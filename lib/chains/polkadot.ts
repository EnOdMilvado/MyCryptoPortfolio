import { decodeAddress, xxhashAsHex, blake2AsHex } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import {
  COINGECKO_NATIVE_ID,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type Holding,
} from "./types";
import { getNativePricesWithChange } from "./prices";

/**
 * Polkadot holdings via direct JSON-RPC + manual SCALE decode.
 *
 * Why not @polkadot/api ApiPromise: the library's create() flow fires a
 * cascade of metadata RPCs (chain_getBlockHash, state_getRuntimeVersion,
 * system_properties, rpc_methods, system_chain). Any single fetch-fail
 * blocks the whole init for ~60s before throwing. From a Vercel sin1
 * function that ran straight into the function-runtime timeout on the
 * first DOT wallet refresh. The raw-RPC path below is one HTTP call —
 * bounded by a per-endpoint AbortSignal so a slow host can't dominate
 * the budget either.
 *
 * Endpoint preference: Alchemy first (reuses ALCHEMY_API_KEY), then
 * three public RPCs. Each gets ~8s before the next is tried; the first
 * one to return a usable response wins.
 */

/**
 * Polkadot DOT lives in two places after the 2024 Asset Hub migration:
 *   - relay chain (rpc.polkadot.io): bonded / nominator / vesting DOT
 *   - Asset Hub: regular wallet balance (where most user funds now sit)
 * Querying only the relay chain returns null for everyday wallets like
 * the one connected via Nova / Talisman. Sum the two so totals match
 * what users see in Subscan / Polkadot.js Apps.
 */
function relayEndpoints(): string[] {
  const list: string[] = [];
  const key = process.env.ALCHEMY_API_KEY;
  if (key) list.push(`https://polkadot-mainnet.g.alchemy.com/v2/${key}`);
  list.push("https://rpc.polkadot.io");
  list.push("https://polkadot-rpc.publicnode.com");
  list.push("https://polkadot.api.onfinality.io/public");
  return list;
}

function assetHubEndpoints(): string[] {
  return [
    "https://polkadot-asset-hub-rpc.polkadot.io",
    "https://statemint-rpc.polkadot.io",
    "https://sys.ibp.network/asset-hub-polkadot",
  ];
}

// Substrate's system.account storage key is:
//   xxhash128("System") + xxhash128("Account") + blake2_128(pubkey) + pubkey
// The two xxhash128 prefixes are constants — compute them lazily once
// and reuse forever to skip ~80µs of hashing per request.
let cachedPrefix: string | null = null;
function systemAccountPrefix(): string {
  if (cachedPrefix) return cachedPrefix;
  const s = xxhashAsHex("System", 128).slice(2);
  const a = xxhashAsHex("Account", 128).slice(2);
  cachedPrefix = `0x${s}${a}`;
  return cachedPrefix;
}

function storageKey(address: string): string {
  const pubkey = decodeAddress(address);
  const hashed = blake2AsHex(pubkey, 128).slice(2);
  const pkHex = u8aToHex(pubkey).slice(2);
  return `${systemAccountPrefix()}${hashed}${pkHex}`;
}

interface RpcResponse {
  result?: string | null;
  error?: { code?: number; message?: string };
}

async function rpcOne(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<RpcResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`${res.status}`);
  }
  return (await res.json()) as RpcResponse;
}

async function getStorageFrom(endpoints: string[], key: string): Promise<string | null> {
  let lastErr: string | null = null;
  for (const url of endpoints) {
    try {
      const r = await rpcOne(url, "state_getStorage", [key], 8000);
      if (r.error) {
        lastErr = r.error.message ?? `code ${r.error.code}`;
        continue;
      }
      // First endpoint that answers without error wins — even if the
      // answer is `null` (which on Polkadot just means "no account at
      // this key", not "RPC broken").
      return r.result ?? null;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(
    `Polkadot state_getStorage failed across ${endpoints.length} endpoints: ${lastErr ?? "unknown"}`,
  );
}

/**
 * Read an unsigned 128-bit little-endian integer out of a `0x`-prefixed
 * hex string at the given byte offset.
 */
function readU128LE(hex: string, offsetBytes: number): bigint {
  const start = 2 + offsetBytes * 2;
  const slice = hex.slice(start, start + 32);
  if (slice.length < 32) return 0n;
  let be = "";
  for (let i = slice.length - 2; i >= 0; i -= 2) {
    be += slice.slice(i, i + 2);
  }
  return BigInt(`0x${be}`);
}

function decodeBalance(raw: string | null): bigint {
  if (!raw) return 0n;
  // AccountInfo layout (current Polkadot runtime, also used by Asset Hub):
  //   nonce        u32         offset 0
  //   consumers    u32         offset 4
  //   providers    u32         offset 8
  //   sufficients  u32         offset 12
  //   data.free       u128     offset 16
  //   data.reserved   u128     offset 32
  //   data.frozen     u128     offset 48  (lock cap — overlaps with free)
  //   data.flags      u128     offset 64
  return readU128LE(raw, 16) + readU128LE(raw, 32);
}

export async function fetchPolkadotHoldings(address: string): Promise<Holding[]> {
  const key = storageKey(address);
  // Fan out to relay + Asset Hub in parallel. Asset Hub holds regular
  // wallet DOT after the 2024 migration; relay chain holds bonded /
  // staking / vesting DOT. Sum both for the user-visible total. Allow
  // either to soft-fail so a single chain outage doesn't void the row.
  const [relayRaw, hubRaw, cg] = await Promise.all([
    getStorageFrom(relayEndpoints(), key).catch(() => null),
    getStorageFrom(assetHubEndpoints(), key).catch(() => null),
    getNativePricesWithChange([COINGECKO_NATIVE_ID.polkadot]),
  ]);
  const planck = decodeBalance(relayRaw) + decodeBalance(hubRaw);
  if (planck === 0n) return [];

  const decimals = NATIVE_DECIMALS.polkadot;
  const amount = Number(planck) / 10 ** decimals;
  const cgEntry = cg[COINGECKO_NATIVE_ID.polkadot];
  const price = cgEntry?.usd ?? null;
  const change = cgEntry?.change24h ?? null;
  return [
    {
      chain: "polkadot",
      contract: "native",
      symbol: NATIVE_SYMBOL.polkadot,
      name: "Polkadot",
      amount,
      decimals,
      priceUsd: price,
      valueUsd: price ? amount * price : 0,
      priceChange24h: change,
    },
  ];
}
