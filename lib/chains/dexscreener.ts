/**
 * DexScreener public API — covers any token that has a DEX pool, including
 * long-tail / new tokens that aren't yet on Alchemy or CoinGecko.
 * Free, no API key, ~300 req/min rate limit.
 *
 * Endpoint: GET /latest/dex/tokens/{tokenAddresses}
 * Comma-separated list, up to 30 addresses per call.
 */

import { resolveByConsensus } from "./price-consensus";

interface DsPair {
  chainId: string;
  baseToken: { address: string; symbol?: string; name?: string };
  quoteToken: { address: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
}

interface DsResponse {
  pairs: DsPair[] | null;
}

/**
 * DexScreener `chainId` values for our supported EVM chains + Solana.
 * Lowercased, see https://docs.dexscreener.com/api/reference
 */
const DS_CHAIN: Record<string, string> = {
  ethereum: "ethereum",
  polygon: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  avalanche: "avalanche",
  bnb: "bsc",
  linea: "linea",
  blast: "blast",
  mantle: "mantle",
  berachain: "berachain",
  sonic: "sonic",
  unichain: "unichain",
  world: "worldchain",
  ape: "apechain",
  zksync: "zksync",
  scroll: "scroll",
  gnosis: "gnosis",
  celo: "celo",
  abstract: "abstract",
  ink: "ink",
  zora: "zora",
  shape: "shape",
  fraxtal: "fraxtal",
  soneium: "soneium",
  polygon_zkevm: "polygon-zkevm",
  arbnova: "arbitrum-nova",
  solana: "solana",
};

export interface DexPriceEntry {
  usd: number;
  change24h: number | null;
}

/**
 * Returns: { contract (lowercased) → { usd, change24h } }.
 * Picks the pair with the highest USD liquidity to avoid scam-pair pricing.
 */
export async function getDexScreenerPricesWithChange(
  network: keyof typeof DS_CHAIN,
  contracts: string[],
): Promise<Record<string, DexPriceEntry>> {
  if (contracts.length === 0) return {};
  const chainId = DS_CHAIN[network];
  if (!chainId) return {};
  const out: Record<string, DexPriceEntry> = {};

  for (let i = 0; i < contracts.length; i += 30) {
    const chunk = contracts.slice(i, i + 30);
    const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`;
    try {
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) continue;
      const json = (await res.json()) as DsResponse;
      const pairs = json.pairs ?? [];
      // Group ALL valid candidate pairs per contract, then resolve via
      // liquidity-INDEPENDENT consensus (see price-consensus.ts). Liquidity
      // itself is attacker-controlled and cannot be used even as a
      // "require 3+ pools" gate or a median-input filter — a single fake
      // pool can report a liquidity number in the hundreds of millions,
      // which is enough to dominate when there are only 1-2 genuine pools
      // (confirmed on TRU: 1 fake pool at $255M fake liquidity vs. 1 real
      // pool at $15K real liquidity — median-of-2 still landed on a blended
      // wrong number). Clustering by price similarity and trusting the
      // cluster with the most INDEPENDENT POOLS (not summed liquidity)
      // sidesteps this entirely.
      const byAddr: Record<string, DsPair[]> = {};
      for (const p of pairs) {
        if (p.chainId !== chainId) continue;
        const v = p.priceUsd ? parseFloat(p.priceUsd) : NaN;
        if (!Number.isFinite(v) || v <= 0 || v >= 1_000_000) continue;
        const addr = p.baseToken.address.toLowerCase();
        (byAddr[addr] ??= []).push(p);
      }
      for (const addr of Object.keys(byAddr)) {
        const candidates = byAddr[addr].map((p) => ({
          price: parseFloat(p.priceUsd!),
          change24h: typeof p.priceChange?.h24 === "number" ? p.priceChange.h24 : null,
          liquidityUsd: p.liquidity?.usd ?? 0,
        }));
        const consensus = resolveByConsensus(candidates);
        if (!consensus) continue;
        out[addr] = { usd: consensus.price, change24h: consensus.change24h };
      }
    } catch {
      // swallow
    }
  }

  return out;
}

/** Back-compat: prices only (no change). */
export async function getDexScreenerPrices(
  network: keyof typeof DS_CHAIN,
  contracts: string[],
): Promise<Record<string, number>> {
  const withChange = await getDexScreenerPricesWithChange(network, contracts);
  const out: Record<string, number> = {};
  for (const k of Object.keys(withChange)) out[k] = withChange[k].usd;
  return out;
}
