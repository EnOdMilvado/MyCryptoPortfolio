import { createHmac } from "crypto";
import type {
  ExchangeAdapter,
  ExchangeCredentials,
  SpotBalance,
  TradeRow,
  OrderRow,
  DepositRow,
  WithdrawalRow,
  TradesQuery,
  TransfersQuery,
} from "./types";

/**
 * HTX (formerly Huobi) Spot v1 REST API adapter.
 *
 * Signing scheme is different from Binance/MEXC: payload is
 *   "<METHOD>\n<HOST>\n<PATH>\n<ASCII-sorted query string>"
 * HMAC-SHA256 with the API secret, then Base64-encoded, then URL-encoded as
 * the `Signature` query parameter.
 *
 * Docs: https://huobiapi.github.io/docs/spot/v1/en/
 */
const HOST = "api.huobi.pro";
const BASE = `https://${HOST}`;

const STABLE_USD_ASSETS = new Set([
  "USDT",
  "USDC",
  "BUSD",
  "FDUSD",
  "TUSD",
  "DAI",
  "USD",
  "HUSD",
]);

function normalizeAsset(asset: string): string {
  return asset.toUpperCase();
}

// HTX timestamps: UTC ISO-8601 without milliseconds, e.g. 2024-01-02T03:04:05.
function htxTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

// Build an ASCII-sorted, URL-encoded query string from a params object.
function sortedQuery(params: Record<string, string | number | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    entries.push([k, String(v)]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

interface HtxResponse<T> {
  status?: string;
  "err-code"?: string;
  "err-msg"?: string;
  errCode?: string;
  errMsg?: string;
  data?: T;
}

async function signedGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  { apiKey, apiSecret }: ExchangeCredentials,
): Promise<T> {
  if (!apiKey || !apiSecret) throw new Error("Missing HTX credentials");
  const baseParams = {
    AccessKeyId: apiKey,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: htxTimestamp(),
    ...params,
  };
  const qs = sortedQuery(baseParams);
  const payload = `GET\n${HOST}\n${path}\n${qs}`;
  const sig = createHmac("sha256", apiSecret).update(payload).digest("base64");
  const url = `${BASE}${path}?${qs}&Signature=${encodeURIComponent(sig)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTX ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  let json: HtxResponse<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTX ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
  const status = json.status ?? (json["err-code"] || json.errCode ? "error" : "ok");
  if (status !== "ok") {
    const code = json["err-code"] ?? json.errCode ?? "unknown";
    const msg = json["err-msg"] ?? json.errMsg ?? "request failed";
    throw new Error(`HTX ${path} ${code}: ${msg}`);
  }
  return (json.data ?? ({} as T)) as T;
}

interface HtxAccount {
  id: number;
  type: string;
  subtype?: string;
  state?: string;
}

interface HtxBalanceItem {
  currency: string;
  type: string; // 'trade' | 'frozen'
  balance: string;
}

interface HtxAccountBalance {
  id: number;
  type: string;
  state: string;
  list: HtxBalanceItem[];
}

async function getSpotAccountId(creds: ExchangeCredentials): Promise<number> {
  const accounts = await signedGet<HtxAccount[]>(
    "/v1/account/accounts",
    {},
    creds,
  );
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("HTX returned no accounts");
  }
  const spot =
    accounts.find((a) => a.type === "spot" && (a.state ?? "working") === "working") ??
    accounts.find((a) => a.type === "spot");
  if (!spot) throw new Error("HTX user has no spot account");
  return spot.id;
}

// Public ticker endpoint — returns one row per trading pair.
interface HtxTickerItem {
  symbol: string;
  close: number;
}
async function fetchHtxUsdTickerMap(): Promise<Record<string, number>> {
  const res = await fetch(`${BASE}/market/tickers`, { next: { revalidate: 30 } });
  if (!res.ok) return {};
  const json = (await res.json()) as { status?: string; data?: HtxTickerItem[] };
  if (json.status !== "ok" || !Array.isArray(json.data)) return {};
  const byUsdt: Record<string, number> = {};
  const byUsdc: Record<string, number> = {};
  for (const t of json.data) {
    const sym = (t.symbol ?? "").toUpperCase();
    const px = Number(t.close);
    if (!sym || !Number.isFinite(px) || px <= 0) continue;
    if (sym.endsWith("USDT")) byUsdt[sym.slice(0, -4)] = px;
    else if (sym.endsWith("USDC")) byUsdc[sym.slice(0, -4)] = px;
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(byUsdt)) out[k] = byUsdt[k];
  for (const k of Object.keys(byUsdc)) {
    if (out[k] == null) out[k] = byUsdc[k];
  }
  return out;
}

export const htxAdapter: ExchangeAdapter = {
  provider: "htx",

  async fetchSpot(creds): Promise<SpotBalance[]> {
    const accountId = await getSpotAccountId(creds);
    const acc = await signedGet<HtxAccountBalance>(
      `/v1/account/accounts/${accountId}/balance`,
      {},
      creds,
    );
    // Sum trade + frozen for each currency.
    const totals: Record<string, number> = {};
    for (const item of acc.list ?? []) {
      const sym = normalizeAsset(item.currency);
      const amt = parseFloat(item.balance);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      totals[sym] = (totals[sym] ?? 0) + amt;
    }
    return Object.entries(totals)
      .map(([asset, amount]) => ({ asset, amount }))
      .filter((b) => b.amount > 0);
  },

  async fetchAssetPricesUsd(assets: string[]): Promise<Record<string, number>> {
    if (assets.length === 0) return {};
    const wanted = new Set(assets.map(normalizeAsset));
    const out: Record<string, number> = {};
    for (const a of wanted) {
      if (STABLE_USD_ASSETS.has(a)) out[a] = 1;
    }
    try {
      const tickerMap = await fetchHtxUsdTickerMap();
      for (const a of wanted) {
        if (out[a] != null) continue;
        const px = tickerMap[a];
        if (px != null) out[a] = px;
      }
    } catch {
      // non-fatal
    }
    return out;
  },

  async fetchTrades(_creds, _query: TradesQuery): Promise<TradeRow[]> {
    // TODO: HTX /v1/order/matchresults — requires per-symbol query with 48h windows.
    return [];
  },

  async fetchOrders(_creds, _query: TradesQuery): Promise<OrderRow[]> {
    // TODO: HTX /v1/order/history — supports per-symbol historical orders.
    return [];
  },

  async fetchDeposits(_creds, _query?: TransfersQuery): Promise<DepositRow[]> {
    // TODO: HTX /v1/query/deposit-withdraw?type=deposit
    return [];
  },

  async fetchWithdrawals(_creds, _query?: TransfersQuery): Promise<WithdrawalRow[]> {
    // TODO: HTX /v1/query/deposit-withdraw?type=withdraw
    return [];
  },
};
