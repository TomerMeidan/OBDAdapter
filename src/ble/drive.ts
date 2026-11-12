/**
 * When to talk to the car. While the engine runs, PID 31 is read every few minutes. Once it stops answering, the
 * drive is over and the app stops sending OBD requests, which would wake the car's computers each time and could
 * keep the adapter from going to sleep. While parked it only asks the adapter for the battery voltage (ATRV, which
 * the adapter answers by itself) to notice the next engine start, plus an occasional PID 31 try in case the
 * voltage doesn't show it (a car whose alternator charges gently, or an adapter without ATRV).
 */

export type Mode = "driving" | "parked";

/** At or above this the alternator is charging, so the engine is running. A typical value; check it on the car. */
export const RUNNING_VOLTS = 13.2;
export const DRIVE_POLL_MS = 5 * 60_000;
export const PARKED_POLL_MS = 60_000;
export const PARKED_PID_EVERY_MS = 10 * 60_000;

export interface DriveState {
  mode: Mode;
  /** When PID 31 was last tried while parked (ms since epoch). */
  lastParkedPidAt: number;
}

export interface DriveIo {
  readPid31(): Promise<number>;
  readVoltage(): Promise<number>;
  /** A PID 31 value read while the engine runs. */
  onReading(pid31: number): Promise<void>;
  /** The engine stopped answering: end the drive (queue its last value and upload). */
  onDriveEnd(): Promise<void>;
  onVoltage(volts: number | null): void;
}

/** The state after a fresh connection: parked until the voltage or PID 31 shows the engine running. */
export const initialState = (): DriveState => ({ mode: "parked", lastParkedPidAt: 0 });

/** Runs one step and says how long to wait before the next one. */
export async function step(state: DriveState, io: DriveIo, now: number): Promise<{ state: DriveState; delay: number }> {
  if (state.mode === "driving") {
    try {
      await io.onReading(await io.readPid31());
      return { state, delay: DRIVE_POLL_MS };
    } catch {
      await io.onDriveEnd().catch(() => undefined);
      // Don't try PID 31 again right away: the next parked steps use the voltage.
      return { state: { mode: "parked", lastParkedPidAt: now }, delay: PARKED_POLL_MS };
    }
  }

  let volts: number | null = null;
  try {
    volts = await io.readVoltage();
  } catch {
    // Unreadable: fall back to the occasional PID 31 try below.
  }
  io.onVoltage(volts);
  if (volts !== null && volts >= RUNNING_VOLTS) {
    return { state: { ...state, mode: "driving" }, delay: 0 };
  }

  if (now - state.lastParkedPidAt >= PARKED_PID_EVERY_MS) {
    try {
      await io.onReading(await io.readPid31());
      return { state: { mode: "driving", lastParkedPidAt: now }, delay: DRIVE_POLL_MS };
    } catch {
      return { state: { ...state, lastParkedPidAt: now }, delay: PARKED_POLL_MS };
    }
  }
  return { state, delay: PARKED_POLL_MS };
}
