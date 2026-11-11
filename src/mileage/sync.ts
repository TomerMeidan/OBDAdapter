import { ApiError, postReading } from "../api/onlycars";
import { setStatus } from "../status";
import { item } from "../storage";
import type { Reading, Vehicle } from "../types";
import { decide } from "./calc";
import { classify, dropMessage, uuid } from "./outcome";

// Uploads wait here while the phone is offline (e.g. underground parking).
const queueStore = item<Reading[]>("uploadQueue");
const vehicleStore = item<Vehicle>("vehicle");
const lastPid31Store = item<number>("lastPid31");
/**
 * The newest value of the drive in progress. Only the last one is uploaded, when the drive ends: OnlyCars keeps
 * every reading as a point in the car's history and caps a car at 5,000.
 */
const driveStore = item<{ odometer_km: number; read_at: string }>("currentDrive");
/** The last odometer value queued for upload (or the site's own value at setup), to skip unchanged ones. */
const lastQueuedStore = item<number>("lastQueuedOdometer");

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.catch(() => undefined);
  return result;
}

async function flush(): Promise<void> {
  const queue = (await queueStore.get()) ?? [];
  let message: string | null = null;
  let tokenRejected = false;
  while (queue.length) {
    try {
      await postReading(queue[0]);
    } catch (e) {
      const error = e instanceof ApiError ? e : new ApiError(null, null, String(e));
      const outcome = classify(error.status, error.code);
      if (outcome === "retry") {
        message = `Upload waiting: ${error.message}`;
        break;
      }
      if (outcome === "auth") {
        tokenRejected = true;
        message = "OnlyCars refused the device token. Enter a new one.";
        break;
      }
      if (outcome === "rebaseline") {
        const vehicle = await vehicleStore.get();
        if (vehicle) await vehicleStore.set({ ...vehicle, needs_rebaseline: true });
        setStatus({ needsRebaseline: true });
        message = "OnlyCars already has a higher reading for this car. Enter the dashboard km again.";
      } else {
        message = dropMessage(error.code);
      }
      // Anything below is a reading the server will never take: drop it so it can't block the rest.
    }
    queue.shift();
    await queueStore.set(queue);
  }
  setStatus({ pendingUploads: queue.length, message, tokenRejected });
}

/** Turns a PID 31 value into the drive's current odometer value (or a re-baseline request). Nothing is uploaded yet. */
export function saveReading(pid31: number, readAt = new Date()): Promise<void> {
  return exclusive(async () => {
    const vehicle = await vehicleStore.get();
    if (!vehicle) return;

    const at = readAt.toISOString();
    const decision = decide(vehicle, pid31, await lastPid31Store.get());

    switch (decision.kind) {
      case "capture_baseline":
        await vehicleStore.set({ ...vehicle, baseline_pid31_km: pid31, baseline_at: at, needs_rebaseline: false });
        break;
      case "paused":
        setStatus({ lastPid31: pid31, needsRebaseline: true });
        return;
      case "rebaseline":
        await vehicleStore.set({ ...vehicle, needs_rebaseline: true });
        setStatus({ lastPid31: pid31, needsRebaseline: true });
        return;
      case "reading":
        break;
    }
    await lastPid31Store.set(pid31);
    await driveStore.set({ odometer_km: decision.odometer, read_at: at });
    setStatus({
      lastPid31: pid31,
      lastOdometer: decision.odometer,
      lastReadAt: at,
      needsRebaseline: false,
      nearLimit: decision.kind === "reading" && decision.nearLimit,
    });
  });
}

/**
 * Ends the drive in progress: queues its last value (unless the odometer hasn't moved) and uploads.
 * Called when the adapter disconnects or the engine stops answering, and on the next connect in case the app was
 * stopped mid-drive. Does nothing when no drive is open.
 */
export function endDrive(): Promise<void> {
  return exclusive(async () => {
    const drive = await driveStore.get();
    if (!drive) return;
    const vehicle = await vehicleStore.get();
    if (vehicle && !vehicle.needs_rebaseline && drive.odometer_km !== (await lastQueuedStore.get())) {
      const queue = (await queueStore.get()) ?? [];
      queue.push({ id: uuid(), vehicle_id: vehicle.id, read_at: drive.read_at, odometer_km: drive.odometer_km });
      await queueStore.set(queue);
      await lastQueuedStore.set(drive.odometer_km);
    }
    await driveStore.clear();
    await flush();
  });
}

/**
 * Stores a new baseline. With `pid31 === null` the next PID 31 read becomes
 * the baseline, so the dashboard km should be entered before driving on.
 */
export function setBaseline(vehicle: Pick<Vehicle, "id" | "name">, odometerKm: number, pid31: number | null) {
  return exclusive(async () => {
    await Promise.all([lastPid31Store.clear(), driveStore.clear()]);
    await vehicleStore.set({
      id: vehicle.id,
      name: vehicle.name,
      baseline_odometer_km: odometerKm,
      baseline_pid31_km: pid31,
      baseline_at: new Date().toISOString(),
      needs_rebaseline: false,
    });
    setStatus({ needsRebaseline: false, nearLimit: false, lastOdometer: odometerKm, message: null });
  });
}

/** At setup: what OnlyCars already shows for the car, so the same value isn't uploaded again. */
export function rememberSiteOdometer(km: number) {
  return lastQueuedStore.set(km);
}

export function localVehicle() {
  return vehicleStore.get();
}

export function retryUploads() {
  return exclusive(flush);
}

export async function forgetLocalData() {
  await Promise.all([
    queueStore.clear(),
    vehicleStore.clear(),
    lastPid31Store.clear(),
    driveStore.clear(),
    lastQueuedStore.clear(),
  ]);
  setStatus({ pendingUploads: 0, lastOdometer: null, lastReadAt: null, lastPid31: null, needsRebaseline: false, nearLimit: false, message: null, tokenRejected: false });
}
