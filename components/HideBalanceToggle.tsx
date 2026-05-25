"use client";

import { useHideBalance } from "./HideBalanceProvider";

export function HideBalanceToggle() {
  const { hidden, toggle } = useHideBalance();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={hidden ? "Show balances" : "Hide balances"}
      title={hidden ? "Show balances" : "Hide balances"}
      className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-surface/80 border border-border backdrop-blur-sm text-text transition hover:bg-surface-2 active:scale-95"
    >
      {hidden ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}
