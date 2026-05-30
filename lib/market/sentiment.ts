/**
 * Market-sentiment widgets sourced from CoinMarketCap's public data-api
 * (the same endpoints powering the gauges on the CMC homepage). No
 * API key required.
 *
 *   Fear & Greed: GET /data-api/v3/fear-greed/chart?start=…&end=…
 *                 → data.dataList[i] = {score, name, timestamp, btcPrice}
 *                 Take the last entry as "now".
 *
 *   Altcoin Season: GET /data-api/v3/altcoin-season/chart?start=…&end=…
 *                 → data.historicalValues.now.altcoinIndex (string number 0-100)
 *                 + dialConfigs giving the band labels.
 *
 * Both endpoints return a small JSON payload and are CDN-cached on
 * CMC's side. We also revalidate every 5 minutes locally so we don't
 * burn upstream calls when many users hit the dashboard in a burst.
 */

export interface FearGreed {
  /** 0–100, where 0 = extreme fear, 100 = extreme greed. */
  value: number;
  /** Classification label CMC ships with the value, e.g. "Fear",
   *  "Neutral", "Greed". Use as-is for display. */
  label: string;
}

export interface AltcoinSeason {
  /** 0–100, where ≤25 = Bitcoin Season, ≥75 = Altcoin Season. */
  value: number;
  /** "Bitcoin Season" / "Altcoin Season" / "" (neutral middle band). */
  label: string;
}

export interface MarketSentiment {
  fearGreed: FearGreed | null;
  altcoinSeason: AltcoinSeason | null;
  fetchedAt: string;
}

const CMC_BASE = "https://api.coinmarketcap.com/data-api/v3";

// Five-minute revalidate matches how fast these gauges actually change
// (CMC publishes a new F&G score once per day, altseason once per hour).
const REVALIDATE_S = 300;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        // CMC's public endpoint 403s on some default Node user-agents
        // depending on edge routing; mirror a generic browser UA.
        "user-agent": "Mozilla/5.0 (compatible; MyCryptoPortfolio/1.0)",
      },
      next: { revalidate: REVALIDATE_S },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface FearGreedResponse {
  data?: {
    dataList?: {
      score: number;
      name: string;
      timestamp: string;
    }[];
  };
}

async function getFearGreed(): Promise<FearGreed | null> {
  // The chart endpoint demands a non-trivial range — empty `data: {}` comes
  // back for short windows. 30 days is the smallest window I've found to
  // reliably contain the latest daily reading.
  const now = Math.floor(Date.now() / 1000);
  const start = now - 30 * 86400;
  const json = await fetchJson<FearGreedResponse>(
    `${CMC_BASE}/fear-greed/chart?start=${start}&end=${now}`,
  );
  const list = json?.data?.dataList;
  if (!list || list.length === 0) return null;
  const latest = list[list.length - 1];
  if (typeof latest.score !== "number" || latest.score < 0 || latest.score > 100) {
    return null;
  }
  return {
    value: Math.round(latest.score),
    label: latest.name || classifyFearGreed(latest.score),
  };
}

interface AltSeasonResponse {
  data?: {
    historicalValues?: {
      now?: { altcoinIndex?: string | number };
    };
    dialConfigs?: { start: number; end: number; name: string }[];
  };
}

async function getAltcoinSeason(): Promise<AltcoinSeason | null> {
  // Altseason endpoint accepts a much shorter range — 1 day is enough.
  const now = Math.floor(Date.now() / 1000);
  const start = now - 86400;
  const json = await fetchJson<AltSeasonResponse>(
    `${CMC_BASE}/altcoin-season/chart?start=${start}&end=${now}`,
  );
  const raw = json?.data?.historicalValues?.now?.altcoinIndex;
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  // Resolve the band label from CMC's own dialConfigs so we match the
  // boundaries they actually display (≤25 / 26-74 / ≥75 today).
  const dial = json?.data?.dialConfigs ?? [];
  const band = dial.find((b) => value >= b.start && value <= b.end);
  return {
    value: Math.round(value),
    label: band?.name || classifyAltseason(value),
  };
}

/** Default labels matching CMC's bands when the API omits a name. */
function classifyFearGreed(v: number): string {
  if (v < 25) return "Extreme Fear";
  if (v < 45) return "Fear";
  if (v < 55) return "Neutral";
  if (v < 75) return "Greed";
  return "Extreme Greed";
}
function classifyAltseason(v: number): string {
  if (v <= 25) return "Bitcoin Season";
  if (v >= 75) return "Altcoin Season";
  return "";
}

/**
 * Fetch both sentiment values in parallel. Either or both may come back
 * null on upstream failure — callers should render gracefully.
 */
export async function getMarketSentiment(): Promise<MarketSentiment> {
  const [fearGreed, altcoinSeason] = await Promise.all([
    getFearGreed(),
    getAltcoinSeason(),
  ]);
  return {
    fearGreed,
    altcoinSeason,
    fetchedAt: new Date().toISOString(),
  };
}
