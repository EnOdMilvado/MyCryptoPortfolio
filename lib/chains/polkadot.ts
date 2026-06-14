import {
  COINGECKO_NATIVE_ID,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type Holding,
} from "./types";
import { getNativePricesWithChange } from "./prices";

/**
 * Polkadot holdings via Subscan REST.
 *
 * Subscan requires an API key (free tier, sign up at subscan.io). The key
 * goes in the SUBSCAN_API_KEY env var; without it this adapter throws a
 * clear "missing key" error rather than silently returning zero.
 *
 * Why not native JSON-RPC: Polkadot's `system.account` storage item is
 * SCALE-encoded — fetching it via `state_getStorage` requires computing
 * an xxhash128 + blake2 storage key and decoding the response, which
 * pulls in a heavyweight SCALE-codec dependency for what should be a
 * tiny adapter. Subscan abstracts that away.
 */
const BASE = "https://polkadot.api.subscan.io";

export class SubscanKeyMissingError extends Error {
  constructor() {
    super("SUBSCAN_API_KEY missing or empty");
    this.name = "SubscanKeyMissingError";
  }
}

interface SubscanAccountResp {
  code: number;
  message?: string;
  data?: {
    account?: {
      // Subscan returns balances as decimal strings already scaled by
      // 10^10 — i.e. "12.345" means 12.345 DOT, NOT 12.345 planck.
      balance?: string;
      balance_lock?: string;
      reserved?: string;
    };
  };
}

async function subscanGetBalance(address: string): Promise<number> {
  const key = process.env.SUBSCAN_API_KEY;
  if (!key) throw new SubscanKeyMissingError();
  const res = await fetch(`${BASE}/api/v2/scan/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({ key: address }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Subscan ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as SubscanAccountResp;
  if (json.code !== 0) {
    throw new Error(`Subscan code ${json.code}: ${json.message ?? "unknown"}`);
  }
  const acc = json.data?.account;
  // Subscan ships balance already denominated in DOT (not planck). Sum
  // free + reserved + locked to match the figure shown in the explorer.
  const free = parseFloat(acc?.balance ?? "0");
  const reserved = parseFloat(acc?.reserved ?? "0");
  const locked = parseFloat(acc?.balance_lock ?? "0");
  return (
    (Number.isFinite(free) ? free : 0) +
    (Number.isFinite(reserved) ? reserved : 0) +
    (Number.isFinite(locked) ? locked : 0)
  );
}

export async function fetchPolkadotHoldings(address: string): Promise<Holding[]> {
  const [amount, cg] = await Promise.all([
    subscanGetBalance(address),
    getNativePricesWithChange([COINGECKO_NATIVE_ID.polkadot]),
  ]);
  if (amount <= 0) return [];
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
      decimals: NATIVE_DECIMALS.polkadot,
      priceUsd: price,
      valueUsd: price ? amount * price : 0,
      priceChange24h: change,
    },
  ];
}
