# Changes needed to connect this app to OnlyCars

This app was built from [BUILD_GUIDE.md](BUILD_GUIDE.md), which assumed the maintenance website
reads mileage straight from Supabase tables. The real website,
[OnlyCars](https://github.com/TomerMeidan/OnlyCars), works differently, so the app as it stands
would sync mileage that the website never sees. This document lists what has to change and why.

Nothing here is implemented yet.

## Why the current design doesn't fit

| The guide assumed | OnlyCars actually does |
|---|---|
| The website reads `mileage_readings` from Supabase | Supabase is only the Postgres database behind an ASP.NET API. The site reads its own `OdometerReadings` table through that API. |
| Users sign in with Supabase Auth, protected by row-level security | OnlyCars has its own accounts (email + password, or Google) and issues its own JWT. It does not use Supabase Auth. |
| The app owns a `vehicles` table with the baseline | OnlyCars already has `Vehicles`, with `CurrentOdometerKm` and `AvgKmPerDay` recomputed on every new reading. |
| The website gets a re-baseline form | OnlyCars has no concept of a baseline or PID 31, and doesn't need one. |

A reading only affects maintenance reminders if it goes through
`POST /api/vehicles/{vehicleId}/odometer`, because that call is what updates the car's current
odometer and average km/day. Writing rows anywhere else does nothing.

## Changes in this app

### 1. Replace Supabase with the OnlyCars API

- Remove `@supabase/supabase-js`, `src/api/supabase.ts`, `supabase/schema.sql` and the
  `EXPO_PUBLIC_SUPABASE_*` settings.
- Add `src/api/onlycars.ts` with one setting, the site's base URL
  (`https://onlycars-ev28.onrender.com`), and these calls:

| Purpose | Call |
|---|---|
| Sign in | `POST /api/auth/login` with `{ email, password }` → `{ token, expiresAt, user }` |
| List cars | `GET /api/vehicles` |
| Upload a reading | `POST /api/vehicles/{id}/odometer` with `{ valueKm, readingDate, clientRequestId }` |

**Why:** it is the only path the website reads from, and it keeps one set of accounts and one
source of truth for mileage.

### 2. Pick an existing car instead of creating one

During setup, after pairing the adapter, show the cars from `GET /api/vehicles` and let the user
choose which one the adapter belongs to. Store that vehicle id on the phone.

**Why:** the car already exists in OnlyCars with its history, tasks and reminders. Creating a
second record would split the data.

### 3. Keep the baseline on the phone

Store `baseline_odometer_km`, `baseline_pid31_km` and the "needs re-baseline" flag in local
storage instead of a database table. The re-baseline prompt lives only in the app.

At setup, pre-fill the dashboard km with the car's `currentOdometerKm` from OnlyCars so the user
only has to confirm or correct it.

**Why:** the baseline is a detail of how this phone turns PID 31 into kilometres. The website
only needs the result. Keeping it local means OnlyCars needs no new tables, columns or screens.
The cost is that reinstalling the app or changing phones means entering the baseline again.

### 4. Upload once per drive, not every five minutes

Keep polling PID 31 while connected, but upload only the last value of a drive: when the adapter
disconnects, or on the next connect if the phone was offline or the app was stopped. Also skip
the upload when the value hasn't changed.

**Why:** OnlyCars caps a car at 5,000 odometer readings and treats each one as a point in the
car's history. A row every five minutes would fill the cap in months and clutter the history
page.

### 5. Use the API's offline protection

Generate a UUID for each reading when it is taken and send it as `clientRequestId`. Keep the
existing local queue for readings taken without signal.

**Why:** OnlyCars already returns the saved reading when the same `clientRequestId` arrives
twice, so a retry after a lost reply can't create a duplicate.

### 6. Handle the API's rejections

| Response | Meaning | App behaviour |
|---|---|---|
| `odometer.lowerThanPrevious` | Calculated km is below a reading already on the site | Don't retry. Ask the user to re-baseline: the baseline is wrong, or someone typed a higher value on the site. |
| `odometer.tooMany` | The car has 5,000 readings | Drop the reading and show a message. |
| `401` | Token expired or revoked | Sign in again (see open decision 1), then retry. |
| Network error / `5xx` / `429` | Temporary | Leave in the queue and retry later. |

**Why:** today every failure is retried forever. With these rules a reading the server will never
accept can't block the queue.

### 7. Sign-in screen

Change the sign-in screen to call OnlyCars. Remove "Create account": registration is closed on
the site (`OpenRegistration: false`).

## Changes in OnlyCars

### 1. Add an `Obd` reading source (small, recommended)

Add `Obd` to the `OdometerSource` enum, let the add-reading request carry a source, and show it
in the history list.

**Why:** without it, automatic readings are stored as `Manual` and are indistinguishable from
ones typed by hand. That matters when a value looks wrong and you need to know where it came
from. The spec already lists "OBD-II odometer" as a planned feature.

The app works without this change; readings would just be labelled Manual.

### 2. Long-lived device token (depends on open decision 1)

Add a way to issue a token that doesn't expire after seven days and that can only add odometer
readings, plus a way to revoke it from Settings.

**Why:** see below.

## Open decisions

### 1. How the app stays signed in

OnlyCars tokens last seven days and there is no refresh endpoint. The app runs unattended, so it
must be able to get a new token without the user.

| Option | Work | Trade-off |
|---|---|---|
| **A. Store the password in the phone's secure keystore** and sign in again when the token expires | App only | The full account password sits on the phone. No OnlyCars changes. |
| **B. Device token** issued by OnlyCars, limited to adding readings, revocable | App + OnlyCars | Safer: a stolen phone can't do anything but post mileage. More work on the site. |

Recommendation: start with A to get the car syncing, move to B later.

### 2. Google-only accounts

If the OnlyCars account was created with Google and has no password, the app can't use
`/api/auth/login`. Either set a password on the account, or add Google sign-in to the app (which
also rules out option A above, since there is no password to store).

## What stays the same

The Bluetooth side is unaffected: adapter pairing, the ELM327 layer, PID 31 parsing, the
background connect loop, the Android foreground service and the baseline maths
(`src/ble/`, `src/mileage/calc.ts`) need no changes.
