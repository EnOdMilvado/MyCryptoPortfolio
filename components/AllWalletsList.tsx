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
import { formatRelative } from "@/lib/format";

/**
 * One-page view of every wallet, ranked by USD value. Each wallet is a
 * collapsible card; expanding reveals a tabbed Holdings / Transactions
 * inner view. Transactions are fetched lazily on first expand of the
 * Transactions tab so we don't burn 60s of /api/transactions calls just
 * to render the list header. CSV export sits inside the Transactions tab
 * and respects the date filter.
 */

export type WalletKind = "wallet" | "exchange" | "offchain";

export interface WalletGroup {
  /** Where this row's value comes from: an on-chain wallet, a CEX, or a
   *  manual off-chain balance. Drives the header badge + expandability. */
  kind: WalletKind;
  walletId: string;
  walletName: string;
  walletAddress: string;
  /** null for exchange / off-chain rows (no single chain). */
  chainType: ChainType | null;
  /** Short label shown in place of the chain pill for exchange/off-chain
   *  rows (e.g. "BINANCE", "Bank"). */
  badge?: string;
  portfolioId: string | null;
  portfolioName: string;
  totalUsd: number;
  holdings: HoldingRow[];
  lastFetchedAt: string | null;
  /** Off-chain single-value rows aren't expandable (nothing to drill into). */
  expandable: boolean;
}

interface Props {
  wallets: WalletGroup[];
  btcPriceUsd: number | null;
}

/** localStorage keys for the tax-exclusion toggles. Mirrors the app's other
 *  exclude sets (wallets / holdings / exchange assets) which all live in
 *  localStorage as JSON string arrays. */
const TAX_WALLETS_KEY = "crypto-tax-excluded-wallets";
const TAX_HOLDINGS_KEY = "crypto-tax-excluded-holdings";

/** A Set<string> persisted to localStorage, with cross-tab sync. Returns the
 *  current set and a toggle that flips membership and re-persists. */
function usePersistentSet(
  storageKey: string,
): [Set<string>, (id: string) => void] {
  const [set, setSet] = useState<Set<string>>(new Set());

  const read = useCallback((): Set<string> => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) return new Set(arr.map(String));
      }
    } catch {
      // ignore corrupt entry
    }
    return new Set();
  }, [storageKey]);

  useEffect(() => {
    setSet(read());
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key === storageKey) setSet(read());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [read, storageKey]);

  const toggle = useCallback(
    (id: string) => {
      setSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // ignore quota / private-mode errors
        }
        return next;
      });
    },
    [storageKey],
  );

  return [set, toggle];
}

/** Stable per-holding key, matching the format used elsewhere for excludes. */
function holdingKey(r: HoldingRow): string {
  return `${r.walletId}|${r.chain}|${r.contract}`;
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

  const [taxExcludedWallets, toggleWalletTax] = usePersistentSet(TAX_WALLETS_KEY);
  const [taxExcludedHoldings, toggleHoldingTax] =
    usePersistentSet(TAX_HOLDINGS_KEY);

  // Keep the original (value-sorted) order within each section.
  const includedWallets = wallets.filter(
    (w) => !taxExcludedWallets.has(w.walletId),
  );
  const excludedWallets = wallets.filter((w) =>
    taxExcludedWallets.has(w.walletId),
  );

  // A wallet's taxable value = sum of its holdings minus any toggled off.
  // Off-chain rows have no holdings, so their value lives on the group total.
  const walletTaxableUsd = (w: WalletGroup): number => {
    if (w.holdings.length === 0) return w.totalUsd;
    return w.holdings.reduce(
      (s, h) => (taxExcludedHoldings.has(holdingKey(h)) ? s : s + h.valueUsd),
      0,
    );
  };

  // Taxable total = included wallets minus any per-holding excludes inside them.
  const taxableTotalUsd = includedWallets.reduce(
    (sum, w) => sum + walletTaxableUsd(w),
    0,
  );
  const taxableTotalBtc = btcPriceUsd ? taxableTotalUsd / btcPriceUsd : 0;

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
          {/* Taxable total — what's left after the TAX toggles. */}
          <div className="text-right">
            <p className="text-sm font-semibold text-text-muted">Taxable total</p>
            <p className="text-[11px] text-text-muted/80 mt-0.5">
              counts only TAX-enabled rows
            </p>
            <UsdValue
              value={taxableTotalUsd}
              priceUsd={1}
              className="mt-2 block text-2xl sm:text-3xl font-extrabold tabular text-text break-all"
            />
            {btcPriceUsd && (
              <BtcValue
                value={taxableTotalBtc}
                className="mt-1 block text-xs sm:text-sm text-text-muted tabular"
              />
            )}
          </div>
        </div>
      </header>

      {/* Wallets list (TAX-enabled) */}
      {wallets.length === 0 ? (
        <div className="card text-center text-text-muted">
          No wallets yet. Add wallets to a portfolio and come back.
        </div>
      ) : (
        <ul className="space-y-3">
          {includedWallets.map((w, i) => {
            const taxable = walletTaxableUsd(w);
            return (
              <WalletItem
                key={w.walletId}
                rank={i + 1}
                wallet={w}
                btcPriceUsd={btcPriceUsd}
                displayUsd={taxable}
                fullUsd={w.totalUsd}
                pct={taxableTotalUsd > 0 ? (taxable / taxableTotalUsd) * 100 : 0}
                pctLabel="of taxable"
                taxIncluded
                onToggleWalletTax={toggleWalletTax}
                taxExcludedHoldings={taxExcludedHoldings}
                onToggleHoldingTax={toggleHoldingTax}
              />
            );
          })}
        </ul>
      )}

      {/* Tax-excluded section */}
      {excludedWallets.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
              Wallets not included in tax calculation
            </h2>
            <span className="text-xs text-text-muted/70">
              {excludedWallets.length}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <ul className="space-y-3 opacity-80">
            {excludedWallets.map((w, i) => (
              <WalletItem
                key={w.walletId}
                rank={i + 1}
                wallet={w}
                btcPriceUsd={btcPriceUsd}
                displayUsd={w.totalUsd}
                fullUsd={w.totalUsd}
                pct={grandTotalUsd > 0 ? (w.totalUsd / grandTotalUsd) * 100 : 0}
                pctLabel="of total"
                taxIncluded={false}
                onToggleWalletTax={toggleWalletTax}
                taxExcludedHoldings={taxExcludedHoldings}
                onToggleHoldingTax={toggleHoldingTax}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* -------------------- per-wallet collapsible item -------------------- */

function WalletItem({
  rank,
  wallet,
  btcPriceUsd,
  displayUsd,
  fullUsd,
  pct,
  pctLabel,
  taxIncluded,
  onToggleWalletTax,
  taxExcludedHoldings,
  onToggleHoldingTax,
}: {
  rank: number;
  wallet: WalletGroup;
  btcPriceUsd: number | null;
  /** USD figure to show in the header — taxable amount for included rows,
   *  full value for excluded rows. */
  displayUsd: number;
  /** The wallet's full pre-tax value; shown as a secondary line when it
   *  differs from displayUsd (i.e. some holdings were toggled off). */
  fullUsd: number;
  pct: number;
  pctLabel: string;
  taxIncluded: boolean;
  onToggleWalletTax: (walletId: string) => void;
  taxExcludedHoldings: Set<string>;
  onToggleHoldingTax: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"holdings" | "transactions">(
    "holdings",
  );
  const chainIcon =
    wallet.kind === "wallet" && wallet.chainType
      ? CHAIN_TYPE_TO_CHAIN[wallet.chainType]
      : null;
  const typeLabel =
    wallet.kind === "wallet" && wallet.chainType
      ? CHAIN_TYPE_LABEL[wallet.chainType]
      : wallet.kind === "exchange"
        ? "Exchange"
        : "Off-chain";

  // Per-holding TAX checkboxes reuse HoldingsTable's `selectable` column.
  // `checked` carries the included keys (= not in the excluded set).
  const includedHoldingKeys = useMemo(() => {
    const s = new Set<string>();
    for (const h of wallet.holdings) {
      const k = holdingKey(h);
      if (!taxExcludedHoldings.has(k)) s.add(k);
    }
    return s;
  }, [wallet.holdings, taxExcludedHoldings]);

  const holdingsSelectable = useMemo(
    () => ({
      getKey: holdingKey,
      checked: includedHoldingKeys,
      onToggle: onToggleHoldingTax,
      header: "TAX",
      ariaLabel: "Include this holding in the tax calculation",
    }),
    [includedHoldingKeys, onToggleHoldingTax],
  );

  return (
    <li className="card-tight overflow-hidden animate-fade-up">
      {/* Always-visible header row: TAX checkbox + (button | static) summary */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* TAX toggle — left of every row. On = counted for taxes. */}
        <label
          className="flex flex-col items-center gap-0.5 shrink-0 cursor-pointer select-none"
          title={
            taxIncluded
              ? "Counted in tax calculation — uncheck to exclude"
              : "Excluded from tax calculation — check to include"
          }
        >
          <input
            type="checkbox"
            checked={taxIncluded}
            onChange={() => onToggleWalletTax(wallet.walletId)}
            className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
            aria-label={`Include ${wallet.walletName} in tax calculation`}
          />
          <span className="text-[9px] font-bold uppercase tracking-wide text-text-muted">
            TAX
          </span>
        </label>

        <HeaderTag
          as={wallet.expandable ? "button" : "div"}
          onClick={
            wallet.expandable ? () => setOpen((o) => !o) : undefined
          }
          className="flex flex-1 items-center gap-3 text-left min-w-0"
          aria-expanded={wallet.expandable ? open : undefined}
          aria-controls={
            wallet.expandable ? `wallet-${wallet.walletId}-panel` : undefined
          }
        >
          <span className="text-xs font-bold text-text-muted w-6 shrink-0 tabular">
            #{rank}
          </span>
          {chainIcon ? (
            <ChainPill chain={chainIcon} />
          ) : (
            <span className="pill shrink-0">{wallet.badge ?? typeLabel}</span>
          )}
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
              <span>{typeLabel}</span>
              {wallet.lastFetchedAt && (
                <>
                  <span aria-hidden>·</span>
                  <span className="hidden sm:inline">
                    {wallet.kind === "wallet" ? "updated" : "synced"}{" "}
                    {formatRelative(wallet.lastFetchedAt)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <UsdValue
              value={displayUsd}
              priceUsd={1}
              className="block text-base sm:text-lg font-extrabold tabular text-text"
            />
            {/* When some holdings are toggled off, show the full pre-tax value
                struck through so the deduction is visible. */}
            {Math.abs(displayUsd - fullUsd) > 0.005 && (
              <UsdValue
                value={fullUsd}
                priceUsd={1}
                className="block text-[10px] text-text-muted/70 tabular line-through"
              />
            )}
            {pct > 0 && (
              <span className="text-[10px] text-text-muted tabular">
                {pct.toFixed(1)}% {pctLabel}
              </span>
            )}
          </div>
          {wallet.expandable && (
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
          )}
        </HeaderTag>
      </div>

      {/* Full wallet address, always visible, with a copy button alongside.
          Sits outside the header <button> so it stays valid HTML. */}
      {wallet.walletAddress && (
        <div className="mt-2 flex items-start gap-2 pl-9 sm:pl-12">
          <span className="font-mono text-xs text-text-muted break-all min-w-0">
            {wallet.walletAddress}
          </span>
          <CopyButton
            value={wallet.walletAddress}
            label="Copy address"
            variant="bare"
            className="shrink-0 mt-0.5"
          />
        </div>
      )}

      {wallet.expandable && open && (
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
            {/* On-chain transactions only exist for real wallets. */}
            {wallet.kind === "wallet" && (
              <TabButton
                active={activeTab === "transactions"}
                onClick={() => setActiveTab("transactions")}
              >
                Transactions
              </TabButton>
            )}
          </div>

          {activeTab === "holdings" || wallet.kind !== "wallet" ? (
            wallet.holdings.length === 0 ? (
              <div className="text-sm text-text-muted py-6 text-center">
                No cached holdings yet — press "Refresh all" on the dashboard.
              </div>
            ) : (
              <HoldingsTable
                rows={wallet.holdings}
                btcPriceUsd={btcPriceUsd}
                selectable={holdingsSelectable}
                groupColumn="network"
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

/** Renders either a <button> (expandable rows) or a <div> (static rows) with
 *  the same props, so off-chain entries don't become dead clickable buttons. */
function HeaderTag({
  as,
  children,
  ...rest
}: {
  as: "button" | "div";
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement> & {
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  if (as === "button") {
    return (
      <button type="button" {...rest}>
        {children}
      </button>
    );
  }
  return <div {...rest}>{children}</div>;
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
