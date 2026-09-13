/**
 * Free Bitcoin on-chain + network metrics. No API key required.
 *
 *  - blockchain.info /charts/* — hash rate, difficulty, tx count, market price
 *    history (used for 200D MA / RSI / cycle context).
 *  - mempool.space /api — live fee recommendations + mempool congestion.
 *
 * Every fetch degrades to null on failure so the page can render partial
 * data instead of erroring out entirely — matches the "best-effort label
 * instead of a misleading number" approach agreed in the Research spec.
 */

const BLOCKCHAIN_INFO_BASE = "https://api.blockchain.info/charts";
const MEMPOOL_BASE = "https://mempool.space/api";
const REVALIDATE_S = 300;

interface ChartResponse {
  values: { x: number; y: number }[];
}

async function fetchChart(
  metric: string,
  timespan = "60days",
): Promise<{ x: number; y: number }[] | null> {
  try {
    const res = await fetch(
      `${BLOCKCHAIN_INFO_BASE}/${metric}?timespan=${timespan}&format=json`,
      { next: { revalidate: REVALIDATE_S } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as ChartResponse;
    return Array.isArray(json.values) ? json.values : null;
  } catch {
    return null;
  }
}

function latest(values: { x: number; y: number }[] | null): number | null {
  if (!values || values.length === 0) return null;
  return values[values.length - 1].y;
}

export interface MempoolFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export interface MempoolStatus {
  fees: MempoolFees | null;
  /** Pending tx count + total mempool size in vBytes — a rough
   *  congestion proxy: high vsize + high fastestFee = busy network. */
  pendingCount: number | null;
  vsizeBytes: number | null;
}

async function getMempoolStatus(): Promise<MempoolStatus> {
  try {
    const [feesRes, mempoolRes] = await Promise.all([
      fetch(`${MEMPOOL_BASE}/v1/fees/recommended`, { next: { revalidate: 60 } }),
      fetch(`${MEMPOOL_BASE}/mempool`, { next: { revalidate: 60 } }),
    ]);
    const fees = feesRes.ok ? ((await feesRes.json()) as MempoolFees) : null;
    const mempool = mempoolRes.ok
      ? ((await mempoolRes.json()) as { count?: number; vsize?: number })
      : null;
    return {
      fees,
      pendingCount: mempool?.count ?? null,
      vsizeBytes: mempool?.vsize ?? null,
    };
  } catch {
    return { fees: null, pendingCount: null, vsizeBytes: null };
  }
}

export interface BitcoinNetworkSnapshot {
  hashRateGHs: number | null;
  difficulty: number | null;
  txCount24h: number | null;
  mempool: MempoolStatus;
  /** Daily BTC/USD closes for the trailing window — feeds RSI / moving
   *  averages / cycle heuristics in technicals.ts + cycle.ts. */
  priceHistory: { x: number; y: number }[] | null;
}

/**
 * Fetch everything the Bitcoin research page needs in one call, all in
 * parallel. `priceTimespanDays` controls how much price history comes
 * back — 210+ days needed for a 200-day moving average.
 */
export async function getBitcoinNetworkSnapshot(
  priceTimespanDays = 400,
): Promise<BitcoinNetworkSnapshot> {
  const [hashRate, difficulty, txCount, mempool, priceHistory] = await Promise.all([
    fetchChart("hash-rate", "30days"),
    fetchChart("difficulty", "30days"),
    fetchChart("n-transactions", "7days"),
    getMempoolStatus(),
    fetchChart("market-price", `${priceTimespanDays}days`),
  ]);
  return {
    hashRateGHs: latest(hashRate),
    difficulty: latest(difficulty),
    txCount24h: latest(txCount),
    mempool,
    priceHistory,
  };
}
