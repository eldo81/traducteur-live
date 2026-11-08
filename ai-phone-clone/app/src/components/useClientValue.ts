"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;

/** Reads a browser-only value without a setState-in-effect; `serverValue` during SSR/hydration. */
export function useClientValue<T>(get: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, get, () => serverValue);
}
