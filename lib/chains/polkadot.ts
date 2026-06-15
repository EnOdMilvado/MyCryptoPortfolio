import { ApiPromise, HttpProvider } from "@polkadot/api";
import {
  COINGECKO_NATIVE_ID,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type Holding,
} from "./types";
import { getNativePricesWithChange } from "./prices";

/**
 * Polkadot holdings via @polkadot/api over HTTP. Endpoint preference:
 *
 *   1. ALCHEMY_API_KEY → https://polkadot-mainnet.g.alchemy.com/v2/{key}
 *      (the user already has this key for EVM/Solana, so no extra setup).
 *   2. Public RPC fallbacks (rpc.polkadot.io, etc.) when Alchemy fails
 *      or the key isn't enabled for Polkadot.
 *
 * @polkadot/api decodes SCALE for us — we just pull `data.free` and
 * `data.reserved` off the standard `system.account` storage item.
 * `frozen` overlaps with `free` (it's a lock flag, not a separate
 * balance) so we sum free + reserved to match the figure Polkadot
 * explorers show as "total".
 */

const ENDPOINTS = (): string[] => {
  const list: string[] = [];
  const key = process.env.ALCHEMY_API_KEY;
  if (key) list.push(`https://polkadot-mainnet.g.alchemy.com/v2/${key}`);
  // Public fallbacks. Order: official → publicnode → 1rpc.
  list.push("https://rpc.polkadot.io");
  list.push("https://polkadot-rpc.publicnode.com");
  return list;
};

// One @polkadot/api instance per Vercel lambda is fine — it's reused
// across requests for the lifetime of the container. We keep the
// first endpoint that succeeded so we don't have to walk the list
// every call.
let cachedApi: { url: string; api: Promise<ApiPromise> } | null = null;

async function getApi(): Promise<ApiPromise> {
  if (cachedApi) {
    try {
      const api = await cachedApi.api;
      if (api.isConnected || api) return api;
    } catch {
      cachedApi = null;
    }
  }
  let lastErr: string | null = null;
  for (const url of ENDPOINTS()) {
    try {
      const provider = new HttpProvider(url);
      const api = ApiPromise.create({ provider, noInitWarn: true });
      cachedApi = { url, api };
      return await api;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      cachedApi = null;
    }
  }
  throw new Error(
    `Polkadot RPC could not initialize across ${ENDPOINTS().length} endpoints: ${lastErr ?? "unknown"}`,
  );
}

interface AccountData {
  free: string | number;
  reserved: string | number;
}
interface AccountInfo {
  data?: AccountData;
}

export async function fetchPolkadotHoldings(address: string): Promise<Holding[]> {
  const api = await getApi();
  const [accountRaw, cg] = await Promise.all([
    api.query.system.account(address),
    getNativePricesWithChange([COINGECKO_NATIVE_ID.polkadot]),
  ]);
  const account = accountRaw.toJSON() as AccountInfo;

  // Substrate balances come back as either hex strings (for big numbers)
  // or numbers. Use BigInt to avoid lossy float arithmetic on the planck
  // values, then convert once at the very end.
  function toBig(v: string | number | undefined): bigint {
    if (v == null) return 0n;
    if (typeof v === "number") return BigInt(v);
    return v.startsWith("0x") ? BigInt(v) : BigInt(v);
  }

  const planck = toBig(account.data?.free) + toBig(account.data?.reserved);
  if (planck === 0n) return [];

  const decimals = NATIVE_DECIMALS.polkadot; // 10
  // (planck / 10^decimals) without losing precision: convert once,
  // dividing by Number(10^decimals).
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
