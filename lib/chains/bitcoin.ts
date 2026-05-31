import type { Holding } from "./types";
import { NATIVE_DECIMALS, NATIVE_SYMBOL } from "./types";
import { getNativePricesWithChange } from "./prices";
import { getAlchemyPricesBySymbol } from "./alchemy_prices";
import { getPublicSpotUsdPrice } from "./public_ticker";

interface BlockstreamAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

/**
 * Returns BTC native holding from blockstream.info — no API key needed.
 * Aggregates confirmed + mempool so the user sees realistic numbers.
 */
export async function fetchBitcoinHoldings(address: string): Promise<Holding[]> {
  const url = `https://blockstream.info/api/address/${encodeURIComponent(address)}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`Blockstream error ${res.status}`);
  }
  const data = (await res.json()) as BlockstreamAddress;
  const sats =
    data.chain_stats.funded_txo_sum -
    data.chain_stats.spent_txo_sum +
    data.mempool_stats.funded_txo_sum -
    data.mempool_stats.spent_txo_sum;
  const amount = sats / 10 ** NATIVE_DECIMALS.bitcoin;

  if (amount <= 0) return [];

  // Three-tier price lookup. Each tier is independently flaky from
  // serverless IPs, so we run all three in parallel and pick the first
  // non-null result.
  //   1) Alchemy Prices by symbol — auth'd, but its /tokens/by-symbol
  //      endpoint is designed for ERC-20 tokens and has been observed to
  //      return nothing for BTC. No 24h change available.
  //   2) CoinGecko free tier — gives 24h change, but rate-limits hard
  //      from shared Vercel IPs and silently returns null.
  //   3) Public spot ticker (MEXC → Binance race) — no auth, very
  //      reliable. This is the last-resort source that previously kept
  //      BTC valueUsd at 0 when both above failed.
  const [alchemy, cg, publicPx] = await Promise.all([
    getAlchemyPricesBySymbol(["BTC"]),
    getNativePricesWithChange(["bitcoin"]),
    getPublicSpotUsdPrice("BTC"),
  ]);
  const priceUsd = alchemy.BTC ?? cg.bitcoin?.usd ?? publicPx ?? null;
  const change = cg.bitcoin?.change24h ?? null;

  return [
    {
      chain: "bitcoin",
      contract: "native",
      symbol: NATIVE_SYMBOL.bitcoin,
      name: "Bitcoin",
      amount,
      decimals: NATIVE_DECIMALS.bitcoin,
      priceUsd,
      valueUsd: priceUsd ? amount * priceUsd : 0,
      priceChange24h: change,
    },
  ];
}
