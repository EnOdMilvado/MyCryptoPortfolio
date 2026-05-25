import type { Holding } from "./types";
import { NATIVE_DECIMALS, NATIVE_SYMBOL } from "./types";
import { getNativePricesWithChange } from "./prices";

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

  const prices = await getNativePricesWithChange(["bitcoin"]);
  const priceUsd = prices.bitcoin?.usd ?? null;
  const change = prices.bitcoin?.change24h ?? null;

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
