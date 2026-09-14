"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUsdCompact } from "@/lib/format";
import { FearGreedGauge, AltSeasonBar } from "@/components/SentimentCards";

interface OverviewSummary {
  sentiment: { value: number; label: string } | null;
  altcoinSeason: { value: number; label: string } | null;
  btcDominance: number | null;
  totalMarketCapUsd: number | null;
  marketCapChange24hPct: number | null;
  hotTokens: { symbol: string; change7dPct: number | null }[];
}

/**
 * Unified "Research" tile for the main dashboard — combines the Fear&Greed
 * gauge, Altcoin Season bar, BTC dominance, and total market cap (with 24h
 * change) into ONE card instead of duplicating the sentiment gauges that
 * already exist elsewhere on the page (see ChangeCards/SentimentCards).
 * The whole card links through to /research; hot tokens render as a
 * one-line teaser at the bottom.
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
  const mcapChange = data?.marketCapChange24hPct;

  return (
    <Link
      href="/research"
      className="card block animate-fade-up space-y-3 p-4 transition hover:ring-2 hover:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-text">Research</h3>
        <span className="text-xs text-primary">Open →</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-center rounded-xl border border-border/60 p-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Fear &amp; Greed</p>
          {data?.sentiment ? (
            <>
              <FearGreedGauge score={data.sentiment.value} />
              <div className="-mt-3 text-xl font-extrabold tabular leading-none">
                {data.sentiment.value}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-text-muted">
                {data.sentiment.label}
              </div>
            </>
          ) : (
            <p className="py-6 text-xs text-text-muted">{loading ? "…" : "—"}</p>
          )}
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-border/60 p-3">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Altcoin Season</p>
          {data?.altcoinSeason ? (
            <>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-extrabold tabular leading-none">
                  {data.altcoinSeason.value}
                </span>
                <span className="text-sm text-text-muted">/100</span>
                <span className="ml-auto text-[11px] font-semibold text-text-muted">
                  {data.altcoinSeason.label}
                </span>
              </div>
              <AltSeasonBar score={data.altcoinSeason.value} />
              <div className="flex justify-between text-[10px] font-medium text-text-muted">
                <span>Bitcoin</span>
                <span>Altcoin</span>
              </div>
            </>
          ) : (
            <p className="py-6 text-xs text-text-muted">{loading ? "…" : "—"}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">BTC Dominance</p>
          <p className="text-lg font-semibold">
            {loading ? "…" : data?.btcDominance != null ? `${data.btcDominance.toFixed(2)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Total Mkt Cap</p>
          <div className="flex items-baseline gap-1.5">
            <p className="text-lg font-semibold">
              {loading
                ? "…"
                : data?.totalMarketCapUsd != null
                  ? formatUsdCompact(data.totalMarketCapUsd)
                  : "—"}
            </p>
            {mcapChange != null && (
              <span className={`text-xs font-semibold ${mcapChange >= 0 ? "text-success" : "text-danger"}`}>
                {mcapChange >= 0 ? "+" : ""}
                {mcapChange.toFixed(2)}% (24h)
              </span>
            )}
          </div>
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
