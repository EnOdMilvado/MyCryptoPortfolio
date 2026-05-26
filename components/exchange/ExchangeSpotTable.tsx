"use client";

import { useMemo, useState } from "react";
import { UsdValue, BtcValue } from "../MaskedValue";
import { formatAmount } from "@/lib/format";
import { HoldingsBarChart, type BarDatum } from "../HoldingsBarChart";
import { CmcLink } from "../CmcLink";
import type { SpotRow } from "../ExchangeDetailView";

type SortKey = "asset" | "amount" | "price" | "value" | "btc";
type SortDir = "asc" | "desc";

const DEFAULT_VISIBLE = 50;
const SCROLL_MAX_HEIGHT = "32rem";

export function ExchangeSpotTable({
  rows,
  btcPriceUsd,
  excluded,
  onToggleExcluded,
}: {
  rows: SpotRow[];
  btcPriceUsd: number | null;
  excluded: Set<string>;
  onToggleExcluded: (asset: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const filtered = f ? rows.filter((r) => r.asset.toUpperCase().includes(f)) : rows;
    const cmp = (a: SpotRow, b: SpotRow) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case "asset":
          av = a.asset;
          bv = b.asset;
          break;
        case "amount":
          av = a.amount;
          bv = b.amount;
          break;
        case "price":
          av = a.priceUsd ?? -1;
          bv = b.priceUsd ?? -1;
          break;
        case "btc":
        case "value":
        default:
          av = a.valueUsd;
          bv = b.valueUsd;
      }
      if (av === bv) return 0;
      const dir = sortDir === "asc" ? 1 : -1;
      return av > bv ? dir : -dir;
    };
    return [...filtered].sort(cmp);
  }, [rows, sortKey, sortDir, filter]);

  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = sorted.length - visible.length;

  const chartData: BarDatum[] = useMemo(
    () =>
      rows
        .filter((r) => r.valueUsd > 0 && !excluded.has(r.asset.toUpperCase()))
        .map((r) => ({
          label: r.asset,
          symbol: r.asset,
          value: r.valueUsd,
          amount: r.amount,
          amountSymbol: r.asset,
        })),
    [rows, excluded],
  );

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "asset" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="text-center text-text-muted text-sm py-8">
        No spot balances cached yet. Click Refresh spot to fetch from the exchange.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {chartData.length > 0 && (
        <HoldingsBarChart data={chartData} topN={15} btcPriceUsd={btcPriceUsd} />
      )}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by asset…"
        className="input max-w-xs text-sm"
      />
      <div
        className="overflow-auto rounded-xl border border-border"
        style={{ maxHeight: showAll ? undefined : SCROLL_MAX_HEIGHT }}
      >
        <table className="w-full text-sm tabular">
          <thead className="bg-surface-2/80 backdrop-blur sticky top-0 z-10">
            <tr className="text-text-muted">
              <th className="px-2 py-2 w-10 text-center" title="Included in totals">
                On
              </th>
              <Th onClick={() => toggle("asset")} active={sortKey === "asset"} dir={sortDir}>
                Asset
              </Th>
              <Th onClick={() => toggle("price")} active={sortKey === "price"} dir={sortDir}>
                Price
              </Th>
              <Th onClick={() => toggle("amount")} active={sortKey === "amount"} dir={sortDir}>
                Amount
              </Th>
              <Th onClick={() => toggle("value")} active={sortKey === "value"} dir={sortDir}>
                Value
              </Th>
              {btcPriceUsd != null && (
                <Th onClick={() => toggle("btc")} active={sortKey === "btc"} dir={sortDir}>
                  ≈ BTC
                </Th>
              )}
              <th className="px-2 py-2 w-8 text-left" aria-label="External" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const btcEquiv =
                btcPriceUsd != null && btcPriceUsd > 0 && r.valueUsd > 0
                  ? r.valueUsd / btcPriceUsd
                  : null;
              const isHidden = excluded.has(r.asset.toUpperCase());
              return (
                <tr
                  key={r.asset}
                  className={`${i % 2 === 0 ? "bg-transparent" : "bg-surface-2/30"} ${
                    isHidden ? "opacity-40" : ""
                  }`}
                >
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => onToggleExcluded(r.asset)}
                      title={isHidden ? "Include in totals" : "Hide from totals"}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td
                    className={`px-3 py-2 font-semibold text-text ${
                      isHidden ? "line-through" : ""
                    }`}
                  >
                    {r.asset}
                  </td>
                  {/* Price */}
                  <td className="px-3 py-2 text-left">
                    <UsdValue value={r.priceUsd} priceUsd={r.priceUsd} />
                  </td>
                  {/* Amount */}
                  <td
                    className={`px-3 py-2 text-left ${isHidden ? "line-through" : ""}`}
                  >
                    {formatAmount(r.amount)}
                  </td>
                  {/* Value */}
                  <td
                    className={`px-3 py-2 text-left font-semibold ${
                      isHidden ? "line-through" : ""
                    }`}
                  >
                    <UsdValue value={r.valueUsd} priceUsd={r.priceUsd} />
                  </td>
                  {btcPriceUsd != null && (
                    <td className="px-3 py-2 text-left text-text-muted">
                      {btcEquiv != null ? <BtcValue value={btcEquiv} /> : "—"}
                    </td>
                  )}
                  <td className="px-2 py-2 text-left">
                    <CmcLink symbol={r.asset} />
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
      {showAll && sorted.length > DEFAULT_VISIBLE && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="btn-ghost text-xs"
          >
            Collapse to top {DEFAULT_VISIBLE}
          </button>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  right,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  right?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer select-none ${right ? "text-right" : "text-left"} ${
        active ? "text-text" : ""
      }`}
    >
      {children}
      {active && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}
