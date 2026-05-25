/**
 * DexScreener public API — covers any token that has a DEX pool, including
 * long-tail / new tokens that aren't yet on Alchemy or CoinGecko.
 * Free, no API key, ~300 req/min rate limit.
 *
 * Endpoint: GET /latest/dex/tokens/{tokenAddresses}
 * Comma-separated list, up to 30 addresses per call.
 */

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
      // Group pairs by base token contract on this chain, pick the deepest liquidity.
      const best: Record<string, DsPair> = {};
      for (const p of pairs) {
        if (p.chainId !== chainId) continue;
        const addr = p.baseToken.address.toLowerCase();
        const liq = p.liquidity?.usd ?? 0;
        const existingLiq = best[addr]?.liquidity?.usd ?? 0;
        if (!best[addr] || liq > existingLiq) best[addr] = p;
      }
      for (const addr of Object.keys(best)) {
        const p = best[addr];
        const v = p.priceUsd ? parseFloat(p.priceUsd) : NaN;
        // Reject pairs with <$5k liquidity (almost always wash trades / scam
        // pools) and prices over $1M (oracle manipulation from tiny pools).
        const liq = p.liquidity?.usd ?? 0;
        if (!Number.isNaN(v) && v > 0 && v < 1_000_000 && liq >= 5000) {
          out[addr] = {
            usd: v,
            change24h:
              typeof p.priceChange?.h24 === "number" ? p.priceChange.h24 : null,
          };
        }
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
