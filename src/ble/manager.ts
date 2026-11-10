import { BleManager, State } from "react-native-ble-plx";

// One manager for the whole app. The restore identifier lets iOS relaunch the
// app in the background when the adapter appears; the pending connection is
// re-issued by the auto-connect loop, so the restored state itself is unused.
export const manager = new BleManager({
  restoreStateIdentifier: "obd-mileage-ble",
  restoreStateFunction: () => {},
});

export function waitForPoweredOn(): Promise<void> {
  return new Promise((resolve) => {
    const sub = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        sub.remove();
        resolve();
      }
    }, true);
  });
}
