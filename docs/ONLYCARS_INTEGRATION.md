# How this app connects to OnlyCars

This app was first built from [BUILD_GUIDE.md](BUILD_GUIDE.md), which assumed the maintenance
website reads mileage straight from Supabase tables. The real website,
[OnlyCars](https://github.com/TomerMeidan/OnlyCars), works differently: Supabase is only the
database behind its API, it has its own accounts, and a reading only affects maintenance reminders
when it is added through the API. This document describes the design that replaced the Supabase
one.

Status: implemented in both repositories (branch `claude/onlycars-integration` here, branch
`claude/obd-integration` in OnlyCars). Not yet tried on a phone with a real adapter, and the
OnlyCars branch must be merged and deployed before the app can connect to the live site.

## Signing in: a device token

The app runs unattended, OnlyCars sign-in tokens last seven days with no refresh, and an account
made with Google has no password. So the app does not sign in at all. Instead:

1. In OnlyCars, Settings, "Connected devices", the user creates a token. It is shown once.
2. The user pastes it into this app. The app checks it by listing the cars, then stores it.

A device token (`ocd_…`) never expires and can do two things only: list the account's cars and
add an odometer reading. Removing it in OnlyCars Settings ends it; the app then keeps its queued
readings and asks for a new token.

The token is kept in the app's private storage (AsyncStorage), not the hardware keystore.
Moving it to `expo-secure-store` is a possible hardening step.

## API

Base URL: `https://onlycars-ev28.onrender.com` (override with `EXPO_PUBLIC_ONLYCARS_URL`).
Every call sends `Authorization: Bearer ocd_…`.

| Purpose | Call |
|---|---|
| List cars | `GET /api/device/vehicles` → `[{ id, nickname, make, model, year, plate, currentOdometerKm }]` |
| Add a reading | `POST /api/device/vehicles/{id}/odometer` with `{ valueKm, readingDate, clientRequestId }` |

Readings added this way are stored with the source `Obd` and shown as "OBD adapter" in the car's
odometer history, where they can be corrected or deleted.

## What the app does

- **Picks an existing car.** After pairing the adapter, the user chooses one of the cars from
  OnlyCars. The app never creates a car.
- **Keeps the baseline on the phone.** `baseline_odometer_km`, `baseline_pid31_km` and the
  "needs re-baseline" flag are local. The dashboard km is prefilled from the car's
  `currentOdometerKm`. OnlyCars only ever receives the calculated odometer.
- **Uploads once per drive.** PID 31 is polled every five minutes, but only the last value of a
  drive is queued: when the adapter disconnects, when the engine stops answering, or at the next
  connect if the app was stopped mid-drive. An unchanged odometer uploads nothing. OnlyCars caps
  a car at 5,000 readings and keeps each as a point in its history.
- **Never duplicates.** Each queued reading has a UUID sent as `clientRequestId`; OnlyCars
  returns the saved reading when the same id arrives twice.
- **Handles rejections** (`src/mileage/outcome.ts`):

| Response | Meaning | App behaviour |
|---|---|---|
| Network error, `408`, `429`, `5xx` | Temporary (no signal, the free host waking up) | Keep in the queue, retry later |
| `401`, `403` | Token removed or wrong | Keep the queue, ask for a new token |
| `odometer.lowerThanPrevious` | The site already has a higher reading | Drop it and ask for the dashboard km again |
| `odometer.higherThanNext` | The site has a newer, lower reading (a queued reading arrived late) | Drop it, show a message |
| `odometer.tooMany` | The car has 5,000 readings | Drop it, show a message |
| Any other `4xx` | The server will never accept it | Drop it, show a message |

## What stayed the same

The Bluetooth side: adapter pairing, the ELM327 layer, PID 31 parsing, the background connect
loop, the Android foreground service and the baseline maths (`src/ble/`, `src/mileage/calc.ts`).
