import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { detectChain } from "@/lib/chains/detect";
import { fetchBitcoinHoldings } from "@/lib/chains/bitcoin";
import { AlchemyKeyMissingError, fetchEvmHoldings } from "@/lib/chains/evm";
import { fetchSolanaHoldings } from "@/lib/chains/solana";
import { getNativePrices } from "@/lib/chains/prices";
import type { ChainType, Holding, WalletHoldings } from "@/lib/chains/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface WalletRow {
  id: string;
  portfolio_id: string;
  name: string;
  address: string;
  chain_type: ChainType;
}

async function fetchForWallet(w: WalletRow): Promise<WalletHoldings> {
  try {
    let holdings: Holding[];
    switch (w.chain_type) {
      case "btc":
        holdings = await fetchBitcoinHoldings(w.address);
        break;
      case "evm":
        holdings = await fetchEvmHoldings(w.address);
        break;
      case "sol":
        holdings = await fetchSolanaHoldings(w.address);
        break;
      default:
        holdings = [];
    }
    const totalUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);
    return {
      walletId: w.id,
      address: w.address,
      chainType: w.chain_type,
      holdings,
      totalUsd,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    // Surface failures in the Vercel function log so we don't have to
    // root-cause from "all wallets show 0 again". Specifically tag the
    // Alchemy key case since it's the only one fixable without code.
    if (e instanceof AlchemyKeyMissingError) {
      console.error(
        `[holdings] EVM wallet ${w.id} (${w.address}): ALCHEMY_API_KEY missing/empty in process env`,
      );
    } else {
      console.error(`[holdings] wallet ${w.id} (${w.chain_type}) failed:`, msg);
    }
    return {
      walletId: w.id,
      address: w.address,
      chainType: w.chain_type,
      holdings: [],
      totalUsd: 0,
      error: msg,
    };
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { walletIds?: string[] };
  const walletIds = Array.isArray(body.walletIds) ? body.walletIds.filter(Boolean) : [];
  if (walletIds.length === 0) {
    return NextResponse.json({ error: "walletIds required" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // RLS already restricts to wallets the user owns — this select will
  // silently drop any other ids.
  const { data: wallets, error: wErr } = await supabase
    .from("crypto_wallets")
    .select("id, portfolio_id, name, address, chain_type")
    .in("id", walletIds);

  if (wErr || !wallets) {
    return NextResponse.json({ error: wErr?.message ?? "wallets fetch failed" }, { status: 500 });
  }

  // Defensive: re-validate chain_type matches address detection.
  for (const w of wallets) {
    const detected = detectChain(w.address);
    if (detected && detected !== w.chain_type) {
      w.chain_type = detected;
    }
  }

  // Process wallets serially to avoid hammering Alchemy / CoinGecko in
  // parallel — when the user has many wallets, simultaneous bursts caused
  // partial price fetches and left some holdings with null prices.
  const results: WalletHoldings[] = [];
  for (const w of wallets as WalletRow[]) {
    results.push(await fetchForWallet(w));
  }

  // Persist to cache: delete previous rows, insert fresh ones in one round trip.
  //
  // IMPORTANT: only delete + replace when the fetch actually SUCCEEDED.
  // If a wallet's chain query failed (Alchemy down / key missing / RPC
  // error → r.error set), we skip the wipe — otherwise a transient
  // network blip would obliterate the user's last-known holdings cache
  // (which has happened in practice and wiped 6-figure RAIN/GEMS rows).
  const insertedAt = new Date().toISOString();
  for (const r of results) {
    if (r.error) continue; // preserve stale cache rather than blanking it
    await supabase.from("crypto_holdings_cache").delete().eq("wallet_id", r.walletId);
    if (r.holdings.length > 0) {
      await supabase.from("crypto_holdings_cache").insert(
        r.holdings.map((h) => ({
          wallet_id: r.walletId,
          chain: h.chain,
          contract: h.contract,
          symbol: h.symbol,
          name: h.name,
          amount: h.amount,
          decimals: h.decimals,
          price_usd: h.priceUsd,
          value_usd: h.valueUsd,
          price_change_24h: h.priceChange24h ?? null,
          fetched_at: insertedAt,
        })),
      );
    }
  }

  // Record a portfolio snapshot for the change-over-time cards.
  // Total = sum of every cached value_usd belonging to this user.
  const { data: totalRows } = await supabase
    .from("crypto_holdings_cache")
    .select("value_usd, crypto_wallets!inner(portfolio_id, crypto_portfolios!inner(user_id))")
    .eq("crypto_wallets.crypto_portfolios.user_id", user.id);
  const totalUsd = (totalRows ?? []).reduce(
    (s, r: { value_usd: number | string | null }) => s + Number(r.value_usd ?? 0),
    0,
  );
  await supabase.from("crypto_portfolio_snapshots").insert({
    user_id: user.id,
    total_usd: totalUsd,
    captured_at: insertedAt,
  });

  const btcPrices = await getNativePrices(["bitcoin"]);

  // Top-level signal: if *every* EVM wallet in this chunk failed with the
  // Alchemy-key marker, tell the UI explicitly so it can render one
  // actionable banner instead of N silent zeros. We mark by exact message
  // since the discriminator class doesn't cross the JSON boundary.
  const evmResults = results.filter((r) => r.chainType === "evm");
  const allEvmFailedOnKey =
    evmResults.length > 0 &&
    evmResults.every((r) => r.error === "ALCHEMY_API_KEY missing or empty");

  return NextResponse.json({
    wallets: results,
    btcPriceUsd: btcPrices.bitcoin ?? null,
    fetchedAt: insertedAt,
    configError: allEvmFailedOnKey
      ? "ALCHEMY_API_KEY is missing or empty in the server environment — EVM wallets cannot be read. Set it in Vercel → Settings → Environment Variables and redeploy."
      : null,
  });
}
