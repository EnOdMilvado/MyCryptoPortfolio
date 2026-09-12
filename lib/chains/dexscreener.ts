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
      // Group ALL valid candidate pairs per contract (not just the single
      // highest-liquidity one). A single scam/mirror pool can report a
      // fabricated liquidity figure large enough to beat every legitimate
      // pool (seen in the wild: a fake MOG pool on real chainId "ethereum"
      // claiming $2.7B liquidity and a $12,101 price, vs. every other MOG
      // pool agreeing on ~$0.0000001 — a 100-billion-times gap). Picking by
      // liquidity alone falls for this; using the MEDIAN price across all
      // candidate pools is robust to a single manipulated outlier as long
      // as most pools for that contract are genuine.
      const byAddr: Record<string, DsPair[]> = {};
      for (const p of pairs) {
        if (p.chainId !== chainId) continue;
        const liq = p.liquidity?.usd ?? 0;
        if (liq < 5000) continue; // still filters pure wash-trade dust pools
        const v = p.priceUsd ? parseFloat(p.priceUsd) : NaN;
        if (!Number.isFinite(v) || v <= 0 || v >= 1_000_000) continue;
        const addr = p.baseToken.address.toLowerCase();
        (byAddr[addr] ??= []).push(p);
      }
      for (const addr of Object.keys(byAddr)) {
        const candidates = byAddr[addr];
        // With only 1 qualifying pool there's nothing to median against —
        // fall back to it directly (still passed the $5k/±$1M sanity gates
        // above). With 2+, the median naturally resists a single outlier.
        if (candidates.length === 1) {
          const only = candidates[0];
          out[addr] = {
            usd: parseFloat(only.priceUsd!),
            change24h:
              typeof only.priceChange?.h24 === "number" ? only.priceChange.h24 : null,
          };
          continue;
        }
        const prices = candidates
          .map((p) => parseFloat(p.priceUsd!))
          .sort((a, b) => a - b);
        const mid = Math.floor(prices.length / 2);
        const median =
          prices.length % 2 === 0
            ? (prices[mid - 1] + prices[mid]) / 2
            : prices[mid];
        // Report the 24h change from whichever candidate pool is closest to
        // the median price (the most "representative" pool), not the
        // highest-liquidity one which may be the outlier itself.
        const closest = candidates.reduce((best, p) =>
          Math.abs(parseFloat(p.priceUsd!) - median) <
          Math.abs(parseFloat(best.priceUsd!) - median)
            ? p
            : best,
        );
        out[addr] = {
          usd: median,
          change24h:
            typeof closest.priceChange?.h24 === "number"
              ? closest.priceChange.h24
              : null,
        };
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
