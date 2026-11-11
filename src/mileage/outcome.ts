/** What to do with a queued reading after an upload attempt failed. */
export type Outcome =
  /** Temporary (no signal, server asleep or busy): keep it and try again later. */
  | "retry"
  /** The token was revoked or mistyped: keep the reading, ask for a new token. */
  | "auth"
  /** The site already has a higher reading: the baseline is wrong, so drop it and ask for a new one. */
  | "rebaseline"
  /** The server will never accept it: drop it so it can't block the queue. */
  | "drop";

/** `status` is the HTTP status (null when there was no response), `code` the API's error code. */
export function classify(status: number | null, code?: string | null): Outcome {
  if (status == null || status === 408 || status === 429 || status >= 500) return "retry";
  if (status === 401 || status === 403) return "auth";
  if (code === "odometer.lowerThanPrevious") return "rebaseline";
  return "drop";
}

/** Why a dropped reading was dropped, for the home screen. */
export function dropMessage(code?: string | null): string {
  switch (code) {
    case "odometer.higherThanNext":
      return "A reading was skipped: OnlyCars already has a newer, lower reading for this car.";
    case "odometer.tooMany":
      return "OnlyCars has reached its limit of odometer readings for this car. Delete old readings on the site.";
    case "http.404":
    case "notFound":
      return "This car was not found in OnlyCars. Pair the adapter again and pick a car.";
    default:
      return `OnlyCars refused a reading${code ? ` (${code})` : ""}.`;
  }
}

/** The phone's calendar date of a reading, as OnlyCars expects it (YYYY-MM-DD). */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A random v4 UUID. Only an idempotency key, so Math.random is enough (Hermes has no crypto.randomUUID). */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
