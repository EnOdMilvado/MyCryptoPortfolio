import {
  COINGECKO_NATIVE_ID,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type Holding,
} from "./types";
import { getNativePricesWithChange, getTokenPricesWithChange } from "./prices";
import {
  getAlchemyPricesBySymbol,
  getAlchemyTokenPrices,
} from "./alchemy_prices";
import { getDexScreenerPricesWithChange } from "./dexscreener";
import { getCmcQuotes, isCmcEnabled } from "./cmc_prices";

interface PriceInfo {
  usd: number;
  change24h: number | null;
}

// symbolByMint is optional metadata (from the Jupiter token list). CMC is
// queried by SYMBOL, which is fundamentally ambiguous — unrelated tokens
// can and do share a ticker (confirmed real case: EVM's TRU resolved to
// "Truebit" instead of the held "TrueFi" via CMC-by-symbol; same failure
// mode applies here). So contract/mint-address lookups (Alchemy, CoinGecko,
// DexScreener-by-mint) go FIRST since a mint address is unambiguous by
// construction, and CMC-by-symbol is only a fallback for mints none of
// those recognize.
async function resolveSolanaTokenPrices(
  mints: string[],
  symbolByMint?: Record<string, string>,
): Promise<Record<string, PriceInfo>> {
  if (mints.length === 0) return {};
  const merged: Record<string, PriceInfo> = {};
  const alchemy = await getAlchemyTokenPrices("solana", mints);
  for (const k of Object.keys(alchemy))
    if (merged[k] == null) merged[k] = { usd: alchemy[k], change24h: null };
  const missing1 = mints.filter((m) => merged[m.toLowerCase()] == null);
  if (missing1.length > 0) {
    const cg = await getTokenPricesWithChange("solana", missing1);
    for (const k of Object.keys(cg)) if (merged[k] == null) merged[k] = cg[k];
  }
  const missingBeforeCmc = mints.filter((m) => merged[m.toLowerCase()] == null);
  if (symbolByMint && isCmcEnabled() && missingBeforeCmc.length > 0) {
    const symToMints: Record<string, string[]> = {};
    for (const m of missingBeforeCmc) {
      const sym = symbolByMint[m.toLowerCase()];
      if (sym) (symToMints[sym.toUpperCase()] ??= []).push(m.toLowerCase());
    }
    const symbols = Object.keys(symToMints);
    if (symbols.length > 0) {
      const cmc = await getCmcQuotes(symbols);
      for (const sym of Object.keys(cmc)) {
        const q = cmc[sym];
        for (const m of symToMints[sym] ?? []) {
          if (merged[m] == null) merged[m] = { usd: q.priceUsd, change24h: q.change24h };
        }
      }
    }
  }
  const missing2 = mints.filter((m) => merged[m.toLowerCase()] == null);
  if (missing2.length > 0) {
    const ds = await getDexScreenerPricesWithChange("solana", missing2);
    for (const k of Object.keys(ds)) if (merged[k] == null) merged[k] = ds[k];
  }
  // Backfill change for Alchemy-only entries.
  const needsChange = mints.filter(
    (m) => merged[m.toLowerCase()] && merged[m.toLowerCase()].change24h == null,
  );
  if (needsChange.length > 0) {
    const cg = await getTokenPricesWithChange("solana", needsChange);
    for (const k of Object.keys(cg)) {
      if (merged[k] && merged[k].change24h == null && cg[k].change24h != null) {
        merged[k] = { ...merged[k], change24h: cg[k].change24h };
      }
    }
  }
  return merged;
}

async function resolveSolanaNativePrice(): Promise<PriceInfo | null> {
  const alchemy = await getAlchemyPricesBySymbol([NATIVE_SYMBOL.solana]);
  const cg = await getNativePricesWithChange([COINGECKO_NATIVE_ID.solana]);
  const cgEntry = cg[COINGECKO_NATIVE_ID.solana];
  const usd =
    alchemy[NATIVE_SYMBOL.solana.toUpperCase()] ?? cgEntry?.usd ?? null;
  if (usd == null) return null;
  return { usd, change24h: cgEntry?.change24h ?? null };
}

function alchemyEndpoint(): string | null {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  return `https://solana-mainnet.g.alchemy.com/v2/${key}`;
}

// Public Solana RPC endpoints. Used as fallback when Alchemy fails (e.g.
// when the Alchemy app doesn't have Solana enabled, or it 429s under the
// free-tier compute-unit budget). Race them so the slowest doesn't gate
// the page.
const PUBLIC_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
] as const;

interface SolBalanceResult {
  value: number;
}
interface SolTokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number | null;
          };
        };
      };
    };
  };
}
interface SolTokenAccountsResult {
  value: SolTokenAccount[];
}

interface JupToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

// Lightweight in-memory cache for the Jupiter token list (shared across
// requests in the same server lambda). Refreshed every hour.
let jupCache: { fetchedAt: number; map: Map<string, JupToken> } | null = null;
const JUP_TTL_MS = 60 * 60 * 1000;

async function getJupiterTokens(): Promise<Map<string, JupToken>> {
  if (jupCache && Date.now() - jupCache.fetchedAt < JUP_TTL_MS) {
    return jupCache.map;
  }
  try {
    const res = await fetch("https://tokens.jup.ag/tokens?tags=verified", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return new Map();
    const arr = (await res.json()) as JupToken[];
    const map = new Map<string, JupToken>();
    for (const t of arr) map.set(t.address, t);
    jupCache = { fetchedAt: Date.now(), map };
    return map;
  } catch {
    return new Map();
  }
}

async function rpcOne<T>(url: string, method: string, params: unknown[]): Promise<T | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
  return (json.result as T) ?? null;
}

/**
 * Try Alchemy first (when configured); on any failure fall back through
 * the public RPC pool. The Phantom wallet was silently caching zero
 * holdings for weeks because the previous rpc() swallowed every error
 * and let fetchSolanaHoldings return [] — preserve the last error and
 * only throw it after every endpoint has been tried.
 */
async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  const endpoints: string[] = [];
  const alch = alchemyEndpoint();
  if (alch) endpoints.push(alch);
  endpoints.push(...PUBLIC_RPCS);

  let lastErr: string | null = null;
  for (const url of endpoints) {
    try {
      return await rpcOne<T>(url, method, params);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Solana RPC ${method} failed across ${endpoints.length} endpoints: ${lastErr}`);
}

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export async function fetchSolanaHoldings(address: string): Promise<Holding[]> {
  // Run both calls in parallel.
  const [balanceRes, tokensRes, jup] = await Promise.all([
    rpc<SolBalanceResult>("getBalance", [address]),
    rpc<SolTokenAccountsResult>("getTokenAccountsByOwner", [
      address,
      { programId: SPL_TOKEN_PROGRAM },
      { encoding: "jsonParsed" },
    ]),
    getJupiterTokens(),
  ]);

  const lamports = balanceRes?.value ?? 0;
  const nativeAmount = lamports / 10 ** NATIVE_DECIMALS.solana;

  const tokenAccounts = (tokensRes?.value ?? []).filter(
    (a) => (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0) > 0,
  );

  const mints = tokenAccounts.map((a) => a.account.data.parsed.info.mint);
  const symbolByMint: Record<string, string> = {};
  for (const m of mints) {
    const sym = jup.get(m)?.symbol;
    if (sym) symbolByMint[m.toLowerCase()] = sym;
  }
  const [tokenPrices, nativePrice] = await Promise.all([
    resolveSolanaTokenPrices(mints, symbolByMint),
    resolveSolanaNativePrice(),
  ]);
  const nativeUsd = nativePrice?.usd ?? null;
  const nativeChange = nativePrice?.change24h ?? null;

  const out: Holding[] = [];
  if (nativeAmount > 0) {
    out.push({
      chain: "solana",
      contract: "native",
      symbol: NATIVE_SYMBOL.solana,
      name: "Solana",
      amount: nativeAmount,
      decimals: NATIVE_DECIMALS.solana,
      priceUsd: nativeUsd,
      valueUsd: nativeUsd ? nativeAmount * nativeUsd : 0,
      priceChange24h: nativeChange,
    });
  }

  for (const acc of tokenAccounts) {
    const info = acc.account.data.parsed.info;
    const mint = info.mint;
    const amount = info.tokenAmount.uiAmount ?? 0;
    if (amount <= 0) continue;
    const meta = jup.get(mint);
    const info2 = tokenPrices[mint.toLowerCase()] ?? null;
    const price = info2?.usd ?? null;

    // Mints are base58, not hex — show a 4-char prefix/suffix when unknown.
    const fallbackSymbol = `${mint.slice(0, 4)}…${mint.slice(-4)}`;

    out.push({
      chain: "solana",
      contract: mint,
      symbol: meta?.symbol ?? fallbackSymbol,
      name: meta?.name ?? null,
      amount,
      decimals: info.tokenAmount.decimals,
      priceUsd: price,
      valueUsd: price ? amount * price : 0,
      priceChange24h: info2?.change24h ?? null,
    });
  }

  return out;
}
