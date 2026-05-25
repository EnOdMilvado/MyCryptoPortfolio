"use client";

import { useMemo } from "react";
import { useHideBalance } from "./HideBalanceProvider";
import { formatUsd } from "@/lib/format";

export interface Snapshot {
  capturedAt: string;
  totalUsd: number;
}

interface Period {
  key: string;
  label: string;
  ms: number;
}

const PERIODS: Period[] = [
  { key: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "3m", label: "3m", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "1y", label: "1y", ms: 365 * 24 * 60 * 60 * 1000 },
];

export function ChangeCards({ snapshots }: { snapshots: Snapshot[] }) {
  const { hidden } = useHideBalance();
  const sorted = useMemo(
    () =>
      [...snapshots].sort(
        (a, b) =>
          new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      ),
    [snapshots],
  );

  if (sorted.length === 0) {
    return null;
  }

  const latest = sorted[sorted.length - 1];
  const now = new Date(latest.capturedAt).getTime();

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up">
      {PERIODS.map((p) => {
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
    </section>
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
