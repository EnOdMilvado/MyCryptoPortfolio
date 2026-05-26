/**
 * Map symbol → CoinMarketCap URL slug. ONLY contains entries where the
 * slug differs from the simple lowercased symbol — everything else falls
 * back to `coinmarketcap.com/currencies/{lowercased-symbol}/`, which works
 * for the long tail of tokens (RAIN, GLQ, SUI, etc.) since CMC's slug for
 * those IS just the lowercased ticker.
 */
const SYMBOL_TO_CMC_SLUG: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  DOGE: "dogecoin",
  ADA: "cardano",
  TRX: "tron",
  TON: "toncoin",
  MATIC: "polygon",
  POL: "polygon-ecosystem-token",
  DOT: "polkadot",
  AVAX: "avalanche",
  LINK: "chainlink",
  SHIB: "shiba-inu",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ATOM: "cosmos",
  XLM: "stellar",
  XMR: "monero",
  ETC: "ethereum-classic",
  NEAR: "near-protocol",
  ICP: "internet-computer",
  APT: "aptos",
  CRO: "cronos",
  FIL: "filecoin",
  THETA: "theta-network",
  AXS: "axie-infinity",
  SAND: "the-sandbox",
  MANA: "decentraland",
  CAKE: "pancakeswap",
  CRV: "curve-dao-token",
  ENJ: "enjin-coin",
  ENS: "ethereum-name-service",
  LRC: "loopring",
  BAT: "basic-attention-token",
  ONE: "harmony",
  WLD: "worldcoin-org",
  WIF: "dogwifhat",
  FLOKI: "floki-inu",
  PYTH: "pyth-network",
  TIA: "celestia",
  STRK: "starknet-token",
  MANTA: "manta-network",
  ENA: "ethena",
  ETHFI: "ether-fi-ethfi",
  ONDO: "ondo-finance",
  W: "wormhole",
  IO: "io-net",
  NOT: "notcoin",
  WLFI: "world-liberty-financial",
  MANTRA: "mantra-om",
  GLQ: "graphlinq-protocol",
  QRL: "quantum-resistant-ledger",
  KILT: "kilt-protocol",
  RNDR: "render-token",
  EGLD: "multiversx-elrond",
  // Stables
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "multi-collateral-dai",
  BUSD: "binance-usd",
  FDUSD: "first-digital-usd",
  TUSD: "trueusd",
  // Wrapped + LSTs
  WBTC: "wrapped-bitcoin",
  CBBTC: "coinbase-wrapped-btc",
  STETH: "lido-staked-ether",
  WSTETH: "lido-finance-wsteth",
  RETH: "rocket-pool-eth",
  // Side chains / L2 tokens with non-obvious slugs
  ROSE: "oasis-network",
  SC: "siacoin",
  HBAR: "hedera",
  GRT: "the-graph",
  RUNE: "thorchain",
  MKR: "maker",
};

/**
 * Returns a CoinMarketCap URL for a given asset symbol. Uses the curated
 * slug map for tokens whose CMC slug differs from their ticker, and falls
 * back to `currencies/<lowercased-symbol>/` for everything else.
 */
export function cmcUrl(symbol: string | null | undefined): string {
  const s = (symbol ?? "").trim();
  if (!s) return "https://coinmarketcap.com/";
  const upper = s.toUpperCase();
  const slug = SYMBOL_TO_CMC_SLUG[upper] ?? upper.toLowerCase();
  return `https://coinmarketcap.com/currencies/${slug}/`;
}
