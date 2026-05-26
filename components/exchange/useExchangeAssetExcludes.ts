"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to per-exchange asset-exclude sets stored in localStorage.
 *
 * Storage key: `excluded-exchange-assets:{exchangeId}` → JSON array of
 * UPPERCASED asset symbols.
 *
 * The exchange-detail toggle hook dispatches a synthetic `storage` event on
 * the same tab so consumers (e.g. the main dashboard) re-render immediately
 * when the user flips a checkbox without needing a full page refresh.
 */
export function useExchangeAssetExcludes(
  exchangeIds: string[],
): Record<string, Set<string>> {
  const [byExchange, setByExchange] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    function read(): Record<string, Set<string>> {
      const out: Record<string, Set<string>> = {};
      for (const id of exchangeIds) {
        try {
          const raw = window.localStorage.getItem(`excluded-exchange-assets:${id}`);
          if (!raw) continue;
          const arr = JSON.parse(raw) as string[];
          if (Array.isArray(arr)) out[id] = new Set(arr.map((a) => a.toUpperCase()));
        } catch {
          // ignore corrupt entries
        }
      }
      return out;
    }
    setByExchange(read());
    const onStorage = () => setByExchange(read());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [exchangeIds]);

  return byExchange;
}
