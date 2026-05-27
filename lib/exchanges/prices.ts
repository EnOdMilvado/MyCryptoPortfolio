import { getAlchemyPricesBySymbol } from "@/lib/chains/alchemy_prices";
import { getCoinGeckoPricesBySymbol, getNativePrices } from "@/lib/chains/prices";
import { getCmcQuotes, isCmcEnabled, type CmcQuote } from "@/lib/chains/cmc_prices";
import { getDexScreenerPricesBySymbol } from "@/lib/chains/dexscreener_symbol";

// Common exchange asset symbols → CoinGecko ID for native-coin fallback.
// Hand-curated to disambiguate (ETH could be many tokens — we pin "ethereum").
const SYMBOL_TO_CG: Record<string, string> = {
  // Top-cap natives + stables
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  TUSD: "true-usd",
  FDUSD: "first-digital-usd",
  PYUSD: "paypal-usd",
  ADA: "cardano",
  XRP: "ripple",
  DOT: "polkadot",
  LINK: "chainlink",
  UNI: "uniswap",
  ARB: "arbitrum",
  OP: "optimism",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  TRX: "tron",
  TON: "the-open-network",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  DOGE: "dogecoin",
  LTC: "litecoin",
  // DeFi blue-chips
  AAVE: "aave",
  COMP: "compound-governance-token",
  CRV: "curve-dao-token",
  SUSHI: "sushi",
  MKR: "maker",
  SNX: "havven",
  YFI: "yearn-finance",
  LDO: "lido-dao",
  PENDLE: "pendle",
  GMX: "gmx",
  FXS: "frax-share",
  // L1s/L2s
  RUNE: "thorchain",
  FTM: "fantom",
  S: "sonic-3",
  FIL: "filecoin",
  HBAR: "hedera-hashgraph",
  IMX: "immutable-x",
  INJ: "injective-protocol",
  KAVA: "kava",
  SEI: "sei-network",
  STX: "blockstack",
  SUI: "sui",
  TIA: "celestia",
  ICP: "internet-computer",
  ETC: "ethereum-classic",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  ALGO: "algorand",
  EOS: "eos",
  XTZ: "tezos",
  KAS: "kaspa",
  MINA: "mina-protocol",
  FLOW: "flow",
  EGLD: "elrond-erd-2",
  THETA: "theta-token",
  VET: "vechain",
  // Trendy / memes
  WIF: "dogwifcoin",
  WLD: "worldcoin-wld",
  BONK: "bonk",
  FLOKI: "floki",
  BOME: "book-of-meme",
  POPCAT: "popcat",
  MEW: "cat-in-a-dogs-world",
  // RWA / AI / depin
  ONDO: "ondo-finance",
  PYTH: "pyth-network",
  JTO: "jito-governance-token",
  RNDR: "render-token",
  RENDER: "render-token",
  TAO: "bittensor",
  FET: "fetch-ai",
  AGIX: "singularitynet",
  OCEAN: "ocean-protocol",
  // Gaming / metaverse
  MANA: "decentraland",
  SAND: "the-sandbox",
  AXS: "axie-infinity",
  GALA: "gala",
  ENJ: "enjincoin",
  ILV: "illuvium",
  // Wrappers
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  WBNB: "wbnb",
  WSOL: "wrapped-solana",
  STETH: "staked-ether",
  WSTETH: "wrapped-steth",
};

/**
 * Resolve USD price (only) for symbols. Layered resolvers:
 * 1) CoinMarketCap (primary, when CMC_API_KEY is set)
 * 2) Alchemy by-symbol
 * 3) Hand-curated CoinGecko slug map
 * 4) CoinGecko symbol search
 */
export async function resolvePricesForSymbols(
  symbols: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (symbols.length === 0) return out;

  // 1) CoinMarketCap (preferred when configured)
  if (isCmcEnabled()) {
    try {
      const cmc = await getCmcQuotes(symbols);
      for (const sym of Object.keys(cmc)) out[sym] = cmc[sym].priceUsd;
    } catch {
      // non-fatal; fall through to other resolvers
    }
  }

  let missing = symbols.filter((s) => out[s.toUpperCase()] == null);

  if (missing.length > 0) {
    const al = await getAlchemyPricesBySymbol(missing);
    for (const s of missing) {
      const upper = s.toUpperCase();
      if (al[upper] != null) out[upper] = al[upper];
    }
    missing = symbols.filter((s) => out[s.toUpperCase()] == null);
  }

  // 3) CoinGecko hand-curated SYMBOL_TO_CG mapping — uses known coin IDs so
  //    ambiguous tickers (e.g. ETH) always resolve to the right project.
  if (missing.length > 0) {
    const ids: string[] = [];
    const idToSym: Record<string, string> = {};
    for (const sym of missing) {
      const id = SYMBOL_TO_CG[sym.toUpperCase()];
      if (id) {
        ids.push(id);
        idToSym[id] = sym.toUpperCase();
      }
    }
    if (ids.length > 0) {
      const cg = await getNativePrices(ids);
      for (const id of Object.keys(cg)) {
        out[idToSym[id]] = cg[id];
      }
    }
    missing = symbols.filter((s) => out[s.toUpperCase()] == null);
  }

  // 4) CoinGecko symbol fallback — catches the long tail (SUI, MANTRA, ENJ,
  //    QRL, GLQ, …). Picks the highest market-cap match per ticker.
  if (missing.length > 0) {
    const cg = await getCoinGeckoPricesBySymbol(missing);
    for (const sym of Object.keys(cg)) {
      out[sym] = cg[sym];
    }
    missing = symbols.filter((s) => out[s.toUpperCase()] == null);
  }

  // 5) DexScreener search-by-symbol — last-resort DEX pool lookup for
  //    anything still missing (covers obscure MEXC / HTX tokens that
  //    Alchemy's top-1K and CoinGecko's curated symbol search miss).
  if (missing.length > 0) {
    const ds = await getDexScreenerPricesBySymbol(missing);
    for (const sym of Object.keys(ds)) {
      out[sym] = ds[sym].priceUsd;
    }
  }

  return out;
}

/**
 * Like resolvePricesForSymbols but also returns 24h % change. Currently
 * sourced from CMC (when enabled). Symbols missing from CMC return
 * change24h=null even if their price was resolved elsewhere.
 *
 * Use this when you need fresh 24h percentages — e.g. spot balances on
 * exchange refreshes — so the new figures populate the dashboard
 * "By network" badges and the per-asset 24h column.
 */
export async function resolvePriceQuotesForSymbols(
  symbols: string[],
): Promise<Record<string, { priceUsd: number; change24h: number | null }>> {
  const out: Record<string, { priceUsd: number; change24h: number | null }> = {};
  if (symbols.length === 0) return out;

  // CMC gives both price + 24h in one call.
  if (isCmcEnabled()) {
    try {
      const cmc = await getCmcQuotes(symbols);
      for (const sym of Object.keys(cmc)) {
        const q: CmcQuote = cmc[sym];
        out[sym] = { priceUsd: q.priceUsd, change24h: q.change24h };
      }
    } catch {
      // non-fatal
    }
  }

  // Fall back to price-only resolver for whatever's still missing.
  const missing = symbols.filter((s) => out[s.toUpperCase()] == null);
  if (missing.length > 0) {
    const prices = await resolvePricesForSymbols(missing);
    for (const sym of Object.keys(prices)) {
      out[sym] = { priceUsd: prices[sym], change24h: null };
    }
  }

  // Backfill 24h change from DexScreener for everything where we have a
  // price but no change (CMC missed it, or the price came from a
  // change-less source like Alchemy / CoinGecko-by-id). DexScreener
  // search returns h24 % change alongside price.
  const needChange = Object.keys(out).filter(
    (sym) => out[sym].change24h == null,
  );
  if (needChange.length > 0) {
    try {
      const ds = await getDexScreenerPricesBySymbol(needChange);
      for (const sym of Object.keys(ds)) {
        if (out[sym] && out[sym].change24h == null) {
          out[sym] = { ...out[sym], change24h: ds[sym].change24h };
        }
      }
    } catch {
      // non-fatal — keep nulls
    }
  }

  return out;
}
