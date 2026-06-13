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

interface PriceInfo {
  usd: number;
  change24h: number | null;
}

async function resolveSolanaTokenPrices(
  mints: string[],
): Promise<Record<string, PriceInfo>> {
  if (mints.length === 0) return {};
  const merged: Record<string, PriceInfo> = {};
  const alchemy = await getAlchemyTokenPrices("solana", mints);
  for (const k of Object.keys(alchemy))
    merged[k] = { usd: alchemy[k], change24h: null };
  const missing1 = mints.filter((m) => merged[m.toLowerCase()] == null);
  if (missing1.length > 0) {
    const cg = await getTokenPricesWithChange("solana", missing1);
    for (const k of Object.keys(cg)) if (merged[k] == null) merged[k] = cg[k];
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

function endpoint(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("Missing ALCHEMY_API_KEY");
  return `https://solana-mainnet.g.alchemy.com/v2/${key}`;
}

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

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  // Surface failures instead of swallowing them. The Phantom wallet was
  // silently caching zero holdings for weeks because every Alchemy call
  // returned an error (likely "Solana not enabled on this Alchemy app")
  // and rpc() ate it, leaving fetchSolanaHoldings to return [].
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Solana RPC ${method} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
  if (json.error) {
    throw new Error(
      `Solana RPC ${method} error: ${json.error.message ?? JSON.stringify(json.error)}`,
    );
  }
  return (json.result as T) ?? null;
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
  const [tokenPrices, nativePrice] = await Promise.all([
    resolveSolanaTokenPrices(mints),
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
