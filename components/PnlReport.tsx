"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UsdValue } from "./MaskedValue";
import { formatUsd } from "@/lib/format";
import { AllHoldingsProvider } from "./AllHoldingsView";
import {
  AggregatedHoldingsTable,
  type AssetPnlCell,
} from "./AggregatedHoldingsTable";
import { computePnl, type PnlEvent } from "@/lib/pnl/engine";
import type { HoldingRow } from "./HoldingsTable";
import type { Transaction } from "@/lib/chains/transactions/types";
import type { ChainId, ChainType } from "@/lib/chains/types";

export interface PnlWallet {
  id: string;
  name: string;
  address: string;
  chainType: ChainType;
}

const DEFAULT_FROM = "2025-01-01";
const DEFAULT_TO = "2025-12-31";

const STABLE_ASSETS = new Set([
  "USDT",
  "USDC",
  "USD",
  "DAI",
  "BUSD",
  "TUSD",
  "FDUSD",
  "USDD",
  "PYUSD",
  "USDE",
  "USDP",
]);

function tokenKey(network: string, contract: string | null): string {
  const c = !contract || contract === "native" ? "native" : contract.toLowerCase();
  return `${network}|${c}`;
}

function nearestPrice(series: [number, number][], ms: number): number | null {
  if (!series || series.length === 0) return null;
  let best = series[0];
  let bestDiff = Math.abs(series[0][0] - ms);
  for (const p of series) {
    const d = Math.abs(p[0] - ms);
    if (d < bestDiff) {
      bestDiff = d;
      best = p;
    }
  }
  if (bestDiff > 4 * 24 * 3600 * 1000) return null;
  return best[1];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

function monthWindows(fromIso: string, toIso: string): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime()) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    out.push({
      startMs: Math.max(cur.getTime(), start.getTime()),
      endMs: Math.min(next.getTime() - 1, end.getTime()),
    });
    cur = next;
  }
  return out;
}

export function PnlReport({
  rows,
  exchangeEvents,
  wallets,
  exchangeIds,
  btcPriceUsd,
}: {
  rows: HoldingRow[];
  exchangeEvents: PnlEvent[];
  wallets: PnlWallet[];
  exchangeIds: string[];
  btcPriceUsd: number | null;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(DEFAULT_FROM);
  const [toDate, setToDate] = useState(DEFAULT_TO);

  const [onChainEvents, setOnChainEvents] = useState<PnlEvent[]>([]);
  const [onChainLoaded, setOnChainLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [unpriced, setUnpriced] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const fromIso = fromDate ? `${fromDate}T00:00:00Z` : null;
  const toIso = toDate ? `${toDate}T23:59:59Z` : null;

  const allEvents = useMemo(
    () => [...exchangeEvents, ...onChainEvents],
    [exchangeEvents, onChainEvents],
  );
  const pnl = useMemo(
    () => computePnl(allEvents, fromIso, toIso),
    [allEvents, fromIso, toIso],
  );

  // Map per-asset P&L (date-range scoped) for the table's extra columns.
  const pnlByAsset = useMemo(() => {
    const m = new Map<string, AssetPnlCell>();
    for (const a of pnl.assets) {
      m.set(a.asset, {
        buys: a.buysUsd,
        sells: a.sellsUsd,
        net: a.realizedUsd,
        estimated: a.estimated,
      });
    }
    return m;
  }, [pnl]);

  // Inject zero-balance placeholder rows for assets that had trades in the
  // period but are no longer held (fully sold) — so they still appear.
  const tableRows = useMemo(() => {
    const held = new Set(
      rows.map((r) => (r.symbol ?? "").trim().toUpperCase()).filter(Boolean),
    );
    const extra: HoldingRow[] = [];
    for (const a of pnl.assets) {
      if (held.has(a.asset)) continue;
      extra.push({
        walletId: `closed:${a.asset}`,
        walletName: "Closed position (sold)",
        walletAddress: "",
        portfolioId: undefined,
        portfolioName: "—",
        chain: "exchange" as ChainId,
        contract: `closed:${a.asset}`,
        symbol: a.asset,
        name: a.asset,
        amount: 0,
        priceUsd: null,
        valueUsd: 0,
        priceChange24h: null,
      });
    }
    return extra.length > 0 ? [...rows, ...extra] : rows;
  }, [rows, pnl]);

  const ownAddresses = useMemo(
    () => new Set(wallets.map((w) => w.address.toLowerCase())),
    [wallets],
  );

  async function loadOnChain() {
    setLoading(true);
    setError(null);
    setUnpriced([]);
    try {
      let done = 0;
      const perWallet = await mapWithConcurrency(wallets, 4, async (w) => {
        try {
          const res = await fetch("/api/transactions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ walletId: w.id }),
          });
          const json = (await res.json()) as { transactions?: Transaction[] };
          return { wallet: w, txs: json.transactions ?? [] };
        } catch {
          return { wallet: w, txs: [] as Transaction[] };
        } finally {
          done++;
          setProgress(`Fetched ${done}/${wallets.length} wallets…`);
        }
      });

      interface Pending {
        wallet: PnlWallet;
        tx: Transaction;
        kind: "buy" | "sell";
        key: string;
      }
      const pending: Pending[] = [];
      const tokenSet = new Map<
        string,
        { network: string; contract: string | null; symbol: string }
      >();
      let minTs = Number.POSITIVE_INFINITY;
      let maxTs = 0;
      for (const { wallet, txs } of perWallet) {
        for (const tx of txs) {
          if (tx.status !== "success") continue;
          if (tx.direction !== "in" && tx.direction !== "out") continue;
          if (!tx.timestamp || !tx.amount || tx.amount <= 0 || !tx.symbol) continue;
          if (STABLE_ASSETS.has(tx.symbol.trim().toUpperCase())) continue;
          if (tx.counterparty && ownAddresses.has(tx.counterparty.toLowerCase()))
            continue;
          const key = tokenKey(tx.network, tx.contract);
          if (!tokenSet.has(key))
            tokenSet.set(key, {
              network: tx.network,
              contract: tx.contract,
              symbol: tx.symbol.trim().toUpperCase(),
            });
          const ts = new Date(tx.timestamp).getTime();
          if (ts < minTs) minTs = ts;
          if (ts > maxTs) maxTs = ts;
          pending.push({
            wallet,
            tx,
            kind: tx.direction === "in" ? "buy" : "sell",
            key,
          });
        }
      }

      if (pending.length === 0) {
        setOnChainEvents([]);
        setOnChainLoaded(true);
        setProgress("");
        return;
      }

      setProgress("Fetching historical prices…");
      const tokens = [...tokenSet.entries()].map(([key, v]) => ({
        key,
        network: v.network,
        contract: v.contract,
        symbol: v.symbol,
      }));
      const priceRes = await fetch("/api/pnl/prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: Math.floor(minTs / 1000) - 86400,
          to: Math.floor(maxTs / 1000) + 86400,
          tokens,
        }),
      });
      const priceJson = (await priceRes.json()) as {
        prices?: Record<string, [number, number][]>;
        unpriced?: string[];
        error?: string;
      };
      if (!priceRes.ok) throw new Error(priceJson.error ?? "Price fetch failed");
      const prices = priceJson.prices ?? {};

      const events: PnlEvent[] = [];
      const unpricedSyms = new Set<string>();
      for (const p of pending) {
        const series = prices[p.key];
        const px = series ? nearestPrice(series, new Date(p.tx.timestamp!).getTime()) : null;
        if (px == null) {
          unpricedSyms.add(p.tx.symbol!.trim().toUpperCase());
          continue;
        }
        events.push({
          asset: p.tx.symbol!.trim().toUpperCase(),
          date: p.tx.timestamp!,
          kind: p.kind,
          qty: p.tx.amount!,
          usdValue: p.tx.amount! * px,
          feeUsd: p.tx.feeUsd ?? 0,
          source: p.wallet.name,
          estimated: true,
        });
      }

      setOnChainEvents(events);
      setUnpriced([...unpricedSyms].sort());
      setOnChainLoaded(true);
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load on-chain data");
    } finally {
      setLoading(false);
    }
  }

  async function syncExchangeHistory() {
    if (exchangeIds.length === 0 || !fromIso || !toIso) return;
    setSyncing(true);
    setError(null);
    try {
      const windows = monthWindows(fromIso, toIso);
      const total = windows.length * exchangeIds.length;
      let done = 0;
      for (const exId of exchangeIds) {
        for (const w of windows) {
          setSyncMsg(`Syncing exchange trades… ${++done}/${total}`);
          try {
            await fetch("/api/exchanges/refresh", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                exchangeId: exId,
                kinds: ["trades", "orders"],
                startTimeMs: w.startMs,
                endTimeMs: w.endMs,
              }),
            });
          } catch {
            // keep going; partial data still helps
          }
        }
      }
      setSyncMsg("Done — reloading…");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      setSyncMsg("");
    }
  }

  return (
    <div className="space-y-6">
      <header className="card p-5 sm:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-text">חישוב רווח והפסד</h1>
          <p className="text-sm text-text-muted mt-1">
            All holdings (TAX-marked) with buys, sells and realized P&amp;L for
            the selected period. Click a row to see the wallets/exchanges behind
            it. Exchange trades are exact; on-chain is estimated.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-[10px] font-semibold text-text-muted uppercase tracking-wide">
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-0.5 px-2 py-1 text-sm rounded border border-border bg-surface text-text"
            />
          </label>
          <label className="flex flex-col text-[10px] font-semibold text-text-muted uppercase tracking-wide">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-0.5 px-2 py-1 text-sm rounded border border-border bg-surface text-text"
            />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {exchangeIds.length > 0 && (
              <button
                type="button"
                onClick={syncExchangeHistory}
                disabled={syncing}
                className="btn-ghost text-sm"
                title="Pull older trade history from the exchange APIs for the selected period (slow)"
              >
                {syncing ? syncMsg || "Syncing…" : "⟳ Sync exchange history"}
              </button>
            )}
            {!onChainLoaded && (
              <button
                type="button"
                onClick={loadOnChain}
                disabled={loading || wallets.length === 0}
                className="btn-ghost text-sm"
              >
                {loading ? progress || "Loading…" : "+ Add on-chain (estimated)"}
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </header>

      {/* Totals */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <TotalCard label="Total buys" value={pnl.totalBuysUsd} />
        <TotalCard label="Total sells" value={pnl.totalSellsUsd} />
        <TotalCard label="Profit" value={pnl.totalProfit} positive />
        <TotalCard label="Net P&L" value={pnl.totalRealizedUsd} colorBySign />
      </section>

      {/* The exact "All holdings summary" table, with P&L columns + drill-down */}
      <AllHoldingsProvider rows={tableRows} storageKey="pnl-page" btcPriceUsd={btcPriceUsd}>
        <AggregatedHoldingsTable
          rows={tableRows}
          btcPriceUsd={btcPriceUsd}
          pnlByAsset={pnlByAsset}
        />
      </AllHoldingsProvider>

      {unpriced.length > 0 && (
        <p className="text-xs text-text-muted">
          No historical price found for: {unpriced.join(", ")} — their on-chain
          P&amp;L is excluded; review manually.
        </p>
      )}

      <div className="card bg-surface-2/40 text-xs text-text-muted leading-relaxed">
        <p className="font-semibold text-text mb-1">Important</p>
        Holdings columns show your current position. Buys / Sells / P&amp;L are
        scoped to the selected dates. Exchange trades use exact prices; on-chain
        P&amp;L is estimated (a <span className="font-mono">~</span> marks
        estimated values), external transfers treated as buys/sells, FIFO cost
        basis. Exchange APIs return only recent history by default — use “Sync
        exchange history” to backfill older months (slow). USD aid, not tax
        advice — verify with your accountant and convert to ILS.
      </div>
    </div>
  );
}

function TotalCard({
  label,
  value,
  colorBySign,
  positive,
}: {
  label: string;
  value: number;
  colorBySign?: boolean;
  positive?: boolean;
}) {
  const color = colorBySign
    ? value >= 0
      ? "text-success"
      : "text-danger"
    : positive
      ? "text-success"
      : "text-text";
  return (
    <div className="card">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabular ${color}`}>
        {(colorBySign && value >= 0) || positive ? "+" : ""}
        <UsdValue value={value} priceUsd={1} />
      </p>
    </div>
  );
}
