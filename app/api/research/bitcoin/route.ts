import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    priceUsd: null,
    volume24hUsd: null,
    realizedPrice: null,
    mvrv: null,
    sopr: null,
    hashRate: null,
    difficulty: null,
    mempool: null,
    rsi: null,
    ma200d: null,
    supplyInProfit: null,
    supplyInLoss: null,
    lthSthSplit: null,
  });
}
