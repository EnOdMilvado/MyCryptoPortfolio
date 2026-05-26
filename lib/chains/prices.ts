import { COINGECKO_PLATFORM, type EvmChain } from "./types";

const CG_BASE = "https://api.coingecko.com/api/v3";

type PriceMap = Record<string, number>;
export type PriceWithChangeMap = Record<string, { usd: number; change24h: number | null }>;

/**
 * Resilient CoinGecko fetch with one automatic retry when the free tier
 * returns 429 (rate limited). Returns null on any other error.
 */
async function cgFetch<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        next: { revalidate: 60 },
      });
      if (res.status === 429) {
        // Backoff briefly before retrying
        await new Promise((r) => setTimeout(r, 700));
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

/**
 * Map of coingecko id → USD price. Pass an array of ids
 * (e.g. ["bitcoin","ethereum","solana"]).
 */
export async function getNativePrices(ids: string[]): Promise<PriceMap> {
  if (ids.length === 0) return {};
  const unique = Array.from(new Set(ids));
  // CoinGecko expects literal commas — using encodeURIComponent on the joined
  // list percent-encodes them and some upstream proxies reject the request.
  const url = `${CG_BASE}/simple/price?ids=${unique.join(",")}&vs_currencies=usd`;
  const json = await cgFetch<Record<string, { usd?: number }>>(url);
  if (!json) return {};
  const out: PriceMap = {};
  for (const id of Object.keys(json)) {
    const p = json[id]?.usd;
    if (typeof p === "number" && p > 0 && p < 1_000_000) out[id] = p;
  }
  return out;
}

/** Same as getNativePrices but also returns the 24h % change per coin. */
export async function getNativePricesWithChange(
  ids: string[],
): Promise<PriceWithChangeMap> {
  if (ids.length === 0) return {};
  const unique = Array.from(new Set(ids));
  const url = `${CG_BASE}/simple/price?ids=${unique.join(",")}&vs_currencies=usd&include_24hr_change=true`;
  const json = await cgFetch<Record<string, { usd?: number; usd_24h_change?: number }>>(url);
  if (!json) return {};
  const out: PriceWithChangeMap = {};
  for (const id of Object.keys(json)) {
    const p = json[id]?.usd;
    const c = json[id]?.usd_24h_change;
    if (typeof p === "number" && p > 0 && p < 1_000_000) {
      out[id] = { usd: p, change24h: typeof c === "number" ? c : null };
    }
  }
  return out;
}

/**
 * Token prices for ERC-20/SPL tokens by contract on a given EVM chain or
 * Solana. Returns map: lowercased contract → USD price.
 */
export async function getTokenPrices(
  platform: EvmChain | "solana",
  contracts: string[],
): Promise<PriceMap> {
  if (contracts.length === 0) return {};
  // CoinGecko caps URL length; chunk into batches of 75 to stay well under
  // the practical limit even with long Solana mint addresses.
  const out: PriceMap = {};
  const cgPlatform = COINGECKO_PLATFORM[platform];
  for (let i = 0; i < contracts.length; i += 75) {
    const chunk = contracts.slice(i, i + 75);
    const url = `${CG_BASE}/simple/token_price/${cgPlatform}?contract_addresses=${chunk.join(",")}&vs_currencies=usd`;
    const json = await cgFetch<Record<string, { usd?: number }>>(url);
    if (!json) continue;
    for (const k of Object.keys(json)) {
      const p = json[k]?.usd;
      if (typeof p === "number" && p > 0 && p < 1_000_000) out[k.toLowerCase()] = p;
    }
  }
  return out;
}

/**
 * Resolve USD prices by ticker symbol (e.g. SUI, ENJ, MANTRA) via CoinGecko's
 * /coins/markets endpoint. Returns map: UPPERCASED symbol → USD price.
 *
 * Ambiguous symbols (multiple coins share a ticker) are resolved by picking
 * the highest market-cap match. Caps batch size to keep URL under length
 * limits on the free tier.
 */
export async function getCoinGeckoPricesBySymbol(
  symbols: string[],
): Promise<PriceMap> {
  if (symbols.length === 0) return {};
  const unique = Array.from(
    new Set(symbols.map((s) => s.toLowerCase()).filter(Boolean)),
  );
  const out: PriceMap = {};
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const url = `${CG_BASE}/coins/markets?vs_currency=usd&symbols=${chunk.join(",")}&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
    const json = await cgFetch<
      { symbol: string; current_price: number | null; market_cap: number | null }[]
    >(url);
    if (!json) continue;
    // For collisions (same symbol → multiple coins), keep the one with the
    // highest market cap (first entry due to order=market_cap_desc).
    for (const row of json) {
      const sym = (row.symbol ?? "").toUpperCase();
      if (!sym || out[sym] != null) continue;
      const p = row.current_price;
      if (typeof p === "number" && p > 0 && p < 1_000_000) out[sym] = p;
    }
  }
  return out;
}

/** Same as getTokenPrices but also returns 24h % change per contract. */
export async function getTokenPricesWithChange(
  platform: EvmChain | "solana",
  contracts: string[],
): Promise<PriceWithChangeMap> {
  if (contracts.length === 0) return {};
  const out: PriceWithChangeMap = {};
  const cgPlatform = COINGECKO_PLATFORM[platform];
  for (let i = 0; i < contracts.length; i += 75) {
    const chunk = contracts.slice(i, i + 75);
    const url = `${CG_BASE}/simple/token_price/${cgPlatform}?contract_addresses=${chunk.join(",")}&vs_currencies=usd&include_24hr_change=true`;
    const json = await cgFetch<Record<string, { usd?: number; usd_24h_change?: number }>>(url);
    if (!json) continue;
    for (const k of Object.keys(json)) {
      const p = json[k]?.usd;
      const c = json[k]?.usd_24h_change;
      if (typeof p === "number" && p > 0 && p < 1_000_000) {
        out[k.toLowerCase()] = { usd: p, change24h: typeof c === "number" ? c : null };
      }
    }
  }
  return out;
}
