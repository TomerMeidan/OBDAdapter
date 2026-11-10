-- OBD Mileage Sync schema. Run in the Supabase SQL editor.

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  adapter_device_id text,              -- BLE id saved at pairing
  baseline_odometer_km integer not null,
  -- NULL = "baseline entered without a PID 31 value" (e.g. from the website):
  -- the app stores the next PID 31 it reads here.
  baseline_pid31_km integer,
  baseline_at timestamptz not null default now(),
  -- true = baseline is invalid (codes cleared / counter saturated); readings
  -- are paused until a new baseline is entered.
  needs_rebaseline boolean not null default false
);

create table mileage_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  read_at timestamptz not null default now(),
  pid31_km integer not null,
  odometer_km integer not null
);

create index mileage_readings_latest on mileage_readings (vehicle_id, read_at desc);

alter table vehicles enable row level security;
alter table mileage_readings enable row level security;

create policy "own vehicles" on vehicles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own readings" on mileage_readings
  for all to authenticated
  using (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())))
  with check (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())));

-- Latest reading per vehicle, for the website.
create view latest_mileage with (security_invoker = true) as
  select distinct on (vehicle_id) vehicle_id, odometer_km, pid31_km, read_at
  from mileage_readings
  order by vehicle_id, read_at desc;
