export type ChainType = "btc" | "evm" | "sol";

export type EvmChain =
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "base"
  | "avalanche"
  | "bnb"
  | "linea"
  | "blast"
  | "mantle"
  | "berachain"
  | "sonic"
  | "unichain"
  | "world"
  | "ape"
  | "zksync"
  | "scroll"
  | "gnosis"
  | "celo"
  | "abstract"
  | "ink"
  | "zora"
  | "shape"
  | "fraxtal"
  | "soneium"
  | "polygon_zkevm"
  | "arbnova";

export type ChainId = "bitcoin" | "solana" | EvmChain;

export interface RawTokenBalance {
  chain: ChainId;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number;
  decimals: number | null;
}

export interface Holding extends RawTokenBalance {
  priceUsd: number | null;
  valueUsd: number;
  /** 24-hour price change as a percentage (e.g. -3.5 means -3.5%). */
  priceChange24h?: number | null;
}

export interface WalletHoldings {
  walletId: string;
  address: string;
  chainType: ChainType;
  holdings: Holding[];
  totalUsd: number;
  error?: string;
}

export const EVM_CHAINS: EvmChain[] = [
  "ethereum",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
  "avalanche",
  "bnb",
  "linea",
  "blast",
  "mantle",
  "berachain",
  "sonic",
  "unichain",
  "world",
  "ape",
  "zksync",
  "scroll",
  "gnosis",
  "celo",
  "abstract",
  "ink",
  "zora",
  "shape",
  "fraxtal",
  "soneium",
  "polygon_zkevm",
  "arbnova",
];

/**
 * Alchemy RPC subdomain prefix for each EVM chain.
 * Final URL: https://{prefix}.g.alchemy.com/v2/{API_KEY}
 */
export const ALCHEMY_EVM_SUBDOMAIN: Record<EvmChain, string> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base: "base-mainnet",
  avalanche: "avax-mainnet",
  bnb: "bnb-mainnet",
  linea: "linea-mainnet",
  blast: "blast-mainnet",
  mantle: "mantle-mainnet",
  berachain: "berachain-mainnet",
  sonic: "sonic-mainnet",
  unichain: "unichain-mainnet",
  world: "worldchain-mainnet",
  ape: "apechain-mainnet",
  zksync: "zksync-mainnet",
  scroll: "scroll-mainnet",
  gnosis: "gnosis-mainnet",
  celo: "celo-mainnet",
  abstract: "abstract-mainnet",
  ink: "ink-mainnet",
  zora: "zora-mainnet",
  shape: "shape-mainnet",
  fraxtal: "frax-mainnet",
  soneium: "soneium-mainnet",
  polygon_zkevm: "polygonzkevm-mainnet",
  arbnova: "arbnova-mainnet",
};

/**
 * Canonical brand colors per network. Sourced from each chain's official
 * brand guidelines (or the most-recognizable color in their gradient) so
 * the same network always shows the same color across the entire app:
 *
 *   - Pie / bar slices in the network breakdown
 *   - Network pills on every holdings / transactions / NFT row
 *
 * Colors are tuned to stay readable on both light and dark themes when
 * rendered as accent text on a tinted background.
 */
export const CHAIN_COLORS: Record<ChainId, string> = {
  bitcoin: "#F7931A",
  solana: "#14F195",
  ethereum: "#627EEA",
  polygon: "#8247E5",
  arbitrum: "#28A0F0",
  optimism: "#FF0420",
  base: "#0052FF",
  avalanche: "#E84142",
  bnb: "#F3BA2F",
  linea: "#61DFFF",
  blast: "#FCFC03",
  mantle: "#008B6E",
  berachain: "#C8964A",
  sonic: "#FF7A00",
  unichain: "#FF007A",
  world: "#4940E0",
  ape: "#0040FF",
  zksync: "#1E69FF",
  scroll: "#FFA756",
  gnosis: "#3E6957",
  celo: "#35D07F",
  abstract: "#00D26A",
  ink: "#5179E2",
  zora: "#A18BD0",
  shape: "#00FF85",
  fraxtal: "#4DC4FF",
  soneium: "#2F5BFF",
  polygon_zkevm: "#9061F0",
  arbnova: "#EF8220",
};

/** Display names */
export const CHAIN_LABEL: Record<ChainId, string> = {
  bitcoin: "Bitcoin",
  solana: "Solana",
  ethereum: "Ethereum",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  base: "Base",
  avalanche: "Avalanche",
  bnb: "BNB Chain",
  linea: "Linea",
  blast: "Blast",
  mantle: "Mantle",
  berachain: "Berachain",
  sonic: "Sonic",
  unichain: "Unichain",
  world: "World Chain",
  ape: "ApeChain",
  zksync: "zkSync",
  scroll: "Scroll",
  gnosis: "Gnosis",
  celo: "Celo",
  abstract: "Abstract",
  ink: "Ink",
  zora: "Zora",
  shape: "Shape",
  fraxtal: "Fraxtal",
  soneium: "Soneium",
  polygon_zkevm: "Polygon zkEVM",
  arbnova: "Arbitrum Nova",
};

/** CoinGecko platform IDs for token-price lookups (per chain). */
export const COINGECKO_PLATFORM: Record<EvmChain | "solana", string> = {
  ethereum: "ethereum",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  base: "base",
  avalanche: "avalanche",
  bnb: "binance-smart-chain",
  linea: "linea",
  blast: "blast",
  mantle: "mantle",
  berachain: "berachain",
  sonic: "sonic",
  unichain: "unichain",
  world: "world-chain",
  ape: "apechain",
  zksync: "zksync",
  scroll: "scroll",
  gnosis: "xdai",
  celo: "celo",
  abstract: "abstract",
  ink: "ink",
  zora: "zora",
  shape: "shape",
  fraxtal: "fraxtal",
  soneium: "soneium",
  polygon_zkevm: "polygon-zkevm",
  arbnova: "arbitrum-nova",
  solana: "solana",
};

/** CoinGecko ids for the native coin of each chain. */
export const COINGECKO_NATIVE_ID: Record<ChainId, string> = {
  bitcoin: "bitcoin",
  solana: "solana",
  ethereum: "ethereum",
  polygon: "matic-network",
  arbitrum: "ethereum",
  optimism: "ethereum",
  base: "ethereum",
  avalanche: "avalanche-2",
  bnb: "binancecoin",
  linea: "ethereum",
  blast: "ethereum",
  mantle: "mantle",
  berachain: "berachain-bera",
  sonic: "sonic-3",
  unichain: "ethereum",
  world: "ethereum",
  ape: "apecoin",
  zksync: "ethereum",
  scroll: "ethereum",
  gnosis: "xdai",
  celo: "celo",
  abstract: "ethereum",
  ink: "ethereum",
  zora: "ethereum",
  shape: "ethereum",
  fraxtal: "frax-ether",
  soneium: "ethereum",
  polygon_zkevm: "ethereum",
  arbnova: "ethereum",
};

/** Symbol of the native coin per chain. */
export const NATIVE_SYMBOL: Record<ChainId, string> = {
  bitcoin: "BTC",
  solana: "SOL",
  ethereum: "ETH",
  polygon: "MATIC",
  arbitrum: "ETH",
  optimism: "ETH",
  base: "ETH",
  avalanche: "AVAX",
  bnb: "BNB",
  linea: "ETH",
  blast: "ETH",
  mantle: "MNT",
  berachain: "BERA",
  sonic: "S",
  unichain: "ETH",
  world: "ETH",
  ape: "APE",
  zksync: "ETH",
  scroll: "ETH",
  gnosis: "xDAI",
  celo: "CELO",
  abstract: "ETH",
  ink: "ETH",
  zora: "ETH",
  shape: "ETH",
  fraxtal: "frxETH",
  soneium: "ETH",
  polygon_zkevm: "ETH",
  arbnova: "ETH",
};

export const NATIVE_DECIMALS: Record<ChainId, number> = {
  bitcoin: 8,
  solana: 9,
  ethereum: 18,
  polygon: 18,
  arbitrum: 18,
  optimism: 18,
  base: 18,
  avalanche: 18,
  bnb: 18,
  linea: 18,
  blast: 18,
  mantle: 18,
  berachain: 18,
  sonic: 18,
  unichain: 18,
  world: 18,
  ape: 18,
  zksync: 18,
  scroll: 18,
  gnosis: 18,
  celo: 18,
  abstract: 18,
  ink: 18,
  zora: 18,
  shape: 18,
  fraxtal: 18,
  soneium: 18,
  polygon_zkevm: 18,
  arbnova: 18,
};
