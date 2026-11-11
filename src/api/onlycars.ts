import * as SecureStore from "expo-secure-store";
import { localDate } from "../mileage/outcome";
import { item } from "../storage";
import type { Reading, RemoteVehicle } from "../types";

const BASE = (process.env.EXPO_PUBLIC_ONLYCARS_URL || "https://onlycars-ev28.onrender.com").replace(/\/+$/, "");

/**
 * The device token made in OnlyCars (Settings, Connected devices). It can only list cars and add odometer
 * readings, never expires, and is revoked from the same Settings page.
 *
 * Kept in SecureStore (Android Keystore / iOS Keychain), not AsyncStorage. After first unlock, because the background
 * loop uploads while the phone is locked; this device only, so a backup never carries it to another phone.
 */
const TOKEN_KEY = "deviceToken";
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
/** Where versions before secure storage kept the token. Moved on first read, then cleared. */
const legacyTokenStore = item<string>(TOKEN_KEY);
const listeners = new Set<(token: string | null) => void>();

/** The saved token, or null. Never rejects: an unreadable store reads as "no token", so the app asks for one again. */
export async function getToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY, SECURE);
    if (token) return token;
    const legacy = await legacyTokenStore.get();
    if (!legacy) return null;
    await SecureStore.setItemAsync(TOKEN_KEY, legacy, SECURE);
    await legacyTokenStore.clear();
    return legacy;
  } catch {
    return null;
  }
}

export async function setToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE);
  else await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE);
  await legacyTokenStore.clear();
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
