/**
 * Lightweight Bitcoin halving-cycle context. Not a prediction model — just
 * a "where roughly are we" heuristic based on days since the last halving
 * and how stretched price is above/below its 200-day moving average.
 *
 * Halving dates are fixed historical facts (no API needed): the next one
 * after the last known halving is estimated at the ~4-year (1,458-day)
 * average interval, which is accurate enough for a directional label —
 * this is explicitly best-effort context, not a precise on-chain metric.
 */

// Most recent halving: April 20, 2024 (block 840,000).
const LAST_HALVING = new Date("2024-04-20T00:00:00Z").getTime();
const AVG_CYCLE_DAYS = 1458; // ~4 years between halvings historically

export function daysSinceLastHalving(now: Date = new Date()): number {
  return Math.floor((now.getTime() - LAST_HALVING) / 86_400_000);
}

export interface CycleSummary {
  phase: "Early cycle" | "Mid cycle" | "Late cycle" | "Unknown";
  daysSinceHalving: number | null;
  /** 0-100 = roughly how far through the ~4-year cycle we are. */
  cycleProgressPct: number | null;
  priceVs200d: number | null;
  supplyInProfitPct: number | null;
}

export function cycleSummary(params: {
  daysSinceHalving?: number | null;
  priceVs200d?: number | null;
  supplyInProfitPct?: number | null;
}): CycleSummary {
  const { daysSinceHalving, priceVs200d, supplyInProfitPct } = params;
  const phase: CycleSummary["phase"] =
    daysSinceHalving == null
      ? "Unknown"
      : daysSinceHalving < 365
        ? "Early cycle"
        : daysSinceHalving < 900
          ? "Mid cycle"
          : "Late cycle";
  const cycleProgressPct =
    daysSinceHalving == null
      ? null
      : Math.max(0, Math.min(100, (daysSinceHalving / AVG_CYCLE_DAYS) * 100));
  return {
    phase,
    daysSinceHalving: daysSinceHalving ?? null,
    cycleProgressPct,
    priceVs200d: priceVs200d ?? null,
    supplyInProfitPct: supplyInProfitPct ?? null,
  };
}
