"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CmcLink } from "./CmcLink";
import { CHAIN_LABEL } from "@/lib/chains/types";
import { tokenExplorerUrl } from "@/lib/chains/explorers";
import { formatAmount, formatBtc, formatUsd, shortenAddress } from "@/lib/format";
import { isLikelySpam } from "@/lib/spam";
import { useAllHoldings } from "./AllHoldingsView";
import { ChainPill } from "./ChainPill";
import type { HoldingRow } from "./HoldingsTable";
import { UsdValue } from "./MaskedValue";
import { useHideBalance } from "./HideBalanceProvider";

interface AggregatedRow {
  key: string;
  symbol: string;
  name: string | null;
  totalAmount: number;
  totalUsd: number;
  hasPrice: boolean;
  walletCount: number;
  networks: string[];
  /** Weighted-average 24h change across all contributing holdings. */
  change24h: number | null;
  /** Raw holdings making up this aggregate — used for drill-down. */
  contributors: HoldingRow[];
}

type SortKey =
  | "symbol"
  | "name"
  | "totalAmount"
  | "totalUsd"
  | "walletCount"
  | "change24h";
type SortDir = "asc" | "desc";

function aggregateKey(r: HoldingRow): string {
  const s = (r.symbol ?? "").trim();
  if (s) return s.toUpperCase();
  return `${r.chain}:${r.contract}`;
}

/** Stable per-holding key — matches the format used by the global hide set. */
function holdingKey(r: HoldingRow): string {
  return `${r.walletId}|${r.chain}|${r.contract}`;
}

function aggregate(rows: HoldingRow[]): AggregatedRow[] {
  const map = new Map<
    string,
    AggregatedRow & {
      _wallets: Set<string>;
      _withPrice: number;
      _changeWeighted: number;
      _changeWeight: number;
    }
  >();
  for (const r of rows) {
    const k = aggregateKey(r);
    const display = (r.symbol ?? r.name ?? k).trim();
    const cur = map.get(k);
    const change = r.priceChange24h ?? null;
    const weight = r.valueUsd > 0 ? r.valueUsd : 0;
    if (cur) {
      cur.totalAmount += r.amount;
      cur.totalUsd += r.valueUsd;
      cur._wallets.add(r.walletId);
      cur.walletCount = cur._wallets.size;
      cur._withPrice += r.priceUsd != null ? 1 : 0;
      cur.hasPrice = cur._withPrice > 0;
      if (!cur.networks.includes(CHAIN_LABEL[r.chain])) {
        cur.networks.push(CHAIN_LABEL[r.chain]);
      }
      if (!cur.name && r.name) cur.name = r.name;
      cur.contributors.push(r);
      if (change != null && weight > 0) {
        cur._changeWeighted += change * weight;
        cur._changeWeight += weight;
      }
    } else {
      map.set(k, {
        key: k,
        symbol: display,
        name: r.name,
        totalAmount: r.amount,
        totalUsd: r.valueUsd,
        hasPrice: r.priceUsd != null,
        walletCount: 1,
        networks: [CHAIN_LABEL[r.chain]],
        change24h: null,
        contributors: [r],
        _wallets: new Set<string>([r.walletId]),
        _withPrice: r.priceUsd != null ? 1 : 0,
        _changeWeighted: change != null && weight > 0 ? change * weight : 0,
        _changeWeight: change != null && weight > 0 ? weight : 0,
      });
    }
  }
  // Finalize change24h as weighted average; null if no contributor had it.
  for (const v of map.values()) {
    v.change24h = v._changeWeight > 0 ? v._changeWeighted / v._changeWeight : null;
  }
  return [...map.values()];
}

const EXCLUDE_KEY = "crypto-aggregated-excluded";

export interface AssetPnlCell {
  buys: number;
  sells: number;
  net: number;
  estimated: boolean;
}

export function AggregatedHoldingsTable({
  rows,
  btcPriceUsd,
  onHide,
  pnlByAsset,
}: {
  rows: HoldingRow[];
  /** When provided, an extra BTC-value column is shown after USD. */
  btcPriceUsd?: number | null;
  /** When provided, a leading "Hide" column appears. Checking it hides every
   *  contributing holding of that asset from all tables/totals on the page.
   *  (Rows shown here are always currently-visible, so the box reads
   *  unchecked; restore is done from the "Hidden holdings" panel.) */
  onHide?: (keys: string[]) => void;
  /** When provided, three extra columns (Buys / Sells / P&L) are shown,
   *  keyed by the aggregate key (uppercased symbol). Used by the tax P&L
   *  page, where the values are scoped to a chosen date range. */
  pnlByAsset?: Map<string, AssetPnlCell>;
}) {
  const showBtc = btcPriceUsd != null && btcPriceUsd > 0;
  const hideable = !!onHide;
  const pnl = !!pnlByAsset;
  const { focusedAsset, focusAsset } = useAllHoldings();
  const [sortKey, setSortKey] = useState<SortKey>("totalUsd");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showSpam, setShowSpam] = useState(false);
  const [showDust, setShowDust] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Full-table mode lifts the 20-row height cap + reveals spam + dust.
  const [showFull, setShowFull] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXCLUDE_KEY);
      if (raw) setExcluded(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, []);

  // External focus request (e.g. user clicked a pie slice or a bar). Expand
  // the matching aggregated row, scroll it into view, then clear the focus
  // flag so subsequent clicks on the same coin still fire a fresh scroll.
  useEffect(() => {
    if (!focusedAsset) return;
    setExpanded((prev) => {
      if (prev.has(focusedAsset)) return prev;
      const next = new Set(prev);
      next.add(focusedAsset);
      return next;
    });
    // Wait one frame so the expansion row exists in the DOM before scrolling.
    const handle = window.requestAnimationFrame(() => {
      const el = document.getElementById(`agg-row-${focusedAsset}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (sectionRef.current) {
        // Row might be hidden behind the dust/spam filter — scroll to the
        // table at least so the user sees where they landed.
        sectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      focusAsset(null);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [focusedAsset, focusAsset]);

  function persist(next: Set<string>) {
    try {
      window.localStorage.setItem(EXCLUDE_KEY, JSON.stringify([...next]));
    } catch {}
  }

  function toggleIncluded(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
      return next;
    });
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Pre-filter rows: drop spam unconditionally for aggregation (we keep a
  // count so the user knows). Dust is filtered on the *aggregated* row by
  // its totalUsd below.
  const { cleanRows, spamCount } = useMemo(() => {
    let spam = 0;
    const clean: HoldingRow[] = [];
    for (const r of rows) {
      if (isLikelySpam(r)) spam++;
      else clean.push(r);
    }
    return { cleanRows: clean, spamCount: spam };
  }, [rows]);

  const effShowSpam = showSpam || showFull;
  const effShowDust = showDust || showFull;
  const sourceRows = effShowSpam ? rows : cleanRows;
  const aggregatedAll = useMemo(() => aggregate(sourceRows), [sourceRows]);

  // Dust on an aggregated asset = total USD < $1 OR no price at all.
  const dustCount = useMemo(
    () => aggregatedAll.filter((r) => !r.hasPrice || r.totalUsd < 1).length,
    [aggregatedAll],
  );
  // Keep an asset visible (even at $0 held) when it had P&L activity in the
  // period — i.e. positions that were fully sold still appear in the report.
  const hasPnlActivity = (key: string): boolean => {
    const c = pnlByAsset?.get(key);
    return !!c && (c.buys > 0 || c.sells > 0 || c.net !== 0);
  };
  const aggregated = useMemo(
    () =>
      effShowDust
        ? aggregatedAll
        : aggregatedAll.filter(
            (r) => (r.hasPrice && r.totalUsd >= 1) || hasPnlActivity(r.key),
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aggregatedAll, effShowDust, pnlByAsset],
  );

  // Grand total across the (visible) included rows — used for the % column.
  const grandTotalUsd = useMemo(
    () =>
      aggregated.reduce(
        (s, r) => (excluded.has(r.key) ? s : s + r.totalUsd),
        0,
      ),
    [aggregated, excluded],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return aggregated;
    return aggregated.filter(
      (r) =>
        r.symbol.toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q),
    );
  }, [aggregated, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (
        sortKey === "totalAmount" ||
        sortKey === "totalUsd" ||
        sortKey === "walletCount" ||
        sortKey === "change24h"
      ) {
        const av =
          sortKey === "change24h"
            ? (a.change24h ?? Number.NEGATIVE_INFINITY)
            : ((a as unknown as Record<SortKey, number>)[sortKey] || 0);
        const bv =
          sortKey === "change24h"
            ? (b.change24h ?? Number.NEGATIVE_INFINITY)
            : ((b as unknown as Record<SortKey, number>)[sortKey] || 0);
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const av = ((a as unknown as Record<SortKey, string | null>)[sortKey] ?? "") as string;
      const bv = ((b as unknown as Record<SortKey, string | null>)[sortKey] ?? "") as string;
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    const numeric =
      key === "totalAmount" ||
      key === "totalUsd" ||
      key === "walletCount" ||
      key === "change24h";
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(numeric ? "desc" : "asc");
    }
  }

  const includedTotal = sorted
    .filter((r) => !excluded.has(r.key))
    .reduce((s, r) => s + r.totalUsd, 0);
  const includedCount = sorted.filter((r) => !excluded.has(r.key)).length;

  if (aggregated.length === 0) {
    return (
      <div className="card text-center text-text-muted text-sm">
        No holdings yet.
      </div>
    );
  }

  return (
    <section
      ref={sectionRef}
      className="card animate-fade-up space-y-3 scroll-mt-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-text">All holdings summary</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {includedCount} of {aggregated.length} assets · total{" "}
            <UsdValue value={includedTotal} className="font-semibold" />
            {dustCount > 0 && !showDust && <> · {dustCount} dust auto-hidden</>}
            {spamCount > 0 && !showSpam && <> · {spamCount} spam auto-hidden</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input max-w-[12rem] text-sm"
          />
          {dustCount > 0 && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
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
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
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

      {/* Cap visible to 20 rows. Each <tr> ≈ 44px (px-3 py-2.5 + content) +
          header ≈ 40px. Sticky thead keeps headings visible while scrolling.
          "Show full table" below removes the cap and reveals dust + spam. */}
      <div
        className={`w-full overflow-y-auto rounded-xl border border-border ${
          showFull ? "" : "max-h-[924px]"
        }`}
      >
        <table className="w-full text-sm table-fixed">
          {/* Proportional widths that add up to 100% so columns spread evenly
              across the card with no dead space in the middle. On mobile we
              hide Amount / 24h / Wallets columns and let Asset + USD grow to
              fill the row; key info is embedded inline under the Asset name. */}
          {/* 10 columns when showBtc, 9 otherwise:
              Include / Asset / Price / 24h / Amount / USD / [BTC] / % / Wallets / Address / CMC */}
          <colgroup>
            {hideable && <col className="w-[8%] sm:w-[4%]" />}
            <col className="w-[8%] sm:w-[4%]" />
            <col className="w-[40%] sm:w-[14%]" />
            <col className="hidden sm:table-column sm:w-[10%]" />
            <col className="hidden sm:table-column sm:w-[8%]" />
            <col className="hidden sm:table-column sm:w-[10%]" />
            <col className="w-[30%] sm:w-[12%]" />
            {pnl && <col className="hidden sm:table-column sm:w-[10%]" />}
            {pnl && <col className="hidden sm:table-column sm:w-[10%]" />}
            {pnl && <col className="w-[24%] sm:w-[11%]" />}
            {showBtc && <col className="hidden sm:table-column sm:w-[10%]" />}
            <col className="hidden sm:table-column sm:w-[6%]" />
            <col className="hidden sm:table-column sm:w-[6%]" />
            <col className="hidden sm:table-column sm:w-[12%]" />
            <col className="w-[22%] sm:w-[6%]" />
          </colgroup>
          <thead className="bg-surface-2/80 text-text-muted sticky top-0 z-10 backdrop-blur-sm">
            <tr>
              {hideable && (
                <th className="px-2 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  Hide
                </th>
              )}
              <th className="px-2 py-2.5 text-center">
                <span className="sr-only">Include</span>
              </th>
              <th className="px-2 py-2.5 text-left">
                <SortHeader
                  label="Asset"
                  active={sortKey === "symbol"}
                  dir={sortDir}
                  onClick={() => toggleSort("symbol")}
                />
              </th>
              <th className="hidden sm:table-cell px-2 py-2.5 text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Price
                </span>
              </th>
              <th className="hidden sm:table-cell px-2 py-2.5 text-left">
                <SortHeader
                  label="24h"
                  active={sortKey === "change24h"}
                  dir={sortDir}
                  onClick={() => toggleSort("change24h")}
                />
              </th>
              <th className="hidden sm:table-cell px-2 py-2.5 text-left">
                <SortHeader
                  label="Amount"
                  active={sortKey === "totalAmount"}
                  dir={sortDir}
                  onClick={() => toggleSort("totalAmount")}
                />
              </th>
              <th className="px-2 py-2.5 text-left">
                <SortHeader
                  label="USD"
                  active={sortKey === "totalUsd"}
                  dir={sortDir}
                  onClick={() => toggleSort("totalUsd")}
                />
              </th>
              {pnl && (
                <>
                  <th className="hidden sm:table-cell px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Buys
                  </th>
                  <th className="hidden sm:table-cell px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Sells
                  </th>
                  <th className="px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                    P&L
                  </th>
                </>
              )}
              {showBtc && (
                <th className="hidden sm:table-cell px-2 py-2.5 text-left">
                  <SortHeader
                    label="BTC"
                    // BTC value is proportional to USD value, so the sort
                    // order matches — reuse the same sort key.
                    active={sortKey === "totalUsd"}
                    dir={sortDir}
                    onClick={() => toggleSort("totalUsd")}
                  />
                </th>
              )}
              <th className="hidden sm:table-cell px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                %
              </th>
              <th className="hidden sm:table-cell px-2 py-2.5 text-left">
                <SortHeader
                  label="Wallets"
                  active={sortKey === "walletCount"}
                  dir={sortDir}
                  onClick={() => toggleSort("walletCount")}
                />
              </th>
              <th className="hidden sm:table-cell px-2 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                Address
              </th>
              <th className="px-2 py-2.5 pr-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                CMC
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const isChecked = !excluded.has(r.key);
              const isExpanded = expanded.has(r.key);
              return (
                <Fragment key={r.key}>
                  <tr
                    // Stable id so external focus requests (pie / bar click)
                    // can scrollIntoView this specific row.
                    id={`agg-row-${r.key}`}
                    className={`${i % 2 ? "bg-surface-2/30" : ""} ${isChecked ? "" : "opacity-50"} scroll-mt-24`}
                  >
                    {hideable && (
                      <td className="px-2 py-2.5 align-middle text-center">
                        <input
                          type="checkbox"
                          aria-label={`Hide ${r.symbol} from all tables and totals`}
                          checked={false}
                          onChange={() =>
                            onHide!(r.contributors.map(holdingKey))
                          }
                          className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-2 py-2.5 align-middle text-center">
                      <input
                        type="checkbox"
                        aria-label={`Include ${r.symbol}`}
                        checked={isChecked}
                        onChange={() => toggleIncluded(r.key)}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-2.5 align-middle min-w-0">
                      <div className="font-bold truncate" title={r.symbol}>
                        {r.symbol}
                      </div>
                      {r.name && r.name !== r.symbol && (
                        <div
                          className="text-xs text-text-muted truncate"
                          title={r.name}
                        >
                          {r.name}
                        </div>
                      )}

                      {/* Mobile-only secondary line: 24h % + amount + wallet
                          count. Tap to expand contributors. */}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(r.key)}
                        className="sm:hidden mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted text-left w-full"
                        title="Tap to see contributing wallets"
                      >
                        {r.change24h != null && (
                          <span
                            className={`font-semibold tabular ${
                              r.change24h >= 0 ? "text-success" : "text-danger"
                            }`}
                          >
                            {r.change24h >= 0 ? "+" : ""}
                            {r.change24h.toFixed(2)}%
                          </span>
                        )}
                        <span className="tabular truncate">
                          {formatAmount(r.totalAmount)}
                        </span>
                        <span className="whitespace-nowrap">
                          · {r.walletCount}{" "}
                          {r.walletCount === 1 ? "wallet" : "wallets"}
                          <span className="ml-1">{isExpanded ? "▾" : "▸"}</span>
                        </span>
                      </button>
                    </td>
                    {/* Price (market) — picked from the largest-USD
                        contributor's priceUsd. */}
                    <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left tabular text-sm whitespace-nowrap text-text-muted">
                      <AggPriceCell contributors={r.contributors} />
                    </td>
                    {/* 24h */}
                    <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left tabular text-sm whitespace-nowrap">
                      {r.change24h == null ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            r.change24h >= 0 ? "text-success" : "text-danger"
                          }`}
                        >
                          {r.change24h >= 0 ? "+" : ""}
                          {r.change24h.toFixed(2)}%
                        </span>
                      )}
                    </td>
                    {/* Amount */}
                    <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left tabular text-sm whitespace-nowrap">
                      {formatAmount(r.totalAmount)}
                    </td>
                    {/* USD */}
                    <td className="px-2 py-2.5 align-middle text-left whitespace-nowrap">
                      <UsdValue
                        value={r.totalUsd}
                        priceUsd={r.hasPrice ? 1 : null}
                        className="tabular font-semibold"
                      />
                    </td>
                    {/* Buys / Sells / P&L (date-range scoped) */}
                    {pnl &&
                      (() => {
                        const c = pnlByAsset!.get(r.key);
                        return (
                          <>
                            <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left tabular text-sm whitespace-nowrap text-text-muted">
                              {c && c.buys > 0 ? formatUsd(c.buys) : "—"}
                            </td>
                            <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left tabular text-sm whitespace-nowrap text-text-muted">
                              {c && c.sells > 0 ? formatUsd(c.sells) : "—"}
                            </td>
                            <td
                              className={`px-2 py-2.5 align-middle text-left tabular text-sm font-semibold whitespace-nowrap ${
                                !c || c.net === 0
                                  ? "text-text-muted"
                                  : c.net > 0
                                    ? "text-success"
                                    : "text-danger"
                              }`}
                            >
                              {c && c.net !== 0
                                ? `${c.net > 0 ? "+" : ""}${formatUsd(c.net)}${c.estimated ? " ~" : ""}`
                                : "—"}
                            </td>
                          </>
                        );
                      })()}
                    {/* BTC */}
                    {showBtc && (
                      <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left whitespace-nowrap">
                        <AggBtcCell
                          totalUsd={r.totalUsd}
                          hasPrice={r.hasPrice}
                          btcPriceUsd={btcPriceUsd!}
                        />
                      </td>
                    )}
                    {/* % of total */}
                    <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left tabular text-xs text-text-muted whitespace-nowrap">
                      {grandTotalUsd > 0 && isChecked
                        ? `${((r.totalUsd / grandTotalUsd) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    {/* Wallets (click to expand contributors) */}
                    <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(r.key)}
                        className="text-xs hover:text-primary inline-flex items-center gap-1 whitespace-nowrap"
                        title="Click to see contributing wallets"
                      >
                        <span className="font-semibold">{r.walletCount}</span>
                        <span className="text-text-muted">·</span>
                        <span>
                          {r.networks.length}
                          {r.networks.length === 1 ? "net" : "nets"}
                        </span>
                        <span className="text-text-muted">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                      </button>
                    </td>
                    {/* Address (largest-USD contributor → chain explorer) */}
                    <td className="hidden sm:table-cell px-2 py-2.5 align-middle text-left">
                      <AggAddressLink contributors={r.contributors} />
                    </td>
                    {/* CMC */}
                    <td className="px-2 py-2.5 align-middle text-left pr-2">
                      <CmcLink symbol={r.symbol} />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${r.key}-expand`} className="bg-surface-2/40">
                      <td colSpan={(showBtc ? 11 : 10) + (hideable ? 1 : 0) + (pnl ? 3 : 0)} className="px-4 py-3">
                        <div className="text-xs text-text-muted mb-2">
                          {r.contributors.length}{" "}
                          {r.contributors.length === 1 ? "holding" : "holdings"} on{" "}
                          {r.networks.join(", ")}
                          {hideable && <> · check to hide a row</>}
                        </div>
                        {/* One flat row per contributor, sorted by USD value
                            (largest first). Everything stays on a single line;
                            the row scrolls horizontally on very narrow cards
                            rather than wrapping each field onto its own line. */}
                        <div className="space-y-1 overflow-x-auto">
                          {r.contributors
                            .slice()
                            .sort((a, b) => b.valueUsd - a.valueUsd)
                            .map((h, j) => (
                              <div
                                key={`${h.walletId}-${h.chain}-${h.contract}-${j}`}
                                className="flex items-center gap-3 text-sm whitespace-nowrap py-0.5"
                              >
                                {hideable && (
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    onChange={() => onHide!([holdingKey(h)])}
                                    aria-label={`Hide ${h.symbol ?? r.symbol} in ${h.walletName} from all tables and totals`}
                                    title="Hide this holding"
                                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
                                  />
                                )}
                                <ChainPill chain={h.chain} size="xs" />
                                <span className="font-semibold text-text truncate max-w-[12rem]">
                                  {h.portfolioId ? (
                                    <Link
                                      href={`/dashboard/portfolio/${h.portfolioId}/wallet/${h.walletId}`}
                                      className="hover:text-primary hover:underline transition"
                                      title={h.walletName}
                                    >
                                      {h.walletName}
                                    </Link>
                                  ) : (
                                    <span title={h.walletName}>{h.walletName}</span>
                                  )}
                                </span>
                                {h.portfolioId && h.portfolioName && (
                                  <Link
                                    href={`/dashboard/portfolio/${h.portfolioId}`}
                                    className="text-text-muted text-xs hover:text-primary hover:underline transition shrink-0"
                                    title={h.portfolioName}
                                  >
                                    {h.portfolioName}
                                  </Link>
                                )}
                                <span className="text-text-muted text-xs font-mono shrink-0">
                                  {shortenAddress(h.walletAddress, 6, 4)}
                                </span>
                                <span className="ml-auto text-text-muted tabular shrink-0">
                                  {formatAmount(h.amount)}
                                </span>
                                <UsdValue
                                  value={h.valueUsd}
                                  priceUsd={h.priceUsd}
                                  className="font-semibold tabular text-right min-w-[5rem] shrink-0"
                                />
                              </div>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={(showBtc ? 11 : 10) + (hideable ? 1 : 0) + (pnl ? 3 : 0)}
                  className="px-3 py-6 text-center text-text-muted"
                >
                  No assets match the current filter
                </td>
              </tr>
            )}
          </tbody>
          {grandTotalUsd > 0 && (
            <tfoot className="border-t-2 border-border bg-surface-2/40">
              <tr className="font-bold text-text">
                {hideable && <td className="px-2 py-2.5" />}
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5 text-left text-xs uppercase tracking-wide text-text-muted">
                  Total
                </td>
                <td className="hidden sm:table-cell px-2 py-2.5" />
                <td className="hidden sm:table-cell px-2 py-2.5" />
                <td className="hidden sm:table-cell px-2 py-2.5" />
                <td className="px-2 py-2.5 text-left whitespace-nowrap tabular">
                  <UsdValue value={grandTotalUsd} priceUsd={1} />
                </td>
                {pnl &&
                  (() => {
                    let b = 0,
                      s = 0,
                      n = 0;
                    for (const r of sorted) {
                      if (excluded.has(r.key)) continue;
                      const c = pnlByAsset!.get(r.key);
                      if (c) {
                        b += c.buys;
                        s += c.sells;
                        n += c.net;
                      }
                    }
                    return (
                      <>
                        <td className="hidden sm:table-cell px-2 py-2.5 text-left whitespace-nowrap tabular text-text-muted">
                          {b > 0 ? formatUsd(b) : "—"}
                        </td>
                        <td className="hidden sm:table-cell px-2 py-2.5 text-left whitespace-nowrap tabular text-text-muted">
                          {s > 0 ? formatUsd(s) : "—"}
                        </td>
                        <td
                          className={`px-2 py-2.5 text-left whitespace-nowrap tabular ${
                            n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-text-muted"
                          }`}
                        >
                          {n !== 0 ? `${n > 0 ? "+" : ""}${formatUsd(n)}` : "—"}
                        </td>
                      </>
                    );
                  })()}
                {showBtc && (
                  <td className="hidden sm:table-cell px-2 py-2.5 text-left whitespace-nowrap tabular text-text-muted">
                    {btcPriceUsd && btcPriceUsd > 0
                      ? formatBtc(grandTotalUsd / btcPriceUsd)
                      : "—"}
                  </td>
                )}
                <td className="hidden sm:table-cell px-2 py-2.5 text-left text-xs text-text-muted">
                  100%
                </td>
                <td className="hidden sm:table-cell px-2 py-2.5" />
                <td className="hidden sm:table-cell px-2 py-2.5" />
                <td className="px-2 py-2.5" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {(dustCount > 0 || spamCount > 0 || aggregated.length >= 20) && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowFull((s) => !s)}
            className="w-full py-2 text-sm font-semibold text-primary hover:text-primary-hover hover:bg-surface-2 transition rounded-xl"
          >
            {showFull
              ? "↑ Show less"
              : `↓ Show full table${
                  dustCount + spamCount > 0
                    ? ` (including ${dustCount + spamCount} dust/spam)`
                    : ""
                }`}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Shows the shortened contract address of the single biggest contributor
 * (by USD value) for an aggregated row, with a deep link to that chain's
 * block explorer. Falls back silently when the contributor has no
 * routable address (e.g. native BTC, synthesized exchange holdings).
 */
function AggAddressLink({ contributors }: { contributors: HoldingRow[] }) {
  if (contributors.length === 0) return null;
  let top = contributors[0];
  for (const c of contributors) {
    if (c.valueUsd > top.valueUsd) top = c;
  }
  const contract = (top.contract ?? "").trim();
  if (!contract || contract === "native") return null;
  const url = tokenExplorerUrl(top.chain, contract);
  const short = shortenAddress(contract, 6, 4);
  if (!url) {
    return (
      <div
        className="text-[11px] font-mono text-text-muted truncate"
        title={contract}
      >
        {short}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="text-[11px] font-mono text-primary hover:text-primary-hover truncate inline-block max-w-full"
      title={`${contract} · ${CHAIN_LABEL[top.chain]}`}
    >
      {short} ↗
    </a>
  );
}

/** Market price cell — picks the largest-USD contributor's priceUsd. */
function AggPriceCell({ contributors }: { contributors: HoldingRow[] }) {
  let top = contributors[0];
  if (!top) return <span className="text-text-muted">—</span>;
  for (const c of contributors) {
    if (c.valueUsd > top.valueUsd) top = c;
  }
  const p = top.priceUsd;
  if (p == null) return <span className="text-text-muted">—</span>;
  // Reuse formatUsd's "<$0.01" for super-small prices.
  return <>{formatUsd(p)}</>;
}

/** BTC cell for the aggregated table — respects the global hide toggle. */
function AggBtcCell({
  totalUsd,
  hasPrice,
  btcPriceUsd,
}: {
  totalUsd: number;
  hasPrice: boolean;
  btcPriceUsd: number;
}) {
  const { hidden } = useHideBalance();
  if (!hasPrice) {
    return (
      <span className="tabular text-text-muted whitespace-nowrap">—</span>
    );
  }
  return (
    <span className="tabular text-text-muted font-semibold whitespace-nowrap">
      {hidden ? "••••" : formatBtc(totalUsd / btcPriceUsd)}
    </span>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "start",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "start" | "center" | "end";
}) {
  const justify =
    align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-full items-center gap-1 font-semibold ${justify} ${active ? "text-primary" : "hover:text-text"}`}
    >
      {label}
      <span className="text-xs">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}
