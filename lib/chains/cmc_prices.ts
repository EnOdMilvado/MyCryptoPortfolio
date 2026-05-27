/**
 * CoinMarketCap quotes API — primary source for spot price + 24h change.
 *
 * Endpoint: GET /v1/cryptocurrency/quotes/latest?symbol=BTC,ETH,LINK,...
 * Auth:     header `X-CMC_PRO_API_KEY`
 * Free tier: 333 calls/day, ~10k credits/month. Each call costs 1 credit
 * regardless of how many symbols you pass (up to ~100 per call), so this
 * is cheap to run every refresh.
 *
 * Requires `CMC_API_KEY` in env. When the key is missing the helper
 * returns an empty map (callers continue to use their existing fallbacks).
 */

export interface CmcQuote {
  priceUsd: number;
  change24h: number | null;
}

interface CmcQuoteResponse {
  data?: Record<string, CmcCoin | CmcCoin[]>;
  status?: { error_code?: number; error_message?: string };
}

interface CmcCoin {
  symbol: string;
  cmc_rank?: number;
  is_active?: number;
  quote?: {
    USD?: {
      price?: number;
      percent_change_24h?: number;
    };
  };
}

function key(): string | null {
  return process.env.CMC_API_KEY || null;
}

/**
 * Fetch USD price + 24h change for the given symbols. Symbols that
 * resolve to multiple CMC coins (ambiguous tickers) are disambiguated
 * by picking the highest-market-cap (lowest cmc_rank) result.
 *
 * Returns map: UPPERCASED symbol → {priceUsd, change24h}.
 */
export async function getCmcQuotes(
  symbols: string[],
): Promise<Record<string, CmcQuote>> {
  const apiKey = key();
  if (!apiKey || symbols.length === 0) return {};
  const unique = Array.from(
    new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean)),
  );
  const out: Record<string, CmcQuote> = {};
  // CMC quotes/latest accepts up to ~100 symbols per call; chunk just to
  // stay well under any URL-length surprise.
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(
      chunk.join(","),
    )}&convert=USD`;
    let json: CmcQuoteResponse | null = null;
    for (let attempt = 0; attempt < 2 && !json; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "X-CMC_PRO_API_KEY": apiKey,
            accept: "application/json",
          },
          // CMC rate-limits aggressively; cache 60s so repeated calls
          // within a single refresh round don't burn extra credits.
          next: { revalidate: 60 },
        });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        if (!res.ok) break;
        json = (await res.json()) as CmcQuoteResponse;
      } catch {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    if (!json || !json.data) continue;
    for (const sym of Object.keys(json.data)) {
      const raw = json.data[sym];
      const candidates = Array.isArray(raw) ? raw : [raw];
      // Pick the highest-market-cap active coin (lowest cmc_rank). Filter
      // out coins with no USD quote.
      let best: CmcCoin | null = null;
      for (const c of candidates) {
        const p = c.quote?.USD?.price;
        if (typeof p !== "number" || p <= 0 || p >= 1_000_000) continue;
        if (c.is_active === 0) continue;
        if (!best) {
          best = c;
          continue;
        }
        const bestRank = best.cmc_rank ?? Number.POSITIVE_INFINITY;
        const curRank = c.cmc_rank ?? Number.POSITIVE_INFINITY;
        if (curRank < bestRank) best = c;
      }
      if (!best) continue;
      const usd = best.quote?.USD;
      if (!usd || typeof usd.price !== "number") continue;
      out[sym.toUpperCase()] = {
        priceUsd: usd.price,
        change24h:
          typeof usd.percent_change_24h === "number"
            ? usd.percent_change_24h
            : null,
      };
    }
  }
  return out;
}

/** Returns true when CMC_API_KEY is present in env. */
export function isCmcEnabled(): boolean {
  return key() != null;
}
