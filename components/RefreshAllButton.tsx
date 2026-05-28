"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelative } from "@/lib/format";

interface Props {
  walletIds: string[];
  lastFetchedAt: string | null;
}

// Refresh in chunks to keep each /api/holdings request under the function
// timeout when the user has many wallets.
const CHUNK_SIZE = 5;

export function RefreshAllButton({ walletIds, lastFetchedAt }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (walletIds.length === 0) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: walletIds.length });
    try {
      for (let i = 0; i < walletIds.length; i += CHUNK_SIZE) {
        const chunk = walletIds.slice(i, i + CHUNK_SIZE);
        const res = await fetch("/api/holdings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ walletIds: chunk }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(json?.error ?? `Chunk failed (${res.status})`);
        }
        setProgress({ done: Math.min(i + CHUNK_SIZE, walletIds.length), total: walletIds.length });
      }
      // After all wallets refresh, fill in any 24h % changes that weren't
      // captured during the per-chain price resolution. Best-effort —
      // failures here don't block the refresh.
      try {
        await fetch("/api/holdings/backfill-24h", { method: "POST" });
      } catch {
        // non-fatal
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  /** Standalone backfill — fast path that only fills missing 24h % changes
   *  without re-fetching balances. Useful when you only see "—" cells. */
  async function backfillOnly() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/holdings/backfill-24h", { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? `Backfill failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setRunning(false);
    }
  }

  const ageHours = lastFetchedAt
    ? (Date.now() - new Date(lastFetchedAt).getTime()) / 3_600_000
    : Infinity;
  const isStale = ageHours > 1;

  const statusLabel = running
    ? progress
      ? `Refreshing ${progress.done}/${progress.total}…`
      : "Refreshing…"
    : lastFetchedAt
      ? `Last refreshed ${formatRelative(lastFetchedAt)}`
      : "Never refreshed";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={backfillOnly}
          disabled={running}
          className="btn-ghost text-xs"
          title="Fill missing 24h % changes (CoinGecko + DexScreener + Alchemy Historical) without re-fetching balances"
        >
          24h fill
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={running || walletIds.length === 0}
          className={`btn-ghost ${isStale && !running ? "ring-2 ring-primary/40" : ""}`}
          title={
            walletIds.length === 0
              ? "Add a wallet first"
              : `Refresh ${walletIds.length} wallets across all portfolios`
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={running ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 4 21 10 15 10" />
          </svg>
          Refresh all
        </button>
      </div>
      <span
        className={`text-xs ${error ? "text-danger" : isStale ? "text-primary" : "text-text-muted"}`}
      >
        {error ?? statusLabel}
      </span>
    </div>
  );
}
