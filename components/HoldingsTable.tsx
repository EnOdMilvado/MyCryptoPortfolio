"use client";

import { useMemo, useState } from "react";
import { CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import { formatAmount, formatBtc } from "@/lib/format";
import { isLikelySpam } from "@/lib/spam";
import { CmcLink } from "./CmcLink";
import { ChainPill } from "./ChainPill";
import { CopyButton } from "./CopyButton";
import { tokenExplorerUrl } from "@/lib/chains/explorers";
import { shortenAddress } from "@/lib/format";
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
  /** When set, this is a synthetic row sourced from an exchange spot balance
   *  rather than an on-chain wallet. Used to apply per-exchange asset
   *  excludes from localStorage. */
  exchangeId?: string;
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
  /** `SortKey` for sortable columns, or a freeform string for display-only
   *  columns (e.g. the trailing CMC link icon). */
  key: SortKey | string;
  label: string;
  numeric?: boolean;
  /** Optional alignment for header + cell text. Defaults to "start". */
  align?: "start" | "end";
  render: (r: HoldingRow) => React.ReactNode;
  /** Omit on display-only columns to disable filter input. */
  filterValue?: (r: HoldingRow) => string;
}

/** % of total cell — receives the precomputed table total so each row
 *  doesn't have to re-sum. */
function PctCell({
  value,
  total,
  on,
}: {
  value: number;
  total: number;
  on: boolean;
}) {
  if (!on || total <= 0 || value <= 0) {
    return <span className="text-text-muted text-xs">—</span>;
  }
  return (
    <span className="tabular text-text-muted text-xs">
      {((value / total) * 100).toFixed(1)}%
    </span>
  );
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
function buildColumns(
  btcPriceUsd: number | null | undefined,
  /** "wallet" → show the owning wallet name (default, for cross-wallet views).
   *  "network" → show the token's chain instead (for single-wallet tables
   *  where every row shares the same wallet). */
  groupColumn: "wallet" | "network" = "wallet",
): ColumnDef[] {
  const cols: ColumnDef[] = [
    {
      key: "symbol",
      label: "Symbol",
      // Symbol filter also matches the coin name shown beneath.
      filterValue: (r) =>
        `${r.symbol ?? ""} ${r.name ?? ""}`.toLowerCase(),
      render: (r) => (
        <div className="min-w-0 max-w-[5rem]">
          <div className="font-semibold truncate" title={r.symbol ?? ""}>
            {r.symbol ?? "—"}
          </div>
          {r.name && r.name !== r.symbol && (
            <div
              className="text-xs text-text-muted truncate"
              title={r.name}
            >
              {r.name}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "price",
      label: "Price",
      render: (r) => (
        <span className="tabular text-sm whitespace-nowrap text-text-muted">
          {r.priceUsd == null ? (
            <span className="text-text-muted">—</span>
          ) : (
            <UsdValue value={r.priceUsd} priceUsd={r.priceUsd} />
          )}
        </span>
      ),
    },
    {
      key: "change24h",
      label: "24h",
      render: (r) =>
        r.priceChange24h == null ? (
          <span className="text-text-muted text-sm">—</span>
        ) : (
          <span
            className={`tabular font-semibold text-sm whitespace-nowrap ${
              r.priceChange24h >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {r.priceChange24h >= 0 ? "+" : ""}
            {r.priceChange24h.toFixed(2)}%
          </span>
        ),
    },
    {
      key: "amount",
      label: "Amount",
      numeric: true,
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
      key: "pct",
      label: "%",
      // % column has no built-in render data; rendered via PctCell which
      // reads the row total from a sibling. We approximate by leaving
      // render empty here and computing in the table-body section below.
      render: () => null,
    },
    groupColumn === "network"
      ? {
          key: "chain",
          label: "Network",
          filterValue: (r) =>
            `${CHAIN_LABEL[r.chain] ?? r.chain}`.toLowerCase(),
          render: (r) => <ChainPill chain={r.chain} size="xs" />,
        }
      : {
          key: "walletName",
          label: "Wallet",
          filterValue: (r) =>
            `${r.walletName} ${CHAIN_LABEL[r.chain]}`.toLowerCase(),
          render: (r) => (
            <div className="min-w-0 max-w-[10rem]">
              <span className="text-sm truncate" title={r.walletName}>
                {r.walletName}
              </span>
            </div>
          ),
        },
    {
      key: "address",
      label: "Address",
      filterValue: (r) => (r.contract ?? "").toLowerCase(),
      render: (r) => {
        if (!r.contract || r.contract === "native") {
          return <span className="text-xs text-text-muted">native</span>;
        }
        const url = tokenExplorerUrl(r.chain, r.contract);
        const short = shortenAddress(r.contract, 6, 4);
        if (!url) {
          return (
            <span
              className="font-mono text-xs text-text-muted"
              title={r.contract}
            >
              {short}
            </span>
          );
        }
        return (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-xs text-primary hover:text-primary-hover"
            title={r.contract}
          >
            {short} ↗
          </a>
        );
      },
    },
    {
      key: "cmc",
      label: "CMC",
      render: (r) => <CmcLink symbol={r.symbol ?? r.name} />,
    },
  );

  return cols;
}

export interface HoldingsSelection {
  getKey: (r: HoldingRow) => string;
  checked: Set<string>;
  onToggle: (key: string) => void;
  /** Optional visible header for the checkbox column (e.g. "TAX"). When
   *  omitted the column header stays screen-reader-only ("Include"). */
  header?: string;
  /** Per-row aria-label for the checkbox. Defaults to "Include in summary". */
  ariaLabel?: string;
}

/** Optional leading "Hide" column. Checking it hides the row from every
 *  table/chart/total on the page; unchecking restores it. The checkbox is
 *  checked when the row's key is in `hidden` (used by the restore panel,
 *  where the listed rows are all hidden). */
export interface HoldingsHideable {
  getKey: (r: HoldingRow) => string;
  hidden: Set<string>;
  onToggleHide: (key: string) => void;
}

export function HoldingsTable({
  rows,
  selectable,
  hideable,
  btcPriceUsd,
  groupColumn = "wallet",
}: {
  rows: HoldingRow[];
  selectable?: HoldingsSelection;
  /** Optional leading "Hide" checkbox column (hides the row everywhere). */
  hideable?: HoldingsHideable;
  /** When provided, an extra "BTC value" column is shown after USD. */
  btcPriceUsd?: number | null;
  /** Whether the grouping column shows the wallet name (default) or the
   *  token's network. Use "network" inside single-wallet tables. */
  groupColumn?: "wallet" | "network";
}) {
  const COLUMNS = useMemo(
    () => buildColumns(btcPriceUsd, groupColumn),
    [btcPriceUsd, groupColumn],
  );
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
        if (!col || !col.filterValue) return true;
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

  // Grand total across visible rows (only included ones, when the table
  // has selectable checkboxes). Drives the % column + tfoot Total.
  const totalForPct = useMemo(() => {
    return sorted.reduce((s, r) => {
      if (selectable) {
        const k = selectable.getKey(r);
        if (!selectable.checked.has(k)) return s;
      }
      return s + r.valueUsd;
    }, 0);
  }, [sorted, selectable]);

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
          className={`overflow-x-hidden overflow-y-auto ${expanded ? "" : "max-h-[1380px]"}`}
        >
          <table className="w-full text-sm table-auto">
          <thead className="bg-surface-2/80 text-text-muted sticky top-0 z-10 backdrop-blur-sm">
            <tr>
              {hideable && (
                <th className="px-2 py-2 text-left whitespace-nowrap w-10 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  Hide
                </th>
              )}
              {selectable && (
                <th className="px-2 py-2 text-left whitespace-nowrap w-10 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  {selectable.header ?? <span className="sr-only">Include</span>}
                </th>
              )}
              {COLUMNS.map((c) => {
                const active = sortKey === c.key;
                const sortable = !!c.filterValue;
                return (
                  <th
                    key={c.key}
                    className="px-2 py-2 text-left whitespace-nowrap text-xs font-semibold uppercase tracking-wide"
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key as SortKey)}
                        className={`inline-flex items-center gap-1 ${active ? "text-primary" : "hover:text-text"}`}
                      >
                        {c.label}
                        <span className="text-[10px]">
                          {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    ) : (
                      <span>{c.label || ""}</span>
                    )}
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
                  {hideable && (
                    <td className="px-2 py-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label="Hide this holding from all tables and totals"
                        checked={hideable.hidden.has(hideable.getKey(r))}
                        onChange={() => hideable.onToggleHide(hideable.getKey(r))}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </td>
                  )}
                  {selectable && (
                    <td className="px-2 py-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label={selectable.ariaLabel ?? "Include in summary"}
                        checked={isChecked}
                        onChange={() => selectable.onToggle(key!)}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </td>
                  )}
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className="px-2 py-2 align-middle text-left"
                    >
                      {c.key === "pct" ? (
                        <PctCell
                          value={r.valueUsd}
                          total={totalForPct}
                          on={isChecked}
                        />
                      ) : (
                        c.render(r)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + (selectable ? 1 : 0) + (hideable ? 1 : 0)}
                  className="px-3 py-6 text-center text-text-muted"
                >
                  No rows match the current filters
                </td>
              </tr>
            )}
          </tbody>
          {(() => {
            const includedSum = sorted.reduce((s, r) => {
              if (selectable) {
                const k = selectable.getKey(r);
                if (!selectable.checked.has(k)) return s;
              }
              return s + r.valueUsd;
            }, 0);
            if (includedSum <= 0) return null;
            const sumBtc =
              btcPriceUsd != null && btcPriceUsd > 0 ? includedSum / btcPriceUsd : null;
            return (
              <tfoot className="border-t-2 border-border bg-surface-2/40">
                <tr className="font-bold text-text">
                  {hideable && <td className="px-2 py-2" />}
                  {selectable && <td className="px-2 py-2" />}
                  {COLUMNS.map((c) => {
                    if (c.key === "symbol") {
                      return (
                        <td
                          key={c.key}
                          className="px-2 py-2 text-left text-xs uppercase tracking-wide text-text-muted"
                        >
                          Total
                        </td>
                      );
                    }
                    if (c.key === "valueUsd") {
                      return (
                        <td
                          key={c.key}
                          className="px-2 py-2 text-left tabular whitespace-nowrap"
                        >
                          <UsdValue value={includedSum} priceUsd={1} />
                        </td>
                      );
                    }
                    if (c.key === "valueBtc") {
                      return (
                        <td
                          key={c.key}
                          className="px-2 py-2 text-left tabular whitespace-nowrap text-text-muted"
                        >
                          {sumBtc != null ? formatBtc(sumBtc) : "—"}
                        </td>
                      );
                    }
                    return <td key={c.key} className="px-2 py-2" />;
                  })}
                </tr>
              </tfoot>
            );
          })()}
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
