"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { UsdValue } from "./MaskedValue";
import { formatAmount, formatUsd } from "@/lib/format";
import { computePnl, type PnlEvent, type AssetPnl } from "@/lib/pnl/engine";
import type { Transaction } from "@/lib/chains/transactions/types";
import type { ChainType } from "@/lib/chains/types";

export interface PnlWallet {
  id: string;
  name: string;
  address: string;
  chainType: ChainType;
}
export interface CurrentHolding {
  asset: string;
  amount: number;
  valueUsd: number;
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

/** Month windows [startMs,endMs] covering [from,to], for chunked API backfill. */
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

interface Row {
  asset: string;
  amount: number;
  valueUsd: number;
  buysUsd: number;
  sellsUsd: number;
  profit: number;
  loss: number;
  net: number;
  estimated: boolean;
  missingCostBasis: boolean;
}

export function PnlReport({
  exchangeEvents,
  wallets,
  currentHoldings,
  exchangeIds,
}: {
  exchangeEvents: PnlEvent[];
  wallets: PnlWallet[];
  currentHoldings: CurrentHolding[];
  exchangeIds: string[];
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

  // Merge current holdings with per-asset P&L into one table.
  const rows = useMemo<Row[]>(() => {
    const byAsset = new Map<string, AssetPnl>();
    for (const a of pnl.assets) byAsset.set(a.asset, a);
    const holdingByAsset = new Map<string, CurrentHolding>();
    for (const h of currentHoldings) holdingByAsset.set(h.asset, h);

    const assets = new Set<string>([
      ...currentHoldings.map((h) => h.asset),
      ...pnl.assets.map((a) => a.asset),
    ]);

    const out: Row[] = [];
    for (const asset of assets) {
      if (STABLE_ASSETS.has(asset)) continue; // stables: no gain/loss
      const a = byAsset.get(asset);
      const h = holdingByAsset.get(asset);
      out.push({
        asset,
        amount: h?.amount ?? 0,
        valueUsd: h?.valueUsd ?? 0,
        buysUsd: a?.buysUsd ?? 0,
        sellsUsd: a?.sellsUsd ?? 0,
        profit: a?.realizedProfit ?? 0,
        loss: a?.realizedLoss ?? 0,
        net: a?.realizedUsd ?? 0,
        estimated: a?.estimated ?? false,
        missingCostBasis: a?.missingCostBasis ?? false,
      });
    }
    // Sort: assets with realized activity first (by |net|), then by value.
    out.sort((x, y) => {
      const ax = Math.abs(x.net) + x.buysUsd + x.sellsUsd;
      const ay = Math.abs(y.net) + y.buysUsd + y.sellsUsd;
      if (ay !== ax) return ay - ax;
      return y.valueUsd - x.valueUsd;
    });
    return out;
  }, [pnl, currentHoldings]);

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

  // Pull older exchange trades via the API, one month per call per exchange so
  // each request stays inside the function time budget. Slow but complete.
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

  const csvColumns = [
    { header: "Asset", value: (r: Row) => r.asset },
    { header: "Amount", value: (r: Row) => r.amount },
    { header: "Value now (USD)", value: (r: Row) => r.valueUsd.toFixed(2) },
    { header: "Buys (USD)", value: (r: Row) => r.buysUsd.toFixed(2) },
    { header: "Sells (USD)", value: (r: Row) => r.sellsUsd.toFixed(2) },
    { header: "Profit (USD)", value: (r: Row) => r.profit.toFixed(2) },
    { header: "Loss (USD)", value: (r: Row) => r.loss.toFixed(2) },
    { header: "Net P&L (USD)", value: (r: Row) => r.net.toFixed(2) },
    { header: "Estimated", value: (r: Row) => (r.estimated ? "yes" : "no") },
  ];

  return (
    <div className="space-y-6">
      <header className="card p-5 sm:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Profit &amp; Loss · holdings</h1>
          <p className="text-sm text-text-muted mt-1">
            Every token you hold (TAX-marked wallets &amp; exchanges) with realized
            profit / loss for the selected period. Exchange trades are exact;
            on-chain is estimated.
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
            <DownloadCsvButton
              filename={`pnl-${fromDate || "start"}_to_${toDate || "end"}`}
              rows={rows}
              columns={csvColumns}
              disabled={rows.length === 0}
              label="Export CSV"
            />
          </div>
        </div>
        {error && (
          <p className="text-sm text-danger bg-danger/10 rounded-lg px-2 py-1.5">
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

      {/* Holdings + P&L table */}
      <section className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-auto text-xs sm:text-sm">
            <thead className="bg-surface-2/80 text-text-muted">
              <tr>
                <th className="pl-2 pr-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide w-px">
                  Asset
                </th>
                <th className="pl-1 pr-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide">
                  Amount
                </th>
                <Th>Value</Th>
                <Th>Buys</Th>
                <Th>Sells</Th>
                <Th>Profit</Th>
                <Th>Loss</Th>
                <Th>Net P&L</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.asset} className={i % 2 ? "bg-surface-2/30" : ""}>
                  <td className="pl-2 pr-1 py-1.5 font-semibold text-text whitespace-nowrap w-px">
                    {r.asset}
                    {r.estimated && (
                      <span className="pill ml-1" title="Includes estimated on-chain prices">
                        est.
                      </span>
                    )}
                    {r.missingCostBasis && (
                      <span className="ml-1 text-amber-500" title="Sold more than the known acquisition history — cost basis incomplete">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="pl-1 pr-2 py-1.5 text-left tabular text-text-muted whitespace-nowrap">
                    {r.amount > 0 ? formatAmount(r.amount) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular whitespace-nowrap">
                    {r.valueUsd > 0 ? formatUsd(r.valueUsd) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular whitespace-nowrap">
                    {r.buysUsd > 0 ? formatUsd(r.buysUsd) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular whitespace-nowrap">
                    {r.sellsUsd > 0 ? formatUsd(r.sellsUsd) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular text-success whitespace-nowrap">
                    {r.profit > 0 ? `+${formatUsd(r.profit)}` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular text-danger whitespace-nowrap">
                    {r.loss < 0 ? formatUsd(r.loss) : "—"}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-left tabular font-semibold whitespace-nowrap ${
                      r.net > 0 ? "text-success" : r.net < 0 ? "text-danger" : "text-text-muted"
                    }`}
                  >
                    {r.net !== 0 ? `${r.net > 0 ? "+" : ""}${formatUsd(r.net)}` : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-text-muted">
                    No TAX-marked holdings or trades yet.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-border bg-surface-2/40 font-bold">
                <tr>
                  <td className="pl-2 pr-1 py-1.5 text-xs uppercase text-text-muted w-px">
                    Total
                  </td>
                  <td />
                  <td className="px-2 py-1.5 text-left tabular">
                    {formatUsd(rows.reduce((s, r) => s + r.valueUsd, 0))}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular">
                    {formatUsd(pnl.totalBuysUsd)}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular">
                    {formatUsd(pnl.totalSellsUsd)}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular text-success">
                    +{formatUsd(pnl.totalProfit)}
                  </td>
                  <td className="px-2 py-1.5 text-left tabular text-danger">
                    {formatUsd(pnl.totalLoss)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-left tabular ${
                      pnl.totalRealizedUsd >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {pnl.totalRealizedUsd >= 0 ? "+" : ""}
                    {formatUsd(pnl.totalRealizedUsd)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {unpriced.length > 0 && (
        <p className="text-xs text-text-muted">
          No historical price found for: {unpriced.join(", ")} — their on-chain
          P&amp;L is excluded; review manually.
        </p>
      )}

      <div className="card bg-surface-2/40 text-xs text-text-muted leading-relaxed">
        <p className="font-semibold text-text mb-1">Important</p>
        Exchange trades use exact prices. On-chain rows are{" "}
        <span className="pill">est.</span> — estimated historical prices,
        external transfers treated as buys/sells (internal wallet-to-wallet moves
        excluded), FIFO cost basis. Exchange APIs only return recent history by
        default — use “Sync exchange history” to backfill older months (it’s slow
        because the exchanges page trade data per symbol). This is a USD
        preparation aid, not tax advice — verify with your accountant and convert
        to ILS at the official rates.
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-2 py-1.5 text-xs font-semibold uppercase tracking-wide ${right ? "text-left" : "text-left"}`}
    >
      {children}
    </th>
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
