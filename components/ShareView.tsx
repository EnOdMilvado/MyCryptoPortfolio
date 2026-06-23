"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { TransactionsTable } from "./TransactionsTable";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ChainPill } from "./ChainPill";
import { CopyButton } from "./CopyButton";
import { UsdValue } from "./MaskedValue";
import { CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import type { Transaction } from "@/lib/chains/transactions/types";
import { formatRelative, shortenAddress } from "@/lib/format";

/* -------------------------------- types -------------------------------- */

interface ShareHolding {
  chain: string;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
  priceChange24h: number | null;
}
interface ShareWallet {
  id: string;
  name: string;
  address: string;
  chainType: string;
  portfolioName: string;
  holdings: ShareHolding[];
}
interface ShareExchange {
  id: string;
  provider: string;
  label: string;
  lastSyncedAt: string | null;
  balances: {
    asset: string;
    amount: number;
    priceUsd: number | null;
    valueUsd: number;
    priceChange24h: number | null;
  }[];
  trades: Record<string, unknown>[];
  deposits: Record<string, unknown>[];
  withdrawals: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}
interface ShareOffchain {
  id: string;
  label: string;
  kind: string;
  currency: string;
  amount: number;
}
export interface ShareData {
  owner: { displayName: string | null } | null;
  wallets: ShareWallet[];
  exchanges: ShareExchange[];
  offchain: ShareOffchain[];
}

/* ------------------------------ utilities ------------------------------ */

function walletHoldingRows(w: ShareWallet): HoldingRow[] {
  return w.holdings.map((h) => ({
    walletId: w.id,
    walletName: w.name,
    walletAddress: w.address,
    portfolioName: w.portfolioName,
    chain: h.chain as ChainId,
    contract: h.contract,
    symbol: h.symbol,
    name: h.name,
    amount: h.amount,
    priceUsd: h.priceUsd,
    valueUsd: h.valueUsd,
    priceChange24h: h.priceChange24h,
  }));
}

function exchangeHoldingRows(ex: ShareExchange): HoldingRow[] {
  return ex.balances.map((b) => ({
    walletId: `exchange:${ex.id}`,
    walletName: ex.label,
    walletAddress: "",
    portfolioName: ex.provider.toUpperCase(),
    chain: "exchange" as ChainId,
    contract: `${ex.id}:${b.asset.toUpperCase()}`,
    symbol: b.asset,
    name: b.asset,
    amount: b.amount,
    priceUsd: b.priceUsd,
    valueUsd: b.valueUsd,
    priceChange24h: b.priceChange24h,
    exchangeId: ex.id,
  }));
}

const KIND_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  credit_card: "Credit card",
  brokerage: "Brokerage",
  other: "Other",
};

/** Default tax-year window for transaction exports. */
const TX_FROM = "2025-01-01";
const TX_TO = "2025-12-31";

function inTaxYear(t: Transaction): boolean {
  if (!t.timestamp) return true; // keep undated rows rather than dropping them
  const ts = new Date(t.timestamp).getTime();
  return (
    ts >= Date.parse(`${TX_FROM}T00:00:00Z`) &&
    ts <= Date.parse(`${TX_TO}T23:59:59Z`)
  );
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_") || "wallet";
}

/** Build a CSV client-side and trigger a download (UTF-8 BOM for Excel). */
function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: { header: string; value: (r: T) => string | number | null }[],
): void {
  const esc = (v: string) =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const r of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = c.value(r);
          return v == null ? "" : esc(String(v));
        })
        .join(","),
    );
  }
  const blob = new Blob(["﻿", lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------- main view ------------------------------ */

export function ShareView({ token, data }: { token: string; data: ShareData }) {
  const walletsUsd = data.wallets.reduce(
    (s, w) => s + w.holdings.reduce((a, h) => a + h.valueUsd, 0),
    0,
  );
  const exchangesUsd = data.exchanges.reduce(
    (s, e) => s + e.balances.reduce((a, b) => a + b.valueUsd, 0),
    0,
  );
  const offchainUsd = data.offchain.reduce((s, o) => s + o.amount, 0);
  const grandUsd = walletsUsd + exchangesUsd + offchainUsd;

  return (
    <div className="space-y-6">
      <header className="card p-5 sm:p-6">
        <p className="text-sm font-semibold text-text-muted">
          Shared portfolio · read-only
        </p>
        {data.owner?.displayName && (
          <p className="text-xs text-text-muted/80 mt-0.5">
            Shared by {data.owner.displayName}
          </p>
        )}
        <UsdValue
          value={grandUsd}
          priceUsd={1}
          className="mt-2 block text-3xl sm:text-4xl font-extrabold tabular text-text break-all"
        />
        <p className="text-xs text-text-muted mt-2">
          Tax-included items only · {data.wallets.length} wallets ·{" "}
          {data.exchanges.length} exchanges · {data.offchain.length} off-chain
        </p>
      </header>

      {data.wallets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
            Wallets
          </h2>
          <ul className="space-y-3">
            {data.wallets.map((w) => (
              <ShareWalletItem key={w.id} wallet={w} token={token} />
            ))}
          </ul>
        </section>
      )}

      {data.exchanges.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
            Exchanges
          </h2>
          <ul className="space-y-3">
            {data.exchanges.map((ex) => (
              <ShareExchangeItem key={ex.id} exchange={ex} />
            ))}
          </ul>
        </section>
      )}

      {data.offchain.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
            Off-chain
          </h2>
          <ul className="space-y-2">
            {data.offchain.map((o) => (
              <li
                key={o.id}
                className="card-tight flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-text truncate">
                    {o.label}
                  </span>
                  <span className="pill">{KIND_LABEL[o.kind] ?? o.kind}</span>
                  <span className="text-xs text-text-muted">{o.currency}</span>
                </div>
                <UsdValue
                  value={o.amount}
                  priceUsd={1}
                  className="font-semibold tabular shrink-0"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ----------------------------- wallet item ----------------------------- */

const CHAIN_TYPE_TO_CHAIN: Record<string, ChainId> = {
  btc: "bitcoin",
  evm: "ethereum",
  sol: "solana",
  ton: "ton",
  dot: "polkadot",
  theta: "theta",
};

function ShareWalletItem({
  wallet,
  token,
}: {
  wallet: ShareWallet;
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"holdings" | "transactions">("transactions");
  const rows = useMemo(() => walletHoldingRows(wallet), [wallet]);
  const totalUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
  const chainIcon = CHAIN_TYPE_TO_CHAIN[wallet.chainType] ?? "ethereum";

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [txLoaded, setTxLoaded] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const loadTx = useCallback(async (): Promise<Transaction[]> => {
    setTxLoading(true);
    setTxError(null);
    try {
      const res = await fetch("/api/share/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, walletId: wallet.id }),
      });
      const json = (await res.json()) as {
        transactions?: Transaction[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Load failed");
      const arr = json.transactions ?? [];
      setTxs(arr);
      setTxLoaded(true);
      return arr;
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Load failed");
      return [];
    } finally {
      setTxLoading(false);
    }
  }, [token, wallet.id]);

  const txInYear = useMemo(() => txs.filter(inTaxYear), [txs]);

  // One-click CSV: fetch on demand if not loaded yet, then download the
  // 2025-filtered set. The accountant never has to open the wallet first.
  async function downloadTx() {
    const arr = txLoaded ? txs : await loadTx();
    downloadCsv(
      `${safeName(wallet.name)}-transactions-2025`,
      arr.filter(inTaxYear),
      TX_CSV_COLUMNS,
    );
  }

  // Auto-load transactions the first time the wallet is opened on the tab.
  useEffect(() => {
    if (open && tab === "transactions" && !txLoaded && !txLoading) {
      void loadTx();
    }
  }, [open, tab, txLoaded, txLoading, loadTx]);

  return (
    <li className="card-tight overflow-hidden">
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-3 text-left min-w-0"
          aria-expanded={open}
        >
          <ChainPill chain={chainIcon} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-text truncate">
                {wallet.name}
              </span>
              <span className="text-[10px] text-text-muted/80 shrink-0">
                · {wallet.portfolioName}
              </span>
            </div>
            <div className="text-xs text-text-muted">
              {wallet.holdings.length} holdings
            </div>
          </div>
          <UsdValue
            value={totalUsd}
            priceUsd={1}
            className="text-base sm:text-lg font-extrabold tabular text-text shrink-0"
          />
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={downloadTx}
          disabled={txLoading}
          className="btn-ghost text-xs shrink-0 whitespace-nowrap"
          title="Download 2025 transactions as CSV"
        >
          {txLoading ? "…" : "⬇ CSV 2025"}
        </button>
      </div>

      {wallet.address && (
        <div className="mt-2 flex items-start gap-2">
          <span className="font-mono text-xs text-text-muted break-all min-w-0">
            {wallet.address}
          </span>
          <CopyButton
            value={wallet.address}
            label="Copy address"
            variant="bare"
            className="shrink-0 mt-0.5"
          />
        </div>
      )}

      {open && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <TabButton active={tab === "holdings"} onClick={() => setTab("holdings")}>
              Holdings ({wallet.holdings.length})
            </TabButton>
            <TabButton
              active={tab === "transactions"}
              onClick={() => setTab("transactions")}
            >
              Transactions
            </TabButton>
          </div>
          {tab === "holdings" ? (
            rows.length === 0 ? (
              <p className="text-sm text-text-muted py-4 text-center">
                No holdings.
              </p>
            ) : (
              <HoldingsTable rows={rows} groupColumn="network" />
            )
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">
                  {txLoading
                    ? "loading…"
                    : `${txInYear.length} transactions in 2025`}
                </span>
                <div className="flex items-center gap-2">
                  <DownloadCsvButton
                    filename={`${safeName(wallet.name)}-transactions-2025`}
                    rows={txInYear}
                    columns={TX_CSV_COLUMNS}
                    disabled={txInYear.length === 0}
                    label="CSV 2025"
                  />
                  <button
                    type="button"
                    onClick={() => void loadTx()}
                    disabled={txLoading}
                    className="btn-ghost text-xs"
                  >
                    {txLoading ? "…" : "Reload"}
                  </button>
                </div>
              </div>
              {txError ? (
                <div className="text-sm text-danger py-3">{txError}</div>
              ) : txLoading && txs.length === 0 ? (
                <div className="text-sm text-text-muted py-6 text-center">
                  Loading transactions…
                </div>
              ) : txInYear.length === 0 ? (
                <div className="text-sm text-text-muted py-6 text-center">
                  No 2025 transactions found.
                </div>
              ) : (
                <TransactionsTable transactions={txInYear} />
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 text-xs font-semibold rounded-full border transition ${
        active
          ? "bg-primary text-white border-primary"
          : "bg-surface-2/60 text-text-muted border-border hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

/* -------------------- wallet transactions (token fetch) -------------------- */

const TX_CSV_COLUMNS: {
  header: string;
  value: (t: Transaction) => string | number | null;
}[] = [
  { header: "Date (UTC)", value: (t) => t.timestamp ?? "" },
  { header: "Network", value: (t) => CHAIN_LABEL[t.network] },
  { header: "Direction", value: (t) => t.direction.toUpperCase() },
  { header: "Amount", value: (t) => (t.amount == null ? "" : t.amount) },
  { header: "Symbol", value: (t) => t.symbol ?? "" },
  { header: "Contract", value: (t) => t.contract ?? "" },
  { header: "Counterparty", value: (t) => t.counterparty ?? "" },
  { header: "Status", value: (t) => t.status },
  { header: "Hash", value: (t) => t.hash },
  { header: "Explorer URL", value: (t) => t.explorerUrl },
];

/* ---------------------------- exchange item ---------------------------- */

function ShareExchangeItem({ exchange }: { exchange: ShareExchange }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => exchangeHoldingRows(exchange), [exchange]);
  const totalUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
  const safe = exchange.label.replace(/[^a-zA-Z0-9_-]+/g, "_") || "exchange";

  return (
    <li className="card-tight overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 text-left"
        aria-expanded={open}
      >
        <span className="pill shrink-0">{exchange.provider.toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-text truncate block">
            {exchange.label}
          </span>
          <span className="text-xs text-text-muted">
            {exchange.balances.length} assets
            {exchange.lastSyncedAt
              ? ` · synced ${formatRelative(exchange.lastSyncedAt)}`
              : ""}
          </span>
        </div>
        <UsdValue
          value={totalUsd}
          priceUsd={1}
          className="text-base sm:text-lg font-extrabold tabular text-text shrink-0"
        />
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          {rows.length > 0 && <HoldingsTable rows={rows} groupColumn="network" />}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Export history
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <HistoryExport
                rows={exchange.trades}
                filename={`${safe}-trades`}
                label={`Trades (${exchange.trades.length})`}
                keys={[
                  "trade_id",
                  "symbol",
                  "base_asset",
                  "quote_asset",
                  "side",
                  "price",
                  "qty",
                  "quote_qty",
                  "fee",
                  "fee_asset",
                  "executed_at",
                ]}
              />
              <HistoryExport
                rows={exchange.orders}
                filename={`${safe}-orders`}
                label={`Orders (${exchange.orders.length})`}
                keys={[
                  "order_id",
                  "symbol",
                  "base_asset",
                  "quote_asset",
                  "side",
                  "type",
                  "status",
                  "price",
                  "orig_qty",
                  "executed_qty",
                  "quote_qty",
                  "fee",
                  "fee_asset",
                  "placed_at",
                ]}
              />
              <HistoryExport
                rows={exchange.deposits}
                filename={`${safe}-deposits`}
                label={`Deposits (${exchange.deposits.length})`}
                keys={[
                  "deposit_id",
                  "coin",
                  "network",
                  "amount",
                  "address",
                  "tx_id",
                  "status",
                  "occurred_at",
                ]}
              />
              <HistoryExport
                rows={exchange.withdrawals}
                filename={`${safe}-withdrawals`}
                label={`Withdrawals (${exchange.withdrawals.length})`}
                keys={[
                  "withdrawal_id",
                  "coin",
                  "network",
                  "amount",
                  "fee",
                  "address",
                  "tx_id",
                  "status",
                  "occurred_at",
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/** CSV export for a generic exchange-history table (keys map to columns). */
function HistoryExport({
  rows,
  filename,
  label,
  keys,
}: {
  rows: Record<string, unknown>[];
  filename: string;
  label: string;
  keys: string[];
}) {
  const columns = keys.map((k) => ({
    header: k,
    value: (r: Record<string, unknown>) => {
      const v = r[k];
      return v == null ? "" : (v as string | number);
    },
  }));
  return (
    <DownloadCsvButton
      filename={filename}
      rows={rows}
      columns={columns}
      disabled={rows.length === 0}
      label={label}
    />
  );
}
