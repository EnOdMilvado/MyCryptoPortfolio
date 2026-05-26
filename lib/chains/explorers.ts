import type { ChainId } from "./types";

interface ChainExplorer {
  /** Base browse URL for the block explorer (no token path). */
  base: string;
  /** Path segment used for ERC-20/SPL-token info. Leave empty for chains
   *  without a per-token page (e.g. native BTC). */
  tokenPath?: string;
  /** Suffix that opens the holders list/chart on the same explorer.
   *  Etherscan-family uses "#balances"; some forks use "/holders" instead. */
  holdersSuffix?: string;
}

const EXPLORERS: Partial<Record<ChainId, ChainExplorer>> = {
  ethereum: { base: "https://etherscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  polygon: { base: "https://polygonscan.com", tokenPath: "token", holdersSuffix: "#balances" },
  arbitrum: { base: "https://arbiscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  optimism: { base: "https://optimistic.etherscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  base: { base: "https://basescan.org", tokenPath: "token", holdersSuffix: "#balances" },
  avalanche: { base: "https://snowtrace.io", tokenPath: "token", holdersSuffix: "#balances" },
  bnb: { base: "https://bscscan.com", tokenPath: "token", holdersSuffix: "#balances" },
  linea: { base: "https://lineascan.build", tokenPath: "token", holdersSuffix: "#balances" },
  blast: { base: "https://blastscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  mantle: { base: "https://explorer.mantle.xyz", tokenPath: "token", holdersSuffix: "/token-holders" },
  berachain: { base: "https://berascan.com", tokenPath: "token", holdersSuffix: "#balances" },
  sonic: { base: "https://sonicscan.org", tokenPath: "token", holdersSuffix: "#balances" },
  unichain: { base: "https://uniscan.xyz", tokenPath: "token", holdersSuffix: "#balances" },
  world: { base: "https://worldscan.org", tokenPath: "token", holdersSuffix: "#balances" },
  ape: { base: "https://apescan.io", tokenPath: "token", holdersSuffix: "#balances" },
  zksync: { base: "https://era.zksync.network", tokenPath: "token", holdersSuffix: "#balances" },
  scroll: { base: "https://scrollscan.com", tokenPath: "token", holdersSuffix: "#balances" },
  gnosis: { base: "https://gnosisscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  celo: { base: "https://celoscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  abstract: { base: "https://abscan.org", tokenPath: "token", holdersSuffix: "#balances" },
  ink: { base: "https://explorer.inkonchain.com", tokenPath: "token", holdersSuffix: "/token-holders" },
  zora: { base: "https://explorer.zora.energy", tokenPath: "token", holdersSuffix: "/token-holders" },
  shape: { base: "https://shapescan.xyz", tokenPath: "token", holdersSuffix: "#balances" },
  fraxtal: { base: "https://fraxscan.com", tokenPath: "token", holdersSuffix: "#balances" },
  soneium: { base: "https://soneium.blockscout.com", tokenPath: "token", holdersSuffix: "/token-holders" },
  polygon_zkevm: { base: "https://zkevm.polygonscan.com", tokenPath: "token", holdersSuffix: "#balances" },
  arbnova: { base: "https://nova.arbiscan.io", tokenPath: "token", holdersSuffix: "#balances" },
  solana: { base: "https://solscan.io", tokenPath: "token", holdersSuffix: "#holders" },
  bitcoin: { base: "https://mempool.space", tokenPath: undefined, holdersSuffix: undefined },
};

/**
 * URL to the per-token page for a given chain + contract. Returns null for
 * native-only chains (e.g. bitcoin native, exchange-sourced rows).
 */
export function tokenExplorerUrl(chain: ChainId, contract: string): string | null {
  const e = EXPLORERS[chain];
  if (!e || !e.tokenPath || !contract) return null;
  return `${e.base}/${e.tokenPath}/${contract}`;
}

/**
 * URL to the holders list/chart for a given token. Same chains as
 * tokenExplorerUrl; returns null when the explorer has no holders page.
 */
export function holdersExplorerUrl(chain: ChainId, contract: string): string | null {
  const e = EXPLORERS[chain];
  if (!e || !e.tokenPath || !contract) return null;
  if (!e.holdersSuffix) return null;
  return `${e.base}/${e.tokenPath}/${contract}${e.holdersSuffix}`;
}
