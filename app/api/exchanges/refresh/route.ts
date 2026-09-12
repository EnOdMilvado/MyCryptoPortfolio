import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/exchanges/registry";
import { resolvePricesForSymbols, resolvePriceQuotesForSymbols } from "@/lib/exchanges/prices";
import {
  ALL_SYNC_KINDS,
  type ExchangeCredentials,
  type SyncKind,
  type TradeRow,
  type OrderRow,
  type DepositRow,
  type WithdrawalRow,
} from "@/lib/exchanges/types";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ExchangeRow {
  id: string;
  provider: string;
  label: string;
  api_key: string;
  api_secret: string;
  api_passphrase: string | null;
}

interface SpotBalanceOut {
  asset: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
  priceChange24h: number | null;
}

interface KindError {
  kind: SyncKind;
  error: string;
}

interface ExchangeResult {
  exchangeId: string;
  label: string;
  ran: SyncKind[];
  errors: KindError[];
  counts: Partial<Record<SyncKind, number>>;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    exchangeId?: string;
    kinds?: SyncKind[];
    /** Optional explicit window (ms epoch) — used to backfill older history
     *  one slice at a time. Defaults to the last 90 days. */
    startTimeMs?: number;
    endTimeMs?: number;
  };
  const kinds: SyncKind[] =
    Array.isArray(body.kinds) && body.kinds.length > 0
      ? body.kinds.filter((k): k is SyncKind => (ALL_SYNC_KINDS as string[]).includes(k))
      : ALL_SYNC_KINDS;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let query = supabase
    .from("crypto_exchanges")
    .select("id, provider, label, api_key, api_secret, api_passphrase");
  if (body.exchangeId) query = query.eq("id", body.exchangeId);
  const { data: rows, error: qErr } = await query;
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  const now = new Date().toISOString();
  const results: ExchangeResult[] = [];

  for (const ex of (rows ?? []) as ExchangeRow[]) {
    const adapter = getAdapter(ex.provider);
    const result: ExchangeResult = {
      exchangeId: ex.id,
      label: ex.label,
      ran: [],
      errors: [],
      counts: {},
    };

    if (!adapter) {
      // "other" is the manual-only placeholder — the user added it on
      // purpose to track an exchange we don't have an API integration for.
      // Treat refresh as a successful no-op so it doesn't surface as an
      // error every time. For other unknown providers, keep the error so
      // typos / new providers without an adapter are visible.
      if (ex.provider !== "other") {
        result.errors.push({
          kind: "spot",
          error: `Provider "${ex.provider}" not yet implemented`,
        });
      }
      results.push(result);
      continue;
    }

    const creds: ExchangeCredentials = {
      apiKey: ex.api_key,
      apiSecret: ex.api_secret,
      apiPassphrase: ex.api_passphrase,
    };

    // --- SPOT ---
    let spotAssets: string[] = [];
    if (kinds.includes("spot")) {
      try {
        const balances = await adapter.fetchSpot(creds);
        const symbols = balances.map((b) => b.asset);
        spotAssets = symbols;

        // Resolver first: CMC → Alchemy → CoinGecko → DexScreener (same
        // pipeline the wallet path uses). These sources are continuously
        // updated and beat exchange-internal "last balance valuation"
        // fields that can be hours stale (saw this on GEMS, whose
        // /account/balances ships a `currency_usdt` that lags the live
        // ticker by an hour or more).
        const prices: Record<string, number> = {};
        const change24h: Record<string, number | null> = {};
        // Exchange's OWN public ticker goes FIRST, not last. It is the only
        // source that is guaranteed to be quoting the exact instrument the
        // user is holding on THIS exchange — a global lookup by bare ticker
        // (CMC/Alchemy/CoinGecko/DexScreener) can silently resolve to a
        // different token that happens to share the same symbol on another
        // chain/market (e.g. Gate's ARCH = Archway at $0.0004, but a global
        // DexScreener symbol search once matched a scam "ARCH" pool quoted
        // at $24.87 — turning a $0.44 balance into a fake $24,800). Global
        // sources are now only used to fill in symbols the exchange itself
        // doesn't list a ticker for.
        if (adapter.fetchAssetPricesUsd) {
          try {
            const exchangePrices = await adapter.fetchAssetPricesUsd(symbols, creds);
            for (const k of Object.keys(exchangePrices)) {
              const upper = k.toUpperCase();
              const px = exchangePrices[k];
              if (Number.isFinite(px) && px > 0) prices[upper] = px;
            }
          } catch {
            // Non-fatal — global resolvers below still cover this exchange.
          }
        }
        const missingAfterExchange = symbols.filter((s) => prices[s.toUpperCase()] == null);
        if (missingAfterExchange.length > 0) {
          const quotes = await resolvePriceQuotesForSymbols(missingAfterExchange);
          for (const k of Object.keys(quotes)) {
            const q = quotes[k];
            if (prices[k] == null) prices[k] = q.priceUsd;
            change24h[k] = q.change24h;
          }
        }
        // Final long-tail price-only resolver — picks up anything the
        // first quote pass missed but a fresh pass might catch.
        const stillMissing = symbols.filter((s) => prices[s.toUpperCase()] == null);
        if (stillMissing.length > 0) {
          const fallback = await resolvePricesForSymbols(stillMissing);
          for (const k of Object.keys(fallback)) {
            if (prices[k] == null) prices[k] = fallback[k];
          }
        }

        const out: SpotBalanceOut[] = balances.map((b) => {
          const upper = b.asset.toUpperCase();
          const price = prices[upper] ?? null;
          return {
            asset: b.asset,
            amount: b.amount,
            priceUsd: price,
            valueUsd: price ? b.amount * price : 0,
            priceChange24h: change24h[upper] ?? null,
          };
        });
        await supabase
          .from("crypto_exchange_balances_cache")
          .delete()
          .eq("exchange_id", ex.id);
        if (out.length > 0) {
          await supabase.from("crypto_exchange_balances_cache").insert(
            out.map((b) => ({
              exchange_id: ex.id,
              asset: b.asset,
              amount: b.amount,
              price_usd: b.priceUsd,
              value_usd: b.valueUsd,
              price_change_24h: b.priceChange24h,
              fetched_at: now,
            })),
          );
        }
        await supabase
          .from("crypto_exchanges")
          .update({ last_synced_at: now })
          .eq("id", ex.id);
        result.ran.push("spot");
        result.counts.spot = out.length;
      } catch (e) {
        result.errors.push({
          kind: "spot",
          error: e instanceof Error ? e.message : "fetch failed",
        });
      }
    }

    const endMs = body.endTimeMs ?? Date.now();
    const startMs = body.startTimeMs ?? endMs - NINETY_DAYS_MS;

    // --- TRADES --- (needs symbols; derive from spot if we just fetched it)
    if (kinds.includes("trades")) {
      try {
        const symbolsForQuery =
          spotAssets.length > 0 ? deriveSymbols(spotAssets) : undefined;
        const trades: TradeRow[] = await adapter.fetchTrades(creds, {
          symbols: symbolsForQuery,
          startTimeMs: startMs,
          endTimeMs: endMs,
        });
        await persistTrades(supabase, ex.id, trades, now);
        await supabase
          .from("crypto_exchanges")
          .update({ last_synced_trades_at: now })
          .eq("id", ex.id);
        result.ran.push("trades");
        result.counts.trades = trades.length;
      } catch (e) {
        result.errors.push({
          kind: "trades",
          error: e instanceof Error ? e.message : "fetch failed",
        });
      }
    }

    // --- ORDERS ---
    if (kinds.includes("orders") && adapter.fetchOrders) {
      try {
        const symbolsForQuery =
          spotAssets.length > 0 ? deriveSymbols(spotAssets) : undefined;
        const orders: OrderRow[] = await adapter.fetchOrders(creds, {
          symbols: symbolsForQuery,
          startTimeMs: startMs,
          endTimeMs: endMs,
        });
        await persistOrders(supabase, ex.id, orders, now);
        await supabase
          .from("crypto_exchanges")
          .update({ last_synced_orders_at: now })
          .eq("id", ex.id);
        result.ran.push("orders");
        result.counts.orders = orders.length;
      } catch (e) {
        result.errors.push({
          kind: "orders",
          error: e instanceof Error ? e.message : "fetch failed",
        });
      }
    }

    // --- DEPOSITS ---
    if (kinds.includes("deposits")) {
      try {
        const deposits = await adapter.fetchDeposits(creds, {
          startTimeMs: startMs,
          endTimeMs: endMs,
        });
        await persistDeposits(supabase, ex.id, deposits, now);
        await supabase
          .from("crypto_exchanges")
          .update({ last_synced_deposits_at: now })
          .eq("id", ex.id);
        result.ran.push("deposits");
        result.counts.deposits = deposits.length;
      } catch (e) {
        result.errors.push({
          kind: "deposits",
          error: e instanceof Error ? e.message : "fetch failed",
        });
      }
    }

    // --- WITHDRAWALS ---
    if (kinds.includes("withdrawals")) {
      try {
        const withdrawals = await adapter.fetchWithdrawals(creds, {
          startTimeMs: startMs,
          endTimeMs: endMs,
        });
        await persistWithdrawals(supabase, ex.id, withdrawals, now);
        await supabase
          .from("crypto_exchanges")
          .update({ last_synced_withdrawals_at: now })
          .eq("id", ex.id);
        result.ran.push("withdrawals");
        result.counts.withdrawals = withdrawals.length;
      } catch (e) {
        result.errors.push({
          kind: "withdrawals",
          error: e instanceof Error ? e.message : "fetch failed",
        });
      }
    }

    results.push(result);
  }

  return NextResponse.json({ exchanges: results, fetchedAt: now });
}

// ---------- persistence helpers ----------

type SupabaseClient = Awaited<ReturnType<typeof supabaseServer>>;

async function persistTrades(
  supabase: SupabaseClient,
  exchangeId: string,
  trades: TradeRow[],
  fetchedAt: string,
) {
  if (trades.length === 0) return;
  const rows = trades.map((t) => ({
    exchange_id: exchangeId,
    trade_id: t.tradeId,
    symbol: t.symbol,
    base_asset: t.baseAsset,
    quote_asset: t.quoteAsset,
    side: t.side,
    price: t.price,
    qty: t.qty,
    quote_qty: t.quoteQty,
    fee: t.fee,
    fee_asset: t.feeAsset,
    executed_at: t.executedAt,
    fetched_at: fetchedAt,
  }));
  for (const batch of chunk(rows, 500)) {
    await supabase
      .from("crypto_exchange_trades")
      .upsert(batch, { onConflict: "exchange_id,trade_id" });
  }
}

async function persistOrders(
  supabase: SupabaseClient,
  exchangeId: string,
  orders: OrderRow[],
  fetchedAt: string,
) {
  if (orders.length === 0) return;
  const rows = orders.map((o) => ({
    exchange_id: exchangeId,
    order_id: o.orderId,
    symbol: o.symbol,
    base_asset: o.baseAsset,
    quote_asset: o.quoteAsset,
    side: o.side,
    type: o.type,
    status: o.status,
    price: o.price,
    orig_qty: o.origQty,
    executed_qty: o.executedQty,
    quote_qty: o.quoteQty,
    placed_at: o.placedAt,
    updated_at: o.updatedAt,
    fetched_at: fetchedAt,
  }));
  for (const batch of chunk(rows, 500)) {
    await supabase
      .from("crypto_exchange_orders")
      .upsert(batch, { onConflict: "exchange_id,order_id" });
  }
}

async function persistDeposits(
  supabase: SupabaseClient,
  exchangeId: string,
  deposits: DepositRow[],
  fetchedAt: string,
) {
  if (deposits.length === 0) return;
  const rows = deposits.map((d) => ({
    exchange_id: exchangeId,
    deposit_id: d.depositId,
    coin: d.coin,
    network: d.network,
    amount: d.amount,
    address: d.address,
    tx_id: d.txId,
    status: d.status,
    occurred_at: d.occurredAt,
    fetched_at: fetchedAt,
  }));
  for (const batch of chunk(rows, 500)) {
    await supabase
      .from("crypto_exchange_deposits")
      .upsert(batch, { onConflict: "exchange_id,deposit_id" });
  }
}

async function persistWithdrawals(
  supabase: SupabaseClient,
  exchangeId: string,
  withdrawals: WithdrawalRow[],
  fetchedAt: string,
) {
  if (withdrawals.length === 0) return;
  const rows = withdrawals.map((w) => ({
    exchange_id: exchangeId,
    withdrawal_id: w.withdrawalId,
    coin: w.coin,
    network: w.network,
    amount: w.amount,
    fee: w.fee,
    address: w.address,
    tx_id: w.txId,
    status: w.status,
    occurred_at: w.occurredAt,
    fetched_at: fetchedAt,
  }));
  for (const batch of chunk(rows, 500)) {
    await supabase
      .from("crypto_exchange_withdrawals")
      .upsert(batch, { onConflict: "exchange_id,withdrawal_id" });
  }
}

// Mirror the MEXC adapter's pair-derivation locally so the route can pass
// a curated symbol list to fetchTrades and avoid an extra fetchSpot call.
const TRADE_QUOTES = ["USDT", "USDC", "BTC", "ETH"];
const STABLE_OR_BASE = new Set(["USDT", "USDC", "USD", "BUSD", "FDUSD", "TUSD"]);
function deriveSymbols(baseAssets: string[]): string[] {
  const bases = Array.from(new Set(baseAssets.map((a) => a.toUpperCase())));
  const symbols = new Set<string>();
  for (const base of bases) {
    if (STABLE_OR_BASE.has(base)) continue;
    for (const quote of TRADE_QUOTES) {
      if (quote !== base) symbols.add(`${base}${quote}`);
    }
  }
  return Array.from(symbols);
}
