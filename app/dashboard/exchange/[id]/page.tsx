import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import {
  ExchangeDetailView,
  type SpotRow,
  type TradeRowView,
  type OrderRowView,
  type TransferRowView,
} from "@/components/ExchangeDetailView";

export const dynamic = "force-dynamic";

export default async function ExchangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  const { data: exchange } = await supabase
    .from("crypto_exchanges")
    .select(
      "id, provider, label, last_synced_at, last_synced_trades_at, last_synced_orders_at, last_synced_deposits_at, last_synced_withdrawals_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!exchange) notFound();

  // Latest BTC price — try the spot cache (cheapest) then fall back to the
  // wallet holdings cache, mirroring the dashboard page resolution order.
  let btcPriceUsd: number | null = null;
  const { data: btcFromSpot } = await supabase
    .from("crypto_exchange_balances_cache")
    .select("price_usd")
    .eq("asset", "BTC")
    .not("price_usd", "is", null)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (btcFromSpot?.price_usd) {
    btcPriceUsd = Number(btcFromSpot.price_usd);
  } else {
    const { data: btcFromHoldings } = await supabase
      .from("crypto_holdings_cache")
      .select("price_usd")
      .eq("chain", "bitcoin")
      .not("price_usd", "is", null)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (btcFromHoldings?.price_usd) btcPriceUsd = Number(btcFromHoldings.price_usd);
  }

  const [
    { data: spotRows },
    { data: tradeRows },
    { data: orderRows },
    { data: depositRows },
    { data: withdrawalRows },
  ] = await Promise.all([
    supabase
      .from("crypto_exchange_balances_cache")
      .select("asset, amount, price_usd, value_usd, price_change_24h, fetched_at")
      .eq("exchange_id", id),
    supabase
      .from("crypto_exchange_trades")
      .select(
        "trade_id, symbol, base_asset, quote_asset, side, price, qty, quote_qty, fee, fee_asset, executed_at",
      )
      .eq("exchange_id", id)
      .order("executed_at", { ascending: false })
      .limit(2000),
    supabase
      .from("crypto_exchange_orders")
      .select(
        "order_id, symbol, base_asset, quote_asset, side, type, status, price, orig_qty, executed_qty, quote_qty, placed_at, updated_at",
      )
      .eq("exchange_id", id)
      .order("placed_at", { ascending: false })
      .limit(2000),
    supabase
      .from("crypto_exchange_deposits")
      .select("deposit_id, coin, network, amount, address, tx_id, status, occurred_at")
      .eq("exchange_id", id)
      .order("occurred_at", { ascending: false })
      .limit(500),
    supabase
      .from("crypto_exchange_withdrawals")
      .select(
        "withdrawal_id, coin, network, amount, fee, address, tx_id, status, occurred_at",
      )
      .eq("exchange_id", id)
      .order("occurred_at", { ascending: false })
      .limit(500),
  ]);

  const spot: SpotRow[] = (spotRows ?? []).map((b: {
    asset: string;
    amount: number | string;
    price_usd: number | string | null;
    value_usd: number | string | null;
    price_change_24h: number | string | null;
    fetched_at: string;
  }) => ({
    asset: b.asset,
    amount: Number(b.amount),
    priceUsd: b.price_usd == null ? null : Number(b.price_usd),
    valueUsd: b.value_usd == null ? 0 : Number(b.value_usd),
    priceChange24h:
      b.price_change_24h == null ? null : Number(b.price_change_24h),
    fetchedAt: b.fetched_at,
  }));

  const orders: OrderRowView[] = (orderRows ?? []).map((o: {
    order_id: string;
    symbol: string;
    base_asset: string;
    quote_asset: string;
    side: string;
    type: string | null;
    status: string | null;
    price: number | string | null;
    orig_qty: number | string | null;
    executed_qty: number | string | null;
    quote_qty: number | string | null;
    placed_at: string;
    updated_at: string | null;
  }) => ({
    orderId: o.order_id,
    symbol: o.symbol,
    baseAsset: o.base_asset,
    quoteAsset: o.quote_asset,
    side: o.side as "BUY" | "SELL",
    type: o.type,
    status: o.status,
    price: o.price == null ? null : Number(o.price),
    origQty: o.orig_qty == null ? null : Number(o.orig_qty),
    executedQty: o.executed_qty == null ? null : Number(o.executed_qty),
    quoteQty: o.quote_qty == null ? null : Number(o.quote_qty),
    placedAt: o.placed_at,
    updatedAt: o.updated_at,
  }));

  const trades: TradeRowView[] = (tradeRows ?? []).map((t: {
    trade_id: string;
    symbol: string;
    base_asset: string;
    quote_asset: string;
    side: string;
    price: number | string;
    qty: number | string;
    quote_qty: number | string;
    fee: number | string | null;
    fee_asset: string | null;
    executed_at: string;
  }) => ({
    tradeId: t.trade_id,
    symbol: t.symbol,
    baseAsset: t.base_asset,
    quoteAsset: t.quote_asset,
    side: t.side as "BUY" | "SELL",
    price: Number(t.price),
    qty: Number(t.qty),
    quoteQty: Number(t.quote_qty),
    fee: t.fee == null ? null : Number(t.fee),
    feeAsset: t.fee_asset,
    executedAt: t.executed_at,
  }));

  const deposits: TransferRowView[] = (depositRows ?? []).map((d: {
    deposit_id: string;
    coin: string;
    network: string | null;
    amount: number | string;
    address: string | null;
    tx_id: string | null;
    status: string | null;
    occurred_at: string;
  }) => ({
    id: d.deposit_id,
    coin: d.coin,
    network: d.network,
    amount: Number(d.amount),
    fee: null,
    address: d.address,
    txId: d.tx_id,
    status: d.status ?? "",
    occurredAt: d.occurred_at,
  }));

  const withdrawals: TransferRowView[] = (withdrawalRows ?? []).map((w: {
    withdrawal_id: string;
    coin: string;
    network: string | null;
    amount: number | string;
    fee: number | string | null;
    address: string | null;
    tx_id: string | null;
    status: string | null;
    occurred_at: string;
  }) => ({
    id: w.withdrawal_id,
    coin: w.coin,
    network: w.network,
    amount: Number(w.amount),
    fee: w.fee == null ? null : Number(w.fee),
    address: w.address,
    txId: w.tx_id,
    status: w.status ?? "",
    occurredAt: w.occurred_at,
  }));

  return (
    <>
      <NavBar isAdmin={!!profile?.is_admin} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <Link href="/dashboard" className="text-sm text-text-muted hover:text-text">
            ← Back to dashboard
          </Link>
        </div>
        <ExchangeDetailView
          exchangeId={exchange.id}
          provider={exchange.provider}
          label={exchange.label}
          lastSyncedSpot={exchange.last_synced_at}
          lastSyncedTrades={exchange.last_synced_trades_at}
          lastSyncedOrders={exchange.last_synced_orders_at}
          lastSyncedDeposits={exchange.last_synced_deposits_at}
          lastSyncedWithdrawals={exchange.last_synced_withdrawals_at}
          btcPriceUsd={btcPriceUsd}
          initialSpot={spot}
          initialTrades={trades}
          initialOrders={orders}
          initialDeposits={deposits}
          initialWithdrawals={withdrawals}
        />
      </main>
    </>
  );
}
