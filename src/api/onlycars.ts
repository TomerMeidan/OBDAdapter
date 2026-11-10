import { localDate } from "../mileage/outcome";
import { item } from "../storage";
import type { Reading, RemoteVehicle } from "../types";

const BASE = (process.env.EXPO_PUBLIC_ONLYCARS_URL || "https://onlycars-ev28.onrender.com").replace(/\/+$/, "");

/**
 * The device token made in OnlyCars (Settings, Connected devices). It can only list cars and add odometer
 * readings, never expires, and is revoked from the same Settings page.
 */
const tokenStore = item<string>("deviceToken");
const listeners = new Set<(token: string | null) => void>();

export const getToken = () => tokenStore.get();

export async function setToken(token: string | null) {
  if (token) await tokenStore.set(token);
  else await tokenStore.clear();
  listeners.forEach((l) => l(token));
}

export function onTokenChange(listener: (token: string | null) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A response from OnlyCars that isn't a success. `status` is null when there was no response at all. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(status: number | null, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, token: string | null, method = "GET", body?: unknown): Promise<T> {
  if (!token) throw new ApiError(401, null, "No device token saved.");
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/device${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(null, null, e instanceof Error ? e.message : "No connection");
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { code?: string; detail?: string; title?: string } | null;
    throw new ApiError(res.status, problem?.code ?? null, problem?.detail ?? problem?.title ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** The account's cars. `token` is passed when checking a token that isn't saved yet. */
export async function listVehicles(token?: string): Promise<RemoteVehicle[]> {
  return call<RemoteVehicle[]>("/vehicles", token ?? (await getToken()));
}

export async function postReading(reading: Reading): Promise<void> {
  await call(`/vehicles/${encodeURIComponent(reading.vehicle_id)}/odometer`, await getToken(), "POST", {
    valueKm: reading.odometer_km,
    readingDate: localDate(new Date(reading.read_at)),
    clientRequestId: reading.id,
  });
}
