import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/mileage/calc.ts";

const base = { baseline_odometer_km: 180000, baseline_pid31_km: 500, needs_rebaseline: false };

test("adds distance driven since the baseline", () => {
  assert.deepEqual(decide(base, 742, 700), { kind: "reading", odometer: 180242, nearLimit: false });
  assert.deepEqual(decide(base, 500), { kind: "reading", odometer: 180000, nearLimit: false });
});

test("counter below the baseline means codes were cleared", () => {
  assert.deepEqual(decide(base, 12), { kind: "rebaseline", reason: "counter_reset" });
});

test("counter below the previous read is a reset even when above the baseline", () => {
  assert.deepEqual(decide(base, 600, 5000), { kind: "rebaseline", reason: "counter_reset" });
});

test("no readings while a re-baseline is pending", () => {
  assert.deepEqual(decide({ ...base, needs_rebaseline: true }, 9000), { kind: "paused" });
});

test("missing PID 31 baseline is captured from the next read", () => {
  const pending = { ...base, baseline_pid31_km: null, needs_rebaseline: true };
  assert.deepEqual(decide(pending, 37), { kind: "capture_baseline", odometer: 180000 });
});

test("warns near the 16-bit limit and stops at it", () => {
  assert.deepEqual(decide(base, 64000), { kind: "reading", odometer: 243500, nearLimit: true });
  assert.deepEqual(decide(base, 65535), { kind: "rebaseline", reason: "counter_saturated" });
});
