import type { EvmChain } from "./types";

/**
 * Alchemy Prices API — covers many more tokens than CoinGecko's free tier
 * for popular L2s + altchains. Free tier allows up to 25 token addresses
 * per request and 300 req/min.
 */

const NETWORK_ID: Record<EvmChain | "solana", string> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base: "base-mainnet",
  avalanche: "avax-mainnet",
  bnb: "bnb-mainnet",
  linea: "linea-mainnet",
  blast: "blast-mainnet",
  mantle: "mantle-mainnet",
  berachain: "berachain-mainnet",
  sonic: "sonic-mainnet",
  unichain: "unichain-mainnet",
  world: "worldchain-mainnet",
  ape: "apechain-mainnet",
  zksync: "zksync-mainnet",
  scroll: "scroll-mainnet",
  gnosis: "gnosis-mainnet",
  celo: "celo-mainnet",
  abstract: "abstract-mainnet",
  ink: "ink-mainnet",
  zora: "zora-mainnet",
  shape: "shape-mainnet",
  fraxtal: "frax-mainnet",
  soneium: "soneium-mainnet",
  polygon_zkevm: "polygonzkevm-mainnet",
  arbnova: "arbnova-mainnet",
  solana: "solana-mainnet",
};

interface PricesByAddressResponse {
  data: {
    network: string;
    address: string;
    prices: { currency: string; value: string; lastUpdatedAt?: string }[];
    error?: unknown;
  }[];
}

interface PricesBySymbolResponse {
  data: {
    symbol: string;
    prices: { currency: string; value: string; lastUpdatedAt?: string }[];
    error?: unknown;
  }[];
}

function key(): string | null {
  return process.env.ALCHEMY_API_KEY || null;
}

/**
 * Returns map: lowercased contract → USD price.
 * Chunks to 25 addresses per request (free-tier limit).
 */
export async function getAlchemyTokenPrices(
  network: EvmChain | "solana",
  contracts: string[],
): Promise<Record<string, number>> {
  const apiKey = key();
  if (!apiKey || contracts.length === 0) return {};
  const out: Record<string, number> = {};
  const url = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-address`;
  for (let i = 0; i < contracts.length; i += 25) {
    const chunk = contracts.slice(i, i + 25);
    let json: PricesByAddressResponse | null = null;
    // One retry on transient failure (5xx, 429, network error).
    for (let attempt = 0; attempt < 2 && !json; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            addresses: chunk.map((a) => ({ network: NETWORK_ID[network], address: a })),
          }),
        });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        if (!res.ok) break;
        json = (await res.json()) as PricesByAddressResponse;
      } catch {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    if (!json) continue;
    for (const item of json.data ?? []) {
      if (item.error) continue;
      const usd = item.prices?.find((p) => p.currency === "usd");
      if (!usd) continue;
      const v = parseFloat(usd.value);
      // Sanity-check: reject prices over $1M per token. No legitimate crypto
      // is priced that high; values that large are almost always oracle
      // manipulations from low-liquidity scam pools.
      if (!Number.isNaN(v) && v > 0 && v < 1_000_000) {
        out[item.address.toLowerCase()] = v;
      }
    }
  }
  return out;
}

/**
 * Returns map: uppercased symbol → USD price.
 * Useful for native coins (ETH, BTC, SOL, MATIC, BNB, AVAX, …).
 */
export async function getAlchemyPricesBySymbol(
  symbols: string[],
): Promise<Record<string, number>> {
  const apiKey = key();
  if (!apiKey || symbols.length === 0) return {};
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const qs = unique.map((s) => `symbols=${encodeURIComponent(s)}`).join("&");
  const url = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?${qs}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = (await res.json()) as PricesBySymbolResponse;
    const out: Record<string, number> = {};
    for (const item of json.data ?? []) {
      if (item.error) continue;
      const usd = item.prices?.find((p) => p.currency === "usd");
      if (!usd) continue;
      const v = parseFloat(usd.value);
      if (!Number.isNaN(v) && v > 0 && v < 1_000_000) {
        out[item.symbol.toUpperCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}
