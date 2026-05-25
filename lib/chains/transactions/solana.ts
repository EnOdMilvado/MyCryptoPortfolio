import { NATIVE_DECIMALS, NATIVE_SYMBOL } from "../types";
import { type Transaction, txUrl } from "./types";

function endpoint(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("Missing ALCHEMY_API_KEY");
  return `https://solana-mainnet.g.alchemy.com/v2/${key}`;
}

interface SolSignature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  memo: string | null;
  confirmationStatus?: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T };
    return (json.result as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the most recent signatures for a Solana address. Lite info only
 * (no per-tx parsing — fetching full data for each would be far too many
 * RPC calls for the free tier).
 */
export async function fetchSolanaTransactions(address: string): Promise<Transaction[]> {
  const sigs = await rpc<SolSignature[]>("getSignaturesForAddress", [
    address,
    { limit: 100 },
  ]);
  if (!sigs) return [];
  return sigs.map((s) => {
    const ts = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null;
    const success = s.err == null;
    return {
      network: "solana",
      hash: s.signature,
      timestamp: ts,
      blockNumber: s.slot,
      direction: "other",
      counterparty: null,
      amount: null,
      symbol: NATIVE_SYMBOL.solana,
      contract: "native",
      category: "signature",
      feeUsd: null,
      feeAmount: null,
      feeSymbol: NATIVE_SYMBOL.solana,
      status: success ? "success" : "failed",
      explorerUrl: txUrl("solana", s.signature),
    } satisfies Transaction;
  });
}

// Silence "imported but unused" for NATIVE_DECIMALS — kept for future expansion.
void NATIVE_DECIMALS;
