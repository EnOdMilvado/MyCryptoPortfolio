import { getAlchemyPricesBySymbol } from "@/lib/chains/alchemy_prices";
import { getAlchemyChange24hBySymbol } from "@/lib/chains/alchemy_historical";
import { getCoinGeckoPricesBySymbol, getNativePrices } from "@/lib/chains/prices";
import { getCmcQuotes, isCmcEnabled, type CmcQuote } from "@/lib/chains/cmc_prices";
import { getDexScreenerPricesBySymbol } from "@/lib/chains/dexscreener_symbol";

const PRICE_CACHE_TTL_MS = 45_000;
const QUOTE_CACHE_TTL_MS = 45_000;

type CachedPrice = { priceUsd: number; at: number; source: string };
type CachedQuote = { priceUsd: number; change24h: number | null; at: number; source: string };

const lastKnownGoodPrice = new Map<string, CachedPrice>();
const lastKnownGoodQuote = new Map<string, CachedQuote>();

function nowMs() {
  return Date.now();
}

function normalizeSym(sym: string) {
  return sym.trim().toUpperCase();
}

function isValidPrice(price: unknown): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0 && price < 1_000_000;
}

function getCachedPrice(sym: string): number | null {
  const cached = lastKnownGoodPrice.get(normalizeSym(sym));
  if (!cached) return null;
  return nowMs() - cached.at <= PRICE_CACHE_TTL_MS ? cached.priceUsd : null;
}

function getCachedQuote(sym: string): CachedQuote | null {
  const cached = lastKnownGoodQuote.get(normalizeSym(sym));
  if (!cached) return null;
  return nowMs() - cached.at <= QUOTE_CACHE_TTL_MS ? cached : null;
}

function rememberPrice(sym: string, priceUsd: number, source: string) {
  lastKnownGoodPrice.set(normalizeSym(sym), { priceUsd, at: nowMs(), source });
}

function rememberQuote(sym: string, priceUsd: number, change24h: number | null, source: string) {
  lastKnownGoodQuote.set(normalizeSym(sym), { priceUsd, change24h, at: nowMs(), source });
  lastKnownGoodPrice.set(normalizeSym(sym), { priceUsd, at: nowMs(), source });
}

async function raceResolvers<T>(tasks: Array<Promise<T | null>>): Promise<T | null> {
  if (tasks.length === 0) return null;
  return await Promise.any(tasks.map((p) => p.then((v) => (v == null ? Promise.reject(new Error("null")) : v)))).catch(() => null);
}

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

  const wanted = Array.from(new Set(symbols.map(normalizeSym)));
  const missing = wanted.filter((s) => getCachedPrice(s) == null);
  for (const sym of wanted) {
    const cached = getCachedPrice(sym);
    if (cached != null) out[sym] = cached;
  }
  if (missing.length === 0) return out;

  const resolvers: Array<Promise<Record<string, number> | null>> = [];
  if (isCmcEnabled()) {
    resolvers.push(
      getCmcQuotes(missing)
        .then((cmc) => {
          const next: Record<string, number> = {};
          for (const sym of Object.keys(cmc)) {
            if (isValidPrice(cmc[sym]?.priceUsd)) next[normalizeSym(sym)] = cmc[sym].priceUsd;
          }
          return next;
        })
        .catch(() => null),
    );
  }
  resolvers.push(
    getAlchemyPricesBySymbol(missing)
      .then((al) => {
        const next: Record<string, number> = {};
        for (const sym of Object.keys(al)) if (isValidPrice(al[sym])) next[normalizeSym(sym)] = al[sym];
        return next;
      })
      .catch(() => null),
  );
  const ids: string[] = [];
  const idToSym: Record<string, string> = {};
  for (const sym of missing) {
    const id = SYMBOL_TO_CG[sym];
    if (id) {
      ids.push(id);
      idToSym[id] = sym;
    }
  }
  if (ids.length > 0) {
    resolvers.push(
      getNativePrices(ids)
        .then((cg) => {
          const next: Record<string, number> = {};
          for (const id of Object.keys(cg)) next[idToSym[id]] = cg[id];
          return next;
        })
        .catch(() => null),
    );
  }
  // DexScreener-by-symbol BEFORE the raw CoinGecko-by-symbol lookup.
  // CoinGecko's /coins/markets?symbols= endpoint disambiguates ticker
  // collisions (WEN, DESO, ETHA, ...) purely by market-cap ranking, which
  // regularly picks the wrong coin for exchange dust (e.g. it once resolved
  // ETHA to the tokenized "iShares Ethereum Trust ETF" instead of an actual
  // on-chain WEN/DESO token, blowing up valueUsd by orders of magnitude).
  // DexScreener instead requires a live, liquid ($5k+) DEX pool with an
  // EXACT symbol match, so for long-tail/collision-prone tickers it is the
  // more trustworthy source. CoinGecko-by-symbol is kept as the last-resort
  // fallback below, only for symbols DexScreener has no pool for.
  resolvers.push(
    getDexScreenerPricesBySymbol(missing)
      .then((ds) => {
        const next: Record<string, number> = {};
        for (const sym of Object.keys(ds)) if (isValidPrice(ds[sym].priceUsd)) next[normalizeSym(sym)] = ds[sym].priceUsd;
        return next;
      })
      .catch(() => null),
  );
  resolvers.push(
    getCoinGeckoPricesBySymbol(missing)
      .then((cg) => {
        const next: Record<string, number> = {};
        for (const sym of Object.keys(cg)) next[normalizeSym(sym)] = cg[sym];
        return next;
      })
      .catch(() => null),
  );

  const results = await Promise.allSettled(resolvers);
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    for (const [sym, price] of Object.entries(r.value)) {
      const upper = normalizeSym(sym);
      if (out[upper] == null && isValidPrice(price)) {
        out[upper] = price;
        rememberPrice(upper, price, "resolver");
      }
    }
  }

  for (const sym of wanted) {
    if (out[sym] == null) {
      const cached = lastKnownGoodPrice.get(sym);
      if (cached) out[sym] = cached.priceUsd;
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

  const wanted = Array.from(new Set(symbols.map(normalizeSym)));
  for (const sym of wanted) {
    const cached = getCachedQuote(sym);
    if (cached) out[sym] = { priceUsd: cached.priceUsd, change24h: cached.change24h };
  }
  const missing = wanted.filter((s) => out[s] == null);
  if (missing.length === 0) return out;

  const tasks: Array<Promise<Record<string, CachedQuote> | null>> = [];
  if (isCmcEnabled()) {
    tasks.push(
      getCmcQuotes(missing)
        .then((cmc) => {
          const next: Record<string, CachedQuote> = {};
          for (const sym of Object.keys(cmc)) {
            const q: CmcQuote = cmc[sym];
            if (isValidPrice(q?.priceUsd)) next[normalizeSym(sym)] = { priceUsd: q.priceUsd, change24h: q.change24h ?? null, at: nowMs(), source: "cmc" };
          }
          return next;
        })
        .catch(() => null),
    );
  }
  tasks.push(
    resolvePricesForSymbols(missing)
      .then((prices) => {
        const next: Record<string, CachedQuote> = {};
        for (const sym of Object.keys(prices)) next[normalizeSym(sym)] = { priceUsd: prices[sym], change24h: null, at: nowMs(), source: "price" };
        return next;
      })
      .catch(() => null),
  );

  const settled = await Promise.allSettled(tasks);
  for (const r of settled) {
    if (r.status !== "fulfilled" || !r.value) continue;
    for (const [sym, q] of Object.entries(r.value)) {
      if (out[sym] == null && isValidPrice(q.priceUsd)) {
        out[sym] = { priceUsd: q.priceUsd, change24h: q.change24h };
        rememberQuote(sym, q.priceUsd, q.change24h, q.source);
      }
    }
  }

  const needChange = Object.keys(out).filter((sym) => out[sym].change24h == null);
  if (needChange.length > 0) {
    try {
      const ds = await getDexScreenerPricesBySymbol(needChange);
      for (const sym of Object.keys(ds)) {
        if (out[sym] && out[sym].change24h == null && ds[sym].change24h != null) {
          out[sym] = { ...out[sym], change24h: ds[sym].change24h };
          rememberQuote(sym, out[sym].priceUsd, ds[sym].change24h, "dexscreener");
        }
      }
    } catch {}
  }

  const stillMissing = Object.keys(out).filter((sym) => out[sym].change24h == null);
  if (stillMissing.length > 0) {
    try {
      const currentPrices: Record<string, number> = {};
      for (const sym of stillMissing) currentPrices[sym] = out[sym].priceUsd;
      const al = await getAlchemyChange24hBySymbol(currentPrices);
      for (const sym of Object.keys(al)) {
        if (out[sym] && out[sym].change24h == null) {
          out[sym] = { ...out[sym], change24h: al[sym] };
          rememberQuote(sym, out[sym].priceUsd, al[sym], "alchemy-historical");
        }
      }
    } catch {}
  }

  return out;
}
