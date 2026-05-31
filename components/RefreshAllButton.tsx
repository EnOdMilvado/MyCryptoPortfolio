"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelative } from "@/lib/format";

interface Props {
  walletIds: string[];
  lastFetchedAt: string | null;
  /** Render the two action buttons stacked + full-width inside a narrow
   *  parent column (used by the dashboard header so the "24h fill",
   *  "Refresh all" and "+ New portfolio" buttons all line up at the
   *  same width one above the other). Default: side-by-side. */
  compact?: boolean;
}

// Refresh in chunks to keep each /api/holdings request under the function
// timeout when the user has many wallets.
const CHUNK_SIZE = 5;

export function RefreshAllButton({ walletIds, lastFetchedAt, compact = false }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (walletIds.length === 0) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: walletIds.length });
    // Collect per-wallet errors across chunks; HTTP 200 from /api/holdings
    // does NOT mean every wallet succeeded — individual failures (e.g.
    // missing Alchemy key, RPC down) are returned inside each
    // WalletHoldings.error field and used to be dropped on the floor.
    let configError: string | null = null;
    const walletErrors: { id: string; chain: string; msg: string }[] = [];
    try {
      for (let i = 0; i < walletIds.length; i += CHUNK_SIZE) {
        const chunk = walletIds.slice(i, i + CHUNK_SIZE);
        const res = await fetch("/api/holdings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ walletIds: chunk }),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              error?: string;
              configError?: string | null;
              wallets?: {
                walletId: string;
                chainType: string;
                error?: string;
              }[];
            }
          | null;
        if (!res.ok) {
          throw new Error(json?.error ?? `Chunk failed (${res.status})`);
        }
        // Hoist the first configError we see — every chunk reports it
        // independently so any one is enough.
        if (!configError && json?.configError) configError = json.configError;
        for (const w of json?.wallets ?? []) {
          if (w.error) {
            walletErrors.push({ id: w.walletId, chain: w.chainType, msg: w.error });
          }
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
      // Also refresh exchange spot balances (MEXC, HTX, …) so the
      // dashboard total includes the latest exchange snapshot too.
      // Best-effort: any failure here is reported but doesn't undo the
      // wallet refresh that just succeeded. Limited to `kinds: ["spot"]`
      // so we don't trigger the slow trades/orders/deposits sync on
      // every dashboard refresh (those still have their own buttons in
      // the per-exchange detail view).
      setProgress(null);
      try {
        const res = await fetch("/api/exchanges/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kinds: ["spot"] }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(json?.error ?? `Exchange spot sync failed (${res.status})`);
        }
      } catch (e) {
        // Surface as a soft warning if wallets otherwise succeeded.
        if (walletErrors.length === 0 && !configError) {
          setError(
            `Wallets refreshed — exchange spot sync failed: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      }
      if (configError) {
        setError(configError);
      } else if (walletErrors.length > 0) {
        // Prefer to show the most common error message + affected count.
        const counts = new Map<string, number>();
        for (const e of walletErrors) counts.set(e.msg, (counts.get(e.msg) ?? 0) + 1);
        const [topMsg, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        setError(
          `${walletErrors.length}/${walletIds.length} wallets failed — ${topCount}× "${topMsg}"`,
        );
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

  // Compact mode: stacked buttons + smaller padding/text so they sit
  // flush with the "+ New portfolio" button stacked beneath them.
  // Default mode: keep the original horizontal pair used elsewhere.
  const wrapClass = compact
    ? "flex flex-col items-stretch gap-1.5 w-full"
    : "flex flex-col items-end gap-1";
  const rowClass = compact
    ? "flex flex-col items-stretch gap-1.5"
    : "flex items-center gap-2";
  const btnBase = compact
    ? "btn-ghost text-xs !px-3 !py-1.5 w-full"
    : "btn-ghost";

  return (
    <div className={wrapClass}>
      <div className={rowClass}>
        <button
          type="button"
          onClick={backfillOnly}
          disabled={running}
          className={`${btnBase} ${compact ? "" : "text-xs"}`}
          title="Fill missing 24h % changes (CoinGecko + DexScreener + Alchemy Historical) without re-fetching balances"
        >
          24h fill
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={running || walletIds.length === 0}
          className={`${btnBase} ${isStale && !running ? "ring-2 ring-primary/40" : ""}`}
          title={
            walletIds.length === 0
              ? "Add a wallet first"
              : `Refresh ${walletIds.length} wallets across all portfolios`
          }
        >
          <svg
            width={compact ? 14 : 16}
            height={compact ? 14 : 16}
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
        className={`text-[10px] ${compact ? "text-center" : "text-xs"} ${error ? "text-danger" : isStale ? "text-primary" : "text-text-muted"}`}
      >
        {error ?? statusLabel}
      </span>
    </div>
  );
}
