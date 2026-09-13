import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    sentiment: null,
    altcoinSeason: null,
    btcDominance: null,
    totalMarketCap: null,
    hotTokens: [],
    recommendations: [],
  });
}
