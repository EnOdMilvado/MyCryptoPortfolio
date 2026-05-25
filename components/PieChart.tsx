"use client";

import { formatAmount, formatBtc, formatUsd } from "@/lib/format";
import { useHideBalance } from "./HideBalanceProvider";

export interface PieSlice {
  label: string;
  value: number;
  color: string;
  /** Optional sub-line, e.g. number of holdings */
  sub?: string;
  /** Total token amount (for the legend); only used when amountSymbol is set */
  amount?: number;
  amountSymbol?: string | null;
  /** Identifier used by onSliceClick — e.g. the aggregate key "BTC". */
  key?: string;
}

/** Vivid palette that works on both light and dark themes. */
export const CHART_COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#84cc16", // lime
];
export const OTHER_COLOR = "#94a3b8"; // slate-400

/**
 * Canonical brand colors for well-known coins. Anything in this map wins over
 * the palette-by-position assignment so e.g. BTC is always Bitcoin-orange
 * regardless of where it lands in the sorted list.
 *
 * Defaults are tuned for **dark** backgrounds. A handful of coins look better
 * with a different shade on a light page — see KNOWN_COIN_COLORS_LIGHT below.
 * Use `resolveCoinColor(symbol, dark)` to get the right one at runtime.
 */
export const KNOWN_COIN_COLORS: Record<string, string> = {
  BTC: "#F7931A",
  ETH: "#627EEA",
  RAIN: "#C2DF13",
  GEMS: "#30F1B6",
  DOPE: "#FFFFFF",
  LINK: "#2A5ADA",
  BNB: "#F3BA2F",
  SOL: "#14F195",
  USDC: "#2775CA",
  USDT: "#26A17B",
  MATIC: "#8247E5",
  UNI: "#FF007A",
  ARB: "#28A0F0",
  AVAX: "#E84142",
  DOT: "#E6007A",
  ADA: "#0033AD",
  XRP: "#23292F",
  DOGE: "#C2A633",
  SHIB: "#F00500",
  TRX: "#EC0928",
  LTC: "#345D9D",
  PEPE: "#3E9F3E",
  WBTC: "#F09242",
  ATOM: "#2E3148",
  NEAR: "#0A0A0A",
  MKR: "#1AAB9B",
  AAVE: "#B6509E",
  CRO: "#0046AB",
  TON: "#0098EA",
  APT: "#34D399",
  ALGO: "#000000",
  XMR: "#FF6600",
  XLM: "#000000",
  HBAR: "#222",
  ICP: "#3B00B9",
  FIL: "#0090FF",
};

/**
 * Overrides applied only when the page is in **light** mode. Used for coins
 * whose dark-mode brand color is too pale / too bright against a white
 * background (e.g. DOPE which is meant to read as black on light pages).
 */
export const KNOWN_COIN_COLORS_LIGHT: Record<string, string> = {
  GEMS: "#30C799",
  DOPE: "#000000",
};

/**
 * Look up a coin's brand color, theme-aware.
 * Returns `undefined` for unknown coins so the caller can fall back to a
 * palette color.
 */
export function resolveCoinColor(
  symbol: string,
  dark: boolean,
): string | undefined {
  const k = symbol.trim().toUpperCase();
  if (!dark) {
    const light = KNOWN_COIN_COLORS_LIGHT[k];
    if (light) return light;
  }
  return KNOWN_COIN_COLORS[k];
}

function polar(cx: number, cy: number, r: number, angle: number) {
  // angle=0 → 12 o'clock, clockwise
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  };
}

export function PieChart({
  slices,
  totalLabel = "Total",
  holdingsCount,
  coinsCount,
  btcPriceUsd,
  onSliceClick,
}: {
  slices: PieSlice[];
  totalLabel?: string;
  /** Number of underlying holdings (rows in the table). */
  holdingsCount?: number;
  /** Number of distinct coin symbols. */
  coinsCount?: number;
  /** When provided, the legend shows a BTC-equivalent column. */
  btcPriceUsd?: number | null;
  /** When provided, slice + legend rows become clickable. The handler
   *  receives the slice.key (skipped for slices without a key). */
  onSliceClick?: (key: string) => void;
}) {
  const { hidden } = useHideBalance();
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0 || slices.length === 0) {
    return (
      <div className="card text-center text-text-muted text-sm py-10">
        No data to chart yet.
      </div>
    );
  }

  const positive = slices.filter((s) => s.value > 0);
  const cx = 120;
  const cy = 120;
  const r = 100;
  const innerR = 56;

  type Path = { full: true; color: string } | { full: false; color: string; d: string };
  const paths: Path[] = (() => {
    // Special-case: one slice with the entire pie — SVG can't draw a full
    // 360° arc with a single A command.
    if (positive.length === 1) {
      const s = positive[0];
      return [{ full: true, color: s.color }];
    }
    let cum = 0;
    return positive.map((s) => {
      const startAngle = (cum / total) * Math.PI * 2;
      cum += s.value;
      const endAngle = (cum / total) * Math.PI * 2;
      const start = polar(cx, cy, r, startAngle);
      const end = polar(cx, cy, r, endAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      return {
        full: false,
        color: s.color,
        d: `M ${cx},${cy} L ${start.x.toFixed(2)},${start.y.toFixed(2)} A ${r},${r} 0 ${largeArc} 1 ${end.x.toFixed(2)},${end.y.toFixed(2)} Z`,
      } as Path;
    });
  })();

  return (
    <div className="flex flex-col md:flex-row items-center gap-8">
      <div className="relative shrink-0">
        <svg
          width="240"
          height="240"
          viewBox="0 0 240 240"
          className="drop-shadow-sm"
        >
          {paths.map((p, i) =>
            p.full ? (
              <circle key={i} cx={cx} cy={cy} r={r} fill={p.color} />
            ) : (
              <path
                key={i}
                d={p.d}
                fill={p.color}
                stroke="rgb(var(--surface))"
                strokeWidth="2"
              />
            ),
          )}
          {/* Donut hole */}
          <circle cx={cx} cy={cy} r={innerR} fill="rgb(var(--surface))" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
          <span className="text-xs font-semibold text-text-muted">{totalLabel}</span>
          <span className="text-xl font-extrabold text-text tabular">
            {hidden ? "••••" : formatUsd(total)}
          </span>
          {coinsCount != null && (
            <span className="mt-0.5 text-[11px] text-text-muted">
              {coinsCount} {coinsCount === 1 ? "coin" : "coins"}
              {holdingsCount != null && holdingsCount !== coinsCount && (
                <> · {holdingsCount} {holdingsCount === 1 ? "holding" : "holdings"}</>
              )}
            </span>
          )}
          {coinsCount == null && holdingsCount != null && (
            <span className="mt-0.5 text-[11px] text-text-muted">
              {holdingsCount} {holdingsCount === 1 ? "holding" : "holdings"}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 w-full">
        {/* Column header — replaces the old Include/Exclude buttons.
            Labels the numeric columns underneath so the legend reads like
            a real table. Headers + cell values share the same fixed widths
            and left-alignment so every column lines up cleanly. */}
        <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-border text-[11px] uppercase tracking-wide font-semibold text-text-muted">
          <span className="pl-5">Asset</span>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <span className="text-left w-12 sm:w-14">%</span>
            <span className="text-left w-24 sm:w-28">USD</span>
            {btcPriceUsd != null && btcPriceUsd > 0 && (
              <span className="text-left w-24 sm:w-28">BTC</span>
            )}
          </div>
        </div>
        <ul className="space-y-2.5">
          {slices.map((s, i) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            const btcEquiv =
              btcPriceUsd != null && btcPriceUsd > 0
                ? s.value / btcPriceUsd
                : null;
            const hasSecondLine =
              (s.amount != null && s.amountSymbol) || !!s.sub;
            const clickable = onSliceClick && s.key;
            return (
              <li
                key={`${s.label}-${i}`}
                className={`text-sm leading-tight rounded-md -mx-1 px-1 ${
                  clickable
                    ? "cursor-pointer hover:bg-surface-2/60 transition"
                    : ""
                }`}
                onClick={
                  clickable ? () => onSliceClick!(s.key!) : undefined
                }
                title={clickable ? `Click to see wallets holding ${s.label}` : undefined}
              >
                {/* Line 1: color + label/symbol + % + USD + (optional) BTC */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      aria-hidden
                      className="h-3 w-3 rounded-sm shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="font-semibold text-text truncate">
                      {s.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0 tabular">
                    <span className="text-text-muted text-xs text-left w-12 sm:w-14">
                      {pct.toFixed(1)}%
                    </span>
                    <span className="font-semibold text-text text-left w-24 sm:w-28">
                      {hidden ? "••••" : formatUsd(s.value)}
                    </span>
                    {btcEquiv != null && (
                      <span className="text-text-muted text-left w-24 sm:w-28">
                        {hidden ? "••••" : formatBtc(btcEquiv)}
                      </span>
                    )}
                  </div>
                </div>
                {/* Line 2: amount of token + wallet/holding count */}
                {hasSecondLine && (
                  <div className="mt-0.5 pl-5 text-xs text-text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {s.amount != null && s.amountSymbol && (
                      <span className="tabular">
                        {formatAmount(s.amount)} {s.amountSymbol}
                      </span>
                    )}
                    {s.sub && (
                      <span className="text-text-muted/80">{s.sub}</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
