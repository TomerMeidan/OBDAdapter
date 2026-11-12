import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRIVE_POLL_MS,
  PARKED_PID_EVERY_MS,
  PARKED_POLL_MS,
  initialState,
  step,
  type DriveState,
} from "../src/ble/drive.ts";

/** A fake car: `running` decides whether PID 31 answers; `volts` is what ATRV returns (null = unsupported). */
function car(running: boolean, volts: number | null) {
  const log: string[] = [];
  const io = {
    readPid31: async () => {
      log.push("0131");
      if (!running) throw new Error("NO DATA");
      return 500;
    },
    readVoltage: async () => {
      log.push("ATRV");
      if (volts === null) throw new Error("?");
      return volts;
    },
    onReading: async (km: number) => void log.push(`reading ${km}`),
    onDriveEnd: async () => void log.push("end"),
    onVoltage: () => {},
  };
  return { io, log };
}

test("parked with the engine off: only the voltage is read, never PID 31, until the occasional check", async () => {
  const { io, log } = car(false, 12.6);
  let state: DriveState = { mode: "parked", lastParkedPidAt: 0 };
  const start = 1_000_000_000;
  state = (await step(state, io, start)).state; // first step after connecting tries PID 31 once
  log.length = 0;
  for (let i = 1; i <= 9; i++) {
    const next = await step(state, io, start + i * PARKED_POLL_MS);
    assert.equal(next.delay, PARKED_POLL_MS);
    state = next.state;
  }
  assert.deepEqual(log, Array(9).fill("ATRV"));
  await step(state, io, start + PARKED_PID_EVERY_MS);
  assert.deepEqual(log.slice(-2), ["ATRV", "0131"]);
});

test("a charging voltage switches to driving, which then reads PID 31", async () => {
  const { io, log } = car(true, 14.1);
  const first = await step({ mode: "parked", lastParkedPidAt: Date.now() }, io, Date.now());
  assert.deepEqual(first, { state: { mode: "driving", lastParkedPidAt: first.state.lastParkedPidAt }, delay: 0 });
  const second = await step(first.state, io, Date.now());
  assert.equal(second.delay, DRIVE_POLL_MS);
  assert.deepEqual(log, ["ATRV", "0131", "reading 500"]);
});

test("when PID 31 stops answering, the drive ends and the app goes back to voltage only", async () => {
  const { io, log } = car(false, 12.4);
  const now = 5_000_000;
  const next = await step({ mode: "driving", lastParkedPidAt: 0 }, io, now);
  assert.deepEqual(next, { state: { mode: "parked", lastParkedPidAt: now }, delay: PARKED_POLL_MS });
  await step(next.state, io, now + PARKED_POLL_MS);
  assert.deepEqual(log, ["0131", "end", "ATRV"]);
});

test("without a voltage reading, an engine start is still found by the occasional PID 31 try", async () => {
  const { io, log } = car(true, null);
  const next = await step(initialState(), io, 10 * PARKED_PID_EVERY_MS);
  assert.deepEqual(next.state.mode, "driving");
  assert.equal(next.delay, DRIVE_POLL_MS);
  assert.deepEqual(log, ["ATRV", "0131", "reading 500"]);
});

test("a gently charging car (voltage below the threshold) is still found by the occasional PID 31 try", async () => {
  const { io } = car(true, 12.9);
  const next = await step({ mode: "parked", lastParkedPidAt: 0 }, io, PARKED_PID_EVERY_MS);
  assert.equal(next.state.mode, "driving");
});
