"use client";

import { useAllHoldings } from "./AllHoldingsView";

/**
 * Center-of-header widget: the day's top 9 gainers from the user's
 * portfolio (positive 24h % only, ranked descending). Aggregated
 * per-symbol upstream so multi-chain assets count once, and filtered
 * to value ≥ $50 to keep airdrop dust off the headline row.
 *
 * Renders as a 3-column wrapping grid of compact pills:
 *
 *   [SYMBOL  +x.xx%]  [SYMBOL  +x.xx%]  [SYMBOL  +x.xx%]
 *   [SYMBOL  +x.xx%]  [SYMBOL  +x.xx%]  [SYMBOL  +x.xx%]
 *   [SYMBOL  +x.xx%]  [SYMBOL  +x.xx%]  [SYMBOL  +x.xx%]
 *
 * Clicking a pill calls the AllHoldings provider's focusAsset, which
 * (in AggregatedHoldingsTable) expands the matching row and scrolls
 * to it — same drill-down used by the pie/bar chart clicks. The widget
 * relies on being rendered inside an AllHoldingsProvider; on the
 * dashboard, DashboardHeader sits inside that provider already.
 *
 * Hidden on mobile; on small dashboards (few gainers) the grid simply
 * fills as many rows as needed.
 */

export interface HeaderMover {
  symbol: string;
  /** Signed 24h % change. For the gainers widget, only positive values
   *  are passed in — but we still respect the sign for display. */
  change24h: number;
  /** Optional per-token brand color for a tiny dot prefix in the pill. */
  color?: string | null;
}

interface Props {
  topGainers: HeaderMover[];
}

export function HeaderHighlights({ topGainers }: Props) {
  const { focusAsset } = useAllHoldings();

  if (topGainers.length === 0) {
    return (
      <div className="hidden md:flex flex-col items-center justify-center gap-1 min-w-[200px] max-w-[360px] flex-1">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wide">
          Top gainers · 24h
        </span>
        <span className="text-xs text-text-muted">No gainers right now</span>
      </div>
    );
  }

  return (
    <div className="hidden md:flex flex-col items-center justify-center gap-1.5 min-w-[240px] max-w-[420px] flex-1">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wide">
        Top gainers · 24h
      </span>
      <div className="grid grid-cols-3 gap-1.5 w-full">
        {topGainers.slice(0, 9).map((m) => {
          const dot = m.color ?? "rgb(var(--success))";
          // Aggregated table keys by uppercased symbol — see
          // aggregateKey() in AggregatedHoldingsTable.tsx. Matching that
          // exact shape is what lets focusAsset find + expand the row.
          const aggKey = m.symbol.toUpperCase();
          return (
            <button
              key={m.symbol}
              type="button"
              onClick={() => focusAsset(aggKey)}
              className="inline-flex items-center justify-between gap-1 rounded-full bg-surface-2/60 hover:bg-surface-2 px-2 py-0.5 text-[11px] font-semibold min-w-0 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              title={`Jump to ${m.symbol} in holdings (+${m.change24h.toFixed(2)}% / 24h)`}
              aria-label={`Show ${m.symbol} holdings`}
            >
              <span className="inline-flex items-center gap-1 min-w-0">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: dot }}
                />
                <span className="text-text truncate">{m.symbol}</span>
              </span>
              <span className="tabular text-success shrink-0">
                +{m.change24h.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
