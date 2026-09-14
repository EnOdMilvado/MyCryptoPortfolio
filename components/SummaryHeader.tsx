"use client";

import { BtcValue, UsdValue } from "./MaskedValue";
import { useHideBalance } from "./HideBalanceProvider";

export function SummaryHeader({
  title,
  subtitle,
  totalUsd,
  totalBtc,
  changePct24h,
  middleSlot,
  extra,
}: {
  title: string;
  subtitle?: React.ReactNode;
  totalUsd: number;
  totalBtc: number;
  /** Signed 24h % change of totalUsd, shown inline next to the total
   *  (e.g. "▴ 2.4%" in green, or "▾ 1.1%" in red). Omitted entirely when
   *  null (not enough snapshot history yet). */
  changePct24h?: number | null;
  /** Optional widget that sits between the totals (left) and the action
   *  buttons (right). Hidden on mobile via `hidden md:flex` in the slot
   *  itself — the header on small screens stays simple. */
  middleSlot?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const { hidden, toggle } = useHideBalance();
  return (
    <section className="card relative overflow-hidden animate-fade-up px-4 py-3 sm:px-5 sm:py-4">
      <div className="absolute -top-20 -left-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</p>
          {subtitle && <div className="text-[11px] text-text-muted/80 mt-0.5">{subtitle}</div>}
          <div className="mt-1 flex flex-wrap items-end gap-2 sm:gap-3">
            <UsdValue
              value={totalUsd}
              whole
              className="text-3xl sm:text-4xl font-extrabold tabular text-text whitespace-nowrap"
            />
            {changePct24h != null && (
              <span
                className={`text-sm sm:text-base font-bold tabular whitespace-nowrap ${
                  changePct24h >= 0 ? "text-success" : "text-danger"
                }`}
              >
                {changePct24h >= 0 ? "▴" : "▾"} {Math.abs(changePct24h).toFixed(1)}%
              </span>
            )}
            <button
              type="button"
              onClick={toggle}
              aria-label={hidden ? "Show balance" : "Hide balance"}
              title={hidden ? "Show balance" : "Hide balance"}
              className="text-text-muted hover:text-text transition p-1 -mb-0.5 shrink-0"
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
            className="mt-0.5 block text-xs sm:text-sm text-text-muted tabular"
          />
        </div>
        {middleSlot}
        {extra && <div className="flex items-center gap-2 w-full sm:w-auto">{extra}</div>}
      </div>
    </section>
  );
}
