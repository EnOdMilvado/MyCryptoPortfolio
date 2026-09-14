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
      className="card block animate-fade-up p-3 transition hover:ring-2 hover:ring-primary/40"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-text">Research</h3>
        <span className="text-xs text-primary">Open →</span>
      </div>

      {/* Data packed on the LEFT, Fear & Greed pinned to the RIGHT (per
          Or's latest spec) so the card fills its width instead of leaving
          ~40% empty. On mobile it stacks: metrics first, gauge below. */}
      <div className="grid gap-3 lg:grid-cols-[1fr_190px]">
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 p-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Altcoin Season</p>
              {data?.altcoinSeason ? (
                <>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="text-lg font-extrabold tabular leading-none">{data.altcoinSeason.value}</span>
                    <span className="text-xs text-text-muted">/100</span>
                  </div>
                  <p className="text-[11px] font-semibold text-text-muted">{data.altcoinSeason.label}</p>
                  <AltSeasonBar score={data.altcoinSeason.value} />
                </>
              ) : (
                <p className="py-2 text-xs text-text-muted">{loading ? "…" : "—"}</p>
              )}
            </div>

            <div className="rounded-lg border border-border/60 p-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">BTC Dominance</p>
              <p className="mt-0.5 text-lg font-semibold">
                {loading ? "…" : data?.btcDominance != null ? `${data.btcDominance.toFixed(2)}%` : "—"}
              </p>
            </div>

            <div className="rounded-lg border border-border/60 p-2">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Total Mkt Cap</p>
              <p className="mt-0.5 text-lg font-semibold leading-none">
                {loading
                  ? "…"
                  : data?.totalMarketCapUsd != null
                    ? formatUsdCompact(data.totalMarketCapUsd)
                    : "—"}
              </p>
              {mcapChange != null && (
                <span className={`text-[11px] font-semibold ${mcapChange >= 0 ? "text-success" : "text-danger"}`}>
                  {mcapChange >= 0 ? "+" : ""}
                  {mcapChange.toFixed(2)}% (24h)
                </span>
              )}
            </div>
          </div>

          {topHot.length > 0 && (
            <p className="truncate text-xs text-text-muted">
              Hot tokens lagging this week: {" "}
              {topHot.map((t, i) => (
                <span key={t.symbol}>
                  {i > 0 && ", "}
                  <span className="font-semibold text-text">{t.symbol}</span>{" "}
                  {t.change7dPct != null && <span className="text-danger">{t.change7dPct.toFixed(1)}%</span>}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 p-2">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Fear &amp; Greed</p>
          {data?.sentiment ? (
            <div className="flex w-full flex-col items-center">
              <FearGreedGauge score={data.sentiment.value} />
              <div className="-mt-3 text-xl font-extrabold tabular leading-none">
                {data.sentiment.value}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-text-muted">
                {data.sentiment.label}
              </div>
            </div>
          ) : (
            <p className="py-6 text-xs text-text-muted">{loading ? "…" : "—"}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
