import type { ChainId } from "../types";

export type TxDirection = "in" | "out" | "self" | "other";

/** Normalized transaction shape returned to the client. */
export interface Transaction {
  network: ChainId;
  hash: string;
  timestamp: string | null;     // ISO 8601, may be null if unknown
  blockNumber: number | null;
  direction: TxDirection;
  counterparty: string | null;  // the other side, when meaningful
  amount: number | null;        // signed/unsigned: see `direction`
  symbol: string | null;
  contract: string | null;      // null/"native" for native coin
  category: string | null;      // e.g. 'external' | 'erc20' | 'internal' | 'transfer'
  feeUsd: number | null;
  feeAmount: number | null;     // native units
  feeSymbol: string | null;
  status: "success" | "failed" | "pending" | "unknown";
  explorerUrl: string;
}

/**
 * Explorer base URLs per chain. The transaction page is `${base}/tx/{hash}`.
 */
export const EXPLORER_TX: Record<ChainId, string> = {
  bitcoin: "https://blockstream.info",
  solana: "https://solscan.io",
  exchange: "",
  ethereum: "https://etherscan.io",
  polygon: "https://polygonscan.com",
  arbitrum: "https://arbiscan.io",
  optimism: "https://optimistic.etherscan.io",
  base: "https://basescan.org",
  avalanche: "https://snowtrace.io",
  bnb: "https://bscscan.com",
  linea: "https://lineascan.build",
  blast: "https://blastscan.io",
  mantle: "https://mantlescan.xyz",
  berachain: "https://berascan.com",
  sonic: "https://sonicscan.org",
  unichain: "https://uniscan.xyz",
  world: "https://worldscan.org",
  ape: "https://apescan.io",
  zksync: "https://explorer.zksync.io",
  scroll: "https://scrollscan.com",
  gnosis: "https://gnosisscan.io",
  celo: "https://celoscan.io",
  abstract: "https://abscan.org",
  ink: "https://explorer.inkonchain.com",
  zora: "https://explorer.zora.energy",
  shape: "https://shapescan.xyz",
  fraxtal: "https://fraxscan.com",
  soneium: "https://soneium.blockscout.com",
  polygon_zkevm: "https://zkevm.polygonscan.com",
  arbnova: "https://nova.arbiscan.io",
};

export function txUrl(network: ChainId, hash: string): string {
  const base = EXPLORER_TX[network];
  if (network === "solana") return `${base}/tx/${hash}`;
  return `${base}/tx/${hash}`;
}
