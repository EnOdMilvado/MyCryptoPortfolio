"use client";

import { useMemo } from "react";
import { formatBtc, formatUsd } from "@/lib/format";
import { useHideBalance } from "./HideBalanceProvider";
import {
  CHART_COLORS,
  resolveCoinColor,
  type PieSlice,
} from "./PieChart";
import { useTheme } from "./ThemeProvider";
import { CmcLink } from "./CmcLink";

export interface BarDatum {
  /** Display label, usually the symbol (e.g. "BTC"). */
  label: string;
  /** Underlying coin symbol — used to look up the brand color. */
  symbol: string | null;
  /** USD value of the holding. */
  value: number;
  /** Token amount (for hover tooltip). */
  amount?: number;
  amountSymbol?: string | null;
  /** Identifier used by onBarClick — e.g. the aggregate key "BTC". */
  key?: string;
  /** USD-weighted 24h % change. */
  change24h?: number | null;
}

/** Compact USD label that fits inside a narrow bar header. */
function compactUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

/**
 * Horizontal-scrollable column chart of the top N coins by USD value.
 *
 * Each column is one coin, colored by its brand color (BTC → orange,
 * ETH → blue, etc.). The chart never wraps — when it runs out of space
 * the container scrolls right, so all top-N coins stay visible.
 */
export function HoldingsBarChart({
  data,
  topN = 15,
  btcPriceUsd,
  onBarClick,
}: {
  data: BarDatum[];
  topN?: number;
  btcPriceUsd?: number | null;
  /** When provided, each bar becomes a button that calls back with the
   *  datum.key — typically wired to expand the same coin's row in the
   *  All-holdings-summary table. */
  onBarClick?: (key: string) => void;
}) {
  const { hidden } = useHideBalance();
  const { dark } = useTheme();

  const bars = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const top = sorted.filter((d) => d.value > 0).slice(0, topN);
    const total = top.reduce((s, d) => s + d.value, 0);
    const maxValue = top.reduce((m, d) => Math.max(m, d.value), 0);
    return top.map((d, i) => {
      const symKey = (d.symbol ?? d.label).trim().toUpperCase();
      const brand = resolveCoinColor(symKey, dark);
      const color = brand ?? CHART_COLORS[i % CHART_COLORS.length];
      const pct = total > 0 ? (d.value / total) * 100 : 0;
      // Bars use 6px min height so the tiny ones stay visible.
      const heightPct = maxValue > 0 ? (d.value / maxValue) * 100 : 0;
      return {
        ...d,
        color,
        pct,
        heightPct: Math.max(heightPct, 2),
      };
    });
  }, [data, topN, dark]);

  if (bars.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-6">
        No data to chart yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* All bars share the available width via flex-1 so 15 bars fit
          inside the card without a horizontal scrollbar. min-w-0 lets
          labels truncate; very narrow viewports still degrade gracefully
          since the symbol label is short. */}
      <ul
        className="flex items-end gap-1 sm:gap-1.5"
        style={{ minHeight: "240px" }}
      >
        {bars.map((b, i) => {
          const btcEquiv =
            btcPriceUsd != null && btcPriceUsd > 0
              ? b.value / btcPriceUsd
              : null;
          const clickable = onBarClick && b.key;
          const tooltip = `${b.label} · ${formatUsd(b.value)}${
            btcEquiv != null ? ` · ${formatBtc(btcEquiv)}` : ""
          } · ${b.pct.toFixed(1)}%${clickable ? " — click to see wallets" : ""}`;
          return (
            <li
              key={`${b.label}-${i}`}
              className={`flex-1 min-w-0 flex flex-col items-center justify-end rounded-md transition ${
                clickable
                  ? "cursor-pointer hover:bg-surface-2/60"
                  : ""
              }`}
              onClick={clickable ? () => onBarClick!(b.key!) : undefined}
              title={tooltip}
            >
              {/* Top label: USD value (compact). */}
              <span className="text-[10px] sm:text-[11px] font-semibold text-text tabular whitespace-nowrap">
                {hidden ? "••••" : compactUsd(b.value)}
              </span>
              {/* 24h change — green/red badge above the bar. */}
              {b.change24h != null && (
                <span
                  className={`text-[9px] sm:text-[10px] font-semibold tabular whitespace-nowrap ${
                    b.change24h >= 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {b.change24h >= 0 ? "+" : ""}
                  {b.change24h.toFixed(2)}%
                </span>
              )}
              {/* Bar — fixed visual area 200px tall. */}
              <div
                className="mt-1 w-full rounded-t-md transition-all"
                style={{
                  height: `${(b.heightPct / 100) * 200}px`,
                  backgroundColor: b.color,
                  boxShadow: `inset 0 -2px 0 ${b.color}88`,
                }}
              />
              {/* Bottom label: symbol + % share. */}
              <span
                className="mt-1.5 text-[10px] sm:text-xs font-bold text-text truncate w-full text-center"
                title={b.label}
              >
                {b.label}
              </span>
              <span className="text-[9px] sm:text-[10px] text-text-muted tabular">
                {b.pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Build BarDatum[] from PieSlice[] (skip the "Other" rollup if present). */
export function barsFromSlices(slices: PieSlice[]): BarDatum[] {
  return slices
    .filter((s) => s.label !== "Other")
    .map((s) => ({
      label: s.label,
      symbol: s.amountSymbol ?? s.label,
      value: s.value,
      amount: s.amount,
      amountSymbol: s.amountSymbol,
    }));
}
