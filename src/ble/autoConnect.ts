import { Platform } from "react-native";
import BackgroundService from "react-native-background-actions";
import type { Device } from "react-native-ble-plx";
import { endDrive, retryUploads, saveReading } from "../mileage/sync";
import { setStatus } from "../status";
import { item } from "../storage";
import { Elm327 } from "./elm327";
import { manager, waitForPoweredOn } from "./manager";

const POLL_MS = 5 * 60_000; // while driving, so the value kept for the upload is close to the trip's end
const RETRY_MS = 30_000; // adapter awake but ECU silent (ignition off)

export const pairedDevice = item<string>("pairedDeviceId");

let stopCurrent: (() => void) | undefined;
let wake: (() => void) | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function connect(deviceId: string): Promise<Device> {
  if (await manager.isDeviceConnected(deviceId)) {
    const [device] = await manager.devices([deviceId]);
    if (device) return device;
  }
  // autoConnect: Android's Bluetooth stack connects whenever the adapter shows
  // up. iOS ignores the flag; its connect requests never time out anyway.
  return manager.connectToDevice(deviceId, { autoConnect: true });
}

/** Waits for the car, reads PID 31 while it's connected, repeats until stopped. */
async function run(deviceId: string, isActive: () => boolean) {
  while (isActive()) {
    let disconnected = false;
    const elm = new Elm327();
    const sub = manager.onDeviceDisconnected(deviceId, () => {
      disconnected = true;
      wake?.();
    });
    try {
      await waitForPoweredOn();
      setStatus({ connection: "waiting" }, false);
      const device = await connect(deviceId);
      if (!isActive()) break;
      setStatus({ connection: "connected" }, false);
      await elm.attach(device);
      // A drive cut short (app stopped, phone restarted) and anything still queued go up first.
      await endDrive().catch(() => undefined);
      await retryUploads().catch(() => undefined);
      while (isActive() && !disconnected) {
        let delay = POLL_MS;
        try {
          await saveReading(await elm.readPid31());
        } catch {
          // The engine stopped answering: the drive is over, even if the adapter stays powered and connected.
          delay = RETRY_MS;
          await endDrive().catch(() => undefined);
        }
        if (isActive() && !disconnected) await sleep(delay);
      }
    } catch {
      // Bluetooth toggled, connect cancelled, adapter unplugged mid-setup…
      if (isActive()) await sleep(5000);
    } finally {
      sub.remove();
      elm.detach();
      await endDrive().catch(() => undefined);
    }
    if (isActive() && !disconnected) {
      await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
    }
  }
}

/** Starts the background loop for the paired adapter (no-op if already running). */
export async function startAutoConnect() {
  const deviceId = await pairedDevice.get();
  if (!deviceId || stopCurrent) return;
  let active = true;
  stopCurrent = () => {
    active = false;
    wake?.();
  };
  const loop = () => run(deviceId, () => active);

  if (Platform.OS === "android") {
    // The foreground service keeps the process (and its timers) alive.
    try {
      await BackgroundService.start(loop, {
        taskName: "MileageSync",
        taskTitle: "Mileage sync active",
        taskDesc: "Waiting for the car",
        taskIcon: { name: "ic_launcher", type: "mipmap" },
        linkingURI: "obdmileage://",
        foregroundServiceType: ["connectedDevice"],
      });
    } catch (e) {
      // e.g. Android refused a start from the background; retried on next app open.
      active = false;
      stopCurrent = undefined;
      throw e;
    }
  } else {
    void loop();
  }
}

export async function stopAutoConnect() {
  const deviceId = await pairedDevice.get();
  stopCurrent?.();
  stopCurrent = undefined;
  if (deviceId) await manager.cancelDeviceConnection(deviceId).catch(() => undefined);
  if (Platform.OS === "android") await BackgroundService.stop().catch(() => undefined);
  setStatus({ connection: "stopped" }, false);
}

/** Read again now instead of waiting for the next poll (if the car is connected). */
export function readNow() {
  wake?.();
}
