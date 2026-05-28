import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getTokenPricesWithChange } from "@/lib/chains/prices";
import { getDexScreenerPricesWithChange } from "@/lib/chains/dexscreener";
import { getAlchemyChange24hByAddress } from "@/lib/chains/alchemy_historical";
import { resolvePriceQuotesForSymbols } from "@/lib/exchanges/prices";
import type { EvmChain } from "@/lib/chains/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CacheRow {
  wallet_id: string;
  chain: string;
  contract: string;
  symbol: string | null;
  price_usd: string | number | null;
}

interface ExBalRow {
  exchange_id: string;
  asset: string;
  price_usd: string | number | null;
}

/**
 * Backfills `price_change_24h` for cached holdings/balances that have a
 * price but no 24h % change. Hits CoinGecko + DexScreener + (optionally)
 * Alchemy Historical — no keys required for the first two, so this works
 * even without ALCHEMY_API_KEY set.
 *
 * Idempotent: only updates rows that are still missing a change value;
 * existing values are left untouched.
 */
export async function POST() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // === Step 1: EVM/Solana holdings ===
  // RLS scopes to the user automatically (cache → wallets → portfolios → user_id).
  const { data: holdRows, error: hErr } = await supabase
    .from("crypto_holdings_cache")
    .select("wallet_id, chain, contract, symbol, price_usd")
    .is("price_change_24h", null)
    .gt("price_usd", 0)
    .neq("contract", "native");
  if (hErr) {
    return NextResponse.json({ error: hErr.message }, { status: 500 });
  }

  // Group by chain → set of distinct contracts.
  const byChain = new Map<string, Map<string, number>>();
  for (const r of (holdRows as CacheRow[] | null) ?? []) {
    if (!r.contract) continue;
    const price = Number(r.price_usd ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const chainKey = r.chain;
    let inner = byChain.get(chainKey);
    if (!inner) {
      inner = new Map();
      byChain.set(chainKey, inner);
    }
    inner.set(r.contract.toLowerCase(), price);
  }

  let evmUpdated = 0;
  let evmExamined = 0;
  for (const [chain, contractsMap] of byChain.entries()) {
    if (chain === "bitcoin") continue; // BTC is native-only — handled separately
    const contracts = [...contractsMap.keys()];
    evmExamined += contracts.length;
    if (contracts.length === 0) continue;

    // Resolve change via the same 3-tier pipeline as the wallet refresh.
    const changes: Record<string, number> = {};

    // 1) CoinGecko by-contract (works for the common chains).
    try {
      const cg = await getTokenPricesWithChange(chain as EvmChain, contracts);
      for (const k of Object.keys(cg)) {
        if (cg[k].change24h != null) changes[k] = cg[k].change24h as number;
      }
    } catch {
      // fall through
    }

    // 2) DexScreener for anything CG didn't have.
    const missingAfterCg = contracts.filter((c) => changes[c] == null);
    if (missingAfterCg.length > 0) {
      try {
        // DexScreener accepts an EvmChain or "solana" — runtime guard rather
        // than a type cast since the chain string came from the DB.
        const ds = await getDexScreenerPricesWithChange(
          chain as EvmChain,
          missingAfterCg,
        );
        for (const k of Object.keys(ds)) {
          if (changes[k] == null && ds[k].change24h != null) {
            changes[k] = ds[k].change24h as number;
          }
        }
      } catch {
        // fall through
      }
    }

    // 3) Alchemy Historical (1 req/token) as last resort — only when key present.
    const stillMissing = contracts.filter((c) => changes[c] == null);
    if (stillMissing.length > 0 && process.env.ALCHEMY_API_KEY) {
      const prices: Record<string, number> = {};
      for (const c of stillMissing) prices[c] = contractsMap.get(c) ?? 0;
      try {
        const al = await getAlchemyChange24hByAddress(
          chain as EvmChain,
          prices,
        );
        for (const k of Object.keys(al)) {
          if (changes[k] == null) changes[k] = al[k];
        }
      } catch {
        // fall through
      }
    }

    // Persist: one UPDATE per (chain, contract) — small enough not to need batching.
    for (const [contract, change] of Object.entries(changes)) {
      const { count } = await supabase
        .from("crypto_holdings_cache")
        .update({ price_change_24h: change }, { count: "exact" })
        .eq("chain", chain)
        .ilike("contract", contract); // case-insensitive contract match
      evmUpdated += count ?? 0;
    }
  }

  // === Step 2: Exchange balances (symbol-based) ===
  const { data: exRows } = await supabase
    .from("crypto_exchange_balances_cache")
    .select("exchange_id, asset, price_usd")
    .is("price_change_24h", null)
    .gt("price_usd", 0);
  const exSymbols = new Set<string>();
  for (const r of (exRows as ExBalRow[] | null) ?? []) {
    exSymbols.add(r.asset.toUpperCase());
  }
  let exUpdated = 0;
  if (exSymbols.size > 0) {
    const quotes = await resolvePriceQuotesForSymbols([...exSymbols]);
    for (const sym of Object.keys(quotes)) {
      const ch = quotes[sym].change24h;
      if (ch == null) continue;
      const { count } = await supabase
        .from("crypto_exchange_balances_cache")
        .update({ price_change_24h: ch }, { count: "exact" })
        .ilike("asset", sym);
      exUpdated += count ?? 0;
    }
  }

  return NextResponse.json({
    ok: true,
    evmExamined,
    evmUpdated,
    exchangeSymbolsExamined: exSymbols.size,
    exchangeRowsUpdated: exUpdated,
    note: process.env.ALCHEMY_API_KEY
      ? undefined
      : "ALCHEMY_API_KEY missing — CG + DexScreener tiers only.",
  });
}
