"use client";

import { useState, useMemo } from "react";
import { useHideBalance } from "./HideBalanceProvider";
import { formatUsd } from "@/lib/format";
import type { Snapshot } from "./ChangeCards";

/**
 * Center-of-header switcher with 3 swappable highlights. Dot indicators
 * along the bottom let the user click through:
 *
 *   1) 24h change    — big colored "+$X (+Y%)" delta vs ~24h ago snapshot
 *   2) 30-day spark  — gradient-filled mini line of total-USD over a month
 *   3) Top movers    — three pills for the holdings with the biggest 24h
 *                       move (by abs %, filtered to value ≥ $50 so dust
 *                       doesn't dominate the view)
 *
 * Pure SVG / no extra deps. Designed to slot into the empty horizontal
 * gap between the giant total and the right-side action buttons.
 */

export interface HeaderMover {
  symbol: string;
  /** Signed 24h % change (e.g. -3.2 means -3.2%). */
  change24h: number;
  /** Per-token brand color — falls back to a neutral pill if undefined. */
  color?: string | null;
}

interface Props {
  snapshots: Snapshot[];
  currentTotalUsd: number;
  topMovers: HeaderMover[];
}

type View = "change" | "spark" | "movers";

export function HeaderHighlights({ snapshots, currentTotalUsd, topMovers }: Props) {
  const [view, setView] = useState<View>("change");

  // Sort snapshots ascending once for both 24h baseline + sparkline.
  const sorted = useMemo(
    () =>
      [...snapshots].sort(
        (a, b) =>
          new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      ),
    [snapshots],
  );

  // Whether we even have anything to show in each view. We don't hide the
  // widget when one view is empty — we let the user flip to the others —
  // but we use this to decide a sensible default.
  const hasSparkData = sorted.length >= 2;
  const hasMovers = topMovers.length > 0;
  // Don't auto-pick a view that has no data — start on whichever's full.
  // Fallback ordering: 24h change → spark → movers.
  const initialView: View = !hasSparkData && !hasMovers
    ? "change"
    : view;
  const effective = view === initialView ? view : initialView;

  return (
    <div className="hidden md:flex flex-col items-center justify-center gap-1.5 min-w-[180px] max-w-[260px] flex-1">
      <div className="w-full h-[60px] flex items-center justify-center">
        {effective === "change" && (
          <Change24hView snapshots={sorted} currentTotalUsd={currentTotalUsd} />
        )}
        {effective === "spark" && <SparkView snapshots={sorted} />}
        {effective === "movers" && <MoversView movers={topMovers} />}
      </div>
      <Dots view={effective} setView={setView} />
    </div>
  );
}

/* ---------------- 1) 24h change ---------------- */

function Change24hView({
  snapshots,
  currentTotalUsd,
}: {
  snapshots: Snapshot[];
  currentTotalUsd: number;
}) {
  const { hidden } = useHideBalance();
  // Find the snapshot closest to 24h ago. Falls back to the earliest
  // snapshot if we don't yet have 24h of history (user just started).
  const baseline = useMemo(() => {
    if (snapshots.length === 0) return null;
    const targetTs = Date.now() - 24 * 60 * 60 * 1000;
    let best = snapshots[0];
    let bestDiff = Math.abs(new Date(best.capturedAt).getTime() - targetTs);
    for (const s of snapshots) {
      const diff = Math.abs(new Date(s.capturedAt).getTime() - targetTs);
      if (diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    return best;
  }, [snapshots]);

  if (!baseline || baseline.totalUsd <= 0) {
    return <NoData label="24h" />;
  }

  const change = currentTotalUsd - baseline.totalUsd;
  const pct = (change / baseline.totalUsd) * 100;
  const positive = change >= 0;
  const color = positive ? "text-success" : "text-danger";
  const sign = positive ? "+" : "";

  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wide">
        24h change
      </span>
      <span className={`text-xl font-extrabold tabular ${color}`}>
        {hidden ? "••••" : `${sign}${formatUsd(change)}`}
      </span>
      <span className={`text-xs font-semibold tabular ${color}`}>
        {sign}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

/* ---------------- 2) 30-day sparkline ---------------- */

function SparkView({ snapshots }: { snapshots: Snapshot[] }) {
  // Last 30 days only.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const points = snapshots.filter(
    (s) => new Date(s.capturedAt).getTime() >= cutoff,
  );
  if (points.length < 2) {
    return <NoData label="30d trend" />;
  }
  const first = points[0].totalUsd;
  const last = points[points.length - 1].totalUsd;
  const positive = last >= first;
  const stroke = positive ? "rgb(var(--success))" : "rgb(var(--danger))";
  const fill = positive ? "rgb(var(--success) / 0.15)" : "rgb(var(--danger) / 0.15)";

  const width = 220;
  const height = 50;
  const padding = 2;
  const vals = points.map((p) => p.totalUsd);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = (width - padding * 2) / (points.length - 1);
  const line = points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y = padding + (1 - (p.totalUsd - min) / range) * (height - padding * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `${line} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const sign = pct >= 0 ? "+" : "";

  return (
    <div className="flex flex-col items-center w-full">
      <div className="flex items-baseline justify-between w-full px-1">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wide">
          30d trend
        </span>
        <span
          className={`text-[11px] font-bold tabular ${positive ? "text-success" : "text-danger"}`}
        >
          {sign}{pct.toFixed(1)}%
        </span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block"
      >
        <path d={area} fill={fill} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/* ---------------- 3) Top movers ---------------- */

function MoversView({ movers }: { movers: HeaderMover[] }) {
  if (movers.length === 0) {
    return <NoData label="Top movers" />;
  }
  return (
    <div className="flex flex-col items-center gap-1 w-full">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wide">
        Top movers · 24h
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {movers.slice(0, 3).map((m) => {
          const positive = m.change24h >= 0;
          const sign = positive ? "+" : "";
          const dot = m.color ?? (positive ? "rgb(var(--success))" : "rgb(var(--danger))");
          return (
            <span
              key={m.symbol}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2/60 px-2 py-0.5 text-[11px] font-semibold"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: dot }}
              />
              <span className="text-text">{m.symbol.toUpperCase()}</span>
              <span
                className={`tabular ${positive ? "text-success" : "text-danger"}`}
              >
                {sign}{m.change24h.toFixed(1)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Dots + empty state ---------------- */

const DOTS: { id: View; label: string }[] = [
  { id: "change", label: "24h change" },
  { id: "spark", label: "30-day trend" },
  { id: "movers", label: "Top movers" },
];

function Dots({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="tablist">
      {DOTS.map((d) => {
        const active = d.id === view;
        return (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={d.label}
            title={d.label}
            onClick={() => setView(d.id)}
            className={`h-1.5 rounded-full transition-all ${
              active
                ? "w-5 bg-primary"
                : "w-1.5 bg-text-muted/40 hover:bg-text-muted/70"
            }`}
          />
        );
      })}
    </div>
  );
}

function NoData({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wide">
        {label}
      </span>
      <span className="text-xs text-text-muted mt-1">No data yet</span>
    </div>
  );
}
