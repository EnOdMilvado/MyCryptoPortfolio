"use client";

import { useMemo, useState } from "react";
import { formatAmount } from "@/lib/format";
import type { TradeRowView } from "../ExchangeDetailView";

const VISIBLE_DEFAULT = 20;
const SCROLL_MAX_HEIGHT = "36rem";

function ninetyDaysAgoIso(): string {
  const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExchangeTradesTable({
  rows,
  excluded,
  onToggleExcluded,
}: {
  rows: TradeRowView[];
  excluded: Set<string>;
  onToggleExcluded: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [side, setSide] = useState<"all" | "BUY" | "SELL">("all");
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
      const ts = Date.parse(r.executedAt);
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
  }, [rows, filter, side, from, to]);

  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_DEFAULT);
  const hiddenCount = filtered.length - visible.length;

  if (rows.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-8">
        No trades cached yet. Click Refresh trades to fetch the last 90 days from
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
        <span className="text-xs text-text-muted ml-auto">{filtered.length} trades</span>
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
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-left">Side</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Fee</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const isHidden = excluded.has(t.tradeId.toUpperCase());
              const rowTint = isHidden
                ? "opacity-40"
                : t.side === "BUY"
                  ? "bg-success/5 hover:bg-success/10"
                  : "bg-danger/5 hover:bg-danger/10";
              return (
                <tr key={t.tradeId} className={rowTint}>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => onToggleExcluded(t.tradeId)}
                      title={isHidden ? "Include" : "Hide"}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                    {formatDateTime(t.executedAt)}
                  </td>
                  <td className="px-3 py-2 font-semibold">{t.symbol}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`pill ${
                        t.side === "BUY"
                          ? "bg-success/15 text-success"
                          : "bg-danger/15 text-danger"
                      }`}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{formatAmount(t.price)}</td>
                  <td className="px-3 py-2 text-right">{formatAmount(t.qty)}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatAmount(t.quoteQty)} {t.quoteAsset}
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted">
                    {t.fee == null
                      ? "—"
                      : `${formatAmount(t.fee)} ${t.feeAsset ?? ""}`.trim()}
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
