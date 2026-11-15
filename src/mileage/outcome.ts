import type { Reading, Vehicle } from "../types";

/** What to do with a queued reading after an upload attempt failed. */
export type Outcome =
  /** Temporary (no signal, server asleep or busy): keep it and try again later. */
  | "retry"
  /** The token was revoked or mistyped: keep the reading, ask for a new token. */
  | "auth"
  /** The site already has a higher reading: the baseline is wrong, so drop it and ask for a new one. */
  | "rebaseline"
  /** The server will never accept it: drop it so it can't block the queue. */
  | "drop";

/** `status` is the HTTP status (null when there was no response), `code` the API's error code. */
export function classify(status: number | null, code?: string | null): Outcome {
  if (status == null || status === 408 || status === 429 || status >= 500) return "retry";
  if (status === 401 || status === 403) return "auth";
  if (code === "odometer.lowerThanPrevious") return "rebaseline";
  return "drop";
}

/** Why a dropped reading was dropped, for the home screen. */
export function dropMessage(code?: string | null): string {
  switch (code) {
    case "odometer.higherThanNext":
      return "A reading was skipped: OnlyCars already has a newer, lower reading for this car.";
    case "odometer.tooMany":
      return "OnlyCars has reached its limit of odometer readings for this car. Delete old readings on the site.";
    case "odometer.deviceImplausible":
      return "A reading was skipped: it was far above the car's last reading in OnlyCars. Check the dashboard km here and the readings on the site.";
    case "vehicle.notFound":
    case "http.404":
      return "This car was not found in OnlyCars (deleted or archived). Pair the adapter again and pick a car.";
    default:
      return `OnlyCars refused a reading${code ? ` (${code})` : ""}.`;
  }
}

/** The phone's calendar date of a reading, as OnlyCars expects it (YYYY-MM-DD). */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A random v4 UUID. Only an idempotency key, so Math.random is enough (Hermes has no crypto.randomUUID). */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** What one pass over the upload queue ended with. */
export interface DrainResult {
  remaining: Reading[];
  message: string | null;
  /** OnlyCars refused the token: the rest waits for a new one. */
  tokenRejected: boolean;
  /** The site has a higher reading: the baseline is wrong. */
  rebaseline: boolean;
}

/**
 * Uploads queued readings in order. A temporary failure or a refused token stops the pass and keeps the rest; a
 * reading the server will never take is dropped so it can't block the queue. `save` is called after each reading
 * leaves the queue, so a pass cut short never uploads one twice (the clientRequestId covers a lost reply).
 */
export async function drain(
  queue: Reading[],
  post: (reading: Reading) => Promise<void>,
  save: (remaining: Reading[]) => Promise<void>,
): Promise<DrainResult> {
  const remaining = [...queue];
  let message: string | null = null;
  let tokenRejected = false;
  let rebaseline = false;
  while (remaining.length) {
    try {
      await post(remaining[0]);
    } catch (e) {
      // An ApiError from the client; anything else counts as "no response" (temporary).
      const error = e as { status?: number | null; code?: string | null; message?: string };
      const outcome = classify(error.status ?? null, error.code ?? null);
      if (outcome === "retry") {
        message = `Upload waiting: ${error.message ?? String(e)}`;
        break;
      }
      if (outcome === "auth") {
        tokenRejected = true;
        message = "OnlyCars refused the device token. Enter a new one.";
        break;
      }
      if (outcome === "rebaseline") {
        rebaseline = true;
        message = "OnlyCars already has a higher reading for this car. Enter the dashboard km again.";
      } else {
        message = dropMessage(error.code);
      }
    }
    remaining.shift();
    await save(remaining);
  }
  return { remaining, message, tokenRejected, rebaseline };
}

/**
 * The reading a finished drive adds to the queue, or null: none while a re-baseline is pending (the value can't be
 * trusted) or when the odometer hasn't moved since the last queued value.
 */
export function driveReading(
  drive: { odometer_km: number; read_at: string },
  vehicle: Vehicle | null,
  lastQueuedKm: number | null,
  id: string,
): Reading | null {
  if (!vehicle || vehicle.needs_rebaseline || drive.odometer_km === lastQueuedKm) return null;
  return { id, vehicle_id: vehicle.id, read_at: drive.read_at, odometer_km: drive.odometer_km };
}
