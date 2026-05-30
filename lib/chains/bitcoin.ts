import type { Holding } from "./types";
import { NATIVE_DECIMALS, NATIVE_SYMBOL } from "./types";
import { getNativePricesWithChange } from "./prices";
import { getAlchemyPricesBySymbol } from "./alchemy_prices";

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

  // Two-tier price lookup, same pattern as EVM/Solana native prices:
  //   1) Alchemy Prices by symbol — reliable from serverless (auth'd) but
  //      no 24h change available.
  //   2) CoinGecko free tier — gives 24h change, but rate-limits hard
  //      from shared Vercel IPs and was silently returning null, leaving
  //      BTC holdings with priceUsd=null → valueUsd=0 (looked like BTC
  //      "disappeared" from the dashboard).
  // Run in parallel and merge: Alchemy wins for usd, CoinGecko fills change.
  const [alchemy, cg] = await Promise.all([
    getAlchemyPricesBySymbol(["BTC"]),
    getNativePricesWithChange(["bitcoin"]),
  ]);
  const priceUsd = alchemy.BTC ?? cg.bitcoin?.usd ?? null;
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
