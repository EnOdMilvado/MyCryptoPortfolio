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
            if ((p.liquidity?.usd ?? 0) < 5_000) return false; // wash-trade/honeypot floor
            const v = p.priceUsd ? parseFloat(p.priceUsd) : NaN;
            return Number.isFinite(v) && v > 0 && v < 1_000_000;
          });
          if (candidates.length === 0) return;

          // CRITICAL: group by CONTRACT ADDRESS first, not just symbol.
          // Search-by-symbol frequently returns pools for several UNRELATED
          // tokens that merely share a ticker (e.g. "WEN" matches the real
          // Solana WEN at WENWENvqq... AND several totally different meme
          // coins on other contracts that also self-labeled "WEN"). Taking
          // a median across candidates from DIFFERENT contracts silently
          // blends unrelated tokens' prices into a meaningless number. The
          // fix: pick the single contract address with the highest total
          // liquidity across its own pools (the token actually trading at
          // real volume), THEN take the median of just that contract's
          // pools to guard against one manipulated pool within it (the
          // ARCH/MOG/ZRX class of bug).
          const byAddr: Record<string, DsSearchPair[]> = {};
          for (const p of candidates) {
            const addr = (p.baseToken?.address ?? "").toLowerCase();
            if (!addr) continue;
            (byAddr[addr] ??= []).push(p);
          }
          const addrs = Object.keys(byAddr);
          if (addrs.length === 0) return;
          const totalLiq = (addr: string) =>
            byAddr[addr].reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
          const winningAddr = addrs.reduce((a, b) => (totalLiq(b) > totalLiq(a) ? b : a));
          const winningPools = byAddr[winningAddr];

          // Require at least 3 qualifying pools for THIS specific contract
          // before trusting a median — with only 1-2, a single
          // manipulated/thin pool can still dominate the result. Fall back
          // to the single/best pool directly when there are fewer.
          let v: number;
          let best: DsSearchPair;
          if (winningPools.length < 3) {
            best = winningPools.reduce((a, b) =>
              (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
            );
            v = parseFloat(best.priceUsd!);
          } else {
            const prices = winningPools
              .map((p) => parseFloat(p.priceUsd!))
              .sort((a, b) => a - b);
            const mid = Math.floor(prices.length / 2);
            v =
              prices.length % 2 === 0
                ? (prices[mid - 1] + prices[mid]) / 2
                : prices[mid];
            best = winningPools.reduce((closest, p) =>
              Math.abs(parseFloat(p.priceUsd!) - v) <
              Math.abs(parseFloat(closest.priceUsd!) - v)
                ? p
                : closest,
            );
          }
          out[sym] = {
            priceUsd: v,
            change24h:
              typeof best.priceChange?.h24 === "number"
                ? best.priceChange.h24
                : null,
            source: { chain: best.chainId },
          };
        } catch {
          // swallow — non-fatal
        }
      }),
    );
  }

  return out;
}
