import { getAlchemyPricesBySymbol } from "@/lib/chains/alchemy_prices";
import { getCoinGeckoPricesBySymbol, getNativePrices } from "@/lib/chains/prices";

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

export async function resolvePricesForSymbols(
  symbols: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (symbols.length === 0) return out;

  const al = await getAlchemyPricesBySymbol(symbols);
  for (const s of symbols) {
    const upper = s.toUpperCase();
    if (al[upper] != null) out[upper] = al[upper];
  }

  let missing = symbols.filter((s) => out[s.toUpperCase()] == null);

  // 2) CoinGecko hand-curated SYMBOL_TO_CG mapping — uses known coin IDs so
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

  // 3) CoinGecko symbol fallback — catches the long tail (SUI, MANTRA, ENJ,
  //    QRL, GLQ, …). Picks the highest market-cap match per ticker.
  if (missing.length > 0) {
    const cg = await getCoinGeckoPricesBySymbol(missing);
    for (const sym of Object.keys(cg)) {
      out[sym] = cg[sym];
    }
  }

  return out;
}
