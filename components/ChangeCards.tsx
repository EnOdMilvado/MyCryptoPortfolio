"use client";

import { useMemo } from "react";
import { useHideBalance } from "./HideBalanceProvider";
import { useAllHoldings } from "./AllHoldingsView";
import { resolveCoinColor, CHART_COLORS, OTHER_COLOR } from "./PieChart";
import { useTheme } from "./ThemeProvider";
import { SentimentCards } from "./SentimentCards";
import { formatUsd } from "@/lib/format";
import type { FearGreed, AltcoinSeason } from "@/lib/market/sentiment";

export interface Snapshot {
  capturedAt: string;
  totalUsd: number;
}

interface Period {
  key: string;
  label: string;
  ms: number;
}

// 30d and 3m cards were replaced with CMC sentiment widgets (Fear & Greed
// + Altcoin Season) per user request — the snapshot-based percentages
// over those long windows were rarely informative since most users only
// started seeing snapshots fill in over the past few weeks. The 24h card
// stays because it's the only one we have reliable data for from day 1.
const PERIODS: Period[] = [
  { key: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
];

interface ChangeCardsProps {
  snapshots: Snapshot[];
  fearGreed?: FearGreed | null;
  altcoinSeason?: AltcoinSeason | null;
}

export function ChangeCards({
  snapshots,
  fearGreed = null,
  altcoinSeason = null,
}: ChangeCardsProps) {
  const { hidden } = useHideBalance();
  const sorted = useMemo(
    () =>
      [...snapshots].sort(
        (a, b) =>
          new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      ),
    [snapshots],
  );

  // Show the row even when we have no snapshots — the sentiment cards
  // don't depend on user data and should always render so the layout
  // doesn't collapse on first-load.
  if (sorted.length === 0 && fearGreed == null && altcoinSeason == null) {
    return null;
  }

  const latest = sorted[sorted.length - 1] ?? null;
  const now = latest ? new Date(latest.capturedAt).getTime() : Date.now();

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up">
      {latest && PERIODS.map((p) => {
        const cutoff = now - p.ms;
        const inWindow = sorted.filter(
          (s) => new Date(s.capturedAt).getTime() >= cutoff,
        );
        // The reference point is the earliest snapshot in the window
        // (or, if none, the snapshot closest *before* the cutoff).
        let baseline: Snapshot | null = null;
        if (inWindow.length > 0 && new Date(inWindow[0].capturedAt).getTime() <= cutoff + p.ms / 4) {
          baseline = inWindow[0];
        } else {
          const before = sorted.filter(
            (s) => new Date(s.capturedAt).getTime() < cutoff,
          );
          if (before.length > 0) baseline = before[before.length - 1];
        }

        const change = baseline ? latest.totalUsd - baseline.totalUsd : null;
        const pct =
          baseline && baseline.totalUsd > 0
            ? ((latest.totalUsd - baseline.totalUsd) / baseline.totalUsd) * 100
            : null;

        // Sparkline data: all snapshots in this window plus the baseline if
        // it lives before the window.
        const sparkPoints = (() => {
          const pts = [...inWindow];
          if (baseline && !pts.includes(baseline)) pts.unshift(baseline);
          return pts;
        })();

        const positive = change != null && change >= 0;

        return (
          <div key={p.key} className="card-tight space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
                {p.label}
              </span>
              {pct != null && (
                <span
                  className={`text-sm font-bold tabular ${
                    positive ? "text-success" : "text-danger"
                  }`}
                >
                  {positive ? "+" : ""}
                  {pct.toFixed(2)}%
                </span>
              )}
            </div>
            <div>
              {change != null ? (
                <span
                  className={`text-base font-extrabold tabular block ${
                    positive ? "text-success" : "text-danger"
                  }`}
                >
                  {hidden
                    ? "••••"
                    : `${positive ? "+" : ""}${formatUsd(change)}`}
                </span>
              ) : (
                <span className="text-sm text-text-muted">No data yet</span>
              )}
            </div>
            <Sparkline points={sparkPoints} positive={positive} />
          </div>
        );
      })}

      <SentimentCards fearGreed={fearGreed} altcoinSeason={altcoinSeason} />

      <AllocationDonutCard />
    </section>
  );
}

/**
 * Compact "allocation" card sitting where the 1Y card used to live. Shows a
 * mini donut chart of the user's top assets by USD value, with a tiny
 * legend underneath. Reads holdings from AllHoldingsProvider context so it
 * stays in sync with checkbox excludes / network filter.
 */
function AllocationDonutCard() {
  const { hidden } = useHideBalance();
  const { dark } = useTheme();
  const { includedRows } = useAllHoldings();

  const slices = useMemo(() => {
    const map = new Map<
      string,
      { label: string; symbol: string | null; value: number }
    >();
    for (const r of includedRows) {
      if (r.valueUsd <= 0) continue;
      const k = (r.symbol ?? r.name ?? r.contract).toUpperCase();
      const cur = map.get(k);
      if (cur) cur.value += r.valueUsd;
      else
        map.set(k, {
          label: (r.symbol ?? r.name ?? k).trim(),
          symbol: r.symbol,
          value: r.valueUsd,
        });
    }
    const sorted = [...map.entries()].sort((a, b) => b[1].value - a[1].value);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const used = new Set<number>();
    const out = top.map(([, info], i) => {
      const brand = resolveCoinColor(
        (info.symbol ?? info.label).toUpperCase(),
        dark,
      );
      let color: string;
      if (brand) color = brand;
      else {
        let idx = i % CHART_COLORS.length;
        while (used.has(idx) && used.size < CHART_COLORS.length) {
          idx = (idx + 1) % CHART_COLORS.length;
        }
        used.add(idx);
        color = CHART_COLORS[idx];
      }
      return { label: info.label, value: info.value, color };
    });
    if (rest.length > 0) {
      const otherValue = rest.reduce((s, [, info]) => s + info.value, 0);
      out.push({ label: "Other", value: otherValue, color: OTHER_COLOR });
    }
    return out;
  }, [includedRows, dark]);

  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div className="card-tight space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
          Allocation
        </span>
        <span className="text-xs text-text-muted">
          {slices.length === 0
            ? "—"
            : `${slices.length} ${slices.length === 1 ? "asset" : "assets"}`}
        </span>
      </div>
      {total > 0 ? (
        <div className="flex items-center gap-3">
          <MiniDonut slices={slices} total={total} size={56} />
          <div className="flex-1 min-w-0 space-y-0.5">
            {slices.slice(0, 4).map((s) => {
              const pct = (s.value / total) * 100;
              return (
                <div
                  key={s.label}
                  className="flex items-center gap-1.5 text-[10px] leading-tight"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-sm shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-semibold text-text truncate">
                    {s.label}
                  </span>
                  <span className="ml-auto text-text-muted tabular shrink-0">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-text-muted py-4 text-center">
          {hidden ? "••••" : "No data yet"}
        </div>
      )}
    </div>
  );
}

function MiniDonut({
  slices,
  total,
  size,
}: {
  slices: { label: string; value: number; color: string }[];
  total: number;
  size: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const innerR = r * 0.55;
  const positive = slices.filter((s) => s.value > 0);
  if (positive.length === 0 || total <= 0) return null;
  if (positive.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={positive[0].color} />
        <circle cx={cx} cy={cy} r={innerR} fill="rgb(var(--surface))" />
      </svg>
    );
  }
  let cum = 0;
  const paths = positive.map((s) => {
    const start = (cum / total) * Math.PI * 2;
    cum += s.value;
    const end = (cum / total) * Math.PI * 2;
    const sp = { x: cx + r * Math.sin(start), y: cy - r * Math.cos(start) };
    const ep = { x: cx + r * Math.sin(end), y: cy - r * Math.cos(end) };
    const large = end - start > Math.PI ? 1 : 0;
    return {
      color: s.color,
      d: `M ${cx},${cy} L ${sp.x.toFixed(2)},${sp.y.toFixed(2)} A ${r},${r} 0 ${large} 1 ${ep.x.toFixed(2)},${ep.y.toFixed(2)} Z`,
    };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.color}
          stroke="rgb(var(--surface))"
          strokeWidth="1"
        />
      ))}
      <circle cx={cx} cy={cy} r={innerR} fill="rgb(var(--surface))" />
    </svg>
  );
}

function Sparkline({
  points,
  positive,
}: {
  points: Snapshot[];
  positive: boolean;
}) {
  // Need at least 2 points for a line.
  if (points.length < 2) {
    return (
      <div className="h-8 flex items-center justify-center text-[10px] text-text-muted">
        {points.length === 1 ? "Refresh to capture more data" : ""}
      </div>
    );
  }

  const width = 200;
  const height = 32;
  const padding = 2;
  const values = points.map((p) => p.totalUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (width - padding * 2) / (points.length - 1);

  const linePath = points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y = padding + (1 - (p.totalUsd - min) / range) * (height - padding * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  // Closed area path under the line for the fill.
  const areaPath = `${linePath} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;

  const stroke = positive ? "rgb(var(--success))" : "rgb(var(--danger))";
  const fill = positive ? "rgb(var(--success) / 0.15)" : "rgb(var(--danger) / 0.15)";

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
    >
      <path d={areaPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
