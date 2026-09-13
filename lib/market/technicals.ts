/**
 * Simple, free-first technical indicators computed from a daily
 * price-history series (blockchain.info's /charts/market-price, or any
 * other {x: unixSeconds, y: price} array).
 *
 * Everything here is a pure function over the series — no network calls,
 * no paid data. Kept intentionally simple (SMA-based RSI, not Wilder's
 * smoothing) since the Research page's job is directional context, not
 * a trading signal.
 */

export interface PricePoint {
  x: number;
  y: number;
}

/** Simple moving average over the trailing `period` points. */
export function sma(series: PricePoint[], period: number): number | null {
  if (series.length < period) return null;
  const slice = series.slice(-period);
  const sum = slice.reduce((s, p) => s + p.y, 0);
  return sum / period;
}

/**
 * Classic 14-period RSI using simple (not Wilder-smoothed) averages of
 * gains/losses — close enough for a dashboard "momentum" tile.
 * Returns null when there isn't enough history.
 */
export function rsi(series: PricePoint[], period = 14): number | null {
  if (series.length < period + 1) return null;
  const slice = series.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i].y - slice[i - 1].y;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** % distance of the latest price above/below its `period`-day SMA. */
export function pctVsMa(series: PricePoint[], period: number): number | null {
  const ma = sma(series, period);
  if (ma == null || series.length === 0) return null;
  const last = series[series.length - 1].y;
  return ((last - ma) / ma) * 100;
}

export interface TechnicalSnapshot {
  price: number | null;
  change24hPct: number | null;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  /** % above/below the 200-day SMA — a common "how stretched is price"
   *  cycle-context readout (very negative near bear-market bottoms,
   *  very positive near blow-off tops). */
  pctVs200d: number | null;
}

/**
 * Rough "supply in profit" proxy: % of trailing daily closes (over the
 * provided series) that are BELOW the current price. This is NOT the same
 * as true on-chain supply-in-profit (which needs per-UTXO cost basis data
 * from a paid provider like Glassnode/CoinMetrics) — it's a free
 * approximation using price history only, and should always be labeled
 * "estimated" in the UI per the Research spec's best-effort rule.
 */
export function estimatedSupplyInProfitPct(series: PricePoint[]): number | null {
  if (series.length < 30) return null;
  const current = series[series.length - 1].y;
  const below = series.filter((p) => p.y <= current).length;
  return (below / series.length) * 100;
}

export function computeTechnicals(series: PricePoint[]): TechnicalSnapshot {
  if (series.length === 0) {
    return { price: null, change24hPct: null, rsi14: null, sma50: null, sma200: null, pctVs200d: null };
  }
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const change24hPct = prev && prev.y !== 0 ? ((last.y - prev.y) / prev.y) * 100 : null;
  return {
    price: last.y,
    change24hPct,
    rsi14: rsi(series, 14),
    sma50: sma(series, 50),
    sma200: sma(series, 200),
    pctVs200d: pctVsMa(series, 200),
  };
}
