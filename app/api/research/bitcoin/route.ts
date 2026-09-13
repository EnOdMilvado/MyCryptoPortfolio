import { NextResponse } from "next/server";
import { getBitcoinNetworkSnapshot } from "@/lib/market/blockchain";
import { computeTechnicals, estimatedSupplyInProfitPct } from "@/lib/market/technicals";
import { cycleSummary, daysSinceLastHalving } from "@/lib/market/cycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const snapshot = await getBitcoinNetworkSnapshot(400);
  const series = snapshot.priceHistory ?? [];
  const technicals = computeTechnicals(series);
  const supplyInProfitPct = estimatedSupplyInProfitPct(series);
  const cycle = cycleSummary({
    daysSinceHalving: daysSinceLastHalving(),
    priceVs200d: technicals.pctVs200d,
    supplyInProfitPct,
  });

  return NextResponse.json({
    price: technicals.price,
    change24hPct: technicals.change24hPct,
    rsi14: technicals.rsi14,
    sma50: technicals.sma50,
    sma200: technicals.sma200,
    pctVs200d: technicals.pctVs200d,
    hashRateGHs: snapshot.hashRateGHs,
    difficulty: snapshot.difficulty,
    txCount24h: snapshot.txCount24h,
    mempool: snapshot.mempool,
    cycle,
    // Explicit best-effort flag so the UI can label anything derived from
    // a free proxy instead of a real on-chain source (per the locked
    // spec's "no misleading numbers" rule).
    estimatedSupplyInProfitPct: supplyInProfitPct,
    fetchedAt: new Date().toISOString(),
  });
}
