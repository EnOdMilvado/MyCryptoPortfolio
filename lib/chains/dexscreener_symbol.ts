/**
 * DexScreener search-by-symbol fallback — catches long-tail exchange tokens
 * (MEXC / HTX dust) that Alchemy-by-symbol (top 1K), CoinGecko, and CMC all
 * miss. DexScreener indexes ~all DEX pools and returns 24h price change too.
 *
 * Endpoint: GET /latest/dex/search?q=<symbol>
 *
 * Free, no API key, ~300 req/min rate limit.
 */

interface DsSearchPair {
  chainId: string;
  baseToken: { address: string; symbol?: string; name?: string };
  quoteToken: { address: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
}

interface DsSearchResponse {
  pairs: DsSearchPair[] | null;
}

export interface DexSymbolEntry {
  priceUsd: number;
  change24h: number | null;
  /** The pair we picked — used for debugging / chain inference. */
  source?: { chain: string; pairAddress?: string };
}

/**
 * Tokens we explicitly skip: delisted MEXC variants (suffix OLD/OLD2)
 * and obvious test/burn symbols. Saves rate-limit budget.
 */
function shouldSkip(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (/OLD\d*$/.test(s)) return true; // MARAOLD, CTOOLD, CAIOLD2 …
  if (/(TEST|FAKE|DEAD|BURN|XXX)$/.test(s)) return true;
  return false;
}

import { resolveByConsensus } from "./price-consensus";

// Only trust pairs on chains we actually recognize/support elsewhere in the
// app. DexScreener's /search endpoint indexes dozens of long-tail/novelty
// "chains" (seen in the wild: "robinhood", tokenized-stock wrapper DEXes)
// that list scam/mirror tokens with an identical ticker and a wildly
// inflated fake liquidity figure — e.g. an "ARCH" pool on chainId
// "robinhood" reporting $1.24B liquidity and a $24.87 price, versus the
// real Archway ARCH at $0.0004. The $5k liquidity floor alone doesn't
// catch this because the fake number is deliberately huge. Restricting to
// known chains removes the entire class of these mirror-pool false
// positives.
const TRUSTED_CHAIN_IDS = new Set([
  "ethereum", "polygon", "arbitrum", "optimism", "base", "avalanche", "bsc",
  "linea", "blast", "mantle", "berachain", "sonic", "unichain", "worldchain",
  "apechain", "zksync", "scroll", "gnosis", "celo", "abstract", "ink",
  "zora", "shape", "fraxtal", "soneium", "polygon-zkevm", "arbitrum-nova",
  "solana", "bitcoin", "tron",
]);

/**
 * Search DexScreener by symbol for each input symbol, return the deepest-
 * liquidity DEX pair where baseToken.symbol matches exactly (case-insensitive).
 *
 * Returns map keyed by UPPERCASE symbol.
 *
 * Concurrency: 5 in-flight at a time to stay well under DexScreener's
 * ~300 req/min limit even when called with 30+ symbols.
 */
export async function getDexScreenerPricesBySymbol(
  symbols: string[],
): Promise<Record<string, DexSymbolEntry>> {
  if (symbols.length === 0) return {};

  const out: Record<string, DexSymbolEntry> = {};
  const filtered = Array.from(
    new Set(symbols.map((s) => s.toUpperCase())),
  ).filter((s) => s.length > 0 && !shouldSkip(s));
  if (filtered.length === 0) return {};

  const CONCURRENCY = 5;
  for (let i = 0; i < filtered.length; i += CONCURRENCY) {
    const batch = filtered.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (sym) => {
        const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(sym)}`;
        try {
          const res = await fetch(url, { next: { revalidate: 300 } });
          if (!res.ok) return;
          const json = (await res.json()) as DsSearchResponse;
          const candidates = (json.pairs ?? []).filter((p) => {
            const baseSym = (p.baseToken?.symbol ?? "").toUpperCase();
            if (baseSym !== sym) return false;
            if (!TRUSTED_CHAIN_IDS.has((p.chainId ?? "").toLowerCase())) return false;
            const v = p.priceUsd ? parseFloat(p.priceUsd) : NaN;
            return Number.isFinite(v) && v > 0 && v < 1_000_000;
          });
          if (candidates.length === 0) return;

          // Group by CONTRACT ADDRESS first, not just symbol. Search-by-
          // symbol frequently returns pools for several UNRELATED tokens
          // that merely share a ticker (e.g. "WEN" matches the real Solana
          // WEN at WENWENvqq... AND totally different meme coins on other
          // contracts). Blending prices across different contracts would be
          // meaningless, so each contract is resolved independently below.
          const byAddr: Record<string, DsSearchPair[]> = {};
          for (const p of candidates) {
            const addr = (p.baseToken?.address ?? "").toLowerCase();
            if (!addr) continue;
            (byAddr[addr] ??= []).push(p);
          }
          const addrs = Object.keys(byAddr);
          if (addrs.length === 0) return;

          // For each contract, resolve via liquidity-INDEPENDENT consensus
          // (see price-consensus.ts) instead of picking/weighting by
          // liquidity, which is attacker-controlled and has repeatedly been
          // faked into the hundreds of millions to make a single scam pool
          // dominate (confirmed on ARCH, MOG, ZRX, TRU, LRC). Then, when
          // MULTIPLE contracts share this symbol, pick the contract whose
          // consensus has the most agreeing pools (again pool COUNT, not
          // liquidity) — that's the real, actively-traded token.
          let bestConsensus: { price: number; change24h: number | null; poolCount: number; chain: string } | null = null;
          for (const addr of addrs) {
            const pools = byAddr[addr];
            const consensus = resolveByConsensus(
              pools.map((p) => ({
                price: parseFloat(p.priceUsd!),
                change24h: typeof p.priceChange?.h24 === "number" ? p.priceChange.h24 : null,
                liquidityUsd: p.liquidity?.usd ?? 0,
              })),
            );
            if (!consensus) continue;
            if (!bestConsensus || consensus.poolCount > bestConsensus.poolCount) {
              bestConsensus = { ...consensus, chain: pools[0].chainId };
            }
          }
          if (!bestConsensus) return;
          out[sym] = {
            priceUsd: bestConsensus.price,
            change24h: bestConsensus.change24h,
            source: { chain: bestConsensus.chain },
          };
        } catch {
          // swallow — non-fatal
        }
      }),
    );
  }

  return out;
}
