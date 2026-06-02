import { createHash, createHmac } from "crypto";
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
 * Gate.io v4 REST API adapter. Auth scheme differs from Binance/MEXC:
 *
 *   payloadHash = SHA512(body)                  // SHA512 of empty string for GET
 *   signString  = method + "\n" + path + "\n" + queryString + "\n" + payloadHash + "\n" + timestamp
 *   SIGN        = HMAC-SHA512(signString, apiSecret) → hex
 *   Headers     = { KEY, Timestamp, SIGN }
 *
 * Docs: https://www.gate.com/docs/developers/apiv4/en/
 */
const BASE = "https://api.gateio.ws";
const PATH_PREFIX = "/api/v4";
const SHA512_EMPTY = createHash("sha512").update("").digest("hex");

function normalizeAsset(asset: string): string {
  return asset.toUpperCase();
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") entries.push([k, String(v)]);
  }
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

async function signedGet<T>(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  { apiKey, apiSecret }: ExchangeCredentials,
): Promise<T> {
  if (!apiKey || !apiSecret) throw new Error("Missing Gate.io credentials");
  const path = `${PATH_PREFIX}${endpoint}`;
  const qs = buildQuery(params);
  // Gate's timestamp is Unix SECONDS as a string.
  const ts = Math.floor(Date.now() / 1000).toString();
  const signString = `GET\n${path}\n${qs}\n${SHA512_EMPTY}\n${ts}`;
  const sign = createHmac("sha512", apiSecret).update(signString).digest("hex");
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { KEY: apiKey, Timestamp: ts, SIGN: sign, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gate ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gate ${endpoint} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

interface GateAccount {
  currency: string;
  available: string;
  locked: string;
}

interface GateTrade {
  id: string;
  create_time: string;
  create_time_ms: string;
  currency_pair: string;
  side: "buy" | "sell";
  amount: string;
  price: string;
  order_id: string;
  fee: string;
  fee_currency: string;
}

interface GateOrder {
  id: string;
  create_time: string;
  update_time: string;
  currency_pair: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  amount: string;
  price: string;
  filled_total: string;
  fill_price?: string;
}

interface GateDeposit {
  id: string;
  txid?: string;
  currency: string;
  chain?: string;
  amount: string;
  address?: string;
  status: string;
  timestamp: string;
  fee?: string;
}

interface GateWithdrawal {
  id: string;
  txid?: string;
  currency: string;
  chain?: string;
  amount: string;
  address?: string;
  status: string;
  timestamp: string;
  fee?: string;
}

interface GateCurrencyPair {
  id: string;
  base: string;
  quote: string;
  trade_status: string;
}

interface GateTicker {
  currency_pair: string;
  last: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Gate enforces a 30-day cap on history endpoints. Step a clear day under
// the boundary so the strict-less-than check never fires.
const HISTORY_WINDOW_MS = 28 * DAY_MS;

const DEFAULT_QUOTES = ["USDT", "USDC", "BTC", "ETH"];
const STABLE_OR_BASE = new Set(["USDT", "USDC", "USD", "BUSD", "FDUSD", "TUSD"]);
const STABLE_USD_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USD"]);

function chunkTimeWindows(
  startMs: number,
  endMs: number,
  windowMs: number,
): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const next = Math.min(cur + windowMs, endMs);
    out.push({ startMs: cur, endMs: next });
    cur = next;
  }
  return out;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  async function pump(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => pump()));
  return out;
}

/**
 * Returns the set of currently-tradable spot pairs on Gate, in the
 * "BASE_QUOTE" format the v4 API expects. Used to pre-filter candidates
 * before hitting the per-pair signed endpoints — same reason as the MEXC
 * adapter (a 95-asset spot × 4 default quotes × N time windows fanout
 * would blow the Vercel 60s budget without this filter).
 */
async function fetchGateValidPairs(): Promise<Set<string>> {
  try {
    const res = await fetch(`${BASE}${PATH_PREFIX}/spot/currency_pairs`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return new Set();
    const arr = (await res.json()) as GateCurrencyPair[];
    if (!Array.isArray(arr)) return new Set();
    const out = new Set<string>();
    for (const p of arr) {
      if (p.trade_status === "tradable" && p.id) out.add(p.id.toUpperCase());
    }
    return out;
  } catch {
    return new Set();
  }
}

async function fetchGateUsdTickerMap(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${BASE}${PATH_PREFIX}/spot/tickers`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return {};
    const arr = (await res.json()) as GateTicker[];
    if (!Array.isArray(arr)) return {};
    const byUsdt: Record<string, number> = {};
    const byUsdc: Record<string, number> = {};
    for (const t of arr) {
      const pair = (t.currency_pair ?? "").toUpperCase();
      const px = parseFloat(t.last);
      if (!pair || !Number.isFinite(px) || px <= 0) continue;
      if (pair.endsWith("_USDT")) byUsdt[pair.slice(0, -5)] = px;
      else if (pair.endsWith("_USDC")) byUsdc[pair.slice(0, -5)] = px;
    }
    const out: Record<string, number> = {};
    for (const base of Object.keys(byUsdt)) out[base] = byUsdt[base];
    for (const base of Object.keys(byUsdc)) {
      if (out[base] == null) out[base] = byUsdc[base];
    }
    return out;
  } catch {
    return {};
  }
}

function derivePairs(baseAssets: string[]): string[] {
  const bases = Array.from(new Set(baseAssets.map(normalizeAsset)));
  const pairs = new Set<string>();
  for (const base of bases) {
    if (STABLE_OR_BASE.has(base)) continue;
    for (const quote of DEFAULT_QUOTES) {
      if (quote !== base) pairs.add(`${base}_${quote}`);
    }
  }
  return Array.from(pairs);
}

function splitPair(pair: string): { base: string; quote: string } {
  const ix = pair.indexOf("_");
  if (ix < 0) return { base: pair, quote: "" };
  return { base: pair.slice(0, ix), quote: pair.slice(ix + 1) };
}

/**
 * Gate deposit/withdrawal status normalization. Per v4 docs the `status`
 * field is a single-letter code: D=done, B=bad, V=verifying, …
 *   D / DONE → success
 *   F / FAIL / CANCEL → failed
 *   anything else → pending
 */
function transferStatus(s: string): "success" | "failed" | "pending" {
  const u = (s ?? "").toUpperCase();
  if (u === "D" || u === "DONE") return "success";
  if (u === "F" || u === "FAIL" || u === "CANCEL" || u === "REFUND") return "failed";
  return "pending";
}

export const gateAdapter: ExchangeAdapter = {
  provider: "gate",

  async fetchSpot(creds): Promise<SpotBalance[]> {
    const json = await signedGet<GateAccount[]>("/spot/accounts", {}, creds);
    if (!Array.isArray(json)) return [];
    return json
      .map((b) => ({
        asset: normalizeAsset(b.currency),
        amount: parseFloat(b.available) + parseFloat(b.locked),
      }))
      .filter((b) => b.amount > 0);
  },

  async fetchTrades(creds, query: TradesQuery): Promise<TradeRow[]> {
    let pairs = (query.symbols ?? []).map((s) => s.toUpperCase());
    if (pairs.length === 0) {
      const spot = await this.fetchSpot(creds);
      pairs = derivePairs(spot.map((s) => s.asset));
    }
    const valid = await fetchGateValidPairs();
    if (valid.size > 0) pairs = pairs.filter((p) => valid.has(p));

    const endMs = query.endTimeMs ?? Date.now();
    const startMs = query.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, HISTORY_WINDOW_MS);

    const all: TradeRow[] = [];
    const seen = new Set<string>();
    await mapWithConcurrency(pairs, 6, async (pair) => {
      for (const w of windows) {
        let trades: GateTrade[];
        try {
          trades = await signedGet<GateTrade[]>(
            "/spot/my_trades",
            {
              currency_pair: pair,
              from: Math.floor(w.startMs / 1000),
              to: Math.floor(w.endMs / 1000),
              limit: 1000,
            },
            creds,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("INVALID_CURRENCY_PAIR")) return;
          continue;
        }
        if (!Array.isArray(trades)) continue;
        for (const t of trades) {
          const id = `${pair}:${t.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const { base, quote } = splitPair(pair);
          const price = parseFloat(t.price);
          const qty = parseFloat(t.amount);
          all.push({
            tradeId: id,
            symbol: pair,
            baseAsset: base,
            quoteAsset: quote,
            side: t.side === "buy" ? "BUY" : "SELL",
            price,
            qty,
            quoteQty: price * qty,
            fee: t.fee != null ? parseFloat(t.fee) : null,
            feeAsset: t.fee_currency ? normalizeAsset(t.fee_currency) : null,
            executedAt: new Date(parseInt(t.create_time_ms, 10)).toISOString(),
          });
        }
      }
    });
    return all;
  },

  async fetchOrders(creds, query: TradesQuery): Promise<OrderRow[]> {
    let pairs = (query.symbols ?? []).map((s) => s.toUpperCase());
    if (pairs.length === 0) {
      const spot = await this.fetchSpot(creds);
      pairs = derivePairs(spot.map((s) => s.asset));
    }
    const valid = await fetchGateValidPairs();
    if (valid.size > 0) pairs = pairs.filter((p) => valid.has(p));

    const endMs = query.endTimeMs ?? Date.now();
    const startMs = query.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, HISTORY_WINDOW_MS);

    const all: OrderRow[] = [];
    const seen = new Set<string>();
    await mapWithConcurrency(pairs, 6, async (pair) => {
      for (const w of windows) {
        let orders: GateOrder[];
        try {
          orders = await signedGet<GateOrder[]>(
            "/spot/orders",
            {
              currency_pair: pair,
              status: "finished",
              from: Math.floor(w.startMs / 1000),
              to: Math.floor(w.endMs / 1000),
              limit: 100,
            },
            creds,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("INVALID_CURRENCY_PAIR")) return;
          continue;
        }
        if (!Array.isArray(orders)) continue;
        for (const o of orders) {
          const id = `${pair}:${o.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const { base, quote } = splitPair(pair);
          const filled = o.filled_total != null ? parseFloat(o.filled_total) : null;
          const amount = o.amount != null ? parseFloat(o.amount) : null;
          all.push({
            orderId: id,
            symbol: pair,
            baseAsset: base,
            quoteAsset: quote,
            side: (o.side ?? "buy").toUpperCase() as "BUY" | "SELL",
            type: o.type ?? null,
            status: o.status ?? null,
            price: o.price != null ? parseFloat(o.price) : null,
            origQty: amount,
            executedQty: filled != null && o.fill_price ? filled / parseFloat(o.fill_price) : null,
            quoteQty: filled,
            placedAt: new Date(parseInt(o.create_time, 10) * 1000).toISOString(),
            updatedAt: o.update_time
              ? new Date(parseInt(o.update_time, 10) * 1000).toISOString()
              : null,
          });
        }
      }
    });
    return all;
  },

  async fetchDeposits(creds, query?: TransfersQuery): Promise<DepositRow[]> {
    const endMs = query?.endTimeMs ?? Date.now();
    const startMs = query?.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, HISTORY_WINDOW_MS);

    const seen = new Set<string>();
    const all: DepositRow[] = [];
    for (const w of windows) {
      // Gate caps `limit` at 100 — paginate with offset until empty.
      let offset = 0;
      while (true) {
        const raw = await signedGet<GateDeposit[]>(
          "/wallet/deposits",
          {
            from: Math.floor(w.startMs / 1000),
            to: Math.floor(w.endMs / 1000),
            limit: 100,
            offset,
          },
          creds,
        );
        if (!Array.isArray(raw) || raw.length === 0) break;
        for (const d of raw) {
          const id = d.id ?? d.txid ?? `${d.currency}:${d.timestamp}`;
          if (seen.has(id)) continue;
          seen.add(id);
          all.push({
            depositId: id,
            coin: normalizeAsset(d.currency),
            network: d.chain ?? null,
            amount: parseFloat(d.amount),
            address: d.address ?? null,
            txId: d.txid ?? null,
            status: transferStatus(d.status),
            occurredAt: new Date(parseInt(d.timestamp, 10) * 1000).toISOString(),
          });
        }
        if (raw.length < 100) break;
        offset += 100;
      }
    }
    return all;
  },

  async fetchWithdrawals(creds, query?: TransfersQuery): Promise<WithdrawalRow[]> {
    const endMs = query?.endTimeMs ?? Date.now();
    const startMs = query?.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, HISTORY_WINDOW_MS);

    const seen = new Set<string>();
    const all: WithdrawalRow[] = [];
    for (const w of windows) {
      let offset = 0;
      while (true) {
        const raw = await signedGet<GateWithdrawal[]>(
          "/wallet/withdrawals",
          {
            from: Math.floor(w.startMs / 1000),
            to: Math.floor(w.endMs / 1000),
            limit: 100,
            offset,
          },
          creds,
        );
        if (!Array.isArray(raw) || raw.length === 0) break;
        for (const wd of raw) {
          const id = wd.id ?? wd.txid ?? `${wd.currency}:${wd.timestamp}`;
          if (seen.has(id)) continue;
          seen.add(id);
          all.push({
            withdrawalId: id,
            coin: normalizeAsset(wd.currency),
            network: wd.chain ?? null,
            amount: parseFloat(wd.amount),
            fee: wd.fee != null ? parseFloat(wd.fee) : null,
            address: wd.address ?? null,
            txId: wd.txid ?? null,
            status: transferStatus(wd.status),
            occurredAt: new Date(parseInt(wd.timestamp, 10) * 1000).toISOString(),
          });
        }
        if (raw.length < 100) break;
        offset += 100;
      }
    }
    return all;
  },

  async fetchAssetPricesUsd(assets: string[]): Promise<Record<string, number>> {
    if (assets.length === 0) return {};
    const wanted = new Set(assets.map(normalizeAsset));
    const out: Record<string, number> = {};
    for (const a of wanted) {
      if (STABLE_USD_ASSETS.has(a)) out[a] = 1;
    }
    try {
      const tickerMap = await fetchGateUsdTickerMap();
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
};
