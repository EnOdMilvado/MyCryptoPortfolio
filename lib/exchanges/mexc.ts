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
 * MEXC v3 REST API adapter. Signature scheme matches Binance: HMAC-SHA256 over
 * the query string, signed with the API secret, header X-MEXC-APIKEY.
 *
 * Docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
 */
const BASE = "https://api.mexc.com";

// MEXC asset code rewrites — exchanges sometimes prefix wrapped tokens.
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
  path: string,
  params: Record<string, string | number | undefined>,
  { apiKey, apiSecret }: ExchangeCredentials,
): Promise<T> {
  if (!apiKey || !apiSecret) throw new Error("Missing MEXC credentials");
  const withTs = {
    ...params,
    recvWindow: 10000,
    timestamp: Date.now(),
  };
  const qs = buildQuery(withTs);
  const sig = createHmac("sha256", apiSecret).update(qs).digest("hex");
  const url = `${BASE}${path}?${qs}&signature=${sig}`;
  const res = await fetch(url, { headers: { "X-MEXC-APIKEY": apiKey } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MEXC ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`MEXC ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

interface MexcAccount {
  balances: { asset: string; free: string; locked: string }[];
}

interface MexcTrade {
  id: number | string;
  orderId?: string;
  symbol: string;
  price: string;
  qty: string;
  quoteQty?: string;
  commission?: string;
  commissionAsset?: string;
  time: number;
  isBuyer: boolean;
}

interface MexcOrder {
  symbol: string;
  orderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
  time: number;
  updateTime?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TRADE_WINDOW_MS = 30 * DAY_MS; // MEXC limit per myTrades / allOrders request

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

interface MexcDeposit {
  id?: string;
  txId?: string;
  coin: string;
  network?: string;
  amount: string;
  address?: string;
  status: number | string;
  insertTime: number;
}

interface MexcWithdrawal {
  id?: string;
  txId?: string;
  coin: string;
  network?: string;
  amount: string;
  transactionFee?: string;
  address?: string;
  status: number | string;
  applyTime?: number | string;
  createTime?: number | string;
}

/**
 * MEXC trade endpoint requires a symbol. We need to discover plausible pairs
 * given an asset list. Default quote assets are USDT/USDC/BTC/ETH/USD.
 */
const DEFAULT_QUOTES = ["USDT", "USDC", "BTC", "ETH"];
const STABLE_OR_BASE = new Set(["USDT", "USDC", "USD", "BUSD", "FDUSD", "TUSD"]);

function deriveSymbols(baseAssets: string[]): string[] {
  const bases = Array.from(new Set(baseAssets.map(normalizeAsset)));
  const symbols = new Set<string>();
  for (const base of bases) {
    if (STABLE_OR_BASE.has(base)) continue;
    for (const quote of DEFAULT_QUOTES) {
      if (quote !== base) symbols.add(`${base}${quote}`);
    }
  }
  return Array.from(symbols);
}

function depositStatus(s: number | string): string {
  // MEXC: 1=small,2=time-delay,3=large-delay,4=pending,5=credited but cannot withdraw,6=success
  const n = typeof s === "number" ? s : parseInt(s, 10);
  if (n === 6 || n === 5) return "success";
  if (n === 7 || n === 8) return "failed";
  return "pending";
}

const STABLE_USD_ASSETS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USD"]);

interface MexcTicker {
  symbol: string;
  price: string;
}

/**
 * Fetches every MEXC spot ticker once (`/api/v3/ticker/price` is a public
 * endpoint that returns thousands of pairs in one shot). Builds USD prices
 * by checking USDT and USDC quote pairs in that order.
 */
async function fetchMexcUsdTickerMap(): Promise<Record<string, number>> {
  const res = await fetch("https://api.mexc.com/api/v3/ticker/price", {
    next: { revalidate: 30 },
  });
  if (!res.ok) return {};
  const arr = (await res.json()) as MexcTicker[];
  if (!Array.isArray(arr)) return {};

  // Build maps per quote so we can prefer USDT over USDC.
  const byUsdt: Record<string, number> = {};
  const byUsdc: Record<string, number> = {};
  for (const t of arr) {
    const sym = (t.symbol ?? "").toUpperCase();
    const px = parseFloat(t.price);
    if (!sym || !Number.isFinite(px) || px <= 0) continue;
    if (sym.endsWith("USDT")) byUsdt[sym.slice(0, -4)] = px;
    else if (sym.endsWith("USDC")) byUsdc[sym.slice(0, -4)] = px;
  }
  const out: Record<string, number> = {};
  for (const base of Object.keys(byUsdt)) out[base] = byUsdt[base];
  for (const base of Object.keys(byUsdc)) {
    if (out[base] == null) out[base] = byUsdc[base];
  }
  return out;
}

interface MexcConvertItem {
  asset: string;
  balance: string;
  convertUsdt?: string;
  convertMx?: string;
}

/**
 * Signed dust-convert list. Returns USDT valuation for every small asset
 * MEXC will convert into MX — this covers long-tail tokens (BRC20COM, etc.)
 * that have no direct USDT/USDC pair in ticker/price.
 *
 * Per-unit price is derived as convertUsdt / balance.
 */
async function fetchMexcConvertUsdMap(
  creds: ExchangeCredentials,
): Promise<Record<string, number>> {
  const arr = await signedGet<MexcConvertItem[]>(
    "/api/v3/capital/convert/list",
    {},
    creds,
  );
  if (!Array.isArray(arr)) return {};
  const out: Record<string, number> = {};
  for (const item of arr) {
    const sym = (item.asset ?? "").toUpperCase();
    const balance = parseFloat(item.balance);
    const usdt = item.convertUsdt != null ? parseFloat(item.convertUsdt) : NaN;
    if (!sym || !Number.isFinite(balance) || balance <= 0) continue;
    if (!Number.isFinite(usdt) || usdt <= 0) continue;
    const px = usdt / balance;
    if (px > 0 && px < 1_000_000) out[sym] = px;
  }
  return out;
}

function withdrawalStatus(s: number | string): string {
  // MEXC: 1=apply,2=auditing,3=wait,4=processing,5=wait_packaging,6=wait_confirm,7=success,8=failed,9=cancel,10=manual
  const n = typeof s === "number" ? s : parseInt(s, 10);
  if (n === 7) return "success";
  if (n === 8 || n === 9) return "failed";
  return "pending";
}

export const mexcAdapter: ExchangeAdapter = {
  provider: "mexc",

  async fetchSpot(creds): Promise<SpotBalance[]> {
    const json = await signedGet<MexcAccount>("/api/v3/account", {}, creds);
    return (json.balances ?? [])
      .map((b) => ({
        asset: normalizeAsset(b.asset),
        amount: parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter((b) => b.amount > 0);
  },

  async fetchTrades(creds, query: TradesQuery): Promise<TradeRow[]> {
    let symbols = (query.symbols ?? []).map(normalizeAsset);
    if (symbols.length === 0) {
      const spot = await this.fetchSpot(creds);
      symbols = deriveSymbols(spot.map((s) => s.asset));
    }

    const endMs = query.endTimeMs ?? Date.now();
    const startMs = query.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, TRADE_WINDOW_MS);

    const all: TradeRow[] = [];
    const seen = new Set<string>();
    for (const symbol of symbols) {
      for (const w of windows) {
        let trades: MexcTrade[];
        try {
          trades = await signedGet<MexcTrade[]>(
            "/api/v3/myTrades",
            { symbol, limit: 1000, startTime: w.startMs, endTime: w.endMs },
            creds,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("-1121") || msg.includes("Invalid symbol")) break; // skip whole symbol
          continue; // try next window
        }
        if (!Array.isArray(trades)) continue;
        for (const t of trades) {
          const id = `${symbol}:${t.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const split = splitSymbol(symbol);
          const price = parseFloat(t.price);
          const qty = parseFloat(t.qty);
          const quoteQty = t.quoteQty != null ? parseFloat(t.quoteQty) : price * qty;
          all.push({
            tradeId: id,
            symbol,
            baseAsset: split.base,
            quoteAsset: split.quote,
            side: t.isBuyer ? "BUY" : "SELL",
            price,
            qty,
            quoteQty,
            fee: t.commission != null ? parseFloat(t.commission) : null,
            feeAsset: t.commissionAsset ?? null,
            executedAt: new Date(t.time).toISOString(),
          });
        }
      }
    }
    return all;
  },

  async fetchOrders(creds, query: TradesQuery): Promise<OrderRow[]> {
    let symbols = (query.symbols ?? []).map(normalizeAsset);
    if (symbols.length === 0) {
      const spot = await this.fetchSpot(creds);
      symbols = deriveSymbols(spot.map((s) => s.asset));
    }

    const endMs = query.endTimeMs ?? Date.now();
    const startMs = query.startTimeMs ?? endMs - 90 * DAY_MS;
    const windows = chunkTimeWindows(startMs, endMs, TRADE_WINDOW_MS);

    const all: OrderRow[] = [];
    const seen = new Set<string>();
    for (const symbol of symbols) {
      for (const w of windows) {
        let orders: MexcOrder[];
        try {
          orders = await signedGet<MexcOrder[]>(
            "/api/v3/allOrders",
            { symbol, limit: 1000, startTime: w.startMs, endTime: w.endMs },
            creds,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("-1121") || msg.includes("Invalid symbol")) break;
          continue;
        }
        if (!Array.isArray(orders)) continue;
        for (const o of orders) {
          const id = `${symbol}:${o.orderId}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const split = splitSymbol(symbol);
          all.push({
            orderId: id,
            symbol,
            baseAsset: split.base,
            quoteAsset: split.quote,
            side: (o.side ?? "BUY").toUpperCase() as "BUY" | "SELL",
            type: o.type ?? null,
            status: o.status ?? null,
            price: o.price != null ? parseFloat(o.price) : null,
            origQty: o.origQty != null ? parseFloat(o.origQty) : null,
            executedQty: o.executedQty != null ? parseFloat(o.executedQty) : null,
            quoteQty: o.cummulativeQuoteQty != null ? parseFloat(o.cummulativeQuoteQty) : null,
            placedAt: new Date(o.time).toISOString(),
            updatedAt: o.updateTime != null ? new Date(o.updateTime).toISOString() : null,
          });
        }
      }
    }
    return all;
  },

  async fetchDeposits(creds, query?: TransfersQuery): Promise<DepositRow[]> {
    const endMs = query?.endTimeMs ?? Date.now();
    const startMs = query?.startTimeMs ?? endMs - 90 * DAY_MS;
    const raw = await signedGet<MexcDeposit[]>(
      "/api/v3/capital/deposit/hisrec",
      { startTime: startMs, endTime: endMs },
      creds,
    );
    if (!Array.isArray(raw)) return [];
    return raw.map((d, idx) => ({
      depositId: d.id ?? d.txId ?? `${d.coin}:${d.insertTime}:${idx}`,
      coin: normalizeAsset(d.coin),
      network: d.network ?? null,
      amount: parseFloat(d.amount),
      address: d.address ?? null,
      txId: d.txId ?? null,
      status: depositStatus(d.status),
      occurredAt: new Date(d.insertTime).toISOString(),
    }));
  },

  async fetchAssetPricesUsd(
    assets: string[],
    creds?: ExchangeCredentials,
  ): Promise<Record<string, number>> {
    if (assets.length === 0) return {};
    const wanted = new Set(assets.map(normalizeAsset));
    const out: Record<string, number> = {};

    // 1) Stablecoins always = $1
    for (const a of wanted) {
      if (STABLE_USD_ASSETS.has(a)) out[a] = 1;
    }

    // 2) Public spot ticker — covers all currently listed pairs vs USDT/USDC.
    try {
      const tickerMap = await fetchMexcUsdTickerMap();
      for (const a of wanted) {
        if (out[a] != null) continue;
        const px = tickerMap[a];
        if (px != null) out[a] = px;
      }
    } catch {
      // Non-fatal — continue to the next tier.
    }

    // 3) Signed dust-convert list — catches long-tail tokens that aren't
    //    traded directly (BRC20COM, NOTHINGOLD, …) but still hold a USDT
    //    valuation MEXC computes internally.
    const stillMissing = Array.from(wanted).filter((a) => out[a] == null);
    if (stillMissing.length > 0 && creds && creds.apiKey && creds.apiSecret) {
      try {
        const convertMap = await fetchMexcConvertUsdMap(creds);
        for (const a of stillMissing) {
          const px = convertMap[a];
          if (px != null) out[a] = px;
        }
      } catch {
        // Non-fatal.
      }
    }
    return out;
  },

  async fetchWithdrawals(creds, query?: TransfersQuery): Promise<WithdrawalRow[]> {
    const endMs = query?.endTimeMs ?? Date.now();
    const startMs = query?.startTimeMs ?? endMs - 90 * DAY_MS;
    const raw = await signedGet<MexcWithdrawal[]>(
      "/api/v3/capital/withdraw/history",
      { startTime: startMs, endTime: endMs },
      creds,
    );
    if (!Array.isArray(raw)) return [];
    return raw.map((w, idx) => {
      const ts = w.applyTime ?? w.createTime ?? Date.now();
      const tsMs = typeof ts === "number" ? ts : Date.parse(String(ts));
      return {
        withdrawalId: w.id ?? w.txId ?? `${w.coin}:${ts}:${idx}`,
        coin: normalizeAsset(w.coin),
        network: w.network ?? null,
        amount: parseFloat(w.amount),
        fee: w.transactionFee != null ? parseFloat(w.transactionFee) : null,
        address: w.address ?? null,
        txId: w.txId ?? null,
        status: withdrawalStatus(w.status),
        occurredAt: new Date(tsMs).toISOString(),
      };
    });
  },
};

function splitSymbol(symbol: string): { base: string; quote: string } {
  for (const q of DEFAULT_QUOTES) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      return { base: symbol.slice(0, -q.length), quote: q };
    }
  }
  return { base: symbol, quote: "" };
}
