"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SummaryHeader } from "./SummaryHeader";
import { WalletNotes } from "./WalletNotes";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { CopyButton } from "./CopyButton";
import { TransactionsTable } from "./TransactionsTable";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { NftSection, type NftRow } from "./NftSection";
import { Tabs } from "./Tabs";
import { CHAIN_LABEL, type ChainId, type ChainType } from "@/lib/chains/types";
import type { Transaction } from "@/lib/chains/transactions/types";
import type { WalletHoldings } from "@/lib/chains/types";
import { formatRelative } from "@/lib/format";

const CHAIN_TYPE_LABEL: Record<ChainType, string> = {
  btc: "Bitcoin",
  evm: "EVM",
  sol: "Solana",
};

interface InitialHolding {
  walletId: string;
  walletName: string;
  walletAddress: string;
  chain: ChainId;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
}

interface Props {
  walletId: string;
  walletName: string;
  walletAddress: string;
  chainType: ChainType;
  notes: string;
  initialHoldings: InitialHolding[];
  initialBtcPriceUsd: number | null;
  initialFetchedAt: string | null;
  initialNfts?: NftRow[];
  nftFetchedAt?: string | null;
}

const CSV_COLUMNS: { header: string; value: (t: Transaction) => string | number | null }[] = [
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

export function WalletDetailView({
  walletId,
  walletName,
  walletAddress,
  chainType,
  notes,
  initialHoldings,
  initialBtcPriceUsd,
  initialFetchedAt,
  initialNfts = [],
  nftFetchedAt = null,
}: Props) {
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const t = searchParams?.get("tab");
    if (t === "nfts" || t === "transactions" || t === "holdings") return t;
    return "holdings";
  })();
  const [activeTab, setActiveTab] = useState<"holdings" | "nfts" | "transactions">(
    initialTab,
  );
  const router = useRouter();
  const [holdings, setHoldings] = useState<InitialHolding[]>(initialHoldings);
  const [btcPrice, setBtcPrice] = useState<number | null>(initialBtcPriceUsd);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initialFetchedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [txFetchedAt, setTxFetchedAt] = useState<string | null>(null);

  // Per-wallet include/exclude state. Excluded holdings stop contributing
  // to the wallet's header total.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`crypto-excluded:wallet-${walletId}`);
      if (raw) setExcluded(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, [walletId]);
  function persistExcluded(next: Set<string>) {
    try {
      window.localStorage.setItem(
        `crypto-excluded:wallet-${walletId}`,
        JSON.stringify([...next]),
      );
    } catch {}
  }
  function toggleExcluded(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistExcluded(next);
      return next;
    });
  }

  // The HoldingsTable expects a `walletName` and `walletAddress` already on
  // each row — our initial rows include them so we can render directly.
  const rows: HoldingRow[] = useMemo(
    () =>
      holdings.map((h) => ({
        walletId: h.walletId,
        walletName: h.walletName,
        walletAddress: h.walletAddress,
        chain: h.chain,
        contract: h.contract,
        symbol: h.symbol,
        name: h.name,
        amount: h.amount,
        priceUsd: h.priceUsd,
        valueUsd: h.valueUsd,
      })),
    [holdings],
  );

  const rowKey = (r: HoldingRow) => `${r.chain}|${r.contract}`;
  const includedRows = rows.filter((r) => !excluded.has(rowKey(r)));
  const totalUsd = includedRows.reduce((s, r) => s + r.valueUsd, 0);
  const totalBtc = btcPrice ? totalUsd / btcPrice : 0;
  const excludedTotal =
    rows.reduce((s, r) => s + r.valueUsd, 0) - totalUsd;

  async function refreshHoldings() {
    setRefreshing(true);
    setHoldingsError(null);
    try {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletIds: [walletId] }),
      });
      const json = (await res.json()) as {
        wallets?: WalletHoldings[];
        btcPriceUsd?: number | null;
        fetchedAt?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Refresh failed");
      const fresh: InitialHolding[] = [];
      for (const w of json.wallets ?? []) {
        for (const h of w.holdings) {
          fresh.push({
            walletId: w.walletId,
            walletName,
            walletAddress,
            chain: h.chain,
            contract: h.contract,
            symbol: h.symbol,
            name: h.name,
            amount: h.amount,
            priceUsd: h.priceUsd,
            valueUsd: h.valueUsd,
          });
        }
      }
      setHoldings(fresh);
      if (typeof json.btcPriceUsd === "number") setBtcPrice(json.btcPriceUsd);
      setFetchedAt(json.fetchedAt ?? new Date().toISOString());
      router.refresh();
    } catch (e) {
      setHoldingsError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletId }),
      });
      const json = (await res.json()) as {
        transactions?: Transaction[];
        fetchedAt?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Load failed");
      setTransactions(json.transactions ?? []);
      setTxFetchedAt(json.fetchedAt ?? new Date().toISOString());
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setTxLoading(false);
    }
  }, [walletId]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const csvName = `${walletName.replace(/[^a-zA-Z0-9_-]+/g, "_") || "wallet"}-transactions-${new Date()
    .toISOString()
    .slice(0, 10)}`;

  return (
    <div className="space-y-8">
      <SummaryHeader
        title={walletName}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{CHAIN_TYPE_LABEL[chainType]} wallet</span>
            <CopyButton
              value={walletAddress}
              showValue
              truncate={{ head: 10, tail: 8 }}
              label="Copy wallet address"
              variant="bare"
            />
            {fetchedAt && (
              <span className="text-text-muted/70">
                · updated {formatRelative(fetchedAt)}
              </span>
            )}
          </div>
        }
        totalUsd={totalUsd}
        totalBtc={totalBtc}
        extra={
          <button
            type="button"
            className="btn-ghost"
            onClick={refreshHoldings}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {holdingsError && (
        <div className="card-tight text-sm text-danger bg-danger/10 border-danger/20">
          {holdingsError}
        </div>
      )}

      <WalletNotes walletId={walletId} initialValue={notes} />

      {/* Tabs switch the main content area between Holdings / NFTs / Tx. */}
      <Tabs
        tabs={[
          { key: "holdings", label: "Holdings", badge: rows.length },
          ...(chainType === "evm"
            ? [{ key: "nfts", label: "NFTs", badge: initialNfts.filter((n) => !n.isSpam).length }]
            : []),
          {
            key: "transactions",
            label: "Transactions",
            badge: transactions.length > 0 ? transactions.length : undefined,
          },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
      />

      {activeTab === "holdings" && (
        <section className="animate-fade-up">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <h3 className="text-lg font-bold text-text">Holdings in this wallet</h3>
            {excluded.size > 0 && (
              <p className="text-xs text-text-muted">{excluded.size} excluded</p>
            )}
          </div>
          <HoldingsTable
            rows={rows}
            btcPriceUsd={btcPrice}
            selectable={{
              getKey: rowKey,
              checked: new Set(includedRows.map(rowKey)),
              onToggle: toggleExcluded,
            }}
          />
          {excluded.size > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              Total above excludes {excluded.size}{" "}
              {excluded.size === 1 ? "holding" : "holdings"} (
              {excludedTotal > 0 ? `$${excludedTotal.toFixed(2)}` : "no value"})
            </p>
          )}
        </section>
      )}

      {activeTab === "nfts" && chainType === "evm" && (
        <NftSection
          walletId={walletId}
          initialNfts={initialNfts}
          fetchedAt={nftFetchedAt}
        />
      )}

      {activeTab === "transactions" && (
        <section className="animate-fade-up">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div>
              <h3 className="text-lg font-bold text-text">Transactions</h3>
              <p className="text-xs text-text-muted mt-0.5">
                {txFetchedAt
                  ? `Loaded ${formatRelative(txFetchedAt)} · ${transactions.length} found`
                  : txLoading
                    ? "Loading…"
                    : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DownloadCsvButton
                filename={csvName}
                rows={transactions}
                columns={CSV_COLUMNS}
                disabled={txLoading || transactions.length === 0}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={loadTransactions}
                disabled={txLoading}
              >
                {txLoading ? "Loading…" : "Reload"}
              </button>
            </div>
          </div>

          {txError && (
            <div className="card-tight text-sm text-danger bg-danger/10 border-danger/20 mb-3">
              {txError}
            </div>
          )}

          {txLoading && transactions.length === 0 ? (
            <div className="card text-center text-text-muted">
              Loading transactions from the blockchain…
            </div>
          ) : (
            <TransactionsTable transactions={transactions} />
          )}
        </section>
      )}
    </div>
  );
}
