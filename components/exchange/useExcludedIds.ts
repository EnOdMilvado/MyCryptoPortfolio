"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Persisted Set of IDs (uppercased) stored in localStorage. Used by the
 * exchange-detail tabs to hide specific assets, trades, deposits, etc.
 */
export function useExcludedIds(storageKey: string) {
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());

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
      setExcluded((prev) => {
        const next = new Set(prev);
        if (next.has(upper)) next.delete(upper);
        else next.add(upper);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
          // Notify listeners in this same tab. The native `storage` event only
          // fires in OTHER tabs, so we emit a manual one for the dashboard
          // ExchangesAndOffchain card to recompute its total.
          window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
        } catch {
          // ignore quota errors
        }
        return next;
      });
    },
    [storageKey],
  );

  return { excluded, toggle } as const;
}
