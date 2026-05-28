/**
 * Alchemy Historical Prices — fetches the price at "24h ago" for a single
 * token (by symbol OR by network+address), used to compute 24h % change
 * for tokens that other resolvers (CoinGecko, DexScreener) couldn't fill.
 *
 * Endpoint: POST /prices/v1/{apiKey}/tokens/historical
 *   { symbol: "BTC", startTime: "<iso>", endTime: "<iso>", interval: "1d" }
 *   or
 *   { network: "eth-mainnet", address: "0x…", startTime: …, endTime: …, interval: "1d" }
 *
 * Free tier: 300 req/hr. We throttle to 5 concurrent and skip if no API key.
 */

import type { EvmChain } from "./types";

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

interface HistoricalResponse {
  data?: { value: string; timestamp: string }[];
  error?: unknown;
}

function key(): string | null {
  return process.env.ALCHEMY_API_KEY || null;
}

function isoHoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Convert two prices into a percent change. Returns null on bad input. */
function pctChange(past: number, current: number): number | null {
  if (!Number.isFinite(past) || past <= 0) return null;
  if (!Number.isFinite(current) || current <= 0) return null;
  return ((current - past) / past) * 100;
}

interface BatchOpts {
  /** Throttle concurrency. Free tier: 300 req/hr → 5 in flight is safe. */
  concurrency?: number;
}

/**
 * Fetch the 24h price-change percentage for a list of token symbols.
 * Returns map: UPPERCASE symbol → change24h (%) — entries missing means
 * Alchemy had no historical data for that symbol.
 *
 * Caller must already know the current price (we don't fetch it here);
 * pass it via `currentPrices` so we can compute change without an extra
 * round-trip per token.
 */
export async function getAlchemyChange24hBySymbol(
  currentPrices: Record<string, number>,
  opts: BatchOpts = {},
): Promise<Record<string, number>> {
  const apiKey = key();
  const symbols = Object.keys(currentPrices);
  if (!apiKey || symbols.length === 0) return {};

  const out: Record<string, number> = {};
  const url = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;
  const startTime = isoHoursAgo(25); // 25h gives slack for interval=1d
  const endTime = nowIso();
  const concurrency = opts.concurrency ?? 5;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (sym) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              symbol: sym,
              startTime,
              endTime,
              interval: "1d",
            }),
            // Cache for 30 min — 24h change is slow-moving.
            next: { revalidate: 1800 },
          });
          if (!res.ok) return;
          const json = (await res.json()) as HistoricalResponse;
          if (json.error || !json.data || json.data.length === 0) return;
          // First data point is the oldest within the window (~24h ago).
          const past = parseFloat(json.data[0].value);
          const change = pctChange(past, currentPrices[sym]);
          if (change != null) out[sym] = change;
        } catch {
          // swallow
        }
      }),
    );
  }
  return out;
}

/**
 * Fetch 24h change for EVM/Solana token contracts. Returns map:
 * lowercased contract → change24h (%).
 */
export async function getAlchemyChange24hByAddress(
  network: EvmChain | "solana",
  currentPrices: Record<string, number>,
  opts: BatchOpts = {},
): Promise<Record<string, number>> {
  const apiKey = key();
  const contracts = Object.keys(currentPrices);
  if (!apiKey || contracts.length === 0) return {};
  const networkId = NETWORK_ID[network];
  if (!networkId) return {};

  const out: Record<string, number> = {};
  const url = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;
  const startTime = isoHoursAgo(25);
  const endTime = nowIso();
  const concurrency = opts.concurrency ?? 5;

  for (let i = 0; i < contracts.length; i += concurrency) {
    const batch = contracts.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (addr) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              network: networkId,
              address: addr,
              startTime,
              endTime,
              interval: "1d",
            }),
            next: { revalidate: 1800 },
          });
          if (!res.ok) return;
          const json = (await res.json()) as HistoricalResponse;
          if (json.error || !json.data || json.data.length === 0) return;
          const past = parseFloat(json.data[0].value);
          const change = pctChange(past, currentPrices[addr]);
          if (change != null) out[addr.toLowerCase()] = change;
        } catch {
          // swallow
        }
      }),
    );
  }
  return out;
}
