/** The car this phone's adapter belongs to. Lives on the phone only: OnlyCars knows nothing about baselines. */
export interface Vehicle {
  /** The car's id in OnlyCars. */
  id: string;
  name: string;
  baseline_odometer_km: number;
  /** null = waiting for the app to capture PID 31 on the next read. */
  baseline_pid31_km: number | null;
  baseline_at: string;
  needs_rebaseline: boolean;
}

/** A calculated odometer value on its way to OnlyCars. */
export interface Reading {
  /** Made when the reading is queued and sent as clientRequestId, so a retry never adds it twice. */
  id: string;
  vehicle_id: string;
  read_at: string;
  odometer_km: number;
}

/** A car as OnlyCars lists it for a device token. */
export interface RemoteVehicle {
  id: string;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  currentOdometerKm: number;
}
