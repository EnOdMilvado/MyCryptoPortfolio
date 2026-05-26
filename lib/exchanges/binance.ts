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
} from "./types";

/**
 * Binance v3 API adapter. Spot balances implemented; trades / deposits /
 * withdrawals are not yet wired and return empty arrays.
 *
 * Docs: https://binance-docs.github.io/apidocs/spot/en/
 */
export const binanceAdapter: ExchangeAdapter = {
  provider: "binance",

  async fetchSpot({ apiKey, apiSecret }: ExchangeCredentials): Promise<SpotBalance[]> {
    if (!apiKey || !apiSecret) throw new Error("Missing Binance credentials");
    const ts = Date.now();
    const recvWindow = 10000;
    const qs = `timestamp=${ts}&recvWindow=${recvWindow}`;
    const sig = createHmac("sha256", apiSecret).update(qs).digest("hex");
    const url = `https://api.binance.com/api/v3/account?${qs}&signature=${sig}`;
    const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Binance API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      balances: { asset: string; free: string; locked: string }[];
    };
    return (json.balances ?? [])
      .map((b) => ({
        asset: b.asset,
        amount: parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter((b) => b.amount > 0);
  },

  async fetchTrades(_creds: ExchangeCredentials, _query: TradesQuery): Promise<TradeRow[]> {
    return [];
  },

  async fetchOrders(_creds: ExchangeCredentials, _query: TradesQuery): Promise<OrderRow[]> {
    return [];
  },

  async fetchDeposits(_creds: ExchangeCredentials): Promise<DepositRow[]> {
    return [];
  },

  async fetchWithdrawals(_creds: ExchangeCredentials): Promise<WithdrawalRow[]> {
    return [];
  },
};

/** @deprecated Use binanceAdapter.fetchSpot — kept for callers not yet migrated. */
export async function fetchBinanceBalances(
  apiKey: string,
  apiSecret: string,
): Promise<SpotBalance[]> {
  return binanceAdapter.fetchSpot({ apiKey, apiSecret, apiPassphrase: null });
}
