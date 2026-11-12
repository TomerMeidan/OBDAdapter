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

## Signing key

Release builds are signed with your own key (`plugins/withReleaseSigning.js`), not the React Native
template's shared debug key, whose password is public. Create the key once and keep it out of the
repository:

1. Create the key (pick a strong password and keep it, and a copy of the file, somewhere safe):

   ```bash
   "%JAVA_HOME%\bin\keytool" -genkeypair -v -storetype PKCS12 -keystore %USERPROFILE%\keys\obd-mileage.p12 -alias obd-mileage -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add four lines to `%USERPROFILE%\.gradle\gradle.properties` (forward slashes in the path):

   ```
   OBD_UPLOAD_STORE_FILE=C:/Users/<you>/keys/obd-mileage.p12
   OBD_UPLOAD_STORE_PASSWORD=<password>
   OBD_UPLOAD_KEY_ALIAS=obd-mileage
   OBD_UPLOAD_KEY_PASSWORD=<password>
   ```

3. Run `npx expo prebuild --platform android`, then `npx expo run:android --variant release`.

Without these properties the release build uses the debug key and prints a line saying so. Changing
the key means uninstalling the app first (Android refuses an update signed with another key), which
clears its token and baseline. Losing the key has the same cost, so keep the copy.

## How it behaves

- Reads PID 31 every 5 minutes while the engine runs. Once it stops answering, the drive is over
  and the app stops sending OBD requests, so the car's computers and the adapter can go to sleep.
  While parked it only asks the adapter for the battery voltage once a minute (`ATRV`, answered by
  the adapter without contacting the car); 13.2 V or more means the engine is running again. A
  PID 31 try every 10 minutes covers a car whose voltage doesn't show it. The home screen shows
  the last voltage, so the threshold can be checked on the real car.
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
