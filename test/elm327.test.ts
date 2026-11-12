import assert from "node:assert/strict";
import { test } from "node:test";
import { Elm327, ElmError, parsePid31 } from "../src/ble/elm327.ts";

const b64 = (s: string) => Buffer.from(s, "latin1").toString("base64");

/** Fake adapter: answers each command from `replies`, split into BLE-sized chunks. */
function fakeAdapter(replies: Record<string, string | string[] | null>, serviceUuid = "000018f0-0000-1000-8000-00805f9b34fb") {
  const sent: string[] = [];
  let listener: (e: unknown, c: { value: string | null } | null) => void = () => {};
  const char = (over: object) => ({
    uuid: "x",
    isNotifiable: false,
    isWritableWithResponse: false,
    isWritableWithoutResponse: false,
    monitor: (l: typeof listener) => ((listener = l), { remove() {} }),
    writeWithResponse: async () => {},
    writeWithoutResponse: async (v: string) => {
      const cmd = Buffer.from(v, "base64").toString("latin1").replace("\r", "");
      sent.push(cmd);
      const entry = replies[cmd];
      const reply = Array.isArray(entry) ? entry.shift() : entry;
      if (reply == null) return; // adapter stays silent
      for (let i = 0; i < reply.length; i += 7) {
        setTimeout(() => listener(null, { value: b64(reply.slice(i, i + 7)) }), 0);
      }
    },
    ...over,
  });
  const service = (uuid: string, chars: object[]) => ({ uuid, characteristics: async () => chars });
  const device = {
    discoverAllServicesAndCharacteristics: async () => {},
    services: async () => [
      service("00001801-0000-1000-8000-00805f9b34fb", [char({ isNotifiable: true })]),
      service(serviceUuid, [char({ isNotifiable: true }), char({ isWritableWithoutResponse: true })]),
    ],
  };
  return { device, sent };
}

const init = {
  ATZ: "ATZ\r\r\rELM327 v2.2\r\r>",
  ATE0: "ATE0\rOK\r\r>",
  ATL0: "OK\r\r>",
  ATH0: "OK\r\r>",
  ATSP0: "OK\r\r>",
};

test("initialises the adapter and reads PID 31 across chunked notifications", async () => {
  const { device, sent } = fakeAdapter({ ...init, "0131": "SEARCHING...\r41 31 12 34 \r\r>" });
  const elm = new Elm327();
  await elm.attach(device as never);
  assert.deepEqual(sent, ["ATZ", "ATE0", "ATL0", "ATH0", "ATSP0"]);
  assert.equal(await elm.readPid31(), 0x1234);
});

test("strips echo and prompt from responses", async () => {
  const { device } = fakeAdapter(init);
  const elm = new Elm327();
  await elm.attach(device as never);
  assert.equal(await elm.send("ATZ"), "ELM327 v2.2");
});

test("retries once when the first request times out", async () => {
  const { device, sent } = fakeAdapter({ ...init, "0131": [null as never, "41 31 00 2A\r\r>"] });
  const elm = new Elm327();
  await elm.attach(device as never);
  const realSetTimeout = globalThis.setTimeout;
  // Shrink the 12 s command timeout so the test stays fast.
  globalThis.setTimeout = ((fn: () => void, ms?: number) => realSetTimeout(fn, ms && ms > 1000 ? 20 : ms)) as never;
  try {
    assert.equal(await elm.readPid31(), 42);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(sent.filter((c) => c === "0131").length, 2);
});

test("fails when no UART-style service exists", async () => {
  const elm = new Elm327();
  const device = { discoverAllServicesAndCharacteristics: async () => {}, services: async () => [] };
  await assert.rejects(elm.attach(device as never), /characteristics not found/);
});

test("parsePid31 handles real-world response shapes", () => {
  assert.equal(parsePid31("41 31 FF FE"), 65534);
  assert.equal(parsePid31("4131000A"), 10);
  assert.equal(parsePid31("41 31 01 00\n41 31 01 00"), 256); // two ECUs answering
  const code = (raw: string) => {
    try {
      parsePid31(raw);
    } catch (e) {
      return (e as ElmError).code;
    }
  };
  assert.equal(code("NO DATA"), "NO_DATA");
  assert.equal(code("UNABLE TO CONNECT"), "UNABLE_TO_CONNECT");
  assert.equal(code("CAN ERROR"), "BUS_ERROR");
  assert.equal(code("7F 01 12"), "UNEXPECTED");
});
