"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "./Tabs";
import { UsdValue, BtcValue } from "./MaskedValue";
import { formatRelative } from "@/lib/format";
import { ExchangeSpotTable } from "./exchange/ExchangeSpotTable";
import { ExchangeTradesTable } from "./exchange/ExchangeTradesTable";
import { ExchangeOrdersTable } from "./exchange/ExchangeOrdersTable";
import { ExchangeTransfersTable } from "./exchange/ExchangeTransfersTable";
import { useExcludedIds } from "./exchange/useExcludedIds";

export interface SpotRow {
  asset: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
  /** Latest 24h % change (from CMC when configured). */
  priceChange24h?: number | null;
  fetchedAt: string;
}

export interface TradeRowView {
  tradeId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  quoteQty: number;
  fee: number | null;
  feeAsset: string | null;
  executedAt: string;
}

export interface OrderRowView {
  orderId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: "BUY" | "SELL";
  type: string | null;
  status: string | null;
  price: number | null;
  origQty: number | null;
  executedQty: number | null;
  quoteQty: number | null;
  placedAt: string;
  updatedAt: string | null;
}

export interface TransferRowView {
  id: string;
  coin: string;
  network: string | null;
  amount: number;
  fee: number | null;
  address: string | null;
  txId: string | null;
  status: string;
  occurredAt: string;
}

type TabKey = "spot" | "trades" | "orders" | "deposits" | "withdrawals";

const TAB_TO_KIND: Record<TabKey, TabKey> = {
  spot: "spot",
  trades: "trades",
  orders: "orders",
  deposits: "deposits",
  withdrawals: "withdrawals",
};

const ALL_TABS: TabKey[] = ["spot", "trades", "orders", "deposits", "withdrawals"];

export function ExchangeDetailView({
  exchangeId,
  provider,
  label,
  lastSyncedSpot,
  lastSyncedTrades,
  lastSyncedOrders,
  lastSyncedDeposits,
  lastSyncedWithdrawals,
  btcPriceUsd,
  initialSpot,
  initialTrades,
  initialOrders,
  initialDeposits,
  initialWithdrawals,
}: {
  exchangeId: string;
  provider: string;
  label: string;
  lastSyncedSpot: string | null;
  lastSyncedTrades: string | null;
  lastSyncedOrders: string | null;
  lastSyncedDeposits: string | null;
  lastSyncedWithdrawals: string | null;
  btcPriceUsd: number | null;
  initialSpot: SpotRow[];
  initialTrades: TradeRowView[];
  initialOrders: OrderRowView[];
  initialDeposits: TransferRowView[];
  initialWithdrawals: TransferRowView[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<TabKey>("spot");
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<{ kind: string; error: string }[]>([]);

  const spot = useExcludedIds(`excluded-exchange-assets:${exchangeId}`);
  const trades = useExcludedIds(`excluded-exchange-trades:${exchangeId}`);
  const orders = useExcludedIds(`excluded-exchange-orders:${exchangeId}`);
  const deposits = useExcludedIds(`excluded-exchange-deposits:${exchangeId}`);
  const withdrawals = useExcludedIds(`excluded-exchange-withdrawals:${exchangeId}`);

  const spotTotal = initialSpot.reduce(
    (s, b) => (spot.excluded.has(b.asset.toUpperCase()) ? s : s + b.valueUsd),
    0,
  );
  const spotTotalBtc =
    btcPriceUsd != null && btcPriceUsd > 0 ? spotTotal / btcPriceUsd : null;
  const excludedValueUsd = initialSpot.reduce(
    (s, b) => (spot.excluded.has(b.asset.toUpperCase()) ? s + b.valueUsd : s),
    0,
  );

  const lastSyncedByTab: Record<TabKey, string | null> = {
    spot: lastSyncedSpot,
    trades: lastSyncedTrades,
    orders: lastSyncedOrders,
    deposits: lastSyncedDeposits,
    withdrawals: lastSyncedWithdrawals,
  };

  async function refresh(tabs: TabKey[]) {
    setRefreshing(true);
    setErrors([]);
    try {
      const res = await fetch("/api/exchanges/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exchangeId, kinds: tabs.map((t) => TAB_TO_KIND[t]) }),
      });
      // Defensive parsing: when the server function times out or 5xx's,
      // Vercel returns an HTML/plain-text error page, not JSON. Read text
      // first, then parse — otherwise res.json() throws "Unexpected token
      // 'A', \"An error o\"..." and hides the real problem.
      const raw = await res.text();
      let json: {
        error?: string;
        exchanges?: { errors?: { kind: string; error: string }[] }[];
      } = {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        const snippet = raw.replace(/<[^>]+>/g, " ").trim().slice(0, 200);
        throw new Error(
          res.ok
            ? `Server returned non-JSON: ${snippet}`
            : `Refresh failed (${res.status}) — likely a function timeout. ${snippet}`,
        );
      }
      if (!res.ok) throw new Error(json.error ?? `Refresh failed (${res.status})`);
      const apiErrors = json.exchanges?.[0]?.errors ?? [];
      if (apiErrors.length > 0) setErrors(apiErrors);
      router.refresh();
    } catch (e) {
      setErrors([{ kind: "all", error: e instanceof Error ? e.message : "Refresh failed" }]);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="card animate-fade-up space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-text">{label}</h2>
          <span className="pill">{provider}</span>
        </div>
        <p className="text-xs uppercase tracking-wider text-text-muted">Spot balance</p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <UsdValue
            value={spotTotal}
            priceUsd={spotTotal > 0 ? 1 : null}
            className="text-3xl sm:text-4xl font-extrabold tabular text-text"
          />
          {spotTotalBtc != null && (
            <BtcValue
              value={spotTotalBtc}
              className="text-lg sm:text-xl font-semibold tabular text-text-muted"
            />
          )}
          {spot.excluded.size > 0 && (
            <span className="text-xs text-text-muted/70">
              ({spot.excluded.size} hidden ·{" "}
              <UsdValue value={excludedValueUsd} priceUsd={excludedValueUsd > 0 ? 1 : null} />)
            </span>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: "spot", label: "Spot", badge: initialSpot.length },
          { key: "trades", label: "Trades", badge: initialTrades.length },
          { key: "orders", label: "Orders", badge: initialOrders.length },
          { key: "deposits", label: "Deposits", badge: initialDeposits.length },
          { key: "withdrawals", label: "Withdrawals", badge: initialWithdrawals.length },
        ]}
        active={active}
        onChange={(k) => setActive(k as TabKey)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span>
          {lastSyncedByTab[active]
            ? `Last synced ${formatRelative(lastSyncedByTab[active])}`
            : "Never synced"}
          {active !== "spot" && " · last 90 days"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refresh([active])}
            disabled={refreshing}
            className="btn-ghost text-xs"
          >
            {`Refresh ${active}`}
          </button>
          <button
            type="button"
            onClick={() => refresh(ALL_TABS)}
            disabled={refreshing}
            className="btn-primary text-xs"
          >
            {refreshing ? "Refreshing…" : "Refresh all"}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="text-sm text-danger bg-danger/10 rounded-xl px-3 py-2 space-y-1">
          {errors.map((e, i) => (
            <li key={`${e.kind}:${i}`}>
              <span className="font-semibold capitalize">{e.kind}:</span> {e.error}
            </li>
          ))}
        </ul>
      )}

      {active === "spot" && (
        <ExchangeSpotTable
          rows={initialSpot}
          btcPriceUsd={btcPriceUsd}
          excluded={spot.excluded}
          onToggleExcluded={spot.toggle}
        />
      )}
      {active === "trades" && (
        <ExchangeTradesTable
          rows={initialTrades}
          excluded={trades.excluded}
          onToggleExcluded={trades.toggle}
        />
      )}
      {active === "orders" && (
        <ExchangeOrdersTable
          rows={initialOrders}
          excluded={orders.excluded}
          onToggleExcluded={orders.toggle}
        />
      )}
      {active === "deposits" && (
        <ExchangeTransfersTable
          rows={initialDeposits}
          direction="deposit"
          excluded={deposits.excluded}
          onToggleExcluded={deposits.toggle}
        />
      )}
      {active === "withdrawals" && (
        <ExchangeTransfersTable
          rows={initialWithdrawals}
          direction="withdrawal"
          excluded={withdrawals.excluded}
          onToggleExcluded={withdrawals.toggle}
        />
      )}
    </section>
  );
}
