"use client";

import { BtcValue, UsdValue } from "./MaskedValue";
import { useHideBalance } from "./HideBalanceProvider";

export function SummaryHeader({
  title,
  subtitle,
  totalUsd,
  totalBtc,
  extra,
}: {
  title: string;
  subtitle?: React.ReactNode;
  totalUsd: number;
  totalBtc: number;
  extra?: React.ReactNode;
}) {
  const { hidden, toggle } = useHideBalance();
  return (
    <section className="card relative overflow-hidden animate-fade-up p-4 sm:p-6">
      <div className="absolute -top-20 -left-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-muted">{title}</p>
          {subtitle && <div className="text-xs text-text-muted/80 mt-0.5">{subtitle}</div>}
          <div className="mt-2 flex items-center gap-2 sm:gap-3 flex-wrap">
            <UsdValue
              value={totalUsd}
              className="text-3xl sm:text-5xl font-extrabold tabular text-text break-all"
            />
            <button
              type="button"
              onClick={toggle}
              aria-label={hidden ? "Show balance" : "Hide balance"}
              title={hidden ? "Show balance" : "Hide balance"}
              className="text-text-muted hover:text-text transition p-1 -mb-1 shrink-0"
            >
              {hidden ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          <BtcValue
            value={totalBtc}
            className="mt-1 block text-sm sm:text-lg text-text-muted tabular"
          />
        </div>
        {extra && <div className="flex items-center gap-2 w-full sm:w-auto">{extra}</div>}
      </div>
    </section>
  );
}
