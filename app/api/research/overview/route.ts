import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getMarketSentiment } from "@/lib/market/sentiment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CgGlobalResponse {
  data?: {
    market_cap_percentage?: { btc?: number };
    total_market_cap?: { usd?: number };
  };
}

interface CgMarketRow {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
}

async function getGlobalStats(): Promise<{ btcDominance: number | null; totalMarketCapUsd: number | null }> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global", {
      next: { revalidate: 300 },
    });
    if (!res.ok) return { btcDominance: null, totalMarketCapUsd: null };
    const json = (await res.json()) as CgGlobalResponse;
    return {
      btcDominance: json.data?.market_cap_percentage?.btc ?? null,
      totalMarketCapUsd: json.data?.total_market_cap?.usd ?? null,
    };
  } catch {
    return { btcDominance: null, totalMarketCapUsd: null };
  }
}

async function getTop100(): Promise<CgMarketRow[]> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h,7d",
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as CgMarketRow[];
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const [sentiment, global, top100] = await Promise.all([
    getMarketSentiment(),
    getGlobalStats(),
    getTop100(),
  ]);

  // "Hot tokens that haven't risen in the past week" — top-100 by market
  // cap, 7d change <= 0%, sorted biggest → smallest per Or's requested
  // default ordering. The client can re-filter/re-sort in the UI.
  const hotTokens = top100
    .filter(
      (r) =>
        r.price_change_percentage_7d_in_currency != null &&
        r.price_change_percentage_7d_in_currency <= 0,
    )
    .sort((a, b) => b.market_cap - a.market_cap)
    .map((r) => ({
      id: r.id,
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      image: r.image,
      priceUsd: r.current_price,
      marketCapUsd: r.market_cap,
      rank: r.market_cap_rank,
      change24hPct: r.price_change_percentage_24h_in_currency ?? null,
      change7dPct: r.price_change_percentage_7d_in_currency ?? null,
    }));

  // Portfolio-first recommendations: try to load the user's current
  // holdings (by symbol) so the UI can show "your holdings" callouts
  // before generic new-token ideas. Falls back to [] when unauthenticated
  // (e.g. this endpoint is hit without a session) rather than erroring.
  let heldSymbols: string[] = [];
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      // RLS scopes crypto_wallets/crypto_exchanges to the current user, so
      // joining through them (same pattern app/api/holdings/route.ts uses
      // for portfolio snapshots) is what actually restricts these two
      // cache tables to this user's own rows — they have no user_id column
      // of their own.
      const { data: holdings } = await supabase
        .from("crypto_holdings_cache")
        .select("symbol, crypto_wallets!inner(portfolio_id, crypto_portfolios!inner(user_id))")
        .eq("crypto_wallets.crypto_portfolios.user_id", user.id)
        .not("symbol", "is", null);
      const { data: exBalances } = await supabase
        .from("crypto_exchange_balances_cache")
        .select("asset, crypto_exchanges!inner(user_id)")
        .eq("crypto_exchanges.user_id", user.id);
      const set = new Set<string>();
      for (const h of holdings ?? []) if (h.symbol) set.add(String(h.symbol).toUpperCase());
      for (const b of exBalances ?? []) if (b.asset) set.add(String(b.asset).toUpperCase());
      heldSymbols = [...set];
    }
  } catch {
    // Non-fatal — recommendations just fall back to top100-only ordering.
  }

  const heldSet = new Set(heldSymbols);
  const recommendations = top100
    .map((r) => ({
      id: r.id,
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      image: r.image,
      priceUsd: r.current_price,
      rank: r.market_cap_rank,
      change7dPct: r.price_change_percentage_7d_in_currency ?? null,
      isHeld: heldSet.has(r.symbol.toUpperCase()),
    }))
    // Held tokens first (per Or's request), then by market cap rank.
    .sort((a, b) => {
      if (a.isHeld !== b.isHeld) return a.isHeld ? -1 : 1;
      return a.rank - b.rank;
    })
    .slice(0, 30);

  return NextResponse.json({
    sentiment: sentiment.fearGreed,
    altcoinSeason: sentiment.altcoinSeason,
    btcDominance: global.btcDominance,
    totalMarketCapUsd: global.totalMarketCapUsd,
    hotTokens,
    recommendations,
    fetchedAt: new Date().toISOString(),
  });
}
