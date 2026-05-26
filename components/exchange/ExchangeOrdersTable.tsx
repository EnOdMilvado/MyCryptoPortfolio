"use client";

import { useMemo, useState } from "react";
import { formatAmount } from "@/lib/format";
import type { OrderRowView } from "../ExchangeDetailView";

const VISIBLE_DEFAULT = 50;
const SCROLL_MAX_HEIGHT = "36rem";

function ninetyDaysAgoIso(): string {
  const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusTint(status: string | null, side: "BUY" | "SELL"): string {
  const s = (status ?? "").toUpperCase();
  if (s === "FILLED") {
    return side === "BUY" ? "bg-success/5" : "bg-danger/5";
  }
  if (s === "PARTIALLY_FILLED") return "bg-warning/5";
  if (s === "CANCELED" || s === "EXPIRED" || s === "REJECTED") return "bg-surface-2/40 opacity-70";
  return "bg-transparent";
}

function statusPillCls(status: string | null): string {
  const s = (status ?? "").toUpperCase();
  if (s === "FILLED") return "bg-success/15 text-success";
  if (s === "PARTIALLY_FILLED") return "bg-warning/15 text-warning";
  if (s === "NEW") return "bg-primary/15 text-primary";
  if (s === "CANCELED" || s === "EXPIRED" || s === "REJECTED") return "bg-danger/10 text-danger";
  return "bg-surface-2 text-text-muted";
}

export function ExchangeOrdersTable({
  rows,
  excluded,
  onToggleExcluded,
}: {
  rows: OrderRowView[];
  excluded: Set<string>;
  onToggleExcluded: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [side, setSide] = useState<"all" | "BUY" | "SELL">("all");
  const [status, setStatus] = useState<"all" | "FILLED" | "CANCELED" | "OPEN">("all");
  const [from, setFrom] = useState(ninetyDaysAgoIso());
  const [to, setTo] = useState(todayIso());
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const fromMs = from ? Date.parse(from) : null;
    const toMs = to ? Date.parse(to) + 24 * 60 * 60 * 1000 - 1 : null;
    return rows.filter((r) => {
      if (side !== "all" && r.side !== side) return false;
      if (f && !r.symbol.toUpperCase().includes(f)) return false;
      const sUp = (r.status ?? "").toUpperCase();
      if (status === "FILLED" && sUp !== "FILLED") return false;
      if (status === "CANCELED" && sUp !== "CANCELED" && sUp !== "EXPIRED" && sUp !== "REJECTED")
        return false;
      if (status === "OPEN" && sUp !== "NEW" && sUp !== "PARTIALLY_FILLED") return false;
      const ts = Date.parse(r.placedAt);
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
  }, [rows, filter, side, status, from, to]);

  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_DEFAULT);
  const hiddenCount = filtered.length - visible.length;

  if (rows.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-8">
        No orders cached yet. Click Refresh orders to fetch the last 90 days from
        the exchange.
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
          placeholder="Filter by symbol…"
          className="input max-w-xs text-sm"
        />
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "all" | "BUY" | "SELL")}
          className="input text-sm w-32"
        >
          <option value="all">All sides</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "all" | "FILLED" | "CANCELED" | "OPEN")}
          className="input text-sm w-36"
        >
          <option value="all">All statuses</option>
          <option value="FILLED">Filled</option>
          <option value="OPEN">Open / partial</option>
          <option value="CANCELED">Canceled / expired</option>
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
        <span className="text-xs text-text-muted ml-auto">{filtered.length} orders</span>
      </div>
      <div
        className="overflow-auto rounded-xl border border-border"
        style={{ maxHeight: showAll ? undefined : SCROLL_MAX_HEIGHT }}
      >
        <table className="w-full text-sm tabular">
          <thead className="bg-surface-2/80 backdrop-blur sticky top-0 z-10 text-text-muted">
            <tr>
              <th className="px-2 py-2 w-10 text-center">On</th>
              <th className="px-3 py-2 text-left">Placed</th>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-left">Side</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Filled</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => {
              const isHidden = excluded.has(o.orderId.toUpperCase());
              const tint = isHidden ? "opacity-40" : statusTint(o.status, o.side);
              return (
                <tr key={o.orderId} className={tint}>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => onToggleExcluded(o.orderId)}
                      title={isHidden ? "Include" : "Hide"}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                    {formatDateTime(o.placedAt)}
                  </td>
                  <td className="px-3 py-2 font-semibold">{o.symbol}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`pill ${
                        o.side === "BUY"
                          ? "bg-success/15 text-success"
                          : "bg-danger/15 text-danger"
                      }`}
                    >
                      {o.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-muted text-xs">{o.type ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {o.price == null || o.price === 0 ? "—" : formatAmount(o.price)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {o.origQty == null ? "—" : formatAmount(o.origQty)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {o.executedQty == null ? "—" : formatAmount(o.executedQty)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`pill ${statusPillCls(o.status)}`}>
                      {o.status ?? "—"}
                    </span>
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
