"use client";

import { useMemo, useState } from "react";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { UsdValue } from "./MaskedValue";
import { formatUsd } from "@/lib/format";
import { computePnl, type PnlEvent, type AssetPnl } from "@/lib/pnl/engine";
import type { Transaction } from "@/lib/chains/transactions/types";
import type { ChainType } from "@/lib/chains/types";

export interface PnlWallet {
  id: string;
  name: string;
  address: string;
  chainType: ChainType;
}

const DEFAULT_FROM = "2025-01-01";
const DEFAULT_TO = "2025-12-31";

/** Stablecoins we never report as a taxable asset (1:1 USD, no gain/loss). */
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

/** Nearest historical price (USD) to a timestamp from a [[ms, price], …] series. */
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
  // Guard: if the nearest point is more than 4 days away, treat as unknown.
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

export function PnlReport({
  exchangeEvents,
  wallets,
}: {
  exchangeEvents: PnlEvent[];
  wallets: PnlWallet[];
}) {
  const [fromDate, setFromDate] = useState(DEFAULT_FROM);
  const [toDate, setToDate] = useState(DEFAULT_TO);

  const [onChainEvents, setOnChainEvents] = useState<PnlEvent[]>([]);
  const [onChainLoaded, setOnChainLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [unpriced, setUnpriced] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fromIso = fromDate ? `${fromDate}T00:00:00Z` : null;
  const toIso = toDate ? `${toDate}T23:59:59Z` : null;

  const allEvents = useMemo(
    () => [...exchangeEvents, ...onChainEvents],
    [exchangeEvents, onChainEvents],
  );
  const result = useMemo(
    () => computePnl(allEvents, fromIso, toIso),
    [allEvents, fromIso, toIso],
  );

  // Own addresses → used to drop internal transfers (wallet-to-wallet).
  const ownAddresses = useMemo(
    () => new Set(wallets.map((w) => w.address.toLowerCase())),
    [wallets],
  );

  async function loadOnChain() {
    setLoading(true);
    setError(null);
    setUnpriced([]);
    try {
      // 1) Fetch transactions for every TAX wallet (bounded concurrency).
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

      // 2) Keep external in/out transfers only (drop internal + failed + dust).
      interface Pending {
        wallet: PnlWallet;
        tx: Transaction;
        kind: "buy" | "sell";
        key: string;
      }
      const pending: Pending[] = [];
      const tokenSet = new Map<
        string,
        { network: string; contract: string | null }
      >();
      let minTs = Number.POSITIVE_INFINITY;
      let maxTs = 0;
      for (const { wallet, txs } of perWallet) {
        for (const tx of txs) {
          if (tx.status !== "success") continue;
          if (tx.direction !== "in" && tx.direction !== "out") continue;
          if (!tx.timestamp || !tx.amount || tx.amount <= 0 || !tx.symbol) continue;
          if (STABLE_ASSETS.has(tx.symbol.trim().toUpperCase())) continue;
          // Internal transfer between the user's own wallets → not a buy/sell.
          if (tx.counterparty && ownAddresses.has(tx.counterparty.toLowerCase()))
            continue;
          const key = tokenKey(tx.network, tx.contract);
          tokenSet.set(key, { network: tx.network, contract: tx.contract });
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

      // 3) Historical prices for the full span of the activity (so pre-window
      //    acquisitions still get a cost basis).
      setProgress("Fetching historical prices…");
      const tokens = [...tokenSet.entries()].map(([key, v]) => ({
        key,
        network: v.network,
        contract: v.contract,
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

      // 4) Build estimated events; track symbols we couldn't price.
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

  const csvColumns = [
    { header: "Asset", value: (a: AssetPnl) => a.asset },
    { header: "Buys (USD)", value: (a: AssetPnl) => a.buysUsd.toFixed(2) },
    { header: "Sells (USD)", value: (a: AssetPnl) => a.sellsUsd.toFixed(2) },
    {
      header: "Realized P&L (USD)",
      value: (a: AssetPnl) => a.realizedUsd.toFixed(2),
    },
    { header: "Fees (USD)", value: (a: AssetPnl) => a.feeUsd.toFixed(2) },
    { header: "Estimated", value: (a: AssetPnl) => (a.estimated ? "yes" : "no") },
    {
      header: "Incomplete cost basis",
      value: (a: AssetPnl) => (a.missingCostBasis ? "yes" : "no"),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="card p-5 sm:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Profit &amp; Loss report</h1>
          <p className="text-sm text-text-muted mt-1">
            Realized gains/losses per token over the selected period, from
            TAX-marked wallets and exchanges only.
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
          <div className="ml-auto flex items-center gap-2">
            {!onChainLoaded && (
              <button
                type="button"
                onClick={loadOnChain}
                disabled={loading || wallets.length === 0}
                className="btn-ghost text-sm"
                title="Fetch on-chain transactions and estimate historical prices"
              >
                {loading ? progress || "Loading…" : "+ Add on-chain (estimated)"}
              </button>
            )}
            <DownloadCsvButton
              filename={`pnl-${fromDate || "start"}_to_${toDate || "end"}`}
              rows={result.assets}
              columns={csvColumns}
              disabled={result.assets.length === 0}
              label="Export CSV"
            />
          </div>
        </div>
        {error && (
          <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </header>

      {/* Totals */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TotalCard label="Total buys" value={result.totalBuysUsd} />
        <TotalCard label="Total sells" value={result.totalSellsUsd} />
        <TotalCard
          label="Realized P&L"
          value={result.totalRealizedUsd}
          colorBySign
        />
      </section>

      {/* Per-asset table */}
      <section className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/80 text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Asset
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                  Buys
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                  Sells
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">
                  Realized P&L
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {result.assets.map((a, i) => (
                <tr key={a.asset} className={i % 2 ? "bg-surface-2/30" : ""}>
                  <td className="px-3 py-2 font-semibold text-text">{a.asset}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatUsd(a.buysUsd)}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatUsd(a.sellsUsd)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular font-semibold ${
                      a.realizedUsd >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {a.realizedUsd >= 0 ? "+" : ""}
                    {formatUsd(a.realizedUsd)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">
                    {a.estimated && (
                      <span className="pill mr-1" title="Includes estimated on-chain prices">
                        est.
                      </span>
                    )}
                    {a.missingCostBasis && (
                      <span className="text-amber-500" title="Sold more than the known acquisition history — cost basis incomplete, gain overstated">
                        ⚠ partial cost basis
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {result.assets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-text-muted">
                    No buys or sells in this period yet. Exchange trades show
                    instantly; click “Add on-chain (estimated)” for wallets.
                  </td>
                </tr>
              )}
            </tbody>
            {result.assets.length > 0 && (
              <tfoot className="border-t-2 border-border bg-surface-2/40 font-bold">
                <tr>
                  <td className="px-3 py-2 text-xs uppercase text-text-muted">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatUsd(result.totalBuysUsd)}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatUsd(result.totalSellsUsd)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular ${
                      result.totalRealizedUsd >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {result.totalRealizedUsd >= 0 ? "+" : ""}
                    {formatUsd(result.totalRealizedUsd)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {unpriced.length > 0 && (
        <p className="text-xs text-text-muted">
          No historical price found for: {unpriced.join(", ")} — excluded from
          P&amp;L; review these manually.
        </p>
      )}

      {/* Disclaimer */}
      <div className="card bg-surface-2/40 text-xs text-text-muted leading-relaxed">
        <p className="font-semibold text-text mb-1">Important</p>
        Exchange trades use exact prices from your trade history. On-chain rows
        are marked <span className="pill">est.</span> — they use estimated
        historical prices and treat external transfers as buys/sells (internal
        wallet-to-wallet transfers are excluded). Cost basis is FIFO. This report
        is a preparation aid in USD, not tax advice or an official filing —
        have your accountant verify it, convert to ILS at the official rates, and
        apply the relevant Israeli tax rules.
      </div>
    </div>
  );
}

function TotalCard({
  label,
  value,
  colorBySign,
}: {
  label: string;
  value: number;
  colorBySign?: boolean;
}) {
  const color = colorBySign
    ? value >= 0
      ? "text-success"
      : "text-danger"
    : "text-text";
  return (
    <div className="card">
      <p className="text-sm font-semibold text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular ${color}`}>
        {colorBySign && value >= 0 ? "+" : ""}
        <UsdValue value={value} priceUsd={1} />
      </p>
    </div>
  );
}
