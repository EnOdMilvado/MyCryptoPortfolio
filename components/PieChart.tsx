"use client";

import { formatAmount, formatBtc, formatUsd, shortenAddress } from "@/lib/format";
import { tokenExplorerUrl } from "@/lib/chains/explorers";
import { useHideBalance } from "./HideBalanceProvider";
import { CmcLink } from "./CmcLink";

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
  /** USD-weighted 24h % change of the underlying holdings (null = unknown). */
  change24h?: number | null;
  /** Chain of the largest-by-USD contributor (used to deep-link to its
   *  explorer page). When undefined the legend skips the address link. */
  primaryChain?: import("@/lib/chains/types").ChainId;
  /** Contract address on `primaryChain` for the same contributor. */
  primaryContract?: string;
  /** Number of distinct wallets holding this asset (for the legend col). */
  walletCount?: number;
  /** Latest market price per unit (USD). Pulled from our existing price
   *  resolvers — CoinGecko / Alchemy / MEXC ticker — at refresh time. */
  priceUsd?: number | null;
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
  mode = "full",
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
  /** Layout mode: "full" = pie + table side-by-side, "table" = only the
   *  structured table, "pie" = only the donut centered with a compact
   *  legend below it. */
  mode?: "full" | "table" | "pie";
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

  const showBtc = btcPriceUsd != null && btcPriceUsd > 0;

  return (
    <div
      className={`flex ${
        mode === "pie"
          ? "justify-center items-center"
          : "flex-col lg:flex-row items-center gap-6"
      }`}
    >
      {/* Table — only when mode is "full" or "table" */}
      {mode !== "pie" && (
      <div className="flex-1 w-full overflow-x-auto">
        <table className="w-full text-sm tabular border-collapse">
          <thead className="text-[11px] uppercase tracking-wide font-semibold text-text-muted">
            <tr className="border-b border-border">
              <th className="text-left font-semibold px-2 py-2">Asset</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Price</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">24h</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Amount</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">USD</th>
              {showBtc && (
                <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">BTC</th>
              )}
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">%</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Wallets</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Address</th>
              <th className="text-left font-semibold px-2 py-2">CMC</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s, i) => {
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              const btcEquiv = showBtc ? s.value / (btcPriceUsd as number) : null;
              const explorerUrl =
                s.primaryChain && s.primaryContract
                  ? tokenExplorerUrl(s.primaryChain, s.primaryContract)
                  : null;
              const clickable = onSliceClick && s.key;
              return (
                <tr
                  key={`${s.label}-${i}`}
                  className={`border-b border-border/40 last:border-b-0 ${
                    clickable ? "cursor-pointer hover:bg-surface-2/60 transition" : ""
                  }`}
                  onClick={clickable ? () => onSliceClick!(s.key!) : undefined}
                  title={clickable ? `Click to see wallets holding ${s.label}` : undefined}
                >
                  {/* Asset */}
                  <td className="px-2 py-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded-sm shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="font-semibold text-text truncate">
                        {s.label}
                      </span>
                    </div>
                  </td>
                  {/* Price (market) */}
                  <td className="px-2 py-2 text-left text-text-muted whitespace-nowrap">
                    {s.priceUsd == null ? (
                      <span className="text-text-muted">—</span>
                    ) : (
                      formatUsd(s.priceUsd)
                    )}
                  </td>
                  {/* 24h */}
                  <td className="px-2 py-2 text-left whitespace-nowrap font-semibold">
                    {s.change24h == null ? (
                      <span className="text-text-muted">—</span>
                    ) : (
                      <span
                        className={
                          s.change24h >= 0 ? "text-success" : "text-danger"
                        }
                      >
                        {s.change24h >= 0 ? "+" : ""}
                        {s.change24h.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  {/* Amount */}
                  <td className="px-2 py-2 text-left text-text-muted whitespace-nowrap">
                    {s.amount != null && s.amountSymbol ? (
                      <>
                        {formatAmount(s.amount)}{" "}
                        <span className="opacity-60">{s.amountSymbol}</span>
                      </>
                    ) : (
                      <span className="opacity-60">{s.sub ?? "—"}</span>
                    )}
                  </td>
                  {/* USD */}
                  <td className="px-2 py-2 text-left font-semibold text-text whitespace-nowrap">
                    {hidden ? "••••" : formatUsd(s.value)}
                  </td>
                  {/* BTC */}
                  {showBtc && (
                    <td className="px-2 py-2 text-left text-text-muted whitespace-nowrap">
                      {btcEquiv != null
                        ? hidden
                          ? "••••"
                          : formatBtc(btcEquiv)
                        : "—"}
                    </td>
                  )}
                  {/* % */}
                  <td className="px-2 py-2 text-left text-text-muted text-xs">
                    {pct.toFixed(1)}%
                  </td>
                  {/* Wallets */}
                  <td className="px-2 py-2 text-left text-text-muted text-xs">
                    {s.walletCount ?? "—"}
                  </td>
                  {/* Address (explorer link) */}
                  <td className="px-2 py-2 text-left">
                    {explorerUrl && s.primaryContract ? (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs text-primary hover:text-primary-hover"
                        title={s.primaryContract}
                      >
                        {shortenAddress(s.primaryContract, 6, 4)} ↗
                      </a>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </td>
                  {/* CMC link */}
                  <td className="px-2 py-2 text-left w-8">
                    {s.key && s.label !== "Other" && (
                      <CmcLink symbol={s.amountSymbol ?? s.label} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-border bg-surface-2/40">
            <tr className="font-bold text-text">
              <td className="px-2 py-2 text-left text-xs uppercase tracking-wide text-text-muted">
                Total
              </td>
              <td className="px-2 py-2" />
              <td className="px-2 py-2" />
              <td className="px-2 py-2" />
              <td className="px-2 py-2 text-left whitespace-nowrap">
                {hidden ? "••••" : formatUsd(total)}
              </td>
              {showBtc && (
                <td className="px-2 py-2 text-left text-text-muted whitespace-nowrap">
                  {hidden ? "••••" : formatBtc(total / (btcPriceUsd as number))}
                </td>
              )}
              <td className="px-2 py-2 text-left text-xs text-text-muted">100%</td>
              <td className="px-2 py-2" />
              <td className="px-2 py-2" />
              <td className="px-2 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
      )}

      {/* Pie — only when mode is "full" or "pie" */}
      {mode !== "table" && (
      <div className="relative shrink-0 mx-auto lg:mx-0">
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
      )}

    </div>
  );
}
