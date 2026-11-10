export interface Vehicle {
  id: string;
  name: string;
  adapter_device_id: string | null;
  baseline_odometer_km: number;
  /** null = waiting for the app to capture PID 31 on the next read. */
  baseline_pid31_km: number | null;
  baseline_at: string;
  needs_rebaseline: boolean;
}

export interface Reading {
  vehicle_id: string;
  read_at: string;
  pid31_km: number;
  odometer_km: number;
}
