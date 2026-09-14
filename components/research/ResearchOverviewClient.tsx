"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { FearGreedGauge, AltSeasonBar } from "@/components/SentimentCards";

interface HotToken {
  id: string;
  symbol: string;
  name: string;
  image: string;
  priceUsd: number;
  marketCapUsd: number;
  rank: number;
  change24hPct: number | null;
  change7dPct: number | null;
}

interface Recommendation {
  id: string;
  symbol: string;
  name: string;
  image: string;
  priceUsd: number;
  rank: number;
  change7dPct: number | null;
  isHeld: boolean;
}

interface OverviewResponse {
  sentiment: { value: number; label: string } | null;
  altcoinSeason: { value: number; label: string } | null;
  btcDominance: number | null;
  totalMarketCapUsd: number | null;
  marketCapChange24hPct: number | null;
  hotTokens: HotToken[];
  recommendations: Recommendation[];
  fetchedAt: string;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-text-muted">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`font-semibold ${positive ? "text-success" : "text-danger"}`}>
      {positive ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

type HotFilter = "all" | "top50" | "big-caps";

export function ResearchOverviewClient() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HotFilter>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/research/overview");
        const json = (await res.json()) as OverviewResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredHotTokens = useMemo(() => {
    const tokens = data?.hotTokens ?? [];
    if (filter === "top50") return tokens.filter((t) => t.rank <= 50);
    if (filter === "big-caps") return tokens.filter((t) => t.marketCapUsd >= 1_000_000_000);
    return tokens;
  }, [data, filter]);

  const heldRecs = useMemo(() => (data?.recommendations ?? []).filter((r) => r.isHeld), [data]);
  const newRecs = useMemo(() => (data?.recommendations ?? []).filter((r) => !r.isHeld), [data]);

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card flex flex-col items-center p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted">Fear &amp; Greed</p>
          {data?.sentiment ? (
            <>
              <FearGreedGauge score={data.sentiment.value} />
              <div className="-mt-3 text-2xl font-extrabold tabular leading-none">
                {data.sentiment.value}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-text-muted">
                {data.sentiment.label}
              </div>
            </>
          ) : (
            <div className="py-6 text-2xl font-semibold text-text-muted">{loading ? "…" : "—"}</div>
          )}
        </div>
        <div className="card flex flex-col justify-center p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted">Altcoin Season</p>
          {data?.altcoinSeason ? (
            <>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold tabular leading-none">
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
            <div className="py-6 text-2xl font-semibold text-text-muted">{loading ? "…" : "—"}</div>
          )}
        </div>
        <Tile
          label="BTC Dominance"
          value={data?.btcDominance != null ? `${data.btcDominance.toFixed(2)}%` : loading ? "…" : "—"}
        />
        <Tile
          label="Total Market Cap"
          value={
            data?.totalMarketCapUsd != null ? formatUsdCompact(data.totalMarketCapUsd) : loading ? "…" : "—"
          }
          sub={
            data?.marketCapChange24hPct != null
              ? `${data.marketCapChange24hPct >= 0 ? "+" : ""}${data.marketCapChange24hPct.toFixed(2)}% (24h)`
              : undefined
          }
        />
      </section>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Hot Tokens</h2>
            <p className="text-sm text-text-muted">
              Top 100 by market cap, sorted biggest → smallest, that have NOT risen in the past 7
              days.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            {(
              [
                ["all", "All"],
                ["top50", "Top 50"],
                ["big-caps", "≥ $1B mcap"],
              ] as [HotFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full border px-3 py-1 ${
                  filter === key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-5 gap-2 bg-surface-alt px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted">
            <span className="col-span-2">Token</span>
            <span className="text-right">Price</span>
            <span className="text-right">24h</span>
            <span className="text-right">7d</span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">Loading…</div>
          ) : filteredHotTokens.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              No underperformers matched this filter.
            </div>
          ) : (
            filteredHotTokens.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-5 items-center gap-2 border-t border-border px-4 py-3 text-sm"
              >
                <div className="col-span-2 flex items-center gap-2 truncate">
                  <span className="text-xs text-text-muted">#{t.rank}</span>
                  <span className="font-semibold">{t.symbol}</span>
                  <span className="truncate text-text-muted">{t.name}</span>
                </div>
                <span className="tabular text-right text-base font-medium">
                  {formatUsd(t.priceUsd)}
                </span>
                <span className="text-right text-base">
                  <ChangeBadge pct={t.change24hPct} />
                </span>
                <span className="text-right text-base">
                  <ChangeBadge pct={t.change7dPct} />
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold">Recommendations</h2>
        <p className="mt-1 text-sm text-text-muted">
          Your holdings surface first, then new top-100 ideas worth a look.
        </p>
        {loading ? (
          <div className="mt-4 text-sm text-text-muted">Loading…</div>
        ) : (
          <div className="mt-4 space-y-4">
            {heldRecs.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  In your portfolio
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {heldRecs.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
                    >
                      <span className="font-semibold">
                        {r.symbol} <span className="text-text-muted">{r.name}</span>
                      </span>
                      <ChangeBadge pct={r.change7dPct} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                New ideas
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {newRecs.slice(0, 12).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
                  >
                    <span className="font-semibold">
                      {r.symbol} <span className="text-text-muted">{r.name}</span>
                    </span>
                    <ChangeBadge pct={r.change7dPct} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
