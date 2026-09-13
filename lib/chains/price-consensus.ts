/**
 * Liquidity-INDEPENDENT price consensus for DexScreener pool candidates.
 *
 * Why liquidity can't be trusted as a signal: DexScreener's `liquidity.usd`
 * field is computed from the pool's own reserves, which an attacker fully
 * controls when creating the pool. Fake pools have repeatedly reported
 * liquidity figures in the hundreds of millions to billions — enough to
 * beat every genuine pool in a "pick highest liquidity" comparison, and
 * even to dominate a median/average when there are only 1-2 genuine pools
 * to outweigh it. Confirmed real-world cases (all on trusted chain ids,
 * so chain-allowlisting alone doesn't catch them): ARCH, MOG, ZRX, TRU,
 * LRC — each had one fake pool reporting a price 1,000x-100,000,000x the
 * real price alongside a fabricated liquidity number.
 *
 * The fix: ignore liquidity for consensus purposes. Instead, CLUSTER
 * candidate prices by relative closeness and trust the cluster with the
 * MOST independent pools agreeing (pool COUNT, not liquidity SUM). A
 * single fake pool can report any liquidity number it wants, but it can't
 * conjure additional independent pools agreeing with its fake price.
 */

export interface PriceCandidate {
  price: number;
  change24h: number | null;
  liquidityUsd: number;
}

export interface ConsensusResult {
  price: number;
  change24h: number | null;
  /** How many pools agreed on this price cluster. */
  poolCount: number;
}

/**
 * Groups candidates into clusters where every price is within `ratio` of
 * every other price in the same cluster (default 1.5x — i.e. no two prices
 * in a cluster differ by more than 50%). Returns the cluster with the most
 * members; ties broken by total liquidity (only used as a tiebreaker
 * between equally-sized clusters, never to let one big number override
 * pool count).
 */
export function resolveByConsensus(
  candidates: PriceCandidate[],
  { ratio = 1.5, minPoolsToTrust = 1 }: { ratio?: number; minPoolsToTrust?: number } = {},
): ConsensusResult | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    // Nothing to cross-validate against. Still return it — this is the
    // same "better than nothing" fallback the callers had before, just
    // made explicit here instead of silently trusting liquidity elsewhere.
    const c = candidates[0];
    return { price: c.price, change24h: c.change24h, poolCount: 1 };
  }

  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters: PriceCandidate[][] = [];
  let current: PriceCandidate[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    // Chain-linked closeness: as long as each consecutive pair is within
    // `ratio`, keep extending the cluster (transitively handles small
    // legitimate spread across many genuine pools without needing every
    // pair to be close to every other pair).
    if (cur.price <= prev.price * ratio) {
      current.push(cur);
    } else {
      clusters.push(current);
      current = [cur];
    }
  }
  clusters.push(current);

  // Winner = most pools (liquidity plays NO role in this comparison — a
  // fake pool cannot conjure more independent agreeing pools by reporting
  // a bigger liquidity number). Tiebreak only when two clusters have the
  // EXACT same pool count: prefer the cluster whose single largest pool
  // is LEAST dominant relative to its peers. A fake pool's entire purpose
  // is to report a liquidity figure that dwarfs every genuine pool for
  // that token (seen: $255M fake vs $15K real, $122M fake vs $17K real) —
  // genuine clusters essentially never have one pool that many orders of
  // magnitude bigger than the rest of the same cluster.
  clusters.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const maxA = Math.max(...a.map((c) => c.liquidityUsd));
    const maxB = Math.max(...b.map((c) => c.liquidityUsd));
    return maxA - maxB;
  });
  const winner = clusters[0];
  if (winner.length < minPoolsToTrust) return null;

  const prices = winner.map((c) => c.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

  // 24h change: median-closest pool's value, among the winning cluster.
  const closest = winner.reduce((best, c) =>
    Math.abs(c.price - median) < Math.abs(best.price - median) ? c : best,
  );

  return { price: median, change24h: closest.change24h, poolCount: winner.length };
}
