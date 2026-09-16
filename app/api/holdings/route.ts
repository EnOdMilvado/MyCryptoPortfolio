import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { detectChain } from "@/lib/chains/detect";
import { fetchBitcoinHoldings } from "@/lib/chains/bitcoin";
import { AlchemyKeyMissingError, fetchEvmHoldings } from "@/lib/chains/evm";
import { fetchSolanaHoldings } from "@/lib/chains/solana";
import { fetchTonHoldings } from "@/lib/chains/ton";
import { fetchPolkadotHoldings } from "@/lib/chains/polkadot";
import { fetchThetaHoldings } from "@/lib/chains/theta";
import { getNativePrices } from "@/lib/chains/prices";
import { getAlchemyPricesBySymbol } from "@/lib/chains/alchemy_prices";
import { getPublicSpotUsdPrice } from "@/lib/chains/public_ticker";
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

// Wall-clock cap per wallet so one slow chain (Solana SPL price lookups
// hammer CoinGecko on the free tier, sometimes >60s) can't take down the
// whole /api/holdings call. The function's maxDuration is 60s — race
// against ~50s so we still have time to return a structured error and
// flush logs instead of getting a 504 with no body.
const PER_WALLET_TIMEOUT_MS = 50_000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function fetchForWallet(w: WalletRow): Promise<WalletHoldings> {
  try {
    let holdings: Holding[];
    switch (w.chain_type) {
      case "btc":
        holdings = await withTimeout(fetchBitcoinHoldings(w.address), PER_WALLET_TIMEOUT_MS, "btc");
        break;
      case "evm":
        holdings = await withTimeout(fetchEvmHoldings(w.address), PER_WALLET_TIMEOUT_MS, "evm");
        break;
      case "sol":
        holdings = await withTimeout(fetchSolanaHoldings(w.address), PER_WALLET_TIMEOUT_MS, "sol");
        break;
      case "ton":
        holdings = await withTimeout(fetchTonHoldings(w.address), PER_WALLET_TIMEOUT_MS, "ton");
        break;
      case "dot":
        holdings = await withTimeout(fetchPolkadotHoldings(w.address), PER_WALLET_TIMEOUT_MS, "dot");
        break;
      case "theta":
        holdings = await withTimeout(fetchThetaHoldings(w.address), PER_WALLET_TIMEOUT_MS, "theta");
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

  // Process wallets with BOUNDED concurrency instead of one-at-a-time.
  // The old fully-serial loop was the #1 cause of "refresh takes a minute"
  // complaints — N wallets × 5-15s each (each wallet already fans out to
  // 28+ EVM chains in parallel internally, see fetchEvmHoldings) adds up
  // fast in series. A small concurrency cap keeps most of the speedup
  // without reintroducing the original "parallel bursts starve shared
  // rate limits (Alchemy/CoinGecko/CMC)" problem that serial processing
  // was added to avoid.
  const WALLET_CONCURRENCY = 4;
  const results: WalletHoldings[] = new Array(wallets.length);
  {
    const list = wallets as WalletRow[];
    let cursor = 0;
    async function pump(): Promise<void> {
      while (true) {
        const i = cursor++;
        if (i >= list.length) return;
        results[i] = await fetchForWallet(list[i]);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(WALLET_CONCURRENCY, list.length) }, () => pump()),
    );
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
  // Total = sum of every cached wallet value_usd belonging to this user
  // PLUS every exchange balance's value_usd. The dashboard's own live
  // total already includes exchanges (see app/dashboard/page.tsx), but
  // this snapshot previously only summed crypto_holdings_cache (wallets),
  // silently excluding exchange balances entirely. For a user whose
  // portfolio is exchange-heavy (e.g. most of the value sitting on MEXC)
  // that meant the recorded snapshot total never matched the real total,
  // which showed up as the 24h change card being permanently stuck at
  // "0.00% / +\$0.00" — the baseline and "latest" snapshot were both
  // wrong by the same (missing) exchange amount, and if exchanges never
  // successfully refreshed in the same run their wallet-only total could
  // end up identical run after run.
  const { data: walletTotalRows } = await supabase
    .from("crypto_holdings_cache")
    .select("value_usd, crypto_wallets!inner(portfolio_id, crypto_portfolios!inner(user_id))")
    .eq("crypto_wallets.crypto_portfolios.user_id", user.id);
  const walletTotalUsd = (walletTotalRows ?? []).reduce(
    (s, r: { value_usd: number | string | null }) => s + Number(r.value_usd ?? 0),
    0,
  );
  const { data: exchangeTotalRows } = await supabase
    .from("crypto_exchange_balances_cache")
    .select("value_usd, crypto_exchanges!inner(user_id)")
    .eq("crypto_exchanges.user_id", user.id);
  const exchangeTotalUsd = (exchangeTotalRows ?? []).reduce(
    (s, r: { value_usd: number | string | null }) => s + Number(r.value_usd ?? 0),
    0,
  );
  const totalUsd = walletTotalUsd + exchangeTotalUsd;
  await supabase.from("crypto_portfolio_snapshots").insert({
    user_id: user.id,
    total_usd: totalUsd,
    captured_at: insertedAt,
  });

  // Top-of-page BTC price tile: three-tier fallback (Alchemy → CoinGecko
  // → public exchange ticker). Same reasoning as in bitcoin.ts — Alchemy's
  // by-symbol endpoint sometimes skips BTC, CoinGecko rate-limits shared
  // Vercel IPs, so we also race a public ticker as a last resort.
  const [btcAlchemy, btcCg, btcPublic] = await Promise.all([
    getAlchemyPricesBySymbol(["BTC"]),
    getNativePrices(["bitcoin"]),
    getPublicSpotUsdPrice("BTC"),
  ]);
  const btcPriceUsd = btcAlchemy.BTC ?? btcCg.bitcoin ?? btcPublic ?? null;

  // Top-level signal: if *every* EVM wallet in this chunk failed with the
  // Alchemy-key marker, tell the UI explicitly so it can render one
  // actionable banner instead of N silent zeros. We mark by exact message
  // since the discriminator class doesn't cross the JSON boundary.
  const evmResults = results.filter((r) => r.chainType === "evm");
  const allEvmFailedOnKey =
    evmResults.length > 0 &&
    evmResults.every((r) => r.error === "ALCHEMY_API_KEY missing or empty");

  let configError: string | null = null;
  if (allEvmFailedOnKey) {
    configError =
      "ALCHEMY_API_KEY is missing or empty in the server environment — EVM wallets cannot be read. Set it in Vercel → Settings → Environment Variables and redeploy.";
  }

  return NextResponse.json({
    wallets: results,
    btcPriceUsd,
    fetchedAt: insertedAt,
    configError,
  });
}
