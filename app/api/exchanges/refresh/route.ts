import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchBinanceBalances } from "@/lib/exchanges/binance";
import { getAlchemyPricesBySymbol } from "@/lib/chains/alchemy_prices";
import { getNativePrices } from "@/lib/chains/prices";

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

interface BalanceOut {
  asset: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
}

// Map common exchange asset symbols → CoinGecko ID for native-coin fallback.
const SYMBOL_TO_CG: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  MATIC: "matic-network",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  ADA: "cardano",
  XRP: "ripple",
  DOT: "polkadot",
  LINK: "chainlink",
  UNI: "uniswap",
  ARB: "arbitrum",
  OP: "optimism",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  TRX: "tron",
  TON: "the-open-network",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  DOGE: "dogecoin",
  LTC: "litecoin",
};

async function resolvePricesForSymbols(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (symbols.length === 0) return out;

  // Try Alchemy by-symbol first (covers most popular assets).
  const al = await getAlchemyPricesBySymbol(symbols);
  for (const s of symbols) {
    if (al[s.toUpperCase()] != null) out[s.toUpperCase()] = al[s.toUpperCase()];
  }
  // CoinGecko fallback for anything still missing using the known mapping.
  const missing = symbols.filter((s) => out[s.toUpperCase()] == null);
  if (missing.length > 0) {
    const ids: string[] = [];
    const idToSym: Record<string, string> = {};
    for (const sym of missing) {
      const id = SYMBOL_TO_CG[sym.toUpperCase()];
      if (id) {
        ids.push(id);
        idToSym[id] = sym.toUpperCase();
      }
    }
    if (ids.length > 0) {
      const cg = await getNativePrices(ids);
      for (const id of Object.keys(cg)) {
        out[idToSym[id]] = cg[id];
      }
    }
  }
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { exchangeId?: string };
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

  const results: { exchangeId: string; label: string; balances: BalanceOut[]; error?: string }[] = [];
  const now = new Date().toISOString();

  for (const ex of (rows ?? []) as ExchangeRow[]) {
    try {
      if (ex.provider !== "binance") {
        results.push({
          exchangeId: ex.id,
          label: ex.label,
          balances: [],
          error: `Provider "${ex.provider}" not yet implemented`,
        });
        continue;
      }
      const balances = await fetchBinanceBalances(ex.api_key, ex.api_secret);
      const symbols = balances.map((b) => b.asset);
      const prices = await resolvePricesForSymbols(symbols);
      const out: BalanceOut[] = balances.map((b) => {
        const price = prices[b.asset.toUpperCase()] ?? null;
        const value = price ? b.amount * price : 0;
        return { asset: b.asset, amount: b.amount, priceUsd: price, valueUsd: value };
      });
      // Persist to cache
      await supabase.from("crypto_exchange_balances_cache").delete().eq("exchange_id", ex.id);
      if (out.length > 0) {
        await supabase.from("crypto_exchange_balances_cache").insert(
          out.map((b) => ({
            exchange_id: ex.id,
            asset: b.asset,
            amount: b.amount,
            price_usd: b.priceUsd,
            value_usd: b.valueUsd,
            fetched_at: now,
          })),
        );
      }
      await supabase
        .from("crypto_exchanges")
        .update({ last_synced_at: now })
        .eq("id", ex.id);
      results.push({ exchangeId: ex.id, label: ex.label, balances: out });
    } catch (e) {
      results.push({
        exchangeId: ex.id,
        label: ex.label,
        balances: [],
        error: e instanceof Error ? e.message : "fetch failed",
      });
    }
  }

  return NextResponse.json({ exchanges: results, fetchedAt: now });
}
