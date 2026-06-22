"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persisted Set of IDs (uppercased) stored in localStorage. Used by the
 * exchange-detail tabs to hide specific assets, trades, deposits, etc.
 */
export function useExcludedIds(storageKey: string) {
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  // Mirror of the current set so `toggle` can compute the next value WITHOUT
  // doing side effects inside a setState updater (updaters run during the
  // render phase — dispatching a storage event there would call other
  // components' listeners mid-render and trigger React's "setState while
  // rendering" error).
  const excludedRef = useRef(excluded);
  excludedRef.current = excluded;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setExcluded(new Set(arr.map((a) => a.toUpperCase())));
      }
    } catch {
      // ignore corrupt entry
    }
  }, [storageKey]);

  const toggle = useCallback(
    (id: string) => {
      const upper = id.toUpperCase();
      const next = new Set(excludedRef.current);
      if (next.has(upper)) next.delete(upper);
      else next.add(upper);
      excludedRef.current = next;
      setExcluded(next);
      // Side effects happen here, in the event handler — never inside the
      // updater. The native `storage` event only fires in OTHER tabs, so we
      // emit a manual one for same-tab listeners (the ExchangesAndOffchain
      // card and the dashboard) to recompute their totals.
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
      } catch {
        // ignore quota errors
      }
    },
    [storageKey],
  );

  return { excluded, toggle } as const;
}
