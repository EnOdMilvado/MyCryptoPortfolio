"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AddExchangeDialog } from "./AddExchangeDialog";
import { AddOffchainBalanceDialog } from "./AddOffchainBalanceDialog";
import { UsdValue } from "./MaskedValue";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { useExcludedIds } from "./exchange/useExcludedIds";
import { formatRelative } from "@/lib/format";
import type { ChainId } from "@/lib/chains/types";

export interface ExchangeRow {
  id: string;
  provider: string;
  label: string;
  totalUsd: number;
  lastSyncedAt: string | null;
  balanceCount: number;
  /** Per-asset breakdown — drives the inline holdings table and the
   *  subtract-user-excluded-assets totals client-side. */
  balances: {
    asset: string;
    amount: number;
    priceUsd: number | null;
    valueUsd: number;
    priceChange24h: number | null;
  }[];
}

/**
 * Load the per-exchange exclude sets from localStorage on the client. Same
 * key shape as the exchange-detail page so toggles roundtrip.
 */
function useExchangeExcludes(exchanges: ExchangeRow[]): Record<string, Set<string>> {
  const [excludesByExchange, setExcludesByExchange] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    const out: Record<string, Set<string>> = {};
    for (const ex of exchanges) {
      try {
        const raw = window.localStorage.getItem(`excluded-exchange-assets:${ex.id}`);
        if (raw) {
          const arr = JSON.parse(raw) as string[];
          if (Array.isArray(arr)) out[ex.id] = new Set(arr.map((a) => a.toUpperCase()));
        }
      } catch {
        // ignore corrupt entry
      }
    }
    setExcludesByExchange(out);
    // Listen to storage changes from other tabs and from our own writes
    // (manually fired via window.dispatchEvent).
    function onStorage() {
      const next: Record<string, Set<string>> = {};
      for (const ex of exchanges) {
        try {
          const raw = window.localStorage.getItem(`excluded-exchange-assets:${ex.id}`);
          if (raw) {
            const arr = JSON.parse(raw) as string[];
            if (Array.isArray(arr)) next[ex.id] = new Set(arr.map((a) => a.toUpperCase()));
          }
        } catch {
          // ignore
        }
      }
      setExcludesByExchange(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [exchanges]);
  return excludesByExchange;
}

export interface OffchainRow {
  id: string;
  label: string;
  kind: string;
  currency: string;
  amount: number;
  /** Best-effort USD value (for non-USD currencies we leave as raw amount). */
  valueUsd: number;
}

/** Tight USD label that fits inside a per-asset chip ($1.2K / $4.5M). */
function compactUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(2);
}

const KIND_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  credit_card: "Credit card",
  brokerage: "Brokerage",
  other: "Other",
};

export function ExchangesAndOffchain({
  exchanges,
  offchain,
  btcPriceUsd = null,
}: {
  exchanges: ExchangeRow[];
  offchain: OffchainRow[];
  btcPriceUsd?: number | null;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-kind so each request gets its own 60s Vercel budget. Running all
  // five kinds in one request reliably timed out on MEXC because /allOrders
  // alone takes ~35-40s once you chunk 90 days into 6-day windows.
  const SYNC_KINDS = ["spot", "trades", "orders", "deposits", "withdrawals"] as const;

  async function refreshKind(
    exchangeId: string,
    kind: (typeof SYNC_KINDS)[number],
  ): Promise<string | null> {
    const res = await fetch("/api/exchanges/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exchangeId, kinds: [kind] }),
    });
    // Vercel returns an HTML/plain-text error page on function timeouts
    // and 5xx — calling res.json() blind throws "Unexpected token 'A',
    // \"An error o\"..." and hides the real cause.
    const raw = await res.text();
    let json: { error?: string; exchanges?: { errors?: { kind: string; error: string }[] }[] } = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      const snippet = raw.replace(/<[^>]+>/g, " ").trim().slice(0, 200);
      return res.ok
        ? `Server returned non-JSON: ${snippet}`
        : `Refresh failed (${res.status}) — likely a function timeout. ${snippet}`;
    }
    if (!res.ok) return json.error ?? `Refresh failed (${res.status})`;
    const apiError = json.exchanges?.[0]?.errors?.find((e) => e.kind === kind);
    return apiError ? apiError.error : null;
  }

  async function refreshOne(exchangeId: string): Promise<string | null> {
    // Fire all five kinds in parallel — each runs in its own Vercel
    // function instance so the slow ones (orders, trades) no longer
    // starve the fast ones (spot, deposits).
    const results = await Promise.all(
      SYNC_KINDS.map(async (kind) => ({ kind, err: await refreshKind(exchangeId, kind) })),
    );
    const failed = results.filter((r) => r.err);
    if (failed.length === 0) return null;
    return failed.map((r) => `${r.kind}: ${r.err}`).join(" · ");
  }

  async function refresh(exId: string | null) {
    setRefreshing(exId ?? "all");
    setError(null);
    try {
      // Iterate per-exchange so each request stays well under Vercel's
      // 60s function budget — a single all-exchanges-all-kinds request
      // with 3+ exchanges easily times out and returns an HTML error
      // page (which used to surface as "Unexpected token 'A'").
      const targets = exId ? [exId] : exchanges.map((e) => e.id);
      const errors: string[] = [];
      for (const id of targets) {
        const label = exchanges.find((e) => e.id === id)?.label ?? id;
        const err = await refreshOne(id);
        if (err) errors.push(`${label}: ${err}`);
      }
      if (errors.length > 0) setError(errors.join("\n"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(null);
    }
  }

  async function removeExchange(id: string) {
    if (!confirm("Remove this exchange connection?")) return;
    await supabaseBrowser().from("crypto_exchanges").delete().eq("id", id);
    router.refresh();
  }

  async function removeOffchain(id: string) {
    if (!confirm("Remove this off-chain balance?")) return;
    await supabaseBrowser().from("crypto_offchain_balances").delete().eq("id", id);
    router.refresh();
  }

  const excludes = useExchangeExcludes(exchanges);
  function adjustedTotal(ex: ExchangeRow): number {
    const ex2 = excludes[ex.id];
    if (!ex2 || ex2.size === 0) return ex.totalUsd;
    return ex.balances.reduce(
      (s, b) => (ex2.has(b.asset.toUpperCase()) ? s : s + b.valueUsd),
      0,
    );
  }
  const exchangeTotal = exchanges.reduce((s, e) => s + adjustedTotal(e), 0);
  const offchainTotal = offchain.reduce((s, o) => s + o.valueUsd, 0);

  return (
    <section className="card animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-text">Exchanges & off-chain</h3>
          <p className="text-xs text-text-muted mt-0.5">
            CEX balances and manual entries for cash, bank, credit card and other
            assets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddExchangeDialog />
          <AddOffchainBalanceDialog />
        </div>
      </div>

      {error && (
        <div className="text-sm text-danger bg-danger/10 rounded-xl px-3 py-2 whitespace-pre-line">
          {error}
        </div>
      )}

      {exchanges.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-text">
              Exchanges <span className="text-text-muted font-normal">·{" "}
                <UsdValue value={exchangeTotal} priceUsd={1} /></span>
            </h4>
            <button
              type="button"
              onClick={() => refresh(null)}
              disabled={refreshing !== null}
              className="btn-ghost text-xs"
            >
              {refreshing === "all" ? "Refreshing…" : "Refresh all"}
            </button>
          </div>
          <ul className="space-y-2">
            {exchanges.map((ex) => (
              <ExchangeRowItem
                key={ex.id}
                ex={ex}
                btcPriceUsd={btcPriceUsd}
                refreshing={refreshing}
                onRefresh={() => refresh(ex.id)}
                onRemove={() => removeExchange(ex.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {offchain.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-text">
            Off-chain <span className="text-text-muted font-normal">·{" "}
              <UsdValue value={offchainTotal} priceUsd={1} /></span>
          </h4>
          <ul className="space-y-2">
            {offchain.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-xl border border-border bg-surface-2/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text">{o.label}</span>
                    <span className="pill">{KIND_LABEL[o.kind] ?? o.kind}</span>
                    <span className="text-xs text-text-muted">{o.currency}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 tabular shrink-0">
                  <UsdValue
                    value={o.valueUsd}
                    priceUsd={o.currency === "USD" ? 1 : 1}
                    className={`font-semibold ${o.valueUsd < 0 ? "text-danger" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeOffchain(o.id)}
                    className="text-xs text-text-muted hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {exchanges.length === 0 && offchain.length === 0 && (
        <p className="text-center text-text-muted text-sm py-4">
          No exchanges or off-chain balances yet. Click the buttons above to add.
        </p>
      )}
    </section>
  );
}

/* -------------------- per-exchange expandable row -------------------- */

/**
 * One exchange in the dashboard card. Clicking the row toggles an inline
 * holdings table (all spot balances) right below it; a separate "Open ↗"
 * link still navigates to the full exchange page. Each asset has a checkbox
 * that excludes it from totals — wired to the same
 * `excluded-exchange-assets:{id}` localStorage set the exchange-detail page
 * uses, so unchecking drops the asset from this card's total AND the main
 * dashboard tables/charts (they listen for the storage event).
 */
function ExchangeRowItem({
  ex,
  btcPriceUsd,
  refreshing,
  onRefresh,
  onRemove,
}: {
  ex: ExchangeRow;
  btcPriceUsd: number | null;
  refreshing: string | null;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { excluded, toggle } = useExcludedIds(`excluded-exchange-assets:${ex.id}`);

  const adjusted = ex.balances.reduce(
    (s, b) => (excluded.has(b.asset.toUpperCase()) ? s : s + b.valueUsd),
    0,
  );

  const topChips = [...ex.balances]
    .filter((b) => b.valueUsd > 0 && !excluded.has(b.asset.toUpperCase()))
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 4);

  // Synthesize HoldingRows so we can reuse HoldingsTable (sorting, dust
  // filter, per-row include checkbox) for the inline asset list.
  const rows: HoldingRow[] = ex.balances
    .filter((b) => b.amount > 0 || b.valueUsd > 0)
    .map((b) => ({
      walletId: `exchange:${ex.id}`,
      walletName: ex.label,
      walletAddress: "",
      portfolioId: undefined,
      portfolioName: ex.provider.toUpperCase(),
      chain: "exchange" as ChainId,
      contract: `${ex.id}:${b.asset.toUpperCase()}`,
      symbol: b.asset,
      name: b.asset,
      amount: b.amount,
      priceUsd: b.priceUsd,
      valueUsd: b.valueUsd,
      priceChange24h: b.priceChange24h,
      exchangeId: ex.id,
    }));

  const includedAssetKeys = new Set(
    rows
      .map((r) => (r.symbol ?? "").toUpperCase())
      .filter((a) => !excluded.has(a)),
  );

  return (
    <li className="rounded-xl border border-border bg-surface-2/40 transition hover:border-primary/50">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <svg
              width="14"
              height="14"
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
            <span className="font-semibold text-text group-hover:text-primary">
              {ex.label}
            </span>
            <span className="pill">{ex.provider}</span>
            {topChips.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {topChips.map((b) => (
                  <span
                    key={b.asset}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-text bg-surface-2 px-1.5 py-0.5 rounded"
                    title={`${b.asset} · $${b.valueUsd.toFixed(2)}`}
                  >
                    {b.asset}
                    <span className="text-text-muted font-normal tabular">
                      ${compactUsd(b.valueUsd)}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5 pl-[22px]">
            {ex.balanceCount} {ex.balanceCount === 1 ? "asset" : "assets"}
            {ex.lastSyncedAt
              ? ` · synced ${formatRelative(ex.lastSyncedAt)}`
              : " · never synced"}
            {" · "}
            {open ? "click to collapse" : "click to expand"}
          </div>
        </button>
        <div className="flex items-center gap-3 tabular shrink-0">
          <UsdValue
            value={adjusted}
            priceUsd={adjusted > 0 ? 1 : null}
            className="font-semibold"
          />
          <Link
            href={`/dashboard/exchange/${ex.id}`}
            className="text-xs text-primary hover:text-primary-hover"
          >
            Open ↗
          </Link>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing !== null}
            className="text-xs text-primary hover:text-primary-hover"
          >
            {refreshing === ex.id ? "…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-text-muted hover:text-danger"
          >
            Remove
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border">
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted py-4 text-center">
              No spot balances cached yet — press Refresh.
            </p>
          ) : (
            <HoldingsTable
              rows={rows}
              btcPriceUsd={btcPriceUsd}
              groupColumn="network"
              selectable={{
                getKey: (r) => (r.symbol ?? "").toUpperCase(),
                checked: includedAssetKeys,
                onToggle: (k) => toggle(k),
                header: "Incl",
                ariaLabel: "Include this asset in totals",
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}
