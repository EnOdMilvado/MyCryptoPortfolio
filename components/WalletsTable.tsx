"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { BtcValue, UsdValue } from "./MaskedValue";
import { ChainPill } from "./ChainPill";
import { formatAmount } from "@/lib/format";
import type { HoldingRow } from "./HoldingsTable";
import type { ChainId } from "@/lib/chains/types";

interface WalletStat {
  walletId: string;
  walletName: string;
  walletAddress: string;
  portfolioId: string | null;
  portfolioName: string | null;
  /** Primary chain — chain that holds the largest USD value in this wallet. */
  primaryChain: ChainId | null;
  totalUsd: number;
  /** All token holdings in this wallet (sorted by USD desc). */
  holdings: HoldingRow[];
}

function aggregateByWallet(
  rows: HoldingRow[],
  walletIds: string[],
): WalletStat[] {
  const known = new Set(walletIds);
  const map = new Map<string, WalletStat & { _topUsd: number }>();
  for (const r of rows) {
    if (!known.has(r.walletId)) continue;
    const cur = map.get(r.walletId);
    if (cur) {
      cur.totalUsd += r.valueUsd;
      cur.holdings.push(r);
      if (r.valueUsd > cur._topUsd) {
        cur._topUsd = r.valueUsd;
        cur.primaryChain = r.chain;
      }
    } else {
      map.set(r.walletId, {
        walletId: r.walletId,
        walletName: r.walletName,
        walletAddress: r.walletAddress,
        portfolioId: r.portfolioId ?? null,
        portfolioName: r.portfolioName ?? null,
        primaryChain: r.chain,
        totalUsd: r.valueUsd,
        holdings: [r],
        _topUsd: r.valueUsd,
      });
    }
  }
  // Placeholders for wallets the dashboard tracks but that don't have any
  // holdings cached yet — so the toggle is still reachable.
  for (const wid of walletIds) {
    if (map.has(wid)) continue;
    map.set(wid, {
      walletId: wid,
      walletName: wid.slice(0, 8),
      walletAddress: "",
      portfolioId: null,
      portfolioName: null,
      primaryChain: null,
      totalUsd: 0,
      holdings: [],
      _topUsd: 0,
    });
  }
  for (const v of map.values()) {
    v.holdings.sort((a, b) => b.valueUsd - a.valueUsd);
  }
  return [...map.values()].sort((a, b) => b.totalUsd - a.totalUsd);
}

/**
 * Wallets table — compact view: ☑ / Wallet / USD / BTC / Top 3 tokens.
 * Each row expands to a sub-table showing every holding in the wallet
 * (symbol / amount / value / % of wallet).
 * Outer card stays fixed height; this table scrolls internally.
 */
export function WalletsTable({
  rows,
  walletIds,
  btcPriceUsd,
  excludedWallets,
  excludedPortfolios,
  onToggleWallet,
}: {
  rows: HoldingRow[];
  walletIds: string[];
  btcPriceUsd: number | null;
  excludedWallets: Set<string>;
  excludedPortfolios: Set<string>;
  onToggleWallet: (id: string) => void;
}) {
  const stats = useMemo(
    () => aggregateByWallet(rows, walletIds),
    [rows, walletIds],
  );
  const grandTotalUsd = useMemo(
    () =>
      stats.reduce(
        (s, w) =>
          excludedWallets.has(w.walletId) ||
          (w.portfolioId && excludedPortfolios.has(w.portfolioId))
            ? s
            : s + w.totalUsd,
        0,
      ),
    [stats, excludedWallets, excludedPortfolios],
  );
  const showBtc = btcPriceUsd != null && btcPriceUsd > 0;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(walletId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(walletId)) next.delete(walletId);
      else next.add(walletId);
      return next;
    });
  }

  if (stats.length === 0) {
    return (
      <div className="text-sm text-text-muted text-center py-4">
        No wallets yet.
      </div>
    );
  }

  return (
    <div
      className="overflow-auto rounded-xl border border-border"
      style={{ maxHeight: "22rem" }}
    >
      <table className="w-full text-sm tabular border-collapse">
        <thead className="bg-surface-2/80 backdrop-blur sticky top-0 z-10 text-[11px] uppercase tracking-wide font-semibold text-text-muted">
          <tr className="border-b border-border">
            <th className="px-2 py-2 text-left w-10">On</th>
            <th className="px-3 py-2 text-left">Wallet</th>
            <th className="px-3 py-2 text-left whitespace-nowrap">USD</th>
            {showBtc && (
              <th className="px-3 py-2 text-left whitespace-nowrap">BTC</th>
            )}
            <th className="px-3 py-2 text-left">Top tokens</th>
            <th className="px-2 py-2 w-8" aria-label="Expand" />
          </tr>
        </thead>
        <tbody>
          {stats.map((w, i) => {
            const portfolioOff =
              w.portfolioId != null && excludedPortfolios.has(w.portfolioId);
            const isOn = !excludedWallets.has(w.walletId) && !portfolioOff;
            const isExpanded = expanded.has(w.walletId);
            const top3 = w.holdings.slice(0, 3);
            const remaining = w.holdings.length - top3.length;
            const isExchange = w.walletId.startsWith("exchange:");
            return (
              <Fragment key={w.walletId}>
                <tr
                  className={`${i % 2 === 0 ? "" : "bg-surface-2/30"} ${
                    isOn ? "" : "opacity-50"
                  }`}
                >
                  <td className="px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={portfolioOff}
                      onChange={() => onToggleWallet(w.walletId)}
                      title={
                        portfolioOff
                          ? "Portfolio is disabled"
                          : isOn
                            ? "Hide from totals"
                            : "Include in totals"
                      }
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 text-left min-w-[12rem]">
                    <div className="flex items-center gap-2 min-w-0">
                      {w.primaryChain && (
                        <ChainPill chain={w.primaryChain} size="xs" />
                      )}
                      {w.portfolioId && !isExchange ? (
                        <Link
                          href={`/dashboard/portfolio/${w.portfolioId}/wallet/${w.walletId}`}
                          className="font-semibold text-text truncate hover:text-primary"
                        >
                          {w.walletName}
                        </Link>
                      ) : (
                        <span className="font-semibold text-text truncate">
                          {w.walletName}
                        </span>
                      )}
                    </div>
                    {w.portfolioName && (
                      <div className="text-xs text-text-muted truncate ml-1">
                        {w.portfolioName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                    <UsdValue
                      value={w.totalUsd}
                      priceUsd={w.totalUsd > 0 ? 1 : null}
                    />
                  </td>
                  {showBtc && (
                    <td className="px-3 py-2 text-left text-text-muted whitespace-nowrap">
                      {w.totalUsd > 0 ? (
                        <BtcValue value={w.totalUsd / (btcPriceUsd as number)} />
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 text-left">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {top3.length === 0 ? (
                        <span className="text-text-muted text-xs">—</span>
                      ) : (
                        top3.map((h, j) => (
                          <span
                            key={`${h.contract}-${j}`}
                            className="inline-flex items-center text-xs font-semibold text-text bg-surface-2 px-1.5 py-0.5 rounded"
                            title={`${formatAmount(h.amount)} ${h.symbol ?? ""}`}
                          >
                            {h.symbol ?? h.name ?? "?"}
                          </span>
                        ))
                      )}
                      {remaining > 0 && (
                        <span className="text-text-muted text-xs">
                          +{remaining}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-left">
                    {w.holdings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(w.walletId)}
                        className="text-text-muted hover:text-primary text-xs"
                        title={isExpanded ? "Hide tokens" : "Show all tokens"}
                      >
                        {isExpanded ? "▾" : "▸"}
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-surface-2/40">
                    <td colSpan={showBtc ? 6 : 5} className="px-4 py-3">
                      <WalletHoldingsSubTable holdings={w.holdings} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {grandTotalUsd > 0 && (
          <tfoot className="border-t-2 border-border bg-surface-2/40">
            <tr className="font-bold text-text">
              <td className="px-2 py-2" />
              <td className="px-3 py-2 text-left text-xs uppercase tracking-wide text-text-muted">
                Total
              </td>
              <td className="px-3 py-2 text-left tabular whitespace-nowrap">
                <UsdValue value={grandTotalUsd} priceUsd={1} />
              </td>
              {showBtc && (
                <td className="px-3 py-2 text-left tabular whitespace-nowrap text-text-muted">
                  <BtcValue value={grandTotalUsd / (btcPriceUsd as number)} />
                </td>
              )}
              <td className="px-3 py-2" />
              <td className="px-2 py-2" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Sub-table shown when a wallet row is expanded — one row per holding. */
function WalletHoldingsSubTable({ holdings }: { holdings: HoldingRow[] }) {
  const walletTotal = holdings.reduce((s, h) => s + h.valueUsd, 0);
  return (
    <div
      role="table"
      className="grid items-center gap-x-3 gap-y-1.5 text-sm grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_max-content_max-content]"
    >
      <div className="contents text-xs uppercase tracking-wide font-semibold text-text-muted">
        <span>Token</span>
        <span>Amount</span>
        <span className="text-right">USD</span>
        <span className="text-right">% of wallet</span>
      </div>
      {holdings.map((h, i) => {
        const pct = walletTotal > 0 ? (h.valueUsd / walletTotal) * 100 : 0;
        return (
          <div key={`${h.contract}-${i}`} className="contents">
            <span className="font-semibold text-text truncate" title={h.name ?? h.symbol ?? ""}>
              {h.symbol ?? h.name ?? "—"}
            </span>
            <span className="tabular truncate">
              {formatAmount(h.amount)}{" "}
              <span className="text-text-muted">{h.symbol ?? ""}</span>
            </span>
            <span className="text-right tabular font-semibold">
              <UsdValue value={h.valueUsd} priceUsd={h.priceUsd} />
            </span>
            <span className="text-right tabular text-text-muted text-xs">
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
