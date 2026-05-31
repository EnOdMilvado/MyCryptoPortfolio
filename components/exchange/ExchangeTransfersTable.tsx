"use client";

import { useMemo, useState } from "react";
import { formatAmount, shortenAddress } from "@/lib/format";
import type { TransferRowView } from "../ExchangeDetailView";

const VISIBLE_DEFAULT = 20;
const SCROLL_MAX_HEIGHT = "36rem";

function ninetyDaysAgoIso(): string {
  const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExchangeTransfersTable({
  rows,
  direction,
  excluded,
  onToggleExcluded,
}: {
  rows: TransferRowView[];
  direction: "deposit" | "withdrawal";
  excluded: Set<string>;
  onToggleExcluded: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "pending" | "failed">(
    "all",
  );
  const [from, setFrom] = useState(ninetyDaysAgoIso());
  const [to, setTo] = useState(todayIso());
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const fromMs = from ? Date.parse(from) : null;
    const toMs = to ? Date.parse(to) + 24 * 60 * 60 * 1000 - 1 : null;
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (f && !r.coin.toUpperCase().includes(f)) return false;
      const ts = Date.parse(r.occurredAt);
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
  }, [rows, filter, statusFilter, from, to]);

  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_DEFAULT);
  const hiddenCount = filtered.length - visible.length;

  if (rows.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-8">
        No {direction === "deposit" ? "deposits" : "withdrawals"} cached yet. Click
        Refresh {direction === "deposit" ? "deposits" : "withdrawals"} to fetch the
        last 90 days from the exchange.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by coin…"
          className="input max-w-xs text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "success" | "pending" | "failed")
          }
          className="input text-sm w-36"
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <label className="text-xs text-text-muted flex items-center gap-1">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input text-sm w-40"
          />
        </label>
        <label className="text-xs text-text-muted flex items-center gap-1">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input text-sm w-40"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setFrom(ninetyDaysAgoIso());
            setTo(todayIso());
          }}
          className="btn-ghost text-xs"
        >
          Last 90 days
        </button>
        <span className="text-xs text-text-muted ml-auto">
          {filtered.length} {direction === "deposit" ? "deposits" : "withdrawals"}
        </span>
      </div>
      <div
        className="overflow-auto rounded-xl border border-border"
        style={{ maxHeight: showAll ? undefined : SCROLL_MAX_HEIGHT }}
      >
        <table className="w-full text-sm tabular">
          <thead className="bg-surface-2/80 backdrop-blur sticky top-0 z-10 text-text-muted">
            <tr>
              <th className="px-2 py-2 w-10 text-center">On</th>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Coin</th>
              <th className="px-3 py-2 text-left">Network</th>
              <th className="px-3 py-2 text-right">Amount</th>
              {direction === "withdrawal" && (
                <th className="px-3 py-2 text-right">Fee</th>
              )}
              <th className="px-3 py-2 text-left">Address</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isHidden = excluded.has(r.id.toUpperCase());
              return (
                <tr key={r.id} className={isHidden ? "opacity-40" : ""}>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => onToggleExcluded(r.id)}
                      title={isHidden ? "Include" : "Hide"}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                    {formatDateTime(r.occurredAt)}
                  </td>
                  <td className={`px-3 py-2 font-semibold ${isHidden ? "line-through" : ""}`}>
                    {r.coin}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.network ?? "—"}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      isHidden
                        ? "line-through text-text-muted"
                        : direction === "withdrawal"
                          ? "text-danger"
                          : "text-success"
                    }`}
                  >
                    {direction === "withdrawal" ? "−" : "+"}
                    {formatAmount(r.amount)}
                  </td>
                  {direction === "withdrawal" && (
                    <td className="px-3 py-2 text-right text-text-muted">
                      {r.fee == null ? "—" : formatAmount(r.fee)}
                    </td>
                  )}
                  <td className="px-3 py-2 text-text-muted font-mono text-xs">
                    {r.address ? shortenAddress(r.address) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="btn-ghost text-xs"
          >
            Show {hiddenCount} more
          </button>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "success"
      ? "bg-success/15 text-success"
      : s === "failed"
        ? "bg-danger/15 text-danger"
        : "bg-surface-2 text-text-muted";
  return <span className={`pill ${cls}`}>{status || "—"}</span>;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
