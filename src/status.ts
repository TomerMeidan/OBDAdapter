import { useSyncExternalStore } from "react";
import { item } from "./storage";

export interface Status {
  connection: "stopped" | "waiting" | "connected";
  lastPid31: number | null;
  lastOdometer: number | null;
  lastReadAt: string | null;
  pendingUploads: number;
  needsRebaseline: boolean;
  nearLimit: boolean;
  /** OnlyCars answered 401: the token was revoked or is wrong. */
  tokenRejected: boolean;
  message: string | null;
}

const saved = item<Status>("status");
let status: Status = {
  connection: "stopped",
  lastPid31: null,
  lastOdometer: null,
  lastReadAt: null,
  pendingUploads: 0,
  needsRebaseline: false,
  nearLimit: false,
  tokenRejected: false,
  message: null,
};
const listeners = new Set<() => void>();

export const loaded = saved
  .get()
  .then((s) => {
    if (s) setStatus({ ...s, connection: status.connection, message: status.message }, false);
  })
  .catch(() => undefined);

export function getStatus(): Status {
  return status;
}

export function setStatus(patch: Partial<Status>, persist = true) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
  if (persist) saved.set(status).catch(() => undefined);
}

export function useStatus(): Status {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, getStatus);
}
