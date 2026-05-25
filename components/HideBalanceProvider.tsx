"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "crypto-hide-balance";

interface Ctx {
  hidden: boolean;
  toggle: () => void;
}

const HideBalanceContext = createContext<Ctx | null>(null);

export function HideBalanceProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      setHidden(v === "1");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  return (
    <HideBalanceContext.Provider value={{ hidden, toggle }}>
      {children}
    </HideBalanceContext.Provider>
  );
}

export function useHideBalance(): Ctx {
  const ctx = useContext(HideBalanceContext);
  // Safe fallback so non-wrapped client components don't crash; they just
  // never hide values.
  if (!ctx) return { hidden: false, toggle: () => {} };
  return ctx;
}

/** Shorthand: returns the masked placeholder when hidden, otherwise null. */
export function useMaskedValue(): string | null {
  const { hidden } = useHideBalance();
  return hidden ? "••••" : null;
}
