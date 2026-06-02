"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AddExchangeDialog } from "./AddExchangeDialog";
import { AddOffchainBalanceDialog } from "./AddOffchainBalanceDialog";
import { UsdValue } from "./MaskedValue";
import { formatRelative } from "@/lib/format";

export interface ExchangeRow {
  id: string;
  provider: string;
  label: string;
  totalUsd: number;
  lastSyncedAt: string | null;
  balanceCount: number;
  /** Per-asset breakdown — used to subtract user-excluded assets client-side. */
  balances: { asset: string; valueUsd: number }[];
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
}: {
  exchanges: ExchangeRow[];
  offchain: OffchainRow[];
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshOne(exchangeId: string): Promise<string | null> {
    const res = await fetch("/api/exchanges/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exchangeId }),
    });
    // Vercel returns an HTML/plain-text error page on function timeouts
    // and 5xx — calling res.json() blind throws the cryptic
    // "Unexpected token 'A', \"An error o\"..." and hides the real cause.
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
    const apiErrors = json.exchanges?.[0]?.errors ?? [];
    if (apiErrors.length > 0) {
      return apiErrors.map((e) => `${e.kind}: ${e.error}`).join(" · ");
    }
    return null;
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
              <li
                key={ex.id}
                className="group relative flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-xl border border-border bg-surface-2/40 transition hover:border-primary/50"
              >
                <Link
                  href={`/dashboard/exchange/${ex.id}`}
                  className="absolute inset-0 z-0"
                  aria-label={`Open ${ex.label}`}
                />
                <div className="min-w-0 flex-1 relative z-10 pointer-events-none">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-text group-hover:text-primary">
                      {ex.label}
                    </span>
                    <span className="pill">{ex.provider}</span>
                    {(() => {
                      const ex2 = excludes[ex.id] ?? new Set<string>();
                      const top = [...ex.balances]
                        .filter(
                          (b) => b.valueUsd > 0 && !ex2.has(b.asset.toUpperCase()),
                        )
                        .sort((a, b) => b.valueUsd - a.valueUsd)
                        .slice(0, 4);
                      if (top.length === 0) return null;
                      return (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {top.map((b) => (
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
                      );
                    })()}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {ex.balanceCount} {ex.balanceCount === 1 ? "asset" : "assets"}
                    {ex.lastSyncedAt
                      ? ` · synced ${formatRelative(ex.lastSyncedAt)}`
                      : " · never synced"}
                  </div>
                </div>
                <div className="flex items-center gap-3 tabular shrink-0 relative z-10">
                  <UsdValue
                    value={adjustedTotal(ex)}
                    priceUsd={adjustedTotal(ex) > 0 ? 1 : null}
                    className="font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => refresh(ex.id)}
                    disabled={refreshing !== null}
                    className="text-xs text-primary hover:text-primary-hover"
                  >
                    {refreshing === ex.id ? "…" : "Refresh"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeExchange(ex.id)}
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
