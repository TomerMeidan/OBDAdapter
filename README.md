# OBD Mileage Sync

React Native (Expo dev build) app that reads a 2009 Honda Accord's mileage through a BLE ELM327
adapter and syncs it to Supabase for the car maintenance website. The car doesn't expose its
odometer over OBD, so the app reads PID `0x31` (km since codes cleared) and adds the difference
to a baseline you enter once. The original plan is in [docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md).

> **Not yet compatible with OnlyCars.** The app currently writes to its own Supabase tables,
> which the OnlyCars website does not read. The required changes are described in
> [docs/ONLYCARS_INTEGRATION.md](docs/ONLYCARS_INTEGRATION.md).

## Setup

1. **Hardware check first** – with Car Scanner, confirm the car answers PID `0131`
   (guide, section 3). If it doesn't, this app can't work for the car.
2. **Supabase** – run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor and create
   a user (Authentication → Users, or "Create account" in the app).
3. **Config** – copy `.env.example` to `.env` and fill in the project URL and anon key.
4. **Build** – BLE does not work in Expo Go, so build a dev client:

   ```bash
   npm install
   ```

   ```bash
   npx expo run:android
   ```

   ```bash
   npx expo run:ios
   ```

5. **Pair** – sign in, start the engine, pick the adapter (`Android-Vlink` / `IOS-Vlink`), and
   type the dashboard odometer. From then on the app reads the mileage whenever the car starts.

On Android, exclude the app from battery optimisation (button on the home screen) and keep the
"Mileage sync active" notification. After a phone reboot, open the app once to restart syncing.
On iOS, don't swipe the app away: iOS won't wake a force-quit app.

## How it behaves

- Reads PID 31 when the adapter connects, then every 5 minutes while connected, and uploads a
  row only when the value changed.
- Readings taken offline are queued on the phone and uploaded later.
- If the counter goes backwards (codes cleared, battery disconnected) or reaches 65,535, the app
  sets `vehicles.needs_rebaseline = true` and stops writing readings until a new baseline is
  entered.

## Website integration

- Latest value: `select * from latest_mileage where vehicle_id = …` (`odometer_km`, `read_at`).
- Show a banner when `vehicles.needs_rebaseline` is true.
- Re-baseline form: update the vehicle with `baseline_odometer_km = <dashboard km>`,
  `baseline_pid31_km = null`, `baseline_at = now()`. The app fills in `baseline_pid31_km` on its
  next read and clears `needs_rebaseline`. (If the user has the PID 31 value from Car Scanner,
  write it and set `needs_rebaseline = false` instead.)

## Development

```bash
npm test
```

```bash
npm run typecheck
```

| Path | Purpose |
|---|---|
| `src/ble/elm327.ts` | ELM327 command/response layer and PID 31 parsing |
| `src/ble/autoConnect.ts` | Background connect-and-read loop, Android foreground service |
| `src/ble/manager.ts` | `BleManager` singleton with iOS state restoration |
| `src/mileage/calc.ts` | Baseline maths and reset detection |
| `src/mileage/sync.ts` | Offline upload queue, baseline updates |
| `src/api/supabase.ts` | Supabase client and queries |
| `src/screens/` | Sign in, pairing/baseline, home |
| `plugins/withForegroundService.js` | Marks the Android service as `connectedDevice` |
