import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/api/errors.ts";
import { drain, driveReading } from "../src/mileage/outcome.ts";
import type { Reading, Vehicle } from "../src/types.ts";

const reading = (id: string, km = 1000): Reading => ({ id, vehicle_id: "car", read_at: "2026-11-15T10:00:00Z", odometer_km: km });

/** `answers[id]` is what posting that reading does: an ApiError to throw, or nothing for success. */
function server(answers: Record<string, ApiError | Error | undefined>) {
  const posted: string[] = [];
  const saves: string[][] = [];
  return {
    post: async (r: Reading) => {
      posted.push(r.id);
      const answer = answers[r.id];
      if (answer) throw answer;
    },
    save: async (remaining: Reading[]) => void saves.push(remaining.map((r) => r.id)),
    posted,
    saves,
  };
}

test("uploads everything in order and saves the queue after each reading", async () => {
  const s = server({});
  const result = await drain([reading("a"), reading("b")], s.post, s.save);
  assert.deepEqual(s.posted, ["a", "b"]);
  assert.deepEqual(s.saves, [["b"], []]);
  assert.deepEqual(result, { remaining: [], message: null, tokenRejected: false, rebaseline: false });
});

test("a temporary failure keeps that reading and the rest", async () => {
  for (const error of [new ApiError(null, null, "offline"), new ApiError(503, null, "asleep"), new ApiError(429, "odometer.deviceTooMany", "cap")]) {
    const s = server({ b: error });
    const result = await drain([reading("a"), reading("b"), reading("c")], s.post, s.save);
    assert.deepEqual(result.remaining.map((r) => r.id), ["b", "c"]);
    assert.match(result.message!, /^Upload waiting/);
    assert.deepEqual(s.posted, ["a", "b"]);
  }
});

test("a refused token stops the pass, keeps everything, and asks for a new token", async () => {
  const s = server({ a: new ApiError(401, null, "Unauthorized") });
  const result = await drain([reading("a"), reading("b")], s.post, s.save);
  assert.equal(result.tokenRejected, true);
  assert.deepEqual(result.remaining.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(s.saves, []);
});

test("a lower reading than the site's drops it, asks for a new baseline, and carries on", async () => {
  const s = server({ a: new ApiError(400, "odometer.lowerThanPrevious", "lower") });
  const result = await drain([reading("a"), reading("b")], s.post, s.save);
  assert.equal(result.rebaseline, true);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(s.posted, ["a", "b"]);
});

test("a reading the server will never take is dropped with its message, and the rest goes up", async () => {
  const s = server({ a: new ApiError(404, "vehicle.notFound", "gone") });
  const result = await drain([reading("a"), reading("b")], s.post, s.save);
  assert.deepEqual(result.remaining, []);
  assert.match(result.message!, /Pair the adapter again/);
  assert.equal(result.rebaseline, false);
});

test("an unexpected error is treated as temporary", async () => {
  const s = server({ a: new Error("boom") });
  const result = await drain([reading("a")], s.post, s.save);
  assert.equal(result.remaining.length, 1);
});

const vehicle: Vehicle = {
  id: "car",
  name: "Accord",
  baseline_odometer_km: 180000,
  baseline_pid31_km: 500,
  baseline_at: "2026-11-01T00:00:00Z",
  needs_rebaseline: false,
};
const drive = { odometer_km: 180242, read_at: "2026-11-15T10:00:00Z" };

test("a finished drive queues its last value", () => {
  assert.deepEqual(driveReading(drive, vehicle, 180000, "id-1"), { id: "id-1", vehicle_id: "car", read_at: drive.read_at, odometer_km: 180242 });
});

test("a drive that didn't move the odometer, a pending re-baseline, or no car queues nothing", () => {
  assert.equal(driveReading(drive, vehicle, 180242, "x"), null);
  assert.equal(driveReading(drive, { ...vehicle, needs_rebaseline: true }, 180000, "x"), null);
  assert.equal(driveReading(drive, null, null, "x"), null);
});
