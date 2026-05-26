export interface SpotBalance {
  asset: string;
  amount: number;
}

export interface TradeRow {
  tradeId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  quoteQty: number;
  fee: number | null;
  feeAsset: string | null;
  executedAt: string;
}

export interface OrderRow {
  orderId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: "BUY" | "SELL";
  type: string | null;
  status: string | null;
  price: number | null;
  origQty: number | null;
  executedQty: number | null;
  quoteQty: number | null;
  placedAt: string;
  updatedAt: string | null;
}

export interface DepositRow {
  depositId: string;
  coin: string;
  network: string | null;
  amount: number;
  address: string | null;
  txId: string | null;
  status: "pending" | "success" | "failed" | string;
  occurredAt: string;
}

export interface WithdrawalRow {
  withdrawalId: string;
  coin: string;
  network: string | null;
  amount: number;
  fee: number | null;
  address: string | null;
  txId: string | null;
  status: "pending" | "success" | "failed" | string;
  occurredAt: string;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string | null;
}

export interface TradesQuery {
  /** Symbols to query. If empty, the adapter may infer them (e.g. from spot holdings). */
  symbols?: string[];
  /** Window start (ms epoch). Adapters that support history windows chunk to API limits. */
  startTimeMs?: number;
  /** Window end (ms epoch). Defaults to "now". */
  endTimeMs?: number;
}

export interface TransfersQuery {
  startTimeMs?: number;
  endTimeMs?: number;
}

export interface ExchangeAdapter {
  readonly provider: string;
  fetchSpot(creds: ExchangeCredentials): Promise<SpotBalance[]>;
  fetchTrades(creds: ExchangeCredentials, query: TradesQuery): Promise<TradeRow[]>;
  fetchOrders?(creds: ExchangeCredentials, query: TradesQuery): Promise<OrderRow[]>;
  fetchDeposits(creds: ExchangeCredentials, query?: TransfersQuery): Promise<DepositRow[]>;
  fetchWithdrawals(creds: ExchangeCredentials, query?: TransfersQuery): Promise<WithdrawalRow[]>;
  /**
   * Optional: resolve USD prices for arbitrary assets using the exchange's
   * own public ticker. Exchanges are authoritative for the tokens they list
   * (catches long-tail altcoins that CoinGecko/Alchemy may miss).
   * When credentials are passed, may use signed endpoints (e.g. MEXC's
   * dust-convert list) to value long-tail tokens with no direct USDT pair.
   * Returns map: UPPERCASED asset → USD price.
   */
  fetchAssetPricesUsd?(
    assets: string[],
    creds?: ExchangeCredentials,
  ): Promise<Record<string, number>>;
}

export type SyncKind = "spot" | "trades" | "orders" | "deposits" | "withdrawals";
export const ALL_SYNC_KINDS: SyncKind[] = [
  "spot",
  "trades",
  "orders",
  "deposits",
  "withdrawals",
];
