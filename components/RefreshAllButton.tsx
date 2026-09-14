"use client";

import { useEffect, useRef, useState } from "react";
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
  /** Render ONLY a single compact "Refresh All" button (no "24h fill"
   *  secondary button, no stacked column) so it sits inline in a
   *  horizontal header button row alongside "+ Portfolio" / "+ Wallet".
   *  The status/last-refreshed line renders beneath as a full-width note. */
  inlineRow?: boolean;
}

// One wallet per request — keeps every /api/holdings call well under
// Vercel's 60s budget even when the wallet has hundreds of tokens (e.g.
// a Phantom wallet with a long SPL list). Many small requests run in
// parallel below, so this is faster than the old "5-per-chunk + serial"
// shape, not slower.
const CHUNK_SIZE = 1;
// Cap how many wallet refreshes are in flight at once. Vercel auto-scales
// invocations, but the per-region concurrency is bounded and bursty
// dispatch occasionally surfaces as "Failed to fetch" — this throttles
// the client just enough to stay below that ceiling.
const PARALLEL_LIMIT = 8;

// Auto-refresh on dashboard mount is throttled client-side (localStorage)
// so navigating between pages / re-rendering doesn't hammer every wallet +
// exchange API on every visit. A fresh full sync on load is still valuable
// since prices/balances can be minutes-to-hours stale from the last visit.
const AUTO_REFRESH_KEY = "crypto-last-auto-refresh";
const AUTO_REFRESH_MIN_GAP_MS = 2 * 60 * 1000; // don't auto-refresh more than once every 2 min
// How often to re-check whether an auto-refresh is due while the tab stays
// open. Deliberately longer than AUTO_REFRESH_MIN_GAP_MS (which is the
// dedupe floor shared with the mount-time trigger) so a long-lived tab
// doesn't hammer every wallet/exchange API every 2 minutes — 10 min keeps
// snapshots (and the 24h change card) fresh without being aggressive.
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function RefreshAllButton({
  walletIds,
  lastFetchedAt,
  compact = false,
  inlineRow = false,
}: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef(false);

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
      // Build per-wallet chunks up front (CHUNK_SIZE=1) and walk them
      // with a small parallel pool. Pull from a shared cursor so the
      // worker count is the only bound on in-flight requests; each
      // request only carries one wallet, so a slow one doesn't gate
      // anything else and a failure only affects its own wallet.
      const chunks: string[][] = [];
      for (let i = 0; i < walletIds.length; i += CHUNK_SIZE) {
        chunks.push(walletIds.slice(i, i + CHUNK_SIZE));
      }
      let done = 0;
      let cursor = 0;
      async function processOne(chunk: string[]): Promise<void> {
        try {
          const res = await fetch("/api/holdings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ walletIds: chunk }),
          });
          const json = (await res.json().catch(() => null)) as
            | {
                error?: string;
                configError?: string | null;
                wallets?: { walletId: string; chainType: string; error?: string }[];
              }
            | null;
          if (!res.ok) {
            for (const id of chunk) {
              walletErrors.push({
                id,
                chain: "?",
                msg: json?.error ?? `Chunk failed (${res.status})`,
              });
            }
            return;
          }
          if (!configError && json?.configError) configError = json.configError;
          for (const w of json?.wallets ?? []) {
            if (w.error) {
              walletErrors.push({ id: w.walletId, chain: w.chainType, msg: w.error });
            }
          }
        } catch (e) {
          // Network-level error (TLS, DNS, Vercel timeout returning HTML).
          // Tag every wallet in this chunk so the user sees what failed.
          const msg = e instanceof Error ? e.message : "Network error";
          for (const id of chunk) walletErrors.push({ id, chain: "?", msg });
        } finally {
          done += chunk.length;
          setProgress({ done, total: walletIds.length });
        }
      }
      async function pump(): Promise<void> {
        while (true) {
          const i = cursor++;
          if (i >= chunks.length) return;
          await processOne(chunks[i]);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL_LIMIT, chunks.length) }, () => pump()),
      );
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

  // Auto-refresh on mount when the dashboard loads, so the user always
  // sees a fresh sync of every wallet (all chains) + every exchange
  // without needing to click "Refresh all" manually. Throttled via
  // localStorage so switching tabs/pages within the same short window
  // doesn't re-trigger a full resync repeatedly.
  //
  // ALSO re-runs on an interval (AUTO_REFRESH_MIN_GAP_MS) as long as the
  // tab stays open. Without this, a dashboard left open for hours never
  // records a new portfolio snapshot after the first load, which froze
  // the 24h change card ("-1.78% / -$11,105.86") on stale data indefinitely
  // — the card's "now" is anchored to the latest snapshot's timestamp, so
  // no new snapshot meant no new "now" and the same frozen number forever.
  useEffect(() => {
    if (walletIds.length === 0) return;

    function maybeRefresh() {
      try {
        const last = Number(window.localStorage.getItem(AUTO_REFRESH_KEY) ?? "0");
        if (Date.now() - last < AUTO_REFRESH_MIN_GAP_MS) return;
        window.localStorage.setItem(AUTO_REFRESH_KEY, String(Date.now()));
      } catch {
        // localStorage unavailable (e.g. private mode) — still safe to run.
      }
      void refresh();
    }

    if (!autoRanRef.current) {
      autoRanRef.current = true;
      maybeRefresh();
    }

    // Re-check every AUTO_REFRESH_MIN_GAP_MS while the tab is open. The
    // localStorage throttle above still gates the actual network burst,
    // so this just makes sure a long-lived tab eventually fires it again
    // instead of only ever running once at mount.
    const interval = window.setInterval(maybeRefresh, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletIds.length]);

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

  // Inline-row mode: a single compact "Refresh All" button that lines up
  // horizontally with "+ Portfolio" / "+ Wallet" in the header. The
  // last-refreshed / error status renders as a small full-width line
  // beneath the whole button row (so it doesn't widen the row itself).
  if (inlineRow) {
    return (
      <button
        type="button"
        onClick={refresh}
        disabled={running || walletIds.length === 0}
        className={`btn-ghost text-xs !px-3 !py-1.5 inline-flex items-center gap-1.5 ${
          isStale && !running ? "ring-2 ring-primary/40" : ""
        }`}
        title={
          walletIds.length === 0
            ? "Add a wallet first"
            : error
              ? error
              : `${statusLabel} · Refresh ${walletIds.length} wallets`
        }
      >
        <svg
          width={14}
          height={14}
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
        {running && progress
          ? `Refreshing ${progress.done}/${progress.total}…`
          : "Refresh All"}
      </button>
    );
  }

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
