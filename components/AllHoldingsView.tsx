"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CHART_COLORS,
  OTHER_COLOR,
  PieChart,
  resolveCoinColor,
  type PieSlice,
} from "./PieChart";
import { useTheme } from "./ThemeProvider";
import { HoldingsBarChart, type BarDatum } from "./HoldingsBarChart";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { NetworkBreakdown, type NetworkRow } from "./NetworkBreakdown";
import { formatBtc, formatUsd } from "@/lib/format";
import { isLikelySpam } from "@/lib/spam";
import type { ChainId } from "@/lib/chains/types";

function holdingKey(r: HoldingRow): string {
  return `${r.walletId}|${r.chain}|${r.contract}`;
}

function assetKey(r: HoldingRow): string {
  const s = (r.symbol ?? "").trim();
  if (s) return s.toUpperCase();
  return `${r.chain}:${r.contract}`;
}

/* ============================================================
   Shared state provider — pie/network and the detailed table
   share the same exclusion state and network filter so they can
   be placed at separate positions on the dashboard.
   ============================================================ */

interface CtxValue {
  /** All input rows (including spam). */
  allRows: HoldingRow[];
  /** Spam-filtered rows. */
  cleanRows: HoldingRow[];
  /** Spam-filtered + user-excluded rows. */
  includedRows: HoldingRow[];
  excluded: Set<string>;
  toggleHolding: (k: string) => void;
  setAllIncluded: (include: boolean) => void;
  selectedNetwork: ChainId | null;
  setSelectedNetwork: (c: ChainId | null) => void;
  hydrated: boolean;
  storageKey: string;
  /** BTC/USD price so child tables can render the BTC-equivalent column. */
  btcPriceUsd: number | null;
  /** Asset key (e.g. "BTC", "RAIN") the user just clicked on a chart.
   *  AggregatedHoldingsTable consumes this to expand the matching row +
   *  scroll it into view, then resets it back to null. */
  focusedAsset: string | null;
  focusAsset: (key: string | null) => void;
}

const Ctx = createContext<CtxValue | null>(null);

export function AllHoldingsProvider({
  rows,
  storageKey,
  btcPriceUsd = null,
  children,
}: {
  rows: HoldingRow[];
  storageKey: string;
  btcPriceUsd?: number | null;
  children: React.ReactNode;
}) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<ChainId | null>(null);
  const [focusedAsset, focusAsset] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`crypto-excluded:${storageKey}`);
      if (raw) setExcluded(new Set(JSON.parse(raw) as string[]));
    } catch {}
    setHydrated(true);
  }, [storageKey]);

  function persist(next: Set<string>) {
    try {
      window.localStorage.setItem(
        `crypto-excluded:${storageKey}`,
        JSON.stringify([...next]),
      );
    } catch {}
  }

  function toggleHolding(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
      return next;
    });
  }

  function setAllIncluded(include: boolean) {
    setExcluded(() => {
      const next = include ? new Set<string>() : new Set(rows.map(holdingKey));
      persist(next);
      return next;
    });
  }

  const cleanRows = useMemo(
    () => rows.filter((r) => !isLikelySpam(r)),
    [rows],
  );
  const includedRows = useMemo(
    () => cleanRows.filter((r) => !excluded.has(holdingKey(r))),
    [cleanRows, excluded],
  );

  return (
    <Ctx.Provider
      value={{
        allRows: rows,
        cleanRows,
        includedRows,
        excluded,
        toggleHolding,
        setAllIncluded,
        selectedNetwork,
        setSelectedNetwork,
        hydrated,
        storageKey,
        btcPriceUsd,
        focusedAsset,
        focusAsset,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAllHoldings(): CtxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("AllHoldings* must be used inside <AllHoldingsProvider>");
  return v;
}

/* ============================================================
   Overview card: pie + network breakdown.
   ============================================================ */

export function AllHoldingsOverview({
  title = "All holdings",
  btcPriceUsd,
}: {
  title?: string;
  btcPriceUsd?: number | null;
}) {
  const {
    allRows,
    cleanRows,
    includedRows,
    excluded,
    selectedNetwork,
    setSelectedNetwork,
    focusAsset,
  } = useAllHoldings();
  const { dark } = useTheme();
  // Pie vs. bars view — persisted in localStorage so the chart preference
  // survives reloads. Defaults to pie.
  const [chartView, setChartView] = useState<"pie" | "bars">("pie");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("crypto-chart-view");
      if (saved === "pie" || saved === "bars") setChartView(saved);
    } catch {}
  }, []);
  function setView(v: "pie" | "bars") {
    setChartView(v);
    try {
      window.localStorage.setItem("crypto-chart-view", v);
    } catch {}
  }

  const totalUsd = includedRows.reduce((s, r) => s + r.valueUsd, 0);
  const totalBtc = btcPriceUsd ? totalUsd / btcPriceUsd : 0;
  const excludedTotal =
    cleanRows.reduce((s, r) => s + r.valueUsd, 0) - totalUsd;
  const excludedCount = cleanRows.length - includedRows.length;
  const spamHidden = allRows.length - cleanRows.length;

  const slices: PieSlice[] = useMemo(() => {
    interface Bucket {
      label: string;
      value: number;
      amount: number;
      symbol: string | null;
      count: number;
      wallets: Set<string>;
    }
    const map = new Map<string, Bucket>();
    for (const r of includedRows) {
      if (r.valueUsd <= 0) continue;
      const k = assetKey(r);
      const display = (r.symbol ?? r.name ?? k).trim();
      const cur = map.get(k);
      if (cur) {
        cur.value += r.valueUsd;
        cur.amount += r.amount;
        cur.count += 1;
        cur.wallets.add(r.walletId);
      } else {
        map.set(k, {
          label: display,
          value: r.valueUsd,
          amount: r.amount,
          symbol: r.symbol,
          count: 1,
          wallets: new Set([r.walletId]),
        });
      }
    }
    const sorted = [...map.entries()].sort((a, b) => b[1].value - a[1].value);
    const top = sorted.slice(0, 8);
    const rest = sorted.slice(8);
    // Track which palette colors are taken by known brands so we don't reuse
    // them for unbranded coins later in the same slice list.
    const usedPaletteIdx = new Set<number>();
    const pieces: PieSlice[] = top.map(([k, info], i) => {
      const parts: string[] = [];
      if (info.wallets.size > 1) parts.push(`${info.wallets.size} wallets`);
      if (info.count > info.wallets.size) parts.push(`${info.count} holdings`);
      const symKey = (info.symbol ?? info.label).trim().toUpperCase();
      const brand = resolveCoinColor(symKey, dark);
      let color: string;
      if (brand) {
        color = brand;
      } else {
        // Pick the next unused palette color.
        let idx = i % CHART_COLORS.length;
        while (usedPaletteIdx.has(idx) && usedPaletteIdx.size < CHART_COLORS.length) {
          idx = (idx + 1) % CHART_COLORS.length;
        }
        usedPaletteIdx.add(idx);
        color = CHART_COLORS[idx];
      }
      return {
        label: info.label,
        value: info.value,
        amount: info.amount,
        amountSymbol: info.symbol,
        color,
        sub: parts.length > 0 ? parts.join(" · ") : undefined,
        // Aggregate key — matches what AggregatedHoldingsTable computes,
        // so clicks can target the same row.
        key: k,
      };
    });
    if (rest.length > 0) {
      const otherValue = rest.reduce((s, [, info]) => s + info.value, 0);
      const otherCount = rest.reduce((s, [, info]) => s + info.count, 0);
      pieces.push({
        label: "Other",
        value: otherValue,
        color: OTHER_COLOR,
        sub: `${rest.length} assets · ${otherCount} holdings`,
      });
    }
    return pieces;
  }, [includedRows, dark]);

  // Top-15 coins for the horizontal bar chart. Unlike the pie chart we
  // don't roll the long tail into "Other" — each coin gets its own bar so
  // the user can scroll right through them individually.
  const barRows: BarDatum[] = useMemo(() => {
    const map = new Map<
      string,
      { label: string; symbol: string | null; value: number; amount: number }
    >();
    for (const r of includedRows) {
      if (r.valueUsd <= 0) continue;
      const k = assetKey(r);
      const display = (r.symbol ?? r.name ?? k).trim();
      const cur = map.get(k);
      if (cur) {
        cur.value += r.valueUsd;
        cur.amount += r.amount;
      } else {
        map.set(k, {
          label: display,
          symbol: r.symbol,
          value: r.valueUsd,
          amount: r.amount,
        });
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 15)
      .map(([k, v]) => ({
        label: v.label,
        symbol: v.symbol,
        value: v.value,
        amount: v.amount,
        amountSymbol: v.symbol,
        // Aggregate key — matches the table's aggregateKey so a click can
        // expand the same coin's row.
        key: k,
      }));
  }, [includedRows]);

  const networkRows: NetworkRow[] = useMemo(() => {
    const map = new Map<ChainId, NetworkRow>();
    for (const r of includedRows) {
      if (r.valueUsd <= 0) continue;
      const cur = map.get(r.chain);
      if (cur) {
        cur.value += r.valueUsd;
        cur.count += 1;
      } else {
        map.set(r.chain, { chain: r.chain, value: r.valueUsd, count: 1 });
      }
    }
    return [...map.values()];
  }, [includedRows]);

  return (
    <section className="card space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {includedRows.length} of {cleanRows.length} holdings included
            {excludedCount > 0 && (
              <> · {formatUsd(excludedTotal)} excluded</>
            )}
            {spamHidden > 0 && (
              <> · {spamHidden} spam auto-filtered</>
            )}
          </p>
        </div>
        {/* Pie / Bars view toggle. */}
        <ChartViewToggle value={chartView} onChange={setView} />
      </div>

      {chartView === "pie" ? (
        <>
          <PieChart
            slices={slices}
            totalLabel="Included"
            coinsCount={
              slices.filter((s) => s.label !== "Other").length +
              (slices.find((s) => s.label === "Other") ? 1 : 0)
            }
            holdingsCount={includedRows.length}
            btcPriceUsd={btcPriceUsd}
            onSliceClick={focusAsset}
          />

          {btcPriceUsd && totalUsd > 0 && (
            <p className="text-center text-xs text-text-muted tabular">
              ≈ {formatBtc(totalBtc)}
            </p>
          )}
        </>
      ) : barRows.length > 0 ? (
        <HoldingsBarChart
          data={barRows}
          btcPriceUsd={btcPriceUsd}
          onBarClick={focusAsset}
        />
      ) : (
        <div className="text-center text-text-muted text-sm py-6">
          No data to chart yet.
        </div>
      )}

      {networkRows.length > 0 && (
        <div className="pt-2 border-t border-border">
          <NetworkBreakdown
            rows={networkRows}
            selected={selectedNetwork}
            onSelect={setSelectedNetwork}
          />
        </div>
      )}

      {/* When state isn't relevant, just consume the value to silence the
          unused-variable warning. */}
      <span className="hidden">{excluded.size}</span>
    </section>
  );
}

/* ============================================================
   Detail table — selectable rows, scoped to selected network.
   ============================================================ */

export function AllHoldingsDetailTable({ title }: { title?: string }) {
  const {
    cleanRows,
    excluded,
    toggleHolding,
    selectedNetwork,
    hydrated,
    btcPriceUsd,
  } = useAllHoldings();

  const rows = selectedNetwork
    ? cleanRows.filter((r) => r.chain === selectedNetwork)
    : cleanRows;

  // Pre-hydration: render everything as "included" to match server output.
  const checked = hydrated
    ? new Set(rows.filter((r) => !excluded.has(holdingKey(r))).map(holdingKey))
    : new Set(rows.map(holdingKey));

  return (
    <section className="animate-fade-up space-y-2">
      {title && (
        <h3 className="text-lg font-bold text-text">{title}</h3>
      )}
      <HoldingsTable
        rows={rows}
        btcPriceUsd={btcPriceUsd}
        selectable={{
          getKey: holdingKey,
          checked,
          onToggle: toggleHolding,
        }}
      />
    </section>
  );
}

/**
 * Small inline toggle between the pie-chart view and the bar-chart view.
 * Two icon buttons styled like the portfolio grid/list toggle.
 */
function ChartViewToggle({
  value,
  onChange,
}: {
  value: "pie" | "bars";
  onChange: (v: "pie" | "bars") => void;
}) {
  return (
    <div
      role="group"
      aria-label="Chart view"
      className="inline-flex items-center rounded-full bg-surface-2 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange("pie")}
        aria-pressed={value === "pie"}
        title="Pie chart"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
          value === "pie"
            ? "bg-surface text-text shadow-sm"
            : "text-text-muted hover:text-text"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12A9 9 0 1 1 12 3v9h9z" />
        </svg>
        Pie
      </button>
      <button
        type="button"
        onClick={() => onChange("bars")}
        aria-pressed={value === "bars"}
        title="Bar chart"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
          value === "bars"
            ? "bg-surface text-text shadow-sm"
            : "text-text-muted hover:text-text"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="20" x2="6" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="18" y1="20" x2="18" y2="14" />
        </svg>
        Bars
      </button>
    </div>
  );
}

/* ============================================================
   Convenience wrapper preserving the original combined layout.
   ============================================================ */

export function AllHoldingsView({
  rows,
  storageKey,
  title = "All holdings",
  btcPriceUsd,
}: {
  rows: HoldingRow[];
  storageKey: string;
  title?: string;
  btcPriceUsd?: number | null;
}) {
  return (
    <AllHoldingsProvider
      rows={rows}
      storageKey={storageKey}
      btcPriceUsd={btcPriceUsd ?? null}
    >
      <AllHoldingsOverview title={title} btcPriceUsd={btcPriceUsd} />
      <AllHoldingsDetailTable />
    </AllHoldingsProvider>
  );
}
