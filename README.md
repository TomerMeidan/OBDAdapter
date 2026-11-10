# OBD Mileage Sync

React Native (Expo dev build) app that reads a 2009 Honda Accord's mileage through a BLE ELM327
adapter and adds it to the car's odometer history in [OnlyCars](https://github.com/TomerMeidan/OnlyCars).
The car doesn't expose its odometer over OBD, so the app reads PID `0x31` (km since codes cleared)
and adds the difference to a baseline you confirm once. The original plan is in
[docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md) (it describes an earlier Supabase design); how the app
talks to OnlyCars is in [docs/ONLYCARS_INTEGRATION.md](docs/ONLYCARS_INTEGRATION.md).

## Setup

1. **Hardware check first** – with Car Scanner, confirm the car answers PID `0131`
   (guide, section 3). If it doesn't, this app can't work for the car.
2. **OnlyCars** – the site must run a version with device tokens (Settings shows "Connected
   devices"), and the car must already exist there.
3. **Config** – nothing is needed for the live site. To use another OnlyCars server, copy
   `.env.example` to `.env` and set `EXPO_PUBLIC_ONLYCARS_URL`.
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

5. **Connect** – in OnlyCars on the phone, open Settings, Connected devices, create a token and
   copy it. Paste it into the app.
6. **Pair** – start the engine, pick the adapter (`Android-Vlink` / `IOS-Vlink`), pick the car,
   and confirm the dashboard odometer. From then on the app reads the mileage whenever the car
   starts.

On Android, exclude the app from battery optimisation (button on the home screen) and keep the
"Mileage sync active" notification. After a phone reboot, open the app once to restart syncing.
On iOS, don't swipe the app away: iOS won't wake a force-quit app.

## How it behaves

- Reads PID 31 when the adapter connects, then every 5 minutes while connected.
- Uploads **one reading per drive**: the last value, when the adapter disconnects or the engine
  stops answering (or at the next connect, if the app was stopped mid-drive). A drive that didn't
  move the odometer uploads nothing.
- Readings taken offline are queued on the phone and uploaded later. Each carries its own id, so
  a retry never adds a reading twice.
- The baseline lives on the phone only. Reinstalling the app or changing phones means confirming
  the dashboard km again.
- If the counter goes backwards (codes cleared, battery disconnected) or reaches 65,535, or
  OnlyCars already has a higher reading, the app stops and asks for the dashboard km.
- If the token is removed in OnlyCars, the app keeps its readings and asks for a new token.
- In OnlyCars the readings appear in the car's odometer history with the source "OBD adapter",
  and can be corrected or deleted there.

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
| `src/mileage/sync.ts` | One reading per drive, offline upload queue, baseline |
| `src/mileage/outcome.ts` | What to do with a reading OnlyCars refused |
| `src/api/onlycars.ts` | OnlyCars device API client and the stored token |
| `src/screens/` | Token entry, pairing/car/baseline, home |
| `plugins/withForegroundService.js` | Marks the Android service as `connectedDevice` |
