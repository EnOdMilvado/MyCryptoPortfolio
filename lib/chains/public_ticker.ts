/**
 * Last-resort USD spot-price source that doesn't need an API key.
 *
 * Race MEXC and Binance public tickers — whichever responds first wins.
 * Both endpoints are CDN-cached and reliably reachable from Vercel
 * serverless IPs (unlike CoinGecko's free tier, which rate-limits the
 * shared egress hard) and don't require an API key (unlike Alchemy,
 * whose by-symbol endpoint is built for ERC-20 tokens and silently
 * skips natives like BTC).
 *
 * Returns null on any failure so callers can chain with `?? next`.
 */

const SYMBOL_TO_USDT_PAIR: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  BNB: "BNBUSDT",
  AVAX: "AVAXUSDT",
  MATIC: "MATICUSDT",
};

interface MexcTickerPrice {
  symbol: string;
  price: string;
}

interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

async function fromMexc(pair: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.mexc.com/api/v3/ticker/price?symbol=${pair}`,
      { next: { revalidate: 30 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as MexcTickerPrice;
    const px = parseFloat(json.price);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

async function fromBinance(pair: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
      { next: { revalidate: 30 } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as BinanceTickerPrice;
    const px = parseFloat(json.price);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort USD spot price for a major native symbol (BTC, ETH, SOL…).
 * Returns null if the symbol isn't a known USDT pair, or if every public
 * source we try fails.
 */
export async function getPublicSpotUsdPrice(
  symbol: string,
): Promise<number | null> {
  const pair = SYMBOL_TO_USDT_PAIR[symbol.toUpperCase()];
  if (!pair) return null;
  // Race so the slower of the two doesn't gate the page when one CDN edge
  // is misbehaving. `Promise.any` resolves on first non-throwing fulfillment;
  // wrap each so a `null` return becomes a rejection to keep Promise.any
  // from settling on a null.
  const racers = [fromMexc(pair), fromBinance(pair)].map((p) =>
    p.then((v) => (v == null ? Promise.reject(new Error("null")) : v)),
  );
  try {
    return await Promise.any(racers);
  } catch {
    return null;
  }
}
