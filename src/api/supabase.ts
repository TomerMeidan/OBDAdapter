import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Reading, Vehicle } from "../types";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "missing", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** The signed-in user's vehicle (this app manages one car). */
export async function fetchVehicle(): Promise<Vehicle | null> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .order("baseline_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Vehicle | null;
}

export async function createVehicle(
  v: Pick<Vehicle, "name" | "adapter_device_id" | "baseline_odometer_km" | "baseline_pid31_km">,
): Promise<Vehicle> {
  const { data, error } = await supabase.from("vehicles").insert(v).select().single();
  if (error) throw new Error(error.message);
  return data as Vehicle;
}

export async function patchVehicle(id: string, patch: Partial<Vehicle>): Promise<void> {
  const { error } = await supabase.from("vehicles").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertReading(reading: Reading): Promise<void> {
  const { error } = await supabase.from("mileage_readings").insert(reading);
  if (error) throw new Error(error.message);
}
