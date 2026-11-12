import { Buffer } from "buffer";

// Structural subset of react-native-ble-plx's Device/Service/Characteristic,
// so this file can be tested without the native module.
export interface ElmCharacteristic {
  uuid: string;
  isNotifiable: boolean;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
  monitor(
    listener: (error: unknown, characteristic: { value: string | null } | null) => void,
  ): { remove(): void };
  writeWithResponse(valueBase64: string): Promise<unknown>;
  writeWithoutResponse(valueBase64: string): Promise<unknown>;
}
export interface ElmService {
  uuid: string;
  characteristics(): Promise<ElmCharacteristic[]>;
}
export interface ElmDevice {
  discoverAllServicesAndCharacteristics(): Promise<unknown>;
  services(): Promise<ElmService[]>;
}

export type ElmErrorCode =
  | "NOT_ATTACHED"
  | "TIMEOUT"
  | "WRITE_FAILED"
  | "NO_DATA" // ECU didn't answer: ignition off or PID unsupported
  | "UNABLE_TO_CONNECT" // adapter found no ECU: ignition off
  | "BUS_ERROR"
  | "UNEXPECTED";

export class ElmError extends Error {
  code: ElmErrorCode;

  constructor(code: ElmErrorCode, message: string) {
    super(message);
    this.name = "ElmError";
    this.code = code;
  }
}

// UART-style services used by common ELM327 BLE adapters (Vgate uses 18F0).
const KNOWN_SERVICES = ["fff0", "ffe0", "18f0", "e7810a71-73ae-499d-8c15-faa9aef0c3f2"];

function isKnownService(uuid: string): boolean {
  const u = uuid.toLowerCase();
  return KNOWN_SERVICES.some((k) => u === k || u.startsWith(`0000${k}-`));
}

/** Parses the answer to `0131` into km since codes were cleared. */
export function parsePid31(raw: string): number {
  const lines = raw
    .toUpperCase()
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s/g, ""));
  for (const line of lines) {
    const m = line.match(/4131([0-9A-F]{2})([0-9A-F]{2})/);
    if (m) return parseInt(m[1], 16) * 256 + parseInt(m[2], 16);
  }
  const flat = lines.join(" ");
  if (flat.includes("NODATA")) throw new ElmError("NO_DATA", "NO DATA for 0131");
  if (flat.includes("UNABLETOCONNECT")) {
    throw new ElmError("UNABLE_TO_CONNECT", "Adapter could not reach the ECU");
  }
  if (/ERROR|STOPPED|BUSBUSY/.test(flat)) throw new ElmError("BUS_ERROR", `Bus error: ${raw}`);
  throw new ElmError("UNEXPECTED", `Unexpected response: ${raw}`);
}

/** Parses the answer to `ATRV` (the adapter's own reading of the car battery, e.g. "12.6V") into volts. */
export function parseVoltage(raw: string): number {
  const m = raw.replace(/\s/g, "").match(/^(\d{1,2}(?:\.\d{1,2})?)V$/i);
  if (!m) throw new ElmError("UNEXPECTED", `Unexpected voltage: ${raw}`);
  return parseFloat(m[1]);
}

export class Elm327 {
  private write?: ElmCharacteristic;
  private subscription?: { remove(): void };
  private buffer = "";
  private pending?: { resolve: (r: string) => void; reject: (e: Error) => void };
  private queue: Promise<unknown> = Promise.resolve();

  async attach(device: ElmDevice) {
    await device.discoverAllServicesAndCharacteristics();
    let found: { notify: ElmCharacteristic; write: ElmCharacteristic } | undefined;
    for (const service of await device.services()) {
      const chars = await service.characteristics();
      const notify = chars.find((c) => c.isNotifiable);
      const write = chars.find((c) => c.isWritableWithResponse || c.isWritableWithoutResponse);
      if (!notify || !write) continue;
      if (isKnownService(service.uuid)) {
        found = { notify, write };
        break;
      }
      found ??= { notify, write };
    }
    if (!found) throw new ElmError("NOT_ATTACHED", "ELM327 characteristics not found");

    this.write = found.write;
    this.subscription = found.notify.monitor((err, c) => {
      if (err) {
        this.fail(new ElmError("WRITE_FAILED", `Notification error: ${String(err)}`));
        return;
      }
      if (c?.value) this.onData(Buffer.from(c.value, "base64").toString("latin1"));
    });

    await this.send("ATZ");
    await this.send("ATE0");
    await this.send("ATL0");
    await this.send("ATH0");
    await this.send("ATSP0");
  }

  detach() {
    this.subscription?.remove();
    this.subscription = undefined;
    this.write = undefined;
    this.fail(new ElmError("NOT_ATTACHED", "Adapter detached"));
  }

  /** Sends one command and resolves with the cleaned-up response lines. */
  send(cmd: string, timeoutMs = 8000): Promise<string> {
    const run = () => this.exchange(cmd, timeoutMs);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async readPid31(): Promise<number> {
    let raw: string;
    try {
      raw = await this.send("0131", 12000);
    } catch (e) {
      // The first request triggers protocol search, which can outlast the timeout.
      if (!(e instanceof ElmError) || e.code !== "TIMEOUT") throw e;
      raw = await this.send("0131", 12000);
    }
    return parsePid31(raw);
  }

  /**
   * The car battery's voltage as the adapter measures it on the OBD port. Answered by the adapter alone: unlike an
   * OBD request, it sends nothing to the car's computers, so it doesn't keep them awake.
   */
  async readVoltage(): Promise<number> {
    return parseVoltage(await this.send("ATRV", 3000));
  }

  private exchange(cmd: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const write = this.write;
      if (!write) {
        reject(new ElmError("NOT_ATTACHED", "Adapter not attached"));
        return;
      }
      this.buffer = "";
      const timer = setTimeout(
        () => this.fail(new ElmError("TIMEOUT", `Timeout: ${cmd}`)),
        timeoutMs,
      );
      this.pending = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(clean(r, cmd));
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const b64 = Buffer.from(cmd + "\r", "latin1").toString("base64");
      const sent = write.isWritableWithResponse
        ? write.writeWithResponse(b64)
        : write.writeWithoutResponse(b64);
      sent.catch((e) => this.fail(new ElmError("WRITE_FAILED", `Write failed: ${String(e)}`)));
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk.replace(/\0/g, "");
    const end = this.buffer.indexOf(">");
    if (end === -1 || !this.pending) return;
    const response = this.buffer.slice(0, end);
    this.buffer = "";
    const { resolve } = this.pending;
    this.pending = undefined;
    resolve(response);
  }

  private fail(error: Error) {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }
}

function clean(response: string, cmd: string): string {
  return response
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l && l.toUpperCase() !== cmd.toUpperCase() && !/^SEARCHING/i.test(l))
    .join("\n");
}
