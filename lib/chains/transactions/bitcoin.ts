import { NATIVE_DECIMALS, NATIVE_SYMBOL } from "../types";
import { type Transaction, txUrl } from "./types";

interface Vin {
  prevout?: {
    scriptpubkey_address?: string;
    value?: number;
  };
}
interface Vout {
  scriptpubkey_address?: string;
  value?: number;
}
interface BtcTx {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: Vin[];
  vout: Vout[];
}

const SAT_PER_BTC = 10 ** NATIVE_DECIMALS.bitcoin;

/**
 * Fetches recent BTC transactions for an address from blockstream.info.
 * Computes the wallet's net amount per tx (vout to us minus vin from us).
 */
export async function fetchBitcoinTransactions(address: string): Promise<Transaction[]> {
  const url = `https://blockstream.info/api/address/${encodeURIComponent(address)}/txs`;
  let txs: BtcTx[];
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    txs = (await res.json()) as BtcTx[];
  } catch {
    return [];
  }

  return txs.map((t) => {
    let sentSats = 0;
    let receivedSats = 0;
    for (const v of t.vin) {
      if (v.prevout?.scriptpubkey_address === address) sentSats += v.prevout.value ?? 0;
    }
    for (const o of t.vout) {
      if (o.scriptpubkey_address === address) receivedSats += o.value ?? 0;
    }
    const netSats = receivedSats - sentSats;
    const direction: Transaction["direction"] =
      sentSats > 0 && receivedSats > 0
        ? netSats >= 0
          ? "in"
          : "out"
        : sentSats > 0
          ? "out"
          : "in";
    const amount = Math.abs(netSats) / SAT_PER_BTC;
    const ts = t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null;

    // Best-effort counterparty: first non-self vout (for sends), first non-self vin (for receives).
    let counterparty: string | null = null;
    if (direction === "out") {
      const o = t.vout.find((x) => x.scriptpubkey_address && x.scriptpubkey_address !== address);
      counterparty = o?.scriptpubkey_address ?? null;
    } else if (direction === "in") {
      const i = t.vin.find(
        (x) => x.prevout?.scriptpubkey_address && x.prevout.scriptpubkey_address !== address,
      );
      counterparty = i?.prevout?.scriptpubkey_address ?? null;
    }

    return {
      network: "bitcoin",
      hash: t.txid,
      timestamp: ts,
      blockNumber: t.status.block_height ?? null,
      direction,
      counterparty,
      amount,
      symbol: NATIVE_SYMBOL.bitcoin,
      contract: "native",
      category: "transfer",
      feeUsd: null,
      feeAmount: t.fee / SAT_PER_BTC,
      feeSymbol: NATIVE_SYMBOL.bitcoin,
      status: t.status.confirmed ? "success" : "pending",
      explorerUrl: txUrl("bitcoin", t.txid),
    } satisfies Transaction;
  });
}
