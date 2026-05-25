"use client";

import { useCallback, useEffect, useState } from "react";
import { TransactionsTable } from "./TransactionsTable";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { CopyButton } from "./CopyButton";
import { CHAIN_LABEL } from "@/lib/chains/types";
import type { Transaction } from "@/lib/chains/transactions/types";
import { formatRelative } from "@/lib/format";

interface Props {
  walletId: string;
  walletName: string;
  walletAddress: string;
  chainTypeLabel: string;
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

export function WalletTransactionsView({
  walletId,
  walletName,
  walletAddress,
  chainTypeLabel,
}: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

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
        fetchedAt?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Load failed");
      setTransactions(json.transactions ?? []);
      setFetchedAt(json.fetchedAt ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  useEffect(() => {
    load();
  }, [load]);

  const filenameSafe = walletName.replace(/[^a-zA-Z0-9_-]+/g, "_") || "wallet";
  const csvFilename = `${filenameSafe}-transactions-${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="space-y-6">
      <section className="card animate-fade-up relative overflow-hidden">
        <div className="absolute -top-20 -left-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-muted">Wallet · {chainTypeLabel}</p>
            <h2 className="mt-1 text-3xl font-extrabold text-text break-words">{walletName}</h2>
            <div className="mt-2">
              <CopyButton
                value={walletAddress}
                showValue
                truncate={{ head: 10, tail: 8 }}
                label="Copy wallet address"
              />
            </div>
            <p className="mt-3 text-xs text-text-muted">
              {fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DownloadCsvButton
              filename={csvFilename}
              rows={transactions}
              columns={CSV_COLUMNS}
              disabled={loading || transactions.length === 0}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Loading…" : "Reload"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="card-tight text-sm text-danger bg-danger/10 border-danger/20">
          {error}
        </div>
      )}

      {loading && transactions.length === 0 ? (
        <div className="card text-center text-text-muted animate-fade-up">
          Loading transactions from the blockchain…
        </div>
      ) : (
        <TransactionsTable transactions={transactions} />
      )}
    </div>
  );
}
