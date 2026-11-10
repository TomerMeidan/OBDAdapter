import type { Vehicle } from "../types";

/** PID 0x31 is a 16-bit counter that stops (does not wrap) at 65,535 km. */
export const PID31_MAX = 65535;
/** From here on we warn the user to clear codes and re-baseline. */
export const PID31_NEAR_LIMIT = 64000;

export type Baseline = Pick<
  Vehicle,
  "baseline_odometer_km" | "baseline_pid31_km" | "needs_rebaseline"
>;

export type Decision =
  /** Baseline km was entered without a PID 31 value: this read becomes the baseline. */
  | { kind: "capture_baseline"; odometer: number }
  /** A re-baseline is already pending; nothing can be calculated. */
  | { kind: "paused" }
  /** Counter went backwards (codes cleared / battery disconnected) or hit its ceiling. */
  | { kind: "rebaseline"; reason: "counter_reset" | "counter_saturated" }
  | { kind: "reading"; odometer: number; nearLimit: boolean };

/**
 * Turns a PID 31 value into an odometer reading, or says why it can't.
 * `lastPid31` is the previous value read for this baseline, used to catch a
 * reset that the baseline comparison alone would miss.
 */
export function decide(v: Baseline, pid31: number, lastPid31?: number | null): Decision {
  if (v.baseline_pid31_km == null) {
    return { kind: "capture_baseline", odometer: v.baseline_odometer_km };
  }
  if (v.needs_rebaseline) return { kind: "paused" };
  if (pid31 >= PID31_MAX) return { kind: "rebaseline", reason: "counter_saturated" };
  if (pid31 < v.baseline_pid31_km || (lastPid31 != null && pid31 < lastPid31)) {
    return { kind: "rebaseline", reason: "counter_reset" };
  }
  return {
    kind: "reading",
    odometer: v.baseline_odometer_km + (pid31 - v.baseline_pid31_km),
    nearLimit: pid31 >= PID31_NEAR_LIMIT,
  };
}
