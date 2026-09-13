import {
  ALCHEMY_EVM_SUBDOMAIN,
  COINGECKO_NATIVE_ID,
  EVM_CHAINS,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type EvmChain,
  type Holding,
} from "./types";
import {
  getNativePrices,
  getNativePricesWithChange,
  getTokenPricesWithChange,
} from "./prices";

/**
 * Hand-curated map of lowercased contract address → CoinGecko coin id,
 * for tokens with a CONFIRMED symbol collision on CoinMarketCap (i.e. a
 * different, unrelated project shares the same ticker on CMC). Add an
 * entry here whenever a new collision is found in production — this is
 * a targeted patch, not meant to replace the general resolver chain.
 */
const KNOWN_COLLISION_CONTRACT_TO_CG_ID: Record<string, string> = {
  // TRU: TrueFi (real, held by users) vs. "Truebit" (unrelated project),
  // both ticker TRU on CMC.
  "0x4c19596f5aaff459fa38b0f7ed92f11ae6543784": "truefi",
};
import {
  getAlchemyPricesBySymbol,
  getAlchemyTokenPrices,
} from "./alchemy_prices";
import { getDexScreenerPricesWithChange } from "./dexscreener";
import { getCmcQuotes, isCmcEnabled } from "./cmc_prices";
import {
  buildMetadataCalls,
  decodeAbiString,
  decodeAbiUint8,
} from "./erc20_eth_call";

/**
 * Sentinel error class — lets the route distinguish "config broken, no point
 * retrying" from a transient Alchemy/network failure. Used to drive the
 * top-level configError signal sent back to the UI.
 */
export class AlchemyKeyMissingError extends Error {
  constructor() {
    super("ALCHEMY_API_KEY missing or empty");
    this.name = "AlchemyKeyMissingError";
  }
}

function endpoint(chain: EvmChain): string {
  const key = process.env.ALCHEMY_API_KEY;
  // Treat empty string the same as missing. A `""` value (which we have
  // actually seen in production after a botched `vercel env add`) is falsy
  // but had been logged ambiguously as just "Missing ALCHEMY_API_KEY" —
  // making the cause hard to spot in Vercel logs.
  if (!key || key.trim() === "") {
    throw new AlchemyKeyMissingError();
  }
  return `https://${ALCHEMY_EVM_SUBDOMAIN[chain]}.g.alchemy.com/v2/${key}`;
}

interface RpcResp<T> {
  result?: T;
  error?: { code: number; message: string };
  id: number;
}

async function rpc<T>(url: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) return null;
    return (json.result as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * `alchemy_getTokenBalances` caps the response at 100 tokens per call and
 * returns a `pageKey` to continue. Without paging we miss every token beyond
 * the first 100 — wallets that have collected many airdrops (and many real
 * tokens scattered among them) end up showing only their largest few.
 *
 * Cap at 10 pages = 1000 tokens to bound the worst case.
 */
async function getAllTokenBalances(
  url: string,
  address: string,
): Promise<TokenBalanceEntry[]> {
  const all: TokenBalanceEntry[] = [];
  let pageKey: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params: unknown[] = [address, "erc20"];
    if (pageKey) params.push({ pageKey });
    const res = await rpc<GetTokenBalancesResult>(url, {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getTokenBalances",
      params,
    });
    if (!res) break;
    for (const t of res.tokenBalances) all.push(t);
    if (!res.pageKey) break;
    pageKey = res.pageKey;
  }
  return all;
}

async function rpcBatch<T>(url: string, calls: object[]): Promise<(T | null)[]> {
  if (calls.length === 0) return [];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calls),
    });
    if (!res.ok) return calls.map(() => null);
    const json = (await res.json()) as RpcResp<T>[];
    // Build a lookup by id since batch responses may come back out of order.
    const byId = new Map<number, RpcResp<T>>();
    for (const r of json) byId.set(r.id as unknown as number, r);
    return calls.map((c) => {
      const id = (c as { id: number }).id;
      const r = byId.get(id);
      if (!r) return null;
      return r.error ? null : (r.result ?? null);
    });
  } catch {
    return calls.map(() => null);
  }
}

interface TokenBalanceEntry {
  contractAddress: string;
  tokenBalance: string;
}
interface GetTokenBalancesResult {
  address: string;
  tokenBalances: TokenBalanceEntry[];
  pageKey?: string | null;
}
interface TokenMetadataResult {
  decimals: number | null;
  logo: string | null;
  name: string | null;
  symbol: string | null;
}

function hexToBigInt(hex: string | null | undefined): bigint {
  if (!hex || hex === "0x") return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

function fromBigIntToFloat(value: bigint, decimals: number): number {
  if (value === 0n) return 0;
  const d = BigInt(decimals);
  const base = 10n ** d;
  const whole = value / base;
  const frac = value % base;
  return Number(whole) + Number(frac) / Number(base);
}

/**
 * For any token whose Alchemy-supplied metadata is missing fields, query the
 * contract directly via eth_call. This catches legitimate tokens that aren't
 * in Alchemy's metadata catalog.
 */
async function fillMissingMetadata(
  url: string,
  entries: TokenBalanceEntry[],
  metadata: (TokenMetadataResult | null)[],
): Promise<(TokenMetadataResult | null)[]> {
  const missingIdx = entries
    .map((_, i) => i)
    .filter((i) => {
      const m = metadata[i];
      return !m || !m.symbol || !m.name || m.decimals == null;
    });
  if (missingIdx.length === 0) return metadata;

  // 3 calls per token (name, symbol, decimals). Use ids that won't collide.
  const calls: { id: number }[] = [];
  for (let k = 0; k < missingIdx.length; k++) {
    const baseId = (k + 1) * 10;
    const tokenCalls = buildMetadataCalls(entries[missingIdx[k]].contractAddress, baseId);
    calls.push(...tokenCalls);
  }
  const results = await rpcBatch<string>(url, calls);

  // results layout: [name_k=0, symbol_k=0, decimals_k=0, name_k=1, …]
  for (let k = 0; k < missingIdx.length; k++) {
    const i = missingIdx[k];
    const nameRes = results[k * 3 + 0];
    const symbolRes = results[k * 3 + 1];
    const decRes = results[k * 3 + 2];
    const fallbackName = decodeAbiString(nameRes);
    const fallbackSymbol = decodeAbiString(symbolRes);
    const fallbackDec = decodeAbiUint8(decRes);
    const existing = metadata[i];
    metadata[i] = {
      decimals: existing?.decimals ?? fallbackDec,
      logo: existing?.logo ?? null,
      name: existing?.name ?? fallbackName,
      symbol: existing?.symbol ?? fallbackSymbol,
    };
  }
  return metadata;
}

interface PriceInfo {
  usd: number;
  change24h: number | null;
}

/**
 * Price lookup, in order: Alchemy Prices (by-CONTRACT) → CoinGecko
 * (by-CONTRACT) → CMC (by SYMBOL) → DexScreener (by-CONTRACT, consensus).
 * Returns USD price + 24h % change (when available) per lowercased contract.
 *
 * Contract-address lookups go first because they are unambiguous by
 * construction — there is exactly one token at a given address. CMC is
 * queried by SYMBOL, which is fundamentally ambiguous: many unrelated
 * tokens share a ticker (confirmed real case — TRU resolves to "Truebit",
 * a completely different project, when TrueFi's TRU is the one actually
 * held; same class of bug as the DexScreener fake-pool issue, just via a
 * different source). So CMC is now a same-symbol FALLBACK for contracts
 * the address-based sources don't know about, not the primary source.
 * `symbolByContract` is optional — callers that don't have metadata yet
 * simply skip the CMC tier and rely on DexScreener.
 */
async function resolveTokenPrices(
  chain: EvmChain,
  contracts: string[],
  symbolByContract?: Record<string, string>,
): Promise<Record<string, PriceInfo>> {
  if (contracts.length === 0) return {};
  const merged: Record<string, PriceInfo> = {};

  // 1) Alchemy Prices (by contract address) — price only (no 24h change).
  const alchemy = await getAlchemyTokenPrices(chain, contracts);
  for (const k of Object.keys(alchemy)) {
    merged[k] = { usd: alchemy[k], change24h: null };
  }

  // 2) CoinGecko (by contract address) for any still-missing.
  const missingAfterAlchemy = contracts.filter((c) => merged[c] == null);
  if (missingAfterAlchemy.length > 0) {
    const cg = await getTokenPricesWithChange(chain, missingAfterAlchemy);
    for (const k of Object.keys(cg)) {
      if (merged[k] == null) merged[k] = cg[k];
    }
  }

  // 2.5) Hand-curated CoinGecko-by-ID pin for contracts with a KNOWN
  //      symbol collision on CMC. CoinGecko's free tier occasionally
  //      429s from shared Vercel IPs, which was silently falling through
  //      to the CMC-by-symbol fallback below — and CMC lists an unrelated
  //      "Truebit" project under the same TRU ticker as TrueFi, producing
  //      a wildly wrong price. Pinning the exact CoinGecko coin id by
  //      contract address (only for chain=="ethereum", where this map's
  //      addresses live) sidesteps both the rate-limit AND the collision
  //      in one shot, with one extra retry baked in via getNativePrices.
  const missingAfterCgId = contracts.filter((c) => merged[c] == null);
  if (chain === "ethereum" && missingAfterCgId.length > 0) {
    const idsToTry: { contract: string; id: string }[] = [];
    for (const c of missingAfterCgId) {
      const id = KNOWN_COLLISION_CONTRACT_TO_CG_ID[c];
      if (id) idsToTry.push({ contract: c, id });
    }
    if (idsToTry.length > 0) {
      const prices = await getNativePrices(idsToTry.map((x) => x.id));
      for (const { contract, id } of idsToTry) {
        const p = prices[id];
        if (p != null) merged[contract] = { usd: p, change24h: null };
      }
    }
  }

  // 3) CoinMarketCap by symbol — fallback only, for contracts neither
  //    address-based source above resolved. Symbol lookups are ambiguous
  //    (see doc comment), so this must never override an address-based hit.
  const missingAfterCg = contracts.filter((c) => merged[c] == null);
  if (symbolByContract && isCmcEnabled() && missingAfterCg.length > 0) {
    const symToContracts: Record<string, string[]> = {};
    for (const c of missingAfterCg) {
      const sym = symbolByContract[c];
      if (sym) (symToContracts[sym.toUpperCase()] ??= []).push(c);
    }
    const symbols = Object.keys(symToContracts);
    if (symbols.length > 0) {
      const cmc = await getCmcQuotes(symbols);
      for (const sym of Object.keys(cmc)) {
        const q = cmc[sym];
        for (const c of symToContracts[sym] ?? []) {
          if (merged[c] == null) merged[c] = { usd: q.priceUsd, change24h: q.change24h };
        }
      }
    }
  }

  // 4) DexScreener for whatever long-tail tokens remain.
  const stillMissing = contracts.filter((c) => merged[c] == null);
  if (stillMissing.length > 0) {
    const ds = await getDexScreenerPricesWithChange(chain, stillMissing);
    for (const k of Object.keys(ds)) {
      if (merged[k] == null) merged[k] = ds[k];
    }
  }

  // 4) Backfill 24h change from CoinGecko for everything resolved-by-Alchemy
  //    (which doesn't expose change). Single batched call.
  const needsChange = contracts.filter(
    (c) => merged[c] && merged[c].change24h == null,
  );
  if (needsChange.length > 0) {
    const cg = await getTokenPricesWithChange(chain, needsChange);
    for (const k of Object.keys(cg)) {
      if (merged[k] && merged[k].change24h == null && cg[k].change24h != null) {
        merged[k] = { ...merged[k], change24h: cg[k].change24h };
      }
    }
  }
  // NOTE: Alchemy Historical (1 req/token) is intentionally NOT called here.
  // For wallets with hundreds of tokens across 28 chains, that path adds
  // tens of seconds per wallet and tipped the function past its 60s
  // maxDuration limit — wiping 20+ wallets' worth of holdings (see the
  // RAIN/GEMS incident on 2026-05-27). The historical backfill now lives
  // exclusively in /api/holdings/backfill-24h, where it can run scoped to
  // tokens that need it without re-fetching balances.

  return merged;
}

async function resolveNativePrice(chain: EvmChain): Promise<PriceInfo | null> {
  const sym = NATIVE_SYMBOL[chain].toUpperCase();
  const alchemy = await getAlchemyPricesBySymbol([sym]);
  const cg = await getNativePricesWithChange([COINGECKO_NATIVE_ID[chain]]);
  const cgEntry = cg[COINGECKO_NATIVE_ID[chain]];
  const usd = alchemy[sym] ?? cgEntry?.usd ?? null;
  if (usd == null) return null;
  return { usd, change24h: cgEntry?.change24h ?? null };
}

async function fetchSingleEvmChain(
  chain: EvmChain,
  address: string,
): Promise<Holding[]> {
  const url = endpoint(chain);

  // 1) Native balance + ALL pages of ERC-20 balances.
  const [nativeHex, allBalances] = await Promise.all([
    rpc<string>(url, {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
    getAllTokenBalances(url, address),
  ]);

  const nativeWei = hexToBigInt(nativeHex);
  const nativeAmount = fromBigIntToFloat(nativeWei, NATIVE_DECIMALS[chain]);

  // Filter out zero-balance tokens.
  const tokenEntries = allBalances.filter(
    (e) => hexToBigInt(e.tokenBalance) > 0n,
  );

  // 2) Metadata: chunk into batches of 50 to avoid huge JSON-RPC payloads
  //    when wallets hold hundreds of tokens.
  let metadataResults: (TokenMetadataResult | null)[] = [];
  if (tokenEntries.length > 0) {
    for (let i = 0; i < tokenEntries.length; i += 50) {
      const chunk = tokenEntries.slice(i, i + 50);
      const chunkRes = await rpcBatch<TokenMetadataResult>(
        url,
        chunk.map((e, j) => ({
          id: j + 1,
          jsonrpc: "2.0",
          method: "alchemy_getTokenMetadata",
          params: [e.contractAddress],
        })),
      );
      metadataResults.push(...chunkRes);
    }
  }

  metadataResults = await fillMissingMetadata(url, tokenEntries, metadataResults);

  // 3) Resolve prices via CMC → Alchemy → CoinGecko → DexScreener, all in
  //    parallel with the native-price lookup. Pass the symbol we already
  //    have from metadata so CMC can be tried first for known tickers.
  const contracts = tokenEntries.map((e) => e.contractAddress.toLowerCase());
  const symbolByContract: Record<string, string> = {};
  for (let i = 0; i < tokenEntries.length; i++) {
    const sym = metadataResults[i]?.symbol;
    if (sym) symbolByContract[tokenEntries[i].contractAddress.toLowerCase()] = sym;
  }
  const [tokenPrices, nativePrice] = await Promise.all([
    resolveTokenPrices(chain, contracts, symbolByContract),
    resolveNativePrice(chain),
  ]);

  const out: Holding[] = [];

  if (nativeAmount > 0) {
    const usd = nativePrice?.usd ?? null;
    out.push({
      chain,
      contract: "native",
      symbol: NATIVE_SYMBOL[chain],
      name: NATIVE_SYMBOL[chain],
      amount: nativeAmount,
      decimals: NATIVE_DECIMALS[chain],
      priceUsd: usd,
      valueUsd: usd ? nativeAmount * usd : 0,
      priceChange24h: nativePrice?.change24h ?? null,
    });
  }

  for (let i = 0; i < tokenEntries.length; i++) {
    const entry = tokenEntries[i];
    const meta = metadataResults[i];
    const decimals = meta?.decimals ?? 18;
    const raw = hexToBigInt(entry.tokenBalance);
    const amount = fromBigIntToFloat(raw, decimals);
    if (amount <= 0) continue;
    const info = tokenPrices[entry.contractAddress.toLowerCase()] ?? null;
    const price = info?.usd ?? null;
    const value = price ? amount * price : 0;

    // If symbol is still unknown after Alchemy + eth_call, fall back to a
    // short version of the contract address so the user still sees *something*.
    const fallbackSymbol = `0x${entry.contractAddress.slice(2, 6)}…${entry.contractAddress.slice(-4)}`;

    out.push({
      chain,
      contract: entry.contractAddress.toLowerCase(),
      symbol: meta?.symbol ?? fallbackSymbol,
      name: meta?.name ?? null,
      amount,
      decimals,
      priceUsd: price,
      valueUsd: value,
      priceChange24h: info?.change24h ?? null,
    });
  }

  return out;
}

/**
 * Query every supported EVM chain in parallel and return a flat list of
 * non-zero holdings.
 *
 * Fails fast with AlchemyKeyMissingError if the env var is missing/empty,
 * rather than silently returning [] after 27 chains each independently
 * threw the same error inside Promise.allSettled (which is what used to
 * happen — and how 20 wallets ended up showing 0 holdings on production
 * with no visible signal).
 */
export async function fetchEvmHoldings(address: string): Promise<Holding[]> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key || key.trim() === "") {
    throw new AlchemyKeyMissingError();
  }
  const results = await Promise.allSettled(
    EVM_CHAINS.map((c) => fetchSingleEvmChain(c, address)),
  );
  const out: Holding[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  return out;
}
