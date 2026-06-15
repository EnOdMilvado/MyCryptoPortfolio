import {
  COINGECKO_NATIVE_ID,
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type Holding,
} from "./types";
import { getNativePricesWithChange } from "./prices";

/**
 * TON holdings via tonapi.io public REST API.
 *
 *   GET /v2/accounts/{address}         → native balance (in nanoTON, 9 dp)
 *   GET /v2/accounts/{address}/jettons → jetton (fungible-token) balances,
 *                                        including a `price` block with USD
 *                                        and 24h percent_change for many
 *                                        listed jettons. We use that
 *                                        directly so we don't have to map
 *                                        each jetton to a CoinGecko id.
 *
 * Free tier is rate-limited but plenty for one wallet refresh.
 */
const BASE = "https://tonapi.io/v2";

interface TonAccount {
  balance: number;
  status?: string;
}

interface TonJettonBalance {
  balance: string;
  jetton: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  price?: {
    prices?: Record<string, number>;
    diff_24h?: Record<string, string>;
  };
}

interface TonJettonsResponse {
  balances: TonJettonBalance[];
}

interface TonNominatorPool {
  pool: string;
  // nanoTON integers (10^9 = 1 TON). Active stake + funds in flight to/from
  // the pool. Tonkeeper's wallet UI sums all four into "Staked", so we
  // mirror that here to keep the dashboard total matching Tonkeeper.
  amount: number;
  pending_deposit_amount: number;
  pending_withdraw_amount: number;
  ready_withdraw_amount: number;
}

interface TonStakingResponse {
  pools: TonNominatorPool[];
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TON ${url} ${res.status}: ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

function parsePercentString(s: string | undefined): number | null {
  if (!s) return null;
  // tonapi returns strings like "-3.45%" or "+1.20%". Trim the % and sign.
  const cleaned = s.replace(/[%+]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export async function fetchTonHoldings(address: string): Promise<Holding[]> {
  // Fetch account + jettons + nominator pools in parallel. Use the user-
  // friendly address form the user gave us — tonapi accepts both raw
  // (0:hex) and user-friendly (EQ.../UQ...) forms.
  const [account, jettons, staking, nativeCg] = await Promise.all([
    getJson<TonAccount>(`${BASE}/accounts/${encodeURIComponent(address)}`),
    getJson<TonJettonsResponse>(
      `${BASE}/accounts/${encodeURIComponent(address)}/jettons?currencies=usd`,
    ),
    // Tonkeeper "Queue" stakes and other nominator-pool stakes are NOT
    // counted in the native balance — they're held by a separate pool
    // contract. tonapi exposes them here. Soft-fail if this single call
    // throws (rate limit / 5xx) so the native + jettons response still
    // succeeds.
    getJson<TonStakingResponse>(
      `${BASE}/staking/nominator/${encodeURIComponent(address)}/pools`,
    ).catch(() => null),
    getNativePricesWithChange([COINGECKO_NATIVE_ID.ton]),
  ]);

  const out: Holding[] = [];

  const nativeAmount = (account?.balance ?? 0) / 10 ** NATIVE_DECIMALS.ton;
  const nativeCgEntry = nativeCg[COINGECKO_NATIVE_ID.ton];
  const nativePrice = nativeCgEntry?.usd ?? null;
  const nativeChange = nativeCgEntry?.change24h ?? null;
  if (nativeAmount > 0) {
    out.push({
      chain: "ton",
      contract: "native",
      symbol: NATIVE_SYMBOL.ton,
      name: "Toncoin",
      amount: nativeAmount,
      decimals: NATIVE_DECIMALS.ton,
      priceUsd: nativePrice,
      valueUsd: nativePrice ? nativeAmount * nativePrice : 0,
      priceChange24h: nativeChange,
    });
  }

  // Aggregate every nominator pool into a single "Staked TON" line so
  // the total matches what Tonkeeper / TON wallet apps show. The pool
  // address goes into a per-holding `contract` so the cache doesn't
  // collide with the native row.
  const pools = staking?.pools ?? [];
  const stakedNano = pools.reduce(
    (s, p) =>
      s +
      (p.amount ?? 0) +
      (p.pending_deposit_amount ?? 0) +
      (p.pending_withdraw_amount ?? 0) +
      (p.ready_withdraw_amount ?? 0),
    0,
  );
  const stakedAmount = stakedNano / 10 ** NATIVE_DECIMALS.ton;
  if (stakedAmount > 0) {
    out.push({
      chain: "ton",
      // Stable synthetic id so the cache distinguishes staked TON from
      // native TON on the same wallet. Carries the pool count for
      // debuggability when there are multiple pools.
      contract: `staked:${pools.length}`,
      symbol: "TON",
      name: pools.length === 1 ? "Staked TON" : `Staked TON (${pools.length} pools)`,
      amount: stakedAmount,
      decimals: NATIVE_DECIMALS.ton,
      // TON has a single price — re-use the native price so the staked
      // line shows the same per-unit USD as the unstaked row.
      priceUsd: nativePrice,
      valueUsd: nativePrice ? stakedAmount * nativePrice : 0,
      priceChange24h: nativeChange,
    });
  }

  for (const j of jettons?.balances ?? []) {
    const decimals = j.jetton.decimals ?? 9;
    const raw = parseFloat(j.balance);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const amount = raw / 10 ** decimals;
    const price = j.price?.prices?.USD ?? null;
    const change24h = parsePercentString(j.price?.diff_24h?.USD);
    out.push({
      chain: "ton",
      contract: j.jetton.address,
      symbol: j.jetton.symbol,
      name: j.jetton.name,
      amount,
      decimals,
      priceUsd: price,
      valueUsd: price ? amount * price : 0,
      priceChange24h: change24h,
    });
  }

  return out;
}
