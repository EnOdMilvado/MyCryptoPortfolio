"use client";

import { useState } from "react";
import { ChainPill } from "./ChainPill";
import { UsdValue } from "./MaskedValue";
import { type HoldingRow } from "./HoldingsTable";

/** Stable per-holding key — matches the global hide set's format. */
function holdingKey(r: HoldingRow): string {
  return `${r.walletId}|${r.chain}|${r.contract}`;
}

/**
 * Collapsible panel listing every holding the user has hidden (via the "Hide"
 * checkbox in the dashboard tables). Hidden rows are removed from all tables,
 * charts, tiles and the grand total; this panel is the one place they remain
 * visible so they can be restored. Unlike HoldingsTable it does NOT apply the
 * spam/dust filter, so even tiny/spam holdings the user hid can be brought
 * back.
 */
export function HiddenHoldingsPanel({
  hiddenRows,
  onUnhide,
  onRestoreAll,
}: {
  hiddenRows: HoldingRow[];
  onUnhide: (key: string) => void;
  onRestoreAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (hiddenRows.length === 0) return null;

  const sorted = [...hiddenRows].sort((a, b) => b.valueUsd - a.valueUsd);

  return (
    <section className="card animate-fade-up space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left min-w-0 flex-1"
          aria-expanded={open}
        >
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-text">Hidden holdings</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {hiddenRows.length}{" "}
              {hiddenRows.length === 1 ? "holding" : "holdings"} hidden from all
              tables, charts and totals · uncheck to restore
            </p>
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
        <button
          type="button"
          onClick={onRestoreAll}
          className="btn-ghost text-xs shrink-0"
        >
          Restore all
        </button>
      </div>

      {open && (
        <ul className="space-y-1.5">
          {sorted.map((r) => (
            <li
              key={holdingKey(r)}
              className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-surface-2/40"
            >
              <input
                type="checkbox"
                checked
                onChange={() => onUnhide(holdingKey(r))}
                aria-label={`Restore ${r.symbol ?? r.name ?? "holding"}`}
                title="Uncheck to restore"
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-text truncate">
                  {r.symbol ?? "—"}
                  {r.name && r.name !== r.symbol && (
                    <span className="ml-1.5 text-xs text-text-muted font-normal">
                      {r.name}
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted truncate">
                  {r.walletName}
                </div>
              </div>
              <ChainPill chain={r.chain} size="xs" />
              <UsdValue
                value={r.valueUsd}
                priceUsd={r.priceUsd}
                className="tabular font-semibold text-text shrink-0 whitespace-nowrap"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
