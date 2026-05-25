"use client";

import { useMemo, useState } from "react";
import { CHAIN_COLORS, CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import type { Transaction } from "@/lib/chains/transactions/types";
import { formatAmount, shortenAddress } from "@/lib/format";
import { ChainPill } from "./ChainPill";
import { CopyButton } from "./CopyButton";

type SortKey = "timestamp" | "network" | "direction" | "amount" | "symbol" | "counterparty" | "hash";
type SortDir = "asc" | "desc";

interface ColumnDef {
  key: SortKey;
  label: string;
  numeric?: boolean;
  render: (t: Transaction) => React.ReactNode;
  filterValue: (t: Transaction) => string;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const DIRECTION_BADGE: Record<Transaction["direction"], { label: string; cls: string }> = {
  in: { label: "IN", cls: "bg-success/15 text-success" },
  out: { label: "OUT", cls: "bg-danger/15 text-danger" },
  self: { label: "SELF", cls: "bg-surface-2 text-text-muted" },
  other: { label: "—", cls: "bg-surface-2 text-text-muted" },
};

const STATUS_COLOR: Record<Transaction["status"], string> = {
  success: "text-success",
  failed: "text-danger",
  pending: "text-text-muted",
  unknown: "text-text-muted",
};

const COLUMNS: ColumnDef[] = [
  {
    key: "timestamp",
    label: "Date",
    filterValue: (t) => (t.timestamp ? formatTs(t.timestamp) : "").toLowerCase(),
    render: (t) => (
      <span className="text-sm text-text-muted tabular whitespace-nowrap">
        {formatTs(t.timestamp)}
      </span>
    ),
  },
  {
    key: "network",
    label: "Network",
    filterValue: (t) => CHAIN_LABEL[t.network].toLowerCase(),
    render: (t) => <ChainPill chain={t.network} />,
  },
  {
    key: "direction",
    label: "Direction",
    filterValue: (t) => t.direction,
    render: (t) => {
      const b = DIRECTION_BADGE[t.direction];
      return (
        <span className={`pill ${b.cls}`}>
          {b.label}
        </span>
      );
    },
  },
  {
    key: "amount",
    label: "Amount",
    numeric: true,
    filterValue: (t) => (t.amount == null ? "" : String(t.amount)),
    render: (t) =>
      t.amount == null ? (
        <span className="text-text-muted">—</span>
      ) : (
        <span className="tabular text-sm">{formatAmount(t.amount)}</span>
      ),
  },
  {
    key: "symbol",
    label: "Asset",
    filterValue: (t) => (t.symbol ?? "").toLowerCase(),
    render: (t) => <span className="font-semibold text-sm">{t.symbol ?? "—"}</span>,
  },
  {
    key: "counterparty",
    label: "Counterparty",
    filterValue: (t) => (t.counterparty ?? "").toLowerCase(),
    render: (t) =>
      t.counterparty ? (
        <CopyButton
          value={t.counterparty}
          showValue
          truncate={{ head: 6, tail: 4 }}
          label="Copy counterparty address"
          variant="bare"
        />
      ) : (
        <span className="text-text-muted text-xs">—</span>
      ),
  },
  {
    key: "hash",
    label: "Hash",
    filterValue: (t) => t.hash.toLowerCase(),
    render: (t) => (
      <div className="flex items-center gap-1.5">
        <a
          href={t.explorerUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={`font-mono text-xs ${STATUS_COLOR[t.status]} hover:underline`}
        >
          {shortenAddress(t.hash, 6, 4)}
        </a>
        <CopyButton value={t.hash} label="Copy transaction hash" variant="bare" />
      </div>
    ),
  },
];

export function TransactionsTable({ transactions }: { transactions: Transaction[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filters, setFilters] = useState<Partial<Record<SortKey, string>>>({});
  const [networkFilter, setNetworkFilter] = useState<ChainId | "all">("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showAll, setShowAll] = useState(false);

  const networks = useMemo(() => {
    const set = new Set<ChainId>();
    for (const t of transactions) set.add(t.network);
    return Array.from(set);
  }, [transactions]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && v.trim());
    const fromMs = dateFrom ? Date.parse(dateFrom) : null;
    // Add a day to include the to-date in the range.
    const toMs = dateTo ? Date.parse(dateTo) + 24 * 60 * 60 * 1000 - 1 : null;
    return transactions.filter((t) => {
      if (networkFilter !== "all" && t.network !== networkFilter) return false;
      if (fromMs != null || toMs != null) {
        const ts = t.timestamp ? Date.parse(t.timestamp) : 0;
        if (fromMs != null && ts < fromMs) return false;
        if (toMs != null && ts > toMs) return false;
      }
      return active.every(([key, value]) => {
        const col = COLUMNS.find((c) => c.key === key);
        if (!col) return true;
        return col.filterValue(t).includes(value!.trim().toLowerCase());
      });
    });
  }, [transactions, filters, networkFilter, dateFrom, dateTo]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const numeric = col?.numeric;
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === "timestamp") {
        const at = a.timestamp ? Date.parse(a.timestamp) : 0;
        const bt = b.timestamp ? Date.parse(b.timestamp) : 0;
        return sortDir === "asc" ? at - bt : bt - at;
      }
      if (numeric) {
        const av = Number((a as unknown as Record<SortKey, number>)[sortKey]) || 0;
        const bv = Number((b as unknown as Record<SortKey, number>)[sortKey]) || 0;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const av = ((a as unknown as Record<SortKey, string | null>)[sortKey] ?? "") || "";
      const bv = ((b as unknown as Record<SortKey, string | null>)[sortKey] ?? "") || "";
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" || COLUMNS.find((c) => c.key === key)?.numeric ? "desc" : "asc");
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="card text-center text-text-muted text-sm">
        No transactions found.
      </div>
    );
  }

  const visibleRows = showAll ? sorted : sorted.slice(0, 50);
  const cappedCount = sorted.length - visibleRows.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {networks.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-muted">Network:</span>
            <button
              type="button"
              onClick={() => setNetworkFilter("all")}
              className={`pill ${networkFilter === "all" ? "bg-primary/15 text-primary" : ""}`}
            >
              All ({transactions.length})
            </button>
            {networks.map((n) => {
              const count = transactions.filter((t) => t.network === n).length;
              const active = networkFilter === n;
              const color = CHAIN_COLORS[n];
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNetworkFilter(n)}
                  className="pill inline-flex items-center gap-1.5"
                  style={
                    active
                      ? {
                          backgroundColor: `${color}1A`,
                          color,
                          borderColor: `${color}55`,
                        }
                      : undefined
                  }
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {CHAIN_LABEL[n]} ({count})
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-text-muted">Date:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 rounded-lg bg-surface border border-border text-xs"
          />
          <span className="text-text-muted">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 rounded-lg bg-surface border border-border text-xs"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="text-primary hover:text-primary-hover font-semibold"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60 text-text-muted">
              <tr>
                {COLUMNS.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <th key={c.key} className="px-3 py-3 text-left whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 font-semibold ${active ? "text-primary" : "hover:text-text"}`}
                      >
                        {c.label}
                        <span className="text-xs">
                          {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                      <input
                        type="text"
                        placeholder="Filter"
                        value={filters[c.key] ?? ""}
                        onChange={(e) =>
                          setFilters((f) => ({ ...f, [c.key]: e.target.value }))
                        }
                        className="mt-1 block w-full text-xs px-2 py-1 rounded-lg bg-surface border border-border focus:outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((t, i) => (
                <tr
                  key={`${t.network}-${t.hash}-${t.direction}-${i}`}
                  className={i % 2 ? "bg-surface-2/30" : ""}
                >
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 align-middle text-left">
                      {c.render(t)}
                    </td>
                  ))}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-text-muted">
                    No rows match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cappedCount > 0 && (
          <div className="border-t border-border bg-surface-2/40 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full py-2.5 text-sm font-semibold text-primary hover:text-primary-hover hover:bg-surface-2 transition"
            >
              ↓ Show all {sorted.length} transactions ({cappedCount} more)
            </button>
          </div>
        )}
        {showAll && sorted.length > 50 && (
          <div className="border-t border-border bg-surface-2/40 text-center">
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="w-full py-2.5 text-sm font-semibold text-primary hover:text-primary-hover hover:bg-surface-2 transition"
            >
              ↑ Collapse to first 50
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
