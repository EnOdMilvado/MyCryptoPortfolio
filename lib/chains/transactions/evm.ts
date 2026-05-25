import {
  ALCHEMY_EVM_SUBDOMAIN,
  EVM_CHAINS,
  type EvmChain,
} from "../types";
import { type Transaction, txUrl } from "./types";

function endpoint(chain: EvmChain): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("Missing ALCHEMY_API_KEY");
  return `https://${ALCHEMY_EVM_SUBDOMAIN[chain]}.g.alchemy.com/v2/${key}`;
}

interface AlchemyTransfer {
  blockNum: string;
  uniqueId: string;
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract: { value?: string | null; address?: string | null; decimal?: string | null };
  metadata?: { blockTimestamp?: string | null };
}

interface AssetTransfersResult {
  transfers: AlchemyTransfer[];
}

async function rpc<T>(url: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) return null;
    return (json.result as T) ?? null;
  } catch {
    return null;
  }
}

const MAX_PER_DIRECTION = 100;

function normalizeTransfer(
  chain: EvmChain,
  walletAddress: string,
  t: AlchemyTransfer,
): Transaction {
  const fromMatch = t.from.toLowerCase() === walletAddress.toLowerCase();
  const toMatch = t.to?.toLowerCase() === walletAddress.toLowerCase();
  let direction: Transaction["direction"];
  if (fromMatch && toMatch) direction = "self";
  else if (fromMatch) direction = "out";
  else if (toMatch) direction = "in";
  else direction = "other";

  const counterparty = direction === "out" ? t.to : direction === "in" ? t.from : null;
  const blockNumber = (() => {
    try {
      return parseInt(t.blockNum, 16);
    } catch {
      return null;
    }
  })();

  return {
    network: chain,
    hash: t.hash,
    timestamp: t.metadata?.blockTimestamp ?? null,
    blockNumber,
    direction,
    counterparty,
    amount: t.value,
    symbol: t.asset,
    contract: t.rawContract?.address ?? (t.category === "external" || t.category === "internal" ? "native" : null),
    category: t.category,
    feeUsd: null,
    feeAmount: null,
    feeSymbol: null,
    status: "success",
    explorerUrl: txUrl(chain, t.hash),
  };
}

async function fetchSingleEvmChainTxs(
  chain: EvmChain,
  address: string,
): Promise<Transaction[]> {
  const url = endpoint(chain);
  const baseParams = {
    fromBlock: "0x0",
    toBlock: "latest",
    category: ["external", "internal", "erc20"],
    order: "desc",
    withMetadata: true,
    excludeZeroValue: true,
    maxCount: `0x${MAX_PER_DIRECTION.toString(16)}`,
  };

  const [sent, received] = await Promise.all([
    rpc<AssetTransfersResult>(url, {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [{ ...baseParams, fromAddress: address }],
    }),
    rpc<AssetTransfersResult>(url, {
      id: 2,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [{ ...baseParams, toAddress: address }],
    }),
  ]);

  const out: Transaction[] = [];
  for (const t of sent?.transfers ?? []) out.push(normalizeTransfer(chain, address, t));
  for (const t of received?.transfers ?? []) {
    // Skip transfers where wallet appears as both sender and receiver — they
    // were already added via the `sent` query.
    if (t.from.toLowerCase() === address.toLowerCase()) continue;
    out.push(normalizeTransfer(chain, address, t));
  }
  // Deduplicate by uniqueId / hash + log index just in case.
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = `${t.hash}-${t.direction}-${t.contract ?? ""}-${t.amount ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Query every supported EVM chain in parallel; return a flat sorted list. */
export async function fetchEvmTransactions(address: string): Promise<Transaction[]> {
  const results = await Promise.allSettled(
    EVM_CHAINS.map((c) => fetchSingleEvmChainTxs(c, address)),
  );
  const out: Transaction[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  // Sort newest first
  out.sort((a, b) => {
    const at = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bt - at;
  });
  return out;
}
