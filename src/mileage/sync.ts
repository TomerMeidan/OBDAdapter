import { fetchVehicle, insertReading, patchVehicle } from "../api/supabase";
import { setStatus } from "../status";
import { item } from "../storage";
import type { Reading, Vehicle } from "../types";
import { decide } from "./calc";

// Uploads wait here while the phone is offline (e.g. underground parking).
type Op =
  | { type: "reading"; reading: Reading }
  | { type: "vehicle"; id: string; patch: Partial<Vehicle> };

const queueStore = item<Op[]>("uploadQueue");
const vehicleStore = item<Vehicle>("vehicle");

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.catch(() => undefined);
  return result;
}

async function flush(): Promise<boolean> {
  const queue = (await queueStore.get()) ?? [];
  let failure: string | null = null;
  while (queue.length) {
    const op = queue[0];
    try {
      if (op.type === "reading") await insertReading(op.reading);
      else await patchVehicle(op.id, op.patch);
    } catch (e) {
      failure = `Upload waiting: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
    queue.shift();
    await queueStore.set(queue);
  }
  setStatus({ pendingUploads: queue.length, message: failure });
  return queue.length === 0;
}

/** Server copy when everything is uploaded, otherwise the local copy (which is newer). */
async function currentVehicle(synced: boolean): Promise<Vehicle | null> {
  if (synced) {
    try {
      const remote = await fetchVehicle();
      if (remote) {
        await vehicleStore.set(remote);
        return remote;
      }
    } catch {
      // offline: fall through to the local copy
    }
  }
  return vehicleStore.get();
}

async function patchLocalAndQueue(vehicle: Vehicle, patch: Partial<Vehicle>, ops: Op[]) {
  await vehicleStore.set({ ...vehicle, ...patch });
  const queue = (await queueStore.get()) ?? [];
  queue.push({ type: "vehicle", id: vehicle.id, patch }, ...ops);
  await queueStore.set(queue);
}

/** Turns a PID 31 value into a reading (or a re-baseline request) and uploads it. */
export function saveReading(pid31: number, readAt = new Date()): Promise<void> {
  return exclusive(async () => {
    const vehicle = await currentVehicle(await flush());
    if (!vehicle) return;

    const at = readAt.toISOString();
    const lastPid31 = await item<number>("lastPid31").get();
    const unchanged = pid31 === lastPid31;
    const decision = decide(vehicle, pid31, lastPid31);
    const reading = (odometer: number): Op => ({
      type: "reading",
      reading: { vehicle_id: vehicle.id, read_at: at, pid31_km: pid31, odometer_km: odometer },
    });

    switch (decision.kind) {
      case "capture_baseline":
        await patchLocalAndQueue(
          vehicle,
          { baseline_pid31_km: pid31, baseline_at: at, needs_rebaseline: false },
          [reading(decision.odometer)],
        );
        await item<number>("lastPid31").set(pid31);
        setStatus({
          lastPid31: pid31,
          lastOdometer: decision.odometer,
          lastReadAt: at,
          needsRebaseline: false,
          nearLimit: false,
        });
        break;
      case "paused":
        setStatus({ lastPid31: pid31, needsRebaseline: true });
        break;
      case "rebaseline":
        await patchLocalAndQueue(vehicle, { needs_rebaseline: true }, []);
        setStatus({ lastPid31: pid31, needsRebaseline: true });
        break;
      case "reading":
        if (!unchanged) {
          const queue = (await queueStore.get()) ?? [];
          queue.push(reading(decision.odometer));
          await queueStore.set(queue);
          await item<number>("lastPid31").set(pid31);
        }
        setStatus({
          lastPid31: pid31,
          lastOdometer: decision.odometer,
          lastReadAt: at,
          needsRebaseline: false,
          nearLimit: decision.nearLimit,
        });
        break;
    }
    await flush();
  });
}

/**
 * Stores a new baseline. With `pid31 === null` the next PID 31 read becomes
 * the baseline, so the dashboard km should be entered before driving on.
 */
export function setBaseline(vehicle: Vehicle, odometerKm: number, pid31: number | null) {
  return exclusive(async () => {
    await flush();
    await item<number>("lastPid31").clear();
    await patchLocalAndQueue(
      vehicle,
      {
        baseline_odometer_km: odometerKm,
        baseline_pid31_km: pid31,
        baseline_at: new Date().toISOString(),
        needs_rebaseline: false,
      },
      [],
    );
    setStatus({ needsRebaseline: false, nearLimit: false, lastOdometer: odometerKm });
    await flush();
  });
}

export function rememberVehicle(vehicle: Vehicle) {
  return vehicleStore.set(vehicle);
}

export function localVehicle() {
  return vehicleStore.get();
}

export function retryUploads() {
  return exclusive(flush);
}

export async function forgetLocalData() {
  await Promise.all([queueStore.clear(), vehicleStore.clear(), item("lastPid31").clear()]);
}
