"use client";

import { CHAIN_COLORS, CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import { formatUsd } from "@/lib/format";
import { UsdValue } from "./MaskedValue";

export interface NetworkRow {
  chain: ChainId;
  value: number;
  count: number;
}

export function NetworkBreakdown({
  rows,
  selected,
  onSelect,
}: {
  rows: NetworkRow[];
  /** Currently filtered chain, if any. */
  selected?: ChainId | null;
  /** When provided, rows become clickable to filter the holdings list. */
  onSelect?: (chain: ChainId | null) => void;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0 || rows.length === 0) return null;

  // Sort by value desc and color each network with its canonical brand
  // color so e.g. Ethereum is always its purple-blue regardless of rank.
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const colored = sorted.map((r) => ({
    ...r,
    color: CHAIN_COLORS[r.chain],
    pct: total > 0 ? (r.value / total) * 100 : 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-text">
          By network
          {selected && (
            <button
              type="button"
              onClick={() => onSelect?.(null)}
              className="ml-2 text-xs font-normal text-primary hover:text-primary-hover"
            >
              · clear filter
            </button>
          )}
        </h4>
        <span className="text-xs text-text-muted">
          {sorted.length} {sorted.length === 1 ? "network" : "networks"}
        </span>
      </div>

      {/* Horizontal stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden border border-border">
        {colored.map((n) => (
          <div
            key={n.chain}
            style={{ width: `${n.pct}%`, backgroundColor: n.color }}
            title={`${CHAIN_LABEL[n.chain]} · ${formatUsd(n.value)} · ${n.pct.toFixed(1)}%`}
          />
        ))}
      </div>

      {/* List */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {colored.map((n) => {
          const isActive = selected === n.chain;
          const isClickable = !!onSelect;
          return (
            <li
              key={n.chain}
              className={`flex items-center justify-between gap-3 rounded-lg -mx-1 px-1 py-0.5 ${
                isClickable ? "cursor-pointer hover:bg-surface-2/60" : ""
              } ${isActive ? "bg-primary/10" : ""}`}
              onClick={isClickable ? () => onSelect(isActive ? null : n.chain) : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-sm shrink-0"
                  style={{ backgroundColor: n.color }}
                />
                <span
                  className={`truncate font-semibold ${isActive ? "text-primary" : "text-text"}`}
                >
                  {CHAIN_LABEL[n.chain]}
                </span>
                <span className="text-xs text-text-muted shrink-0">
                  · {n.count} {n.count === 1 ? "holding" : "holdings"}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 tabular">
                <span className="text-text-muted text-xs w-12 text-right">
                  {n.pct.toFixed(1)}%
                </span>
                <UsdValue
                  value={n.value}
                  className="font-semibold text-text text-right min-w-[5rem]"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
