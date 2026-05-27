import { getAlchemyPricesBySymbol } from "@/lib/chains/alchemy_prices";
import { getCoinGeckoPricesBySymbol, getNativePrices } from "@/lib/chains/prices";
import { getCmcQuotes, isCmcEnabled, type CmcQuote } from "@/lib/chains/cmc_prices";

// Common exchange asset symbols → CoinGecko ID for native-coin fallback.
const SYMBOL_TO_CG: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  MATIC: "matic-network",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
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

  return out;
}
