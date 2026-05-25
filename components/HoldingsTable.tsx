"use client";

import { useMemo, useState } from "react";
import { CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import { formatAmount, formatBtc } from "@/lib/format";
import { isLikelySpam } from "@/lib/spam";
import { ChainPill } from "./ChainPill";
import { CopyButton } from "./CopyButton";
import { UsdValue } from "./MaskedValue";
import { useHideBalance } from "./HideBalanceProvider";

export interface HoldingRow {
  walletId: string;
  walletName: string;
  walletAddress: string;
  /** Optional — used to disambiguate wallets that share a name across
   *  portfolios (e.g. two wallets both named "Trezor 1"). */
  portfolioId?: string;
  portfolioName?: string;
  chain: ChainId;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
  /** 24h price change in percent (e.g. -3.2 = -3.2%). */
  priceChange24h?: number | null;
}

type SortKey =
  | "symbol"
  | "amount"
  | "valueUsd"
  | "valueBtc"
  | "walletName"
  | "chain"
  | "walletAddress";

type SortDir = "asc" | "desc";

interface ColumnDef {
  key: SortKey;
  label: string;
  numeric?: boolean;
  /** Optional alignment for header + cell text. Defaults to "start". */
  align?: "start" | "end";
  render: (r: HoldingRow) => React.ReactNode;
  filterValue: (r: HoldingRow) => string;
}

/** Small BTC cell that respects the global Hide-balance toggle. */
function BtcCell({
  valueUsd,
  priceUsd,
  btcPriceUsd,
}: {
  valueUsd: number;
  priceUsd: number | null;
  btcPriceUsd: number;
}) {
  const { hidden } = useHideBalance();
  if (priceUsd == null) {
    return <span className="text-text-muted tabular whitespace-nowrap">—</span>;
  }
  return (
    <span className="tabular text-text-muted whitespace-nowrap">
      {hidden ? "••••" : formatBtc(valueUsd / btcPriceUsd)}
    </span>
  );
}

/**
 * Column order is fixed left-to-right:
 *   Symbol → Amount → USD value → BTC value → Wallet name → Network → Wallet address
 * The BTC column is omitted entirely when `btcPriceUsd` is null.
 * Coin name is folded under the Symbol cell as a small secondary line.
 */
function buildColumns(btcPriceUsd: number | null | undefined): ColumnDef[] {
  const cols: ColumnDef[] = [
    {
      key: "symbol",
      label: "Symbol",
      // Symbol filter also matches the coin name shown beneath.
      filterValue: (r) =>
        `${r.symbol ?? ""} ${r.name ?? ""}`.toLowerCase(),
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold truncate" title={r.symbol ?? ""}>
            {r.symbol ?? "—"}
          </div>
          {r.name && r.name !== r.symbol && (
            <div
              className="text-xs text-text-muted truncate max-w-[10rem]"
              title={r.name}
            >
              {r.name}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      numeric: true,
      align: "end",
      filterValue: (r) => String(r.amount),
      render: (r) => (
        <span className="tabular text-sm whitespace-nowrap">
          {formatAmount(r.amount)}
        </span>
      ),
    },
    {
      key: "valueUsd",
      label: "USD value",
      numeric: true,
      align: "end",
      filterValue: (r) => String(r.valueUsd),
      render: (r) => (
        <UsdValue
          value={r.valueUsd}
          priceUsd={r.priceUsd}
          className={`tabular font-semibold whitespace-nowrap ${r.priceUsd == null ? "text-text-muted" : ""}`}
        />
      ),
    },
  ];

  if (btcPriceUsd != null && btcPriceUsd > 0) {
    cols.push({
      key: "valueBtc",
      label: "BTC value",
      numeric: true,
      align: "end",
      filterValue: (r) => String(r.valueUsd / btcPriceUsd),
      render: (r) => (
        <BtcCell
          valueUsd={r.valueUsd}
          priceUsd={r.priceUsd}
          btcPriceUsd={btcPriceUsd}
        />
      ),
    });
  }

  cols.push(
    {
      key: "walletName",
      label: "Wallet name",
      filterValue: (r) => r.walletName.toLowerCase(),
      render: (r) => (
        <span className="text-sm truncate block max-w-[10rem]" title={r.walletName}>
          {r.walletName}
        </span>
      ),
    },
    {
      key: "chain",
      label: "Network",
      filterValue: (r) => CHAIN_LABEL[r.chain].toLowerCase(),
      render: (r) => <ChainPill chain={r.chain} />,
    },
    {
      key: "walletAddress",
      label: "Wallet address",
      filterValue: (r) => r.walletAddress.toLowerCase(),
      render: (r) => (
        <CopyButton
          value={r.walletAddress}
          showValue
          truncate={{ head: 6, tail: 4 }}
          label="Copy wallet address"
        />
      ),
    },
  );

  return cols;
}

export interface HoldingsSelection {
  getKey: (r: HoldingRow) => string;
  checked: Set<string>;
  onToggle: (key: string) => void;
}

export function HoldingsTable({
  rows,
  selectable,
  btcPriceUsd,
}: {
  rows: HoldingRow[];
  selectable?: HoldingsSelection;
  /** When provided, an extra "BTC value" column is shown after USD. */
  btcPriceUsd?: number | null;
}) {
  const COLUMNS = useMemo(() => buildColumns(btcPriceUsd), [btcPriceUsd]);
  const [sortKey, setSortKey] = useState<SortKey>("valueUsd");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filters, setFilters] = useState<Partial<Record<SortKey, string>>>({});
  const [showSpam, setShowSpam] = useState(false);
  const [showDust, setShowDust] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { cleanRows, spamCount, dustCount } = useMemo(() => {
    const clean: HoldingRow[] = [];
    let spam = 0;
    let dust = 0;
    for (const r of rows) {
      const spamHit = isLikelySpam(r);
      const dustHit = !spamHit && (r.priceUsd == null || r.valueUsd < 1);
      if (spamHit) spam++;
      if (dustHit) dust++;
      if (!spamHit && !dustHit) clean.push(r);
    }
    return { cleanRows: clean, spamCount: spam, dustCount: dust };
  }, [rows]);

  // "Expanded" mode shows everything (spam + dust) regardless of the
  // individual checkboxes, equivalent to checking both.
  const effShowSpam = showSpam || expanded;
  const effShowDust = showDust || expanded;
  const visibleRows = useMemo(() => {
    if (!effShowSpam && !effShowDust) return cleanRows;
    return rows.filter((r) => {
      const spamHit = isLikelySpam(r);
      const dustHit = !spamHit && (r.priceUsd == null || r.valueUsd < 1);
      if (spamHit && !effShowSpam) return false;
      if (dustHit && !effShowDust) return false;
      return true;
    });
  }, [rows, cleanRows, effShowSpam, effShowDust]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && v.trim());
    if (active.length === 0) return visibleRows;
    return visibleRows.filter((r) =>
      active.every(([key, value]) => {
        const col = COLUMNS.find((c) => c.key === key);
        if (!col) return true;
        return col.filterValue(r).includes(value!.trim().toLowerCase());
      }),
    );
  }, [visibleRows, filters]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const numeric = col?.numeric;
    const arr = [...filtered];
    arr.sort((a, b) => {
      // valueBtc is proportional to valueUsd (same conversion rate per row),
      // so sort on the underlying USD value.
      const readNum = (r: HoldingRow): number => {
        if (sortKey === "valueBtc") return r.valueUsd;
        return Number((r as unknown as Record<SortKey, number>)[sortKey]) || 0;
      };
      const av: number | string = numeric
        ? readNum(a)
        : ((a as unknown as Record<SortKey, string | null>)[sortKey] ?? "");
      const bv: number | string = numeric
        ? readNum(b)
        : ((b as unknown as Record<SortKey, string | null>)[sortKey] ?? "");
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [COLUMNS, filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      const col = COLUMNS.find((c) => c.key === key);
      setSortKey(key);
      setSortDir(col?.numeric ? "desc" : "asc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card text-center text-text-muted text-sm">
        No holdings yet. Add a wallet or hit "Refresh" to load holdings.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(spamCount > 0 || dustCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted px-1">
          <span>
            {[
              spamCount > 0 && (
                <span key="spam">
                  {showSpam
                    ? `${spamCount} spam shown`
                    : `${spamCount} likely spam hidden`}
                </span>
              ),
              dustCount > 0 && (
                <span key="dust">
                  {showDust
                    ? `${dustCount} dust shown`
                    : `${dustCount} dust hidden (< $1 or no price)`}
                </span>
              ),
            ]
              .filter(Boolean)
              .reduce<React.ReactNode[]>((acc, el, i) => {
                if (i > 0) acc.push(<span key={`sep-${i}`}> · </span>);
                acc.push(el);
                return acc;
              }, [])}
          </span>
          <div className="flex items-center gap-3">
            {dustCount > 0 && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDust}
                  onChange={(e) => setShowDust(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                <span className="text-primary hover:text-primary-hover font-semibold">
                  Show dust
                </span>
              </label>
            )}
            {spamCount > 0 && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showSpam}
                  onChange={(e) => setShowSpam(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                <span className="text-primary hover:text-primary-hover font-semibold">
                  Show spam
                </span>
              </label>
            )}
          </div>
        </div>
      )}
      <div className="card overflow-hidden p-0">
        {/* Vertical cap ≈ 30 rows + header (~ 80px). The inner div handles
            both axes of scroll; sticky thead keeps headers visible.
            "Show full table" below removes the cap. */}
        <div
          className={`overflow-x-auto overflow-y-auto ${expanded ? "" : "max-h-[1380px]"}`}
        >
          <table className="w-full text-sm">
          <thead className="bg-surface-2/80 text-text-muted sticky top-0 z-10 backdrop-blur-sm">
            <tr>
              {selectable && (
                <th className="px-3 py-3 text-left whitespace-nowrap w-10">
                  <span className="sr-only">Include</span>
                </th>
              )}
              {COLUMNS.map((c) => {
                const active = sortKey === c.key;
                const isEnd = c.align === "end";
                return (
                  <th
                    key={c.key}
                    className={`px-3 py-3 whitespace-nowrap ${isEnd ? "text-right" : "text-left"}`}
                  >
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
            {sorted.map((r, i) => {
              const key = selectable?.getKey(r);
              const isChecked = selectable ? selectable.checked.has(key!) : true;
              return (
                <tr
                  key={`${r.walletId}-${r.chain}-${r.contract}`}
                  className={`${i % 2 ? "bg-surface-2/30" : ""} ${selectable && !isChecked ? "opacity-50" : ""}`}
                >
                  {selectable && (
                    <td className="px-3 py-2.5 align-middle">
                      <input
                        type="checkbox"
                        aria-label="Include in summary"
                        checked={isChecked}
                        onChange={() => selectable.onToggle(key!)}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </td>
                  )}
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 align-middle ${c.align === "end" ? "text-right" : "text-left"}`}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + (selectable ? 1 : 0)}
                  className="px-3 py-6 text-center text-text-muted"
                >
                  No rows match the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Show-full-table toggle. When expanded the height cap is removed AND
          spam + dust become visible regardless of the individual checkboxes. */}
      {(spamCount > 0 || dustCount > 0 || visibleRows.length >= 30) && (
        <div className="border-t border-border bg-surface-2/40 text-center">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-full py-2.5 text-sm font-semibold text-primary hover:text-primary-hover hover:bg-surface-2 transition"
          >
            {expanded
              ? "↑ Show less"
              : `↓ Show full table (${spamCount + dustCount > 0 ? `including ${spamCount + dustCount} dust/spam` : "no cap"})`}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
