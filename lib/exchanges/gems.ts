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
 * GEMS.trade adapter. The platform is a Peatio fork — open-source crypto
 * exchange engine. Auth is HMAC-SHA256:
 *
 *   nonce       = Date.now()  (ms, as string)
 *   signature   = HMAC_SHA256(apiSecret, nonce + apiKey).hex
 *   Headers     = { X-Auth-Apikey, X-Auth-Nonce, X-Auth-Signature }
 *
 * Markets use a concatenated lowercase id ("btcusdt") with `base_unit` /
 * `quote_unit` fields exposed by the public markets endpoint, which we
 * use to split symbols cleanly even for awkward bases like "1inch".
 */
const BASE = "https://www.gems.trade";
const PEATIO = "/api/v2/peatio";

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

function authHeaders({ apiKey, apiSecret }: ExchangeCredentials): Record<string, string> {
  if (!apiKey || !apiSecret) throw new Error("Missing GEMS credentials");
  const nonce = Date.now().toString();
  const sig = createHmac("sha256", apiSecret).update(nonce + apiKey).digest("hex");
  return {
    "X-Auth-Apikey": apiKey,
    "X-Auth-Nonce": nonce,
    "X-Auth-Signature": sig,
    Accept: "application/json",
  };
}

async function signedGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  creds: ExchangeCredentials,
): Promise<T> {
  const qs = buildQuery(params);
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: authHeaders(creds) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GEMS ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`GEMS ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

interface GemsBalance {
  currency: string;
  balance: string;
  locked: string;
  /** Already-computed USD value per unit, when available. */
  currency_usdt?: string;
}

interface GemsMarket {
  id: string;
  base_unit: string;
  quote_unit: string;
  state: string;
  trading_enabled: boolean;
}

interface GemsTrade {
  id: number;
  market: string;
  price: string;
  amount: string;
  total: string;
  side: "buy" | "sell";
  fee?: string;
  fee_currency?: string;
  created_at: string;
  order_id: number;
}

interface GemsOrder {
  id: number;
  market: string;
  side: "buy" | "sell";
  ord_type: string;
  state: string;
  price?: string;
  avg_price?: string;
  origin_volume: string;
  executed_volume: string;
  remaining_volume?: string;
  created_at: string;
  updated_at?: string;
}

interface GemsDeposit {
  id: number;
  currency: string;
  amount: string;
  address?: string;
  txid?: string | null;
  state: string;
  blockchain_key?: string | null;
  protocol?: string | null;
  created_at: string;
}

interface GemsWithdrawal {
  id: number;
  currency: string;
  amount: string;
  fee?: string;
  rid?: string;
  txid?: string | null;
  state: string;
  blockchain_key?: string | null;
  created_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Peatio max limit per page is 100. Default lookback in queries is 90 days.
// Trades/orders endpoints accept time_from/time_to in Unix seconds.
const HISTORY_WINDOW_MS = 30 * DAY_MS;

const DEFAULT_QUOTES = ["usdt", "usdc", "btc", "eth"];
const STABLE_OR_BASE = new Set(["usdt", "usdc", "usd", "busd", "fdusd", "tusd"]);
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

let cachedMarkets: { fetched: number; markets: GemsMarket[] } | null = null;
const MARKETS_TTL_MS = 5 * 60 * 1000;

async function fetchMarkets(): Promise<GemsMarket[]> {
  if (cachedMarkets && Date.now() - cachedMarkets.fetched < MARKETS_TTL_MS) {
    return cachedMarkets.markets;
  }
  const res = await fetch(`${BASE}${PEATIO}/public/markets?limit=1000`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) return cachedMarkets?.markets ?? [];
  const arr = (await res.json()) as GemsMarket[];
  if (!Array.isArray(arr)) return cachedMarkets?.markets ?? [];
  cachedMarkets = { fetched: Date.now(), markets: arr };
  return arr;
}

async function fetchMarketsById(): Promise<Map<string, GemsMarket>> {
  const arr = await fetchMarkets();
  const map = new Map<string, GemsMarket>();
  for (const m of arr) {
    if (m.id && m.state === "enabled") map.set(m.id, m);
  }
  return map;
}

function deriveCandidatePairs(baseAssets: string[]): string[] {
  const bases = Array.from(new Set(baseAssets.map((a) => a.toLowerCase())));
  const pairs = new Set<string>();
  for (const base of bases) {
    if (STABLE_OR_BASE.has(base)) continue;
    for (const quote of DEFAULT_QUOTES) {
      if (quote !== base) pairs.add(`${base}${quote}`);
    }
  }
  return Array.from(pairs);
}

/**
 * Peatio deposit/withdrawal state strings vary slightly by deployment but
 * the common terminal codes are stable enough to map directly.
 */
function transferStatus(s: string): "success" | "failed" | "pending" {
  const u = (s ?? "").toLowerCase();
  if (u === "collected" || u === "accepted" || u === "succeed" || u === "success" || u === "confirmed")
    return "success";
  if (u === "rejected" || u === "canceled" || u === "failed" || u === "errored") return "failed";
  return "pending";
}

export const gemsAdapter: ExchangeAdapter = {
  provider: "gems",

  async fetchSpot(creds): Promise<SpotBalance[]> {
    const json = await signedGet<GemsBalance[]>(`${PEATIO}/account/balances`, {}, creds);
    if (!Array.isArray(json)) return [];
    return json
      .map((b) => ({
        asset: normalizeAsset(b.currency),
        amount: parseFloat(b.balance) + parseFloat(b.locked),
      }))
      .filter((b) => b.amount > 0);
  },

  async fetchTrades(creds, query: TradesQuery): Promise<TradeRow[]> {
    const marketsById = await fetchMarketsById();
    let pairs: string[];
    if (query.symbols && query.symbols.length > 0) {
      // Accept either lowercase concat ("btcusdt") or our internal uppercase
      // ("BTC_USDT"/"BTCUSDT") — normalize to GEMS's lowercase id form.
      pairs = query.symbols
        .map((s) => s.replace(/_/g, "").toLowerCase())
        .filter((s) => marketsById.has(s));
    } else {
      const spot = await this.fetchSpot(creds);
      pairs = deriveCandidatePairs(spot.map((s) => s.asset)).filter((p) => marketsById.has(p));
    }

    const endMs = query.endTimeMs ?? Date.now();
    const startMs = query.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, HISTORY_WINDOW_MS);

    const all: TradeRow[] = [];
    const seen = new Set<string>();
    await mapWithConcurrency(pairs, 6, async (pair) => {
      const market = marketsById.get(pair);
      if (!market) return;
      for (const w of windows) {
        let trades: GemsTrade[];
        try {
          trades = await signedGet<GemsTrade[]>(
            `${PEATIO}/market/trades`,
            {
              market: pair,
              time_from: Math.floor(w.startMs / 1000),
              time_to: Math.floor(w.endMs / 1000),
              limit: 100,
            },
            creds,
          );
        } catch {
          continue;
        }
        if (!Array.isArray(trades)) continue;
        for (const t of trades) {
          const id = `${pair}:${t.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const price = parseFloat(t.price);
          const qty = parseFloat(t.amount);
          all.push({
            tradeId: id,
            symbol: pair.toUpperCase(),
            baseAsset: normalizeAsset(market.base_unit),
            quoteAsset: normalizeAsset(market.quote_unit),
            side: t.side === "buy" ? "BUY" : "SELL",
            price,
            qty,
            quoteQty: parseFloat(t.total),
            fee: t.fee != null ? parseFloat(t.fee) : null,
            feeAsset: t.fee_currency ? normalizeAsset(t.fee_currency) : null,
            executedAt: new Date(t.created_at).toISOString(),
          });
        }
      }
    });
    return all;
  },

  async fetchOrders(creds, query: TradesQuery): Promise<OrderRow[]> {
    const marketsById = await fetchMarketsById();
    let pairs: string[];
    if (query.symbols && query.symbols.length > 0) {
      pairs = query.symbols
        .map((s) => s.replace(/_/g, "").toLowerCase())
        .filter((s) => marketsById.has(s));
    } else {
      const spot = await this.fetchSpot(creds);
      pairs = deriveCandidatePairs(spot.map((s) => s.asset)).filter((p) => marketsById.has(p));
    }

    const endMs = query.endTimeMs ?? Date.now();
    const startMs = query.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, HISTORY_WINDOW_MS);

    const all: OrderRow[] = [];
    const seen = new Set<string>();
    await mapWithConcurrency(pairs, 6, async (pair) => {
      const market = marketsById.get(pair);
      if (!market) return;
      for (const w of windows) {
        let orders: GemsOrder[];
        try {
          orders = await signedGet<GemsOrder[]>(
            `${PEATIO}/market/orders`,
            {
              market: pair,
              state: "done",
              time_from: Math.floor(w.startMs / 1000),
              time_to: Math.floor(w.endMs / 1000),
              limit: 100,
            },
            creds,
          );
        } catch {
          continue;
        }
        if (!Array.isArray(orders)) continue;
        for (const o of orders) {
          const id = `${pair}:${o.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const executed = parseFloat(o.executed_volume);
          const avg = o.avg_price != null ? parseFloat(o.avg_price) : null;
          all.push({
            orderId: id,
            symbol: pair.toUpperCase(),
            baseAsset: normalizeAsset(market.base_unit),
            quoteAsset: normalizeAsset(market.quote_unit),
            side: o.side === "buy" ? "BUY" : "SELL",
            type: o.ord_type ?? null,
            status: o.state ?? null,
            price: o.price != null ? parseFloat(o.price) : null,
            origQty: parseFloat(o.origin_volume),
            executedQty: executed,
            quoteQty: avg != null ? executed * avg : null,
            placedAt: new Date(o.created_at).toISOString(),
            updatedAt: o.updated_at ? new Date(o.updated_at).toISOString() : null,
          });
        }
      }
    });
    return all;
  },

  async fetchDeposits(creds, query?: TransfersQuery): Promise<DepositRow[]> {
    const endMs = query?.endTimeMs ?? Date.now();
    const startMs = query?.startTimeMs ?? endMs - 90 * DAY_MS;
    const seen = new Set<string>();
    const all: DepositRow[] = [];
    // Peatio paginates with page/limit. Walk pages until empty.
    for (let page = 1; page <= 50; page++) {
      const raw = await signedGet<GemsDeposit[]>(
        `${PEATIO}/account/deposits`,
        {
          time_from: Math.floor(startMs / 1000),
          time_to: Math.floor(endMs / 1000),
          limit: 100,
          page,
        },
        creds,
      );
      if (!Array.isArray(raw) || raw.length === 0) break;
      for (const d of raw) {
        const id = String(d.id);
        if (seen.has(id)) continue;
        seen.add(id);
        all.push({
          depositId: id,
          coin: normalizeAsset(d.currency),
          network: d.blockchain_key ?? d.protocol ?? null,
          amount: parseFloat(d.amount),
          address: d.address ?? null,
          txId: d.txid ?? null,
          status: transferStatus(d.state),
          occurredAt: new Date(d.created_at).toISOString(),
        });
      }
      if (raw.length < 100) break;
    }
    return all;
  },

  async fetchWithdrawals(creds, query?: TransfersQuery): Promise<WithdrawalRow[]> {
    const endMs = query?.endTimeMs ?? Date.now();
    const startMs = query?.startTimeMs ?? endMs - 90 * DAY_MS;
    const seen = new Set<string>();
    const all: WithdrawalRow[] = [];
    for (let page = 1; page <= 50; page++) {
      let raw: GemsWithdrawal[];
      try {
        raw = await signedGet<GemsWithdrawal[]>(
          `${PEATIO}/account/withdraws`,
          {
            time_from: Math.floor(startMs / 1000),
            time_to: Math.floor(endMs / 1000),
            limit: 100,
            page,
          },
          creds,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Peatio rejects without the `withdraw` API scope. The user does
        // not have to grant withdraw-history read to use the other kinds —
        // surface as an empty list rather than failing the whole refresh.
        if (msg.includes("authz.api_key_withdraw_not_allowed")) {
          return [];
        }
        throw e;
      }
      if (!Array.isArray(raw) || raw.length === 0) break;
      for (const w of raw) {
        const id = String(w.id);
        if (seen.has(id)) continue;
        seen.add(id);
        all.push({
          withdrawalId: id,
          coin: normalizeAsset(w.currency),
          network: w.blockchain_key ?? null,
          amount: parseFloat(w.amount),
          fee: w.fee != null ? parseFloat(w.fee) : null,
          address: w.rid ?? null,
          txId: w.txid ?? null,
          status: transferStatus(w.state),
          occurredAt: new Date(w.created_at).toISOString(),
        });
      }
      if (raw.length < 100) break;
    }
    return all;
  },

  async fetchAssetPricesUsd(
    assets: string[],
    creds?: ExchangeCredentials,
  ): Promise<Record<string, number>> {
    if (assets.length === 0) return {};
    const wanted = new Set(assets.map(normalizeAsset));
    const out: Record<string, number> = {};
    for (const a of wanted) {
      if (STABLE_USD_ASSETS.has(a)) out[a] = 1;
    }
    // The balances endpoint already ships a `currency_usdt` per-unit
    // valuation when the user has any balance in that currency. That is
    // by far the most reliable price source for GEMS-specific tokens
    // (handpicked altcoins that often have no upstream CoinGecko/Alchemy
    // entry). Use it when we have signed creds.
    if (creds && creds.apiKey && creds.apiSecret) {
      try {
        const balances = await signedGet<GemsBalance[]>(
          `${PEATIO}/account/balances`,
          {},
          creds,
        );
        if (Array.isArray(balances)) {
          for (const b of balances) {
            const sym = normalizeAsset(b.currency);
            if (out[sym] != null) continue;
            if (!wanted.has(sym)) continue;
            const amount = parseFloat(b.balance);
            const usdt = b.currency_usdt != null ? parseFloat(b.currency_usdt) : NaN;
            if (Number.isFinite(amount) && amount > 0 && Number.isFinite(usdt) && usdt > 0) {
              const px = usdt / amount;
              if (px > 0 && px < 1_000_000) out[sym] = px;
            }
          }
        }
      } catch {
        // non-fatal
      }
    }
    return out;
  },
};
