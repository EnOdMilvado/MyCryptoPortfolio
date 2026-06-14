"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { TransactionsTable } from "./TransactionsTable";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ChainPill } from "./ChainPill";
import { CopyButton } from "./CopyButton";
import { UsdValue, BtcValue } from "./MaskedValue";
import {
  CHAIN_LABEL,
  type ChainId,
  type ChainType,
} from "@/lib/chains/types";
import type { Transaction } from "@/lib/chains/transactions/types";
import { formatRelative, shortenAddress } from "@/lib/format";

/**
 * One-page view of every wallet, ranked by USD value. Each wallet is a
 * collapsible card; expanding reveals a tabbed Holdings / Transactions
 * inner view. Transactions are fetched lazily on first expand of the
 * Transactions tab so we don't burn 60s of /api/transactions calls just
 * to render the list header. CSV export sits inside the Transactions tab
 * and respects the date filter.
 */

export interface WalletGroup {
  walletId: string;
  walletName: string;
  walletAddress: string;
  chainType: ChainType;
  portfolioId: string;
  portfolioName: string;
  totalUsd: number;
  holdings: HoldingRow[];
  lastFetchedAt: string | null;
}

interface Props {
  wallets: WalletGroup[];
  btcPriceUsd: number | null;
}

const CHAIN_TYPE_LABEL: Record<ChainType, string> = {
  btc: "Bitcoin",
  evm: "EVM",
  sol: "Solana",
  ton: "TON",
  dot: "Polkadot",
  theta: "Theta",
};

/** Representative chain icon per ChainType — pick the most-recognized
 *  network of the family for the colored pill in the wallet header. */
const CHAIN_TYPE_TO_CHAIN: Record<ChainType, ChainId> = {
  btc: "bitcoin",
  evm: "ethereum",
  sol: "solana",
  ton: "ton",
  dot: "polkadot",
  theta: "theta",
};

export function AllWalletsList({ wallets, btcPriceUsd }: Props) {
  const grandTotalUsd = wallets.reduce((s, w) => s + w.totalUsd, 0);
  const grandTotalBtc = btcPriceUsd ? grandTotalUsd / btcPriceUsd : 0;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <header className="card relative overflow-hidden p-4 sm:p-6 animate-fade-up">
        <div className="absolute -top-20 -left-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-text-muted">All wallets</p>
            <p className="text-xs text-text-muted/80 mt-0.5">
              {wallets.length} {wallets.length === 1 ? "wallet" : "wallets"} ·
              sorted by USD value
            </p>
            <UsdValue
              value={grandTotalUsd}
              className="mt-2 block text-3xl sm:text-4xl font-extrabold tabular text-text break-all"
            />
            {btcPriceUsd && (
              <BtcValue
                value={grandTotalBtc}
                className="mt-1 block text-sm sm:text-base text-text-muted tabular"
              />
            )}
          </div>
        </div>
      </header>

      {/* Wallets list */}
      {wallets.length === 0 ? (
        <div className="card text-center text-text-muted">
          No wallets yet. Add wallets to a portfolio and come back.
        </div>
      ) : (
        <ul className="space-y-3">
          {wallets.map((w, i) => (
            <WalletItem
              key={w.walletId}
              rank={i + 1}
              wallet={w}
              btcPriceUsd={btcPriceUsd}
              grandTotalUsd={grandTotalUsd}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------- per-wallet collapsible item -------------------- */

function WalletItem({
  rank,
  wallet,
  btcPriceUsd,
  grandTotalUsd,
}: {
  rank: number;
  wallet: WalletGroup;
  btcPriceUsd: number | null;
  grandTotalUsd: number;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"holdings" | "transactions">(
    "holdings",
  );
  const pct =
    grandTotalUsd > 0 ? (wallet.totalUsd / grandTotalUsd) * 100 : 0;
  const chainIcon = CHAIN_TYPE_TO_CHAIN[wallet.chainType];

  return (
    <li className="card-tight overflow-hidden animate-fade-up">
      {/* Always-visible header row */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 text-left"
        aria-expanded={open}
        aria-controls={`wallet-${wallet.walletId}-panel`}
      >
        <span className="text-xs font-bold text-text-muted w-6 shrink-0 tabular">
          #{rank}
        </span>
        <ChainPill chain={chainIcon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-text truncate">
              {wallet.walletName}
            </span>
            <span className="text-[10px] text-text-muted/80 shrink-0">
              · {wallet.portfolioName}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{CHAIN_TYPE_LABEL[wallet.chainType]}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">
              {shortenAddress(wallet.walletAddress, 8, 6)}
            </span>
            {wallet.lastFetchedAt && (
              <>
                <span aria-hidden>·</span>
                <span className="hidden sm:inline">
                  updated {formatRelative(wallet.lastFetchedAt)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <UsdValue
            value={wallet.totalUsd}
            className="block text-base sm:text-lg font-extrabold tabular text-text"
          />
          {grandTotalUsd > 0 && (
            <span className="text-[10px] text-text-muted tabular">
              {pct.toFixed(1)}% of total
            </span>
          )}
        </div>
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
        <div
          id={`wallet-${wallet.walletId}-panel`}
          className="mt-4 pt-4 border-t border-border space-y-3"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <TabButton
              active={activeTab === "holdings"}
              onClick={() => setActiveTab("holdings")}
            >
              Holdings ({wallet.holdings.length})
            </TabButton>
            <TabButton
              active={activeTab === "transactions"}
              onClick={() => setActiveTab("transactions")}
            >
              Transactions
            </TabButton>
            <span className="ml-auto">
              <CopyButton
                value={wallet.walletAddress}
                label="Copy address"
                variant="bare"
              />
            </span>
          </div>

          {activeTab === "holdings" ? (
            wallet.holdings.length === 0 ? (
              <div className="text-sm text-text-muted py-6 text-center">
                No cached holdings for this wallet yet — press "Refresh all"
                on the dashboard.
              </div>
            ) : (
              <HoldingsTable
                rows={wallet.holdings}
                btcPriceUsd={btcPriceUsd}
              />
            )
          ) : (
            <TransactionsPanel
              walletId={wallet.walletId}
              walletName={wallet.walletName}
            />
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

/* -------------------- transactions panel (lazy fetch + CSV) -------------------- */

const CSV_COLUMNS: {
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
  { header: "Block", value: (t) => t.blockNumber ?? "" },
  { header: "Explorer URL", value: (t) => t.explorerUrl },
];

function TransactionsPanel({
  walletId,
  walletName,
}: {
  walletId: string;
  walletName: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);

  // Date filter: YYYY-MM-DD strings (HTML <input type="date">). Empty = open.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletId }),
      });
      const json = (await res.json()) as {
        transactions?: Transaction[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Load failed");
      setTxs(json.transactions ?? []);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  // Auto-fetch the first time the user switches to this tab.
  useEffect(() => {
    if (!loaded) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply date filter + sort. Transactions without timestamps fall through
  // any active date filter (we don't drop them silently).
  const filtered = useMemo(() => {
    const fromTs = fromDate ? new Date(fromDate + "T00:00:00Z").getTime() : null;
    const toTs = toDate ? new Date(toDate + "T23:59:59Z").getTime() : null;
    const result = txs.filter((t) => {
      if (!t.timestamp) return true;
      const ts = new Date(t.timestamp).getTime();
      if (fromTs != null && ts < fromTs) return false;
      if (toTs != null && ts > toTs) return false;
      return true;
    });
    result.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
    return result;
  }, [txs, fromDate, toDate, sortDir]);

  const csvName = (() => {
    const safe = walletName.replace(/[^a-zA-Z0-9_-]+/g, "_") || "wallet";
    const today = new Date().toISOString().slice(0, 10);
    const range =
      fromDate || toDate
        ? `_${fromDate || "start"}_to_${toDate || today}`
        : "";
    return `${safe}-transactions${range}-${today}`;
  })();

  return (
    <div className="space-y-3">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-[10px] font-semibold text-text-muted uppercase tracking-wide">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            max={toDate || undefined}
            className="mt-0.5 px-2 py-1 text-xs rounded border border-border bg-surface text-text"
          />
        </label>
        <label className="flex flex-col text-[10px] font-semibold text-text-muted uppercase tracking-wide">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            min={fromDate || undefined}
            className="mt-0.5 px-2 py-1 text-xs rounded border border-border bg-surface text-text"
          />
        </label>
        <label className="flex flex-col text-[10px] font-semibold text-text-muted uppercase tracking-wide">
          Sort
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
            className="mt-0.5 px-2 py-1 text-xs rounded border border-border bg-surface text-text"
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        {(fromDate || toDate) && (
          <button
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            className="btn-ghost text-xs"
          >
            Clear dates
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-muted">
            {loading
              ? "loading…"
              : `${filtered.length}/${txs.length} tx`}
          </span>
          <DownloadCsvButton
            filename={csvName}
            rows={filtered}
            columns={CSV_COLUMNS}
            disabled={filtered.length === 0}
            label="CSV"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="btn-ghost text-xs"
            title="Refetch transactions"
          >
            {loading ? "…" : "Reload"}
          </button>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="text-sm text-danger py-4">{error}</div>
      ) : loading && txs.length === 0 ? (
        <div className="text-sm text-text-muted py-6 text-center">
          Loading transactions…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-text-muted py-6 text-center">
          {txs.length === 0
            ? "No transactions found for this wallet."
            : "No transactions in this date range."}
        </div>
      ) : (
        <TransactionsTable transactions={filtered} />
      )}
    </div>
  );
}
