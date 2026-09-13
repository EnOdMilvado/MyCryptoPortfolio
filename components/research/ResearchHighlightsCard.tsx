"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/format";

interface OverviewSummary {
  sentiment: { value: number; label: string } | null;
  altcoinSeason: { value: number; label: string } | null;
  btcDominance: number | null;
  totalMarketCapUsd: number | null;
  hotTokens: { symbol: string; change7dPct: number | null }[];
}

/**
 * Compact "Research highlights" tile for the main dashboard — the sentiment
 * gauges + a one-line hot-token teaser, with the whole card clickable
 * through to the full /research hub. Keeps the dashboard itself light
 * while making Research actually discoverable (per Or's request — the
 * nav link alone wasn't enough).
 */
export function ResearchHighlightsCard() {
  const [data, setData] = useState<OverviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/research/overview");
        const json = (await res.json()) as OverviewSummary;
        if (!cancelled) setData(json);
      } catch {
        // Silent — this is a dashboard teaser, not a critical widget.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const topHot = data?.hotTokens?.slice(0, 3) ?? [];

  return (
    <Link
      href="/research"
      className="card block animate-fade-up space-y-3 p-4 transition hover:ring-2 hover:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-text">Research highlights</h3>
        <span className="text-xs text-primary">Open →</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Fear &amp; Greed</p>
          <p className="text-lg font-semibold">
            {loading ? "…" : data?.sentiment ? data.sentiment.value : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Altcoin Season</p>
          <p className="text-lg font-semibold">
            {loading ? "…" : data?.altcoinSeason ? data.altcoinSeason.value : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">BTC Dominance</p>
          <p className="text-lg font-semibold">
            {loading ? "…" : data?.btcDominance != null ? `${data.btcDominance.toFixed(1)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Total Mkt Cap</p>
          <p className="text-lg font-semibold">
            {loading
              ? "…"
              : data?.totalMarketCapUsd != null
                ? formatUsd(data.totalMarketCapUsd)
                : "—"}
          </p>
        </div>
      </div>
      {topHot.length > 0 && (
        <p className="truncate text-xs text-text-muted">
          Hot tokens lagging this week:{" "}
          {topHot.map((t, i) => (
            <span key={t.symbol}>
              {i > 0 && ", "}
              <span className="font-semibold text-text">{t.symbol}</span>{" "}
              {t.change7dPct != null && (
                <span className="text-danger">{t.change7dPct.toFixed(1)}%</span>
              )}
            </span>
          ))}
        </p>
      )}
    </Link>
  );
}
