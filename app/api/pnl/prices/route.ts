import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { COINGECKO_PLATFORM, type ChainId, type EvmChain } from "@/lib/chains/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CG_BASE = "https://api.coingecko.com/api/v3";

/** Native coin → CoinGecko id, keyed by chain. EVM L2s settle in ETH. */
const NATIVE_ID_BY_CHAIN: Partial<Record<ChainId, string>> = {
  bitcoin: "bitcoin",
  solana: "solana",
  ton: "the-open-network",
  polkadot: "polkadot",
  theta: "theta-token",
  ethereum: "ethereum",
  polygon: "matic-network",
  arbitrum: "ethereum",
  optimism: "ethereum",
  base: "ethereum",
  avalanche: "avalanche-2",
  bnb: "binancecoin",
  linea: "ethereum",
  blast: "ethereum",
  mantle: "mantle",
  berachain: "berachain-bera",
  sonic: "sonic-3",
  unichain: "ethereum",
  world: "ethereum",
  ape: "apecoin",
  zksync: "ethereum",
  scroll: "ethereum",
  gnosis: "xdai",
  celo: "celo",
  ink: "ethereum",
  zora: "ethereum",
  arbnova: "ethereum",
};

interface TokenReq {
  key: string;
  network: ChainId;
  /** null or "native" for the chain's native coin. */
  contract: string | null;
}

async function cgFetch<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        next: { revalidate: 3600 },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function rangeUrl(token: TokenReq, from: number, to: number): string | null {
  const contract = token.contract;
  const isNative = !contract || contract === "native" || contract === "";
  if (isNative) {
    const id = NATIVE_ID_BY_CHAIN[token.network];
    if (!id) return null;
    return `${CG_BASE}/coins/${id}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
  }
  const platform =
    COINGECKO_PLATFORM[token.network as EvmChain | "solana"] ?? null;
  if (!platform) return null;
  return `${CG_BASE}/coins/${platform}/contract/${contract.toLowerCase()}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
}

/**
 * Historical daily USD prices for a set of on-chain tokens over [from,to]
 * (unix seconds). One CoinGecko `market_chart/range` call per distinct token.
 * Returns { prices: { key: [[ms, price], …] }, unpriced: string[] }.
 *
 * Auth-gated (owner only) so the endpoint can't be abused as a free price
 * proxy. Best-effort: tokens we can't resolve land in `unpriced`.
 */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    from?: number;
    to?: number;
    tokens?: TokenReq[];
  };
  const from = Math.floor(Number(body.from ?? 0));
  const to = Math.floor(Number(body.to ?? 0));
  const tokens = Array.isArray(body.tokens) ? body.tokens : [];
  if (!from || !to || to <= from) {
    return NextResponse.json({ error: "from/to required" }, { status: 400 });
  }

  // Cap to keep us inside the function budget + CoinGecko free-tier limits.
  const CAP = 40;
  const limited = tokens.slice(0, CAP);
  const overflow = tokens.slice(CAP).map((t) => t.key);

  const prices: Record<string, [number, number][]> = {};
  const unpriced: string[] = [...overflow];

  for (const token of limited) {
    const url = rangeUrl(token, from, to);
    if (!url) {
      unpriced.push(token.key);
      continue;
    }
    const json = await cgFetch<{ prices?: [number, number][] }>(url);
    if (json?.prices && json.prices.length > 0) {
      prices[token.key] = json.prices;
    } else {
      unpriced.push(token.key);
    }
    // Gentle pacing for the free tier.
    await new Promise((r) => setTimeout(r, 250));
  }

  return NextResponse.json({ prices, unpriced });
}
