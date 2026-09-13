"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/format";

interface MempoolFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface BitcoinResponse {
  price: number | null;
  change24hPct: number | null;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  pctVs200d: number | null;
  hashRateGHs: number | null;
  difficulty: number | null;
  txCount24h: number | null;
  mempool: {
    fees: MempoolFees | null;
    pendingCount: number | null;
    vsizeBytes: number | null;
  };
  cycle: {
    phase: string;
    daysSinceHalving: number | null;
    cycleProgressPct: number | null;
    priceVs200d: number | null;
    supplyInProfitPct: number | null;
  };
  estimatedSupplyInProfitPct: number | null;
  fetchedAt: string;
}

function Tile({
  label,
  value,
  sub,
  estimated,
}: {
  label: string;
  value: string;
  sub?: string;
  estimated?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-text-muted">
        {label}
        {estimated && (
          <span
            className="ml-1 text-[10px] text-primary"
            title="Estimated from a free proxy — not an exact on-chain metric"
          >
            (est.)
          </span>
        )}
      </p>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

function fmtPct(v: number | null, digits = 2): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function fmtHashRate(ghs: number | null): string {
  if (ghs == null) return "—";
  const ehs = ghs / 1_000_000; // GH/s → EH/s
  return `${ehs.toFixed(1)} EH/s`;
}

export function BitcoinInsightsClient() {
  const [data, setData] = useState<BitcoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/research/bitcoin");
        const json = (await res.json()) as BitcoinResponse;
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

  const v = loading ? "…" : "—";

  return (
    <>
      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="BTC Price"
          value={data?.price != null ? formatUsd(data.price) : v}
          sub={data?.change24hPct != null ? `${fmtPct(data.change24hPct)} (24h)` : undefined}
        />
        <Tile label="RSI (14d)" value={data?.rsi14 != null ? data.rsi14.toFixed(1) : v} />
        <Tile
          label="200D MA"
          value={data?.sma200 != null ? formatUsd(data.sma200) : v}
          sub={data?.pctVs200d != null ? `${fmtPct(data.pctVs200d)} vs price` : undefined}
        />
        <Tile label="50D MA" value={data?.sma50 != null ? formatUsd(data.sma50) : v} />
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold">Cycle context</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Tile label="Phase" value={data?.cycle.phase ?? v} />
          <Tile
            label="Days since halving"
            value={data?.cycle.daysSinceHalving != null ? String(data.cycle.daysSinceHalving) : v}
          />
          <Tile
            label="Cycle progress"
            value={
              data?.cycle.cycleProgressPct != null
                ? `${data.cycle.cycleProgressPct.toFixed(0)}%`
                : v
            }
            sub="vs. average ~4yr halving interval"
          />
          <Tile
            label="Supply in profit"
            value={
              data?.estimatedSupplyInProfitPct != null
                ? `${data.estimatedSupplyInProfitPct.toFixed(0)}%`
                : v
            }
            estimated
            sub="% of trailing daily closes below current price"
          />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold">Network health</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Tile label="Hash rate" value={fmtHashRate(data?.hashRateGHs ?? null)} />
          <Tile
            label="Difficulty"
            value={data?.difficulty != null ? data.difficulty.toExponential(2) : v}
          />
          <Tile
            label="Tx count (latest)"
            value={data?.txCount24h != null ? data.txCount24h.toLocaleString() : v}
          />
          <Tile
            label="Mempool pending"
            value={data?.mempool.pendingCount != null ? data.mempool.pendingCount.toLocaleString() : v}
            sub={
              data?.mempool.vsizeBytes != null
                ? `${(data.mempool.vsizeBytes / 1_000_000).toFixed(1)} MvB queued`
                : undefined
            }
          />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold">Recommended fees</h2>
        {data?.mempool.fees ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Tile label="Fastest" value={`${data.mempool.fees.fastestFee} sat/vB`} />
            <Tile label="30 min" value={`${data.mempool.fees.halfHourFee} sat/vB`} />
            <Tile label="1 hour" value={`${data.mempool.fees.hourFee} sat/vB`} />
            <Tile label="Economy" value={`${data.mempool.fees.economyFee} sat/vB`} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">{loading ? "Loading…" : "Unavailable"}</p>
        )}
      </section>
    </>
  );
}
