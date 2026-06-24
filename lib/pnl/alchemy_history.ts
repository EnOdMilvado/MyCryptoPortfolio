import type { ChainId } from "@/lib/chains/types";

/**
 * Historical USD prices from Alchemy's Prices API. Unlike CoinGecko's free
 * tier (365-day cap, contract endpoint requires a key), Alchemy's historical
 * endpoint reaches several years back with the project's existing key — which
 * is what makes an older tax-year on-chain report possible.
 *
 * Endpoint: POST /prices/v1/{key}/tokens/historical
 *   body: { symbol | (network,address), startTime, endTime, interval }
 *   resp: { data: [{ value: string, timestamp: string }] }
 */

const BASE = "https://api.g.alchemy.com/prices/v1";

/** chain → Alchemy network id (only chains Alchemy indexes for prices). */
const ALCHEMY_NETWORK: Partial<Record<ChainId, string>> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base: "base-mainnet",
  avalanche: "avax-mainnet",
  bnb: "bnb-mainnet",
  solana: "solana-mainnet",
  gnosis: "gnosis-mainnet",
  scroll: "scroll-mainnet",
  zksync: "zksync-mainnet",
  linea: "linea-mainnet",
  blast: "blast-mainnet",
  mantle: "mantle-mainnet",
  berachain: "berachain-mainnet",
  unichain: "unichain-mainnet",
  world: "worldchain-mainnet",
  celo: "celo-mainnet",
  zora: "zora-mainnet",
  ink: "ink-mainnet",
};

interface HistoryResponse {
  data?: { value: string; timestamp: string }[];
}

function key(): string | null {
  return process.env.ALCHEMY_API_KEY || null;
}

function toSeries(json: HistoryResponse | null): [number, number][] {
  if (!json?.data) return [];
  const out: [number, number][] = [];
  for (const p of json.data) {
    const ms = new Date(p.timestamp).getTime();
    const v = parseFloat(p.value);
    if (!Number.isNaN(ms) && !Number.isNaN(v) && v > 0 && v < 1_000_000) {
      out.push([ms, v]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

async function post(body: Record<string, unknown>): Promise<HistoryResponse | null> {
  const apiKey = key();
  if (!apiKey) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/${apiKey}/tokens/historical`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        next: { revalidate: 3600 },
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as HistoryResponse;
    } catch {
      return null;
    }
  }
  return null;
}

/** Daily historical prices for a native coin by symbol (ETH, BTC, SOL, …). */
export async function alchemyHistoryBySymbol(
  symbol: string,
  startIso: string,
  endIso: string,
): Promise<[number, number][]> {
  return toSeries(
    await post({
      symbol: symbol.toUpperCase(),
      startTime: startIso,
      endTime: endIso,
      interval: "1d",
    }),
  );
}

/** Daily historical prices for a token by network + contract address. */
export async function alchemyHistoryByAddress(
  network: ChainId,
  address: string,
  startIso: string,
  endIso: string,
): Promise<[number, number][]> {
  const net = ALCHEMY_NETWORK[network];
  if (!net) return [];
  return toSeries(
    await post({
      network: net,
      address,
      startTime: startIso,
      endTime: endIso,
      interval: "1d",
    }),
  );
}

export function alchemySupportsNetwork(network: ChainId): boolean {
  return !!ALCHEMY_NETWORK[network];
}
