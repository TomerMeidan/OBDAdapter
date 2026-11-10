# OBD Mileage Sync – Build Guide

Automatically read the mileage of a 2009 Honda Accord and sync it to the car maintenance website, with no manual connecting.

---

## 1. How it works

```
[Car ignition ON]
      │  powers
      ▼
[Vgate iCar Pro BLE adapter]  ── advertises over BLE ──►  [Phone: React Native app, asleep]
                                                              │ OS wakes app on match
                                                              ▼
                                         ATZ / ATE0 / ATSP0 / 0131  →  km since codes cleared
                                                              │
                                                              ▼
                                         mileage = baseline_odo + (now_0131 − baseline_0131)
                                                              │
                                                              ▼
                                                      [Supabase]  ◄──  [Maintenance website]
```

- The 2009 Accord does **not** expose total odometer over OBD (it's stored in the instrument cluster).
- It **does** (most likely) expose standard PID `0x31` – distance since trouble codes were cleared (0–65,535 km).
- We record one manual "baseline" (dashboard km + PID 31 value at the same moment) and calculate from there.

---

## 2. What you need

| Item | Notes |
|---|---|
| Vgate iCar Pro 2S (or BLE 4.0) | Must be **BLE**. ~€30. Leave it plugged in, it sleeps after ~30 min engine off. |
| Android or iPhone | App runs in background. |
| Node 20+, Android Studio and/or Xcode | For native builds. |
| Supabase project | Free tier is fine. |
| Car Scanner ELM OBD2 app | Only for the first hardware test. |

---

## 3. Phase 1 – Hardware test (do this before writing code)

1. Plug the adapter into the OBD port (under the dashboard, driver side).
2. Ignition ON (engine running is best).
3. Open **Car Scanner** → connect to the adapter.
4. Add sensor **"Distance traveled since codes cleared"** (PID `0131`).
5. ✅ A number appears → continue.
   ❌ Dash / "no data" → this car doesn't support PID 31; stop and fall back to dashboard photo + OCR.
6. Write down: **dashboard odometer km** and **PID 31 value**. This is your first baseline.

---

## 4. Phase 2 – Supabase

```sql
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  adapter_device_id text,              -- BLE id saved at pairing
  baseline_odometer_km integer not null,
  baseline_pid31_km integer not null,
  baseline_at timestamptz not null default now(),
  needs_rebaseline boolean not null default false
);

create table mileage_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,
  read_at timestamptz not null default now(),
  pid31_km integer not null,
  odometer_km integer not null
);
```

- Enable Row Level Security and policies for your user.
- The website reads the latest `mileage_readings` row per vehicle.

---

## 5. Phase 3 – React Native project

`react-native-ble-plx` does **not** work in Expo Go → use an Expo **dev build** (or bare RN).

```bash
npx create-expo-app obd-mileage --template blank-typescript
cd obd-mileage
npx expo install react-native-ble-plx expo-dev-client @supabase/supabase-js buffer
```

`app.json`:

```json
{
  "expo": {
    "plugins": [
      ["react-native-ble-plx", {
        "isBackgroundEnabled": true,
        "modes": ["central"],
        "bluetoothAlwaysPermission": "Used to read mileage from your car's OBD adapter"
      }]
    ],
    "android": {
      "permissions": [
        "BLUETOOTH_SCAN", "BLUETOOTH_CONNECT", "ACCESS_FINE_LOCATION",
        "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_CONNECTED_DEVICE", "POST_NOTIFICATIONS"
      ]
    }
  }
}
```

```bash
npx expo prebuild
npx expo run:android   # or run:ios
```

Suggested structure:

```
src/
  ble/manager.ts       # BleManager singleton + state restoration
  ble/elm327.ts        # send command / wait for '>' / parse
  ble/autoConnect.ts   # pairing + background reconnect loop
  mileage/calc.ts      # baseline math + reset detection
  api/supabase.ts      # upload readings
  screens/Setup.tsx    # pair adapter + enter baseline
```

---

## 6. Phase 4 – Pairing (one time)

1. Request runtime permissions (Android 12+: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`).
2. `manager.startDeviceScan(null, null, cb)` → list devices, user picks the Vgate (`Android-Vlink` / `IOS-Vlink`).
3. Save `device.id` to local storage **and** to `vehicles.adapter_device_id`.
4. User enters dashboard km; app reads PID 31 once → save both as baseline.

---

## 7. Phase 5 – ELM327 communication layer

Adapters expose one **notify** characteristic (answers) and one **write** characteristic (commands). UUIDs differ by brand (`FFF0`, `FFE0`, `18F0`…), so find them by property.

```ts
// src/ble/elm327.ts
import { Buffer } from "buffer";
import { Device, Characteristic } from "react-native-ble-plx";

export class Elm327 {
  private write!: Characteristic;
  private buffer = "";
  private pending?: (r: string) => void;

  async attach(device: Device) {
    await device.discoverAllServicesAndCharacteristics();
    for (const service of await device.services()) {
      const chars = await service.characteristics();
      const notify = chars.find(c => c.isNotifiable);
      const write = chars.find(c => c.isWritableWithResponse || c.isWritableWithoutResponse);
      if (notify && write) {
        this.write = write;
        notify.monitor((err, c) => {
          if (err || !c?.value) return;
          this.buffer += Buffer.from(c.value, "base64").toString("ascii");
          if (this.buffer.includes(">") && this.pending) {
            const r = this.buffer.replace(">", "").trim();
            this.buffer = "";
            this.pending(r);
            this.pending = undefined;
          }
        });
        break;
      }
    }
    if (!this.write) throw new Error("ELM327 characteristics not found");
    await this.send("ATZ");
    await this.send("ATE0");
    await this.send("ATSP0");
  }

  send(cmd: string, timeoutMs = 8000): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout: ${cmd}`)), timeoutMs);
      this.pending = r => { clearTimeout(t); resolve(r); };
      const b64 = Buffer.from(cmd + "\r", "ascii").toString("base64");
      this.write.isWritableWithResponse
        ? this.write.writeWithResponse(b64)
        : this.write.writeWithoutResponse(b64);
    });
  }

  async readPid31(): Promise<number> {
    const raw = await this.send("0131");
    const m = raw.replace(/\s/g, "").match(/4131([0-9A-F]{2})([0-9A-F]{2})/i);
    if (!m) throw new Error(`Unexpected response: ${raw}`);
    return parseInt(m[1], 16) * 256 + parseInt(m[2], 16);
  }
}
```

---

## 8. Phase 6 – Automatic background connection

### Shared logic

```ts
// src/ble/autoConnect.ts (simplified)
async function waitForCar(deviceId: string) {
  const device = await manager.connectToDevice(deviceId, { autoConnect: true }); // waits until adapter appears
  const elm = new Elm327();
  await elm.attach(device);
  const pid31 = await elm.readPid31();
  await saveReading(pid31);                 // calc + upload (section 9)
  manager.onDeviceDisconnected(deviceId, () => waitForCar(deviceId)); // car off → wait again
}
```

### Android
- `autoConnect: true` hands the "connect when seen" job to the Bluetooth chip.
- Run it inside a **foreground service** (e.g. Notifee `asForegroundService` or `react-native-background-actions`) with a small "Mileage sync active" notification, `foregroundServiceType="connectedDevice"` (required on Android 14+).
- Ask the user to exclude the app from battery optimisation.
- Optional upgrade (Android 12+): **CompanionDeviceManager** presence observing – the OS wakes the app when the adapter is near, no permanent notification (needs a small native module).

### iOS
- Background mode `bluetooth-central` (set by the config plugin above).
- Create `BleManager` with `restoreStateIdentifier` + `restoreStateFunction` so iOS can relaunch the app in the background.
- A pending `connectToDevice` never times out on iOS; when the adapter appears, iOS connects and wakes the app (~10 s to work).
- ⚠️ If the user force-quits the app (swipe away), iOS will not wake it until it's opened again.

---

## 9. Phase 7 – Mileage calculation and upload

```ts
// src/mileage/calc.ts
export function calcOdometer(v: Vehicle, pid31: number) {
  if (pid31 < v.baseline_pid31_km) {
    return { needsRebaseline: true as const };     // codes cleared / battery disconnected
  }
  return { needsRebaseline: false as const, odometer: v.baseline_odometer_km + (pid31 - v.baseline_pid31_km) };
}
```

- `needsRebaseline` → set `vehicles.needs_rebaseline = true`, show a banner on website + app: *"Enter current dashboard km"*.
- Otherwise insert into `mileage_readings`.
- If PID 31 approaches 65,535 → also ask for a re-baseline (or clear codes and re-baseline).
- If offline → store the reading locally and upload later.

---

## 10. Phase 8 – Website integration

- Show latest `odometer_km` + "last synced" time.
- Re-baseline form: dashboard km → writes new baseline (the app grabs the matching PID 31 on next drive, or the user enters it from Car Scanner).
- Use `odometer_km` to drive maintenance reminders (oil, tires, etc.).

---

## 11. Testing

1. **At the desk:** ELM327 emulator app (e.g. "ELM327 Emulator" on F-Droid, supports BLE profiles) on a second phone → test parsing and reconnect without the car.
2. **In the car, foreground:** open app, start car, confirm reading.
3. **In the car, background:** lock phone, start car, check Supabase for a new row.
4. **Reset case:** clear codes with Car Scanner → confirm re-baseline flow.
5. **Accuracy:** after a week, compare calculated km with the dashboard.

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| Adapter not found in scan | Ignition ON; Android: location + nearby-devices permissions granted. |
| `SEARCHING...` / timeout on first `0131` | Normal on first command; raise timeout, retry once. |
| `NO DATA` for `0131` | Engine off or PID unsupported – test with engine running. |
| App never wakes on Android | Battery optimisation killing it – whitelist the app, check foreground service runs. |
| App never wakes on iOS | App was force-quit, or state restoration not configured. |
| Wrong/garbled responses | Cheap clone adapter – use a genuine Vgate/OBDLink. |
