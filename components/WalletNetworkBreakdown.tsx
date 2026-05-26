"use client";

import { useMemo, useState } from "react";
import { CHAIN_COLORS, CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import { tokenExplorerUrl, holdersExplorerUrl } from "@/lib/chains/explorers";
import { formatAmount, shortenAddress } from "@/lib/format";
import { BtcValue, UsdValue } from "./MaskedValue";
import { ChainPill } from "./ChainPill";
import { CmcLink } from "./CmcLink";
import type { HoldingRow } from "./HoldingsTable";

interface NetworkGroup {
  chain: ChainId;
  totalUsd: number;
  holdings: HoldingRow[];
  change24h: number | null;
}

function weightedChange24h(rows: HoldingRow[]): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.priceChange24h == null || r.valueUsd <= 0) continue;
    num += r.priceChange24h * r.valueUsd;
    den += r.valueUsd;
  }
  return den > 0 ? num / den : null;
}

/**
 * Per-network view for a single wallet, rendered as horizontal tabs (one
 * per chain, sorted by USD value desc). Click a chain to see the full token
 * list for that network, with the same exclude-checkbox state used by the
 * main HoldingsTable so toggles stay in sync.
 */
export function WalletNetworkBreakdown({
  rows,
  btcPriceUsd,
  excluded,
  toggleExcluded,
  rowKey,
}: {
  /** Full row set (NOT pre-excluded). We need it to render rows even when
   *  they're disabled, with the right checkbox state. */
  rows: HoldingRow[];
  btcPriceUsd: number | null;
  excluded: Set<string>;
  toggleExcluded: (key: string) => void;
  rowKey: (r: HoldingRow) => string;
}) {
  const groups = useMemo<NetworkGroup[]>(() => {
    const byChain = new Map<ChainId, NetworkGroup>();
    for (const r of rows) {
      const isOn = !excluded.has(rowKey(r));
      const g = byChain.get(r.chain);
      if (g) {
        if (isOn) g.totalUsd += r.valueUsd;
        g.holdings.push(r);
      } else {
        byChain.set(r.chain, {
          chain: r.chain,
          totalUsd: isOn ? r.valueUsd : 0,
          holdings: [r],
          change24h: null, // filled below
        });
      }
    }
    // Compute 24h weighted change per chain — using ONLY included rows.
    for (const g of byChain.values()) {
      const includedRows = g.holdings.filter((r) => !excluded.has(rowKey(r)));
      g.change24h = weightedChange24h(includedRows);
    }
    return [...byChain.values()].sort((a, b) => b.totalUsd - a.totalUsd);
  }, [rows, excluded, rowKey]);

  const [activeChain, setActiveChain] = useState<ChainId | null>(
    groups[0]?.chain ?? null,
  );
  // Keep the active tab valid if data shifts.
  const activeGroup =
    groups.find((g) => g.chain === activeChain) ?? groups[0] ?? null;

  if (groups.length === 0) return null;

  const totalUsd = groups.reduce((s, g) => s + g.totalUsd, 0);

  return (
    <section className="card-tight space-y-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-text">By network</h3>
        <span className="text-xs text-text-muted">
          {groups.length} {groups.length === 1 ? "network" : "networks"}
        </span>
      </div>

      {/* Stacked allocation bar */}
      {totalUsd > 0 && (
        <div className="flex h-3 rounded-full overflow-hidden border border-border">
          {groups.map((g) => {
            const pct = (g.totalUsd / totalUsd) * 100;
            if (pct <= 0) return null;
            return (
              <div
                key={g.chain}
                style={{ width: `${pct}%`, backgroundColor: CHAIN_COLORS[g.chain] }}
                title={`${CHAIN_LABEL[g.chain]} · ${pct.toFixed(1)}%`}
              />
            );
          })}
        </div>
      )}

      {/* Horizontal chain tabs (sorted largest-USD first). */}
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        {groups.map((g) => {
          const isActive = activeGroup?.chain === g.chain;
          const pct = totalUsd > 0 ? (g.totalUsd / totalUsd) * 100 : 0;
          return (
            <button
              key={g.chain}
              type="button"
              onClick={() => setActiveChain(g.chain)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border whitespace-nowrap shrink-0 transition ${
                isActive
                  ? "border-primary bg-primary/5 text-text"
                  : "border-border bg-surface-2/40 text-text-muted hover:text-text hover:border-primary/40"
              }`}
            >
              <ChainPill chain={g.chain} />
              <span className="text-xs tabular">
                <UsdValue
                  value={g.totalUsd}
                  priceUsd={g.totalUsd > 0 ? 1 : null}
                  className="font-semibold"
                />
                <span className="ml-1 opacity-60">· {pct.toFixed(1)}%</span>
              </span>
              {g.change24h != null && (
                <span
                  className={`text-[10px] font-semibold tabular ${
                    g.change24h >= 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {g.change24h >= 0 ? "+" : ""}
                  {g.change24h.toFixed(2)}%
                </span>
              )}
              <span className="text-[10px] text-text-muted">
                {g.holdings.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active chain's holdings table */}
      {activeGroup && (
        <NetworkHoldingsTable
          group={activeGroup}
          btcPriceUsd={btcPriceUsd}
          excluded={excluded}
          toggleExcluded={toggleExcluded}
          rowKey={rowKey}
        />
      )}
    </section>
  );
}

function NetworkHoldingsTable({
  group,
  btcPriceUsd,
  excluded,
  toggleExcluded,
  rowKey,
}: {
  group: NetworkGroup;
  btcPriceUsd: number | null;
  excluded: Set<string>;
  toggleExcluded: (key: string) => void;
  rowKey: (r: HoldingRow) => string;
}) {
  const sorted = useMemo(
    () => [...group.holdings].sort((a, b) => b.valueUsd - a.valueUsd),
    [group.holdings],
  );

  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm tabular">
        <thead className="bg-surface-2/60 text-text-muted">
          <tr>
            <th className="px-2 py-2 w-10 text-center">On</th>
            <th className="px-3 py-2 text-left">Token</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-right">Value</th>
            <th className="px-3 py-2 text-right">≈ BTC</th>
            <th className="px-3 py-2 text-right">24h</th>
            <th className="px-3 py-2 text-right">Buy</th>
            <th className="px-3 py-2 text-left">Address</th>
            <th className="px-3 py-2 text-left">Holders</th>
            <th className="px-2 py-2 w-8" aria-label="External" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const k = rowKey(r);
            const isOn = !excluded.has(k);
            const btcEq =
              btcPriceUsd != null && btcPriceUsd > 0 && r.valueUsd > 0
                ? r.valueUsd / btcPriceUsd
                : null;
            const tokenUrl = tokenExplorerUrl(r.chain, r.contract);
            const holdersUrl = holdersExplorerUrl(r.chain, r.contract);
            const isNative = r.contract === "" || r.contract === "native";
            return (
              <tr
                key={k}
                className={`${i % 2 === 0 ? "bg-transparent" : "bg-surface-2/30"} ${
                  isOn ? "" : "opacity-40"
                }`}
              >
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggleExcluded(k)}
                    title={isOn ? "Hide from totals" : "Include in totals"}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  />
                </td>
                <td
                  className={`px-3 py-2 ${isOn ? "" : "line-through"} min-w-[12rem]`}
                >
                  <div className="font-semibold text-text truncate">
                    {r.symbol ?? r.name ?? "—"}
                  </div>
                  {r.name && r.symbol && r.name !== r.symbol && (
                    <div className="text-xs text-text-muted truncate" title={r.name}>
                      {r.name}
                    </div>
                  )}
                </td>
                <td className={`px-3 py-2 text-right ${isOn ? "" : "line-through"}`}>
                  {formatAmount(r.amount)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    isOn ? "" : "line-through"
                  }`}
                >
                  <UsdValue value={r.valueUsd} priceUsd={r.priceUsd} />
                </td>
                <td className="px-3 py-2 text-right text-text-muted">
                  {btcEq != null ? <BtcValue value={btcEq} /> : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.priceChange24h == null ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    <span
                      className={`font-semibold ${
                        r.priceChange24h >= 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {r.priceChange24h >= 0 ? "+" : ""}
                      {r.priceChange24h.toFixed(2)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-text-muted">—</td>
                <td className="px-3 py-2 text-left">
                  {isNative ? (
                    <span className="text-xs text-text-muted">native</span>
                  ) : tokenUrl ? (
                    <a
                      href={tokenUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs text-primary hover:text-primary-hover font-mono"
                      title={r.contract}
                    >
                      {shortenAddress(r.contract, 6, 4)} ↗
                    </a>
                  ) : (
                    <span className="text-xs text-text-muted font-mono">
                      {shortenAddress(r.contract, 6, 4)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-left">
                  {holdersUrl ? (
                    <a
                      href={holdersUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs text-primary hover:text-primary-hover"
                      title="View holders on explorer"
                    >
                      View ↗
                    </a>
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center">
                  <CmcLink symbol={r.symbol ?? r.name} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
