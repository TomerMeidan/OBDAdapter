import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Keeps the last JavaScript crash on the phone, so the next launch can show what failed without a computer and a
 * USB cable. A native (Java/Kotlin) crash isn't caught here.
 */
const KEY = "lastCrash";

export interface Crash {
  at: string;
  text: string;
}

export function describe(error: unknown, where: string): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const stack = (e.stack ?? "").split("\n").slice(0, 8).join("\n");
  return `${where}: ${e.name}: ${e.message}\n${stack}`;
}

export function recordCrash(text: string): Promise<void> {
  const save = AsyncStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), text } satisfies Crash));
  // Never let a slow write keep the app from closing.
  return Promise.race([save, new Promise<void>((resolve) => setTimeout(resolve, 1500))]).catch(() => undefined);
}

export async function readCrash(): Promise<Crash | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Crash) : null;
  } catch {
    return null;
  }
}

export function clearCrash() {
  return AsyncStorage.removeItem(KEY).catch(() => undefined);
}

type Handler = (error: unknown, isFatal?: boolean) => void;

/** Records an uncaught error before React Native's own handler closes the app. */
export function installCrashRecorder() {
  const errorUtils = (globalThis as { ErrorUtils?: { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void } }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    void recordCrash(describe(error, "Crash")).finally(() => previous(error, isFatal));
  });
}
