"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { UsdValue } from "./MaskedValue";
import { ChainPill } from "./ChainPill";
import { CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import { formatAmount, formatRelative } from "@/lib/format";
import {
  ViewToggle,
  readViewMode,
  writeViewMode,
  type ViewMode,
} from "./ViewToggle";

export interface NftRow {
  walletId: string;
  chain: ChainId;
  contract: string;
  tokenId: string;
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  floorEth: number | null;
  floorUsd: number | null;
  costBasisUsd: number | null;
  isSpam: boolean;
  userHidden?: boolean;
}

interface Props {
  walletId: string;
  initialNfts: NftRow[];
  fetchedAt: string | null;
}

export function NftSection({ walletId, initialNfts, fetchedAt: initialFetchedAt }: Props) {
  const router = useRouter();
  const [nfts, setNfts] = useState<NftRow[]>(initialNfts);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initialFetchedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpam, setShowSpam] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [costInput, setCostInput] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    setViewMode(readViewMode("crypto-nft-view"));
  }, []);
  function setView(v: ViewMode) {
    setViewMode(v);
    writeViewMode("crypto-nft-view", v);
  }

  // "Effective spam" = either Alchemy-flagged OR user-hidden.
  function isHidden(n: NftRow): boolean {
    return n.isSpam || !!n.userHidden;
  }
  const cleanNfts = useMemo(() => nfts.filter((n) => !isHidden(n)), [nfts]);
  const spamCount = nfts.length - cleanNfts.length;
  const visible = showSpam ? nfts : cleanNfts;

  const totalFloorUsd = cleanNfts.reduce((s, n) => s + (n.floorUsd ?? 0), 0);
  const totalCost = cleanNfts.reduce((s, n) => s + (n.costBasisUsd ?? 0), 0);
  const pnl = totalCost > 0 ? totalFloorUsd - totalCost : null;

  async function toggleHidden(n: NftRow) {
    const next = !n.userHidden;
    const key = nftKey(n);
    // Optimistic update.
    setNfts((prev) =>
      prev.map((x) => (nftKey(x) === key ? { ...x, userHidden: next } : x)),
    );
    await supabaseBrowser()
      .from("crypto_nfts_cache")
      .update({ user_hidden: next })
      .eq("wallet_id", n.walletId)
      .eq("chain", n.chain)
      .eq("contract", n.contract)
      .eq("token_id", n.tokenId);
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/nfts/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletIds: [walletId] }),
      });
      const json = (await res.json()) as { error?: string; fetchedAt?: string };
      if (!res.ok) throw new Error(json.error ?? "Refresh failed");
      setFetchedAt(json.fetchedAt ?? new Date().toISOString());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function nftKey(n: NftRow) {
    return `${n.chain}|${n.contract}|${n.tokenId}`;
  }

  async function saveCost(n: NftRow) {
    const num = costInput === "" ? null : parseFloat(costInput);
    if (num != null && (!Number.isFinite(num) || num < 0)) return;
    const supabase = supabaseBrowser();
    await supabase
      .from("crypto_nfts_cache")
      .update({ cost_basis_usd: num })
      .eq("wallet_id", n.walletId)
      .eq("chain", n.chain)
      .eq("contract", n.contract)
      .eq("token_id", n.tokenId);
    setNfts((prev) =>
      prev.map((x) => (nftKey(x) === nftKey(n) ? { ...x, costBasisUsd: num } : x)),
    );
    setEditing(null);
    setCostInput("");
  }

  return (
    <section className="card animate-fade-up space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-text">NFTs</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {cleanNfts.length} NFTs · floor{" "}
            <UsdValue value={totalFloorUsd} priceUsd={totalFloorUsd > 0 ? 1 : null} className="font-semibold" />
            {totalCost > 0 && (
              <>
                {" · cost "}
                <UsdValue value={totalCost} priceUsd={1} className="font-semibold" />
                {pnl != null && (
                  <>
                    {" · "}
                    <span
                      className={`font-semibold ${pnl >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {pnl >= 0 ? "+" : ""}
                      {pnl.toFixed(0)} P&amp;L
                    </span>
                  </>
                )}
              </>
            )}
            {spamCount > 0 && !showSpam && <> · {spamCount} spam hidden</>}
            {fetchedAt && <> · loaded {formatRelative(fetchedAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={setView} />
          {spamCount > 0 && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={showSpam}
                onChange={(e) => setShowSpam(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="text-primary font-semibold">Show hidden</span>
            </label>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="btn-ghost text-xs"
          >
            {refreshing ? "Loading NFTs…" : "Refresh NFTs"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-danger bg-danger/10 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="text-center text-text-muted text-sm py-8">
          {nfts.length === 0
            ? "No NFTs yet. Click 'Refresh NFTs' to load."
            : "All NFTs in this wallet are hidden."}
        </div>
      ) : viewMode === "list" ? (
        <div
          className={`pr-1 ${
            visible.length > 8 ? "max-h-[500px] overflow-y-auto" : ""
          }`}
        >
          <ul className="flex flex-col gap-2">
            {visible.map((n) => {
              const k = nftKey(n);
              const isVisuallyHidden = n.isSpam || !!n.userHidden;
              return (
                <li
                  key={k}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-surface ${
                    isVisuallyHidden ? "opacity-60" : ""
                  }`}
                >
                  <div className="h-12 w-12 rounded-lg bg-surface-2 overflow-hidden shrink-0">
                    {n.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={n.imageUrl} alt={n.name ?? "NFT"} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-lg text-text-muted">⬡</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold truncate">{n.name ?? `#${n.tokenId.slice(0, 8)}`}</div>
                    <div className="text-xs text-text-muted truncate">
                      {n.collectionName ?? "Unknown"} · {CHAIN_LABEL[n.chain]}
                    </div>
                  </div>
                  <div className="text-right tabular shrink-0 text-xs">
                    {n.floorEth != null ? (
                      <>
                        <div className="font-semibold">
                          {formatAmount(n.floorEth)} Ξ
                        </div>
                        {n.floorUsd != null && (
                          <UsdValue value={n.floorUsd} priceUsd={1} className="text-text-muted" />
                        )}
                      </>
                    ) : (
                      <span className="text-text-muted">No floor</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleHidden(n)}
                    aria-label={n.userHidden ? "Show NFT" : "Hide NFT"}
                    title={n.userHidden ? "Unhide" : "Hide — treat as spam"}
                    className="h-8 w-8 rounded-full bg-surface-2 text-text-muted hover:text-primary inline-flex items-center justify-center shrink-0"
                  >
                    {n.userHidden ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          className={`pr-1 ${
            visible.length > 6 ? "max-h-[420px] overflow-y-auto" : ""
          }`}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {visible.map((n) => {
            const k = nftKey(n);
            const isEditing = editing === k;
            const isVisuallyHidden = n.isSpam || !!n.userHidden;
            const pl =
              n.costBasisUsd != null && n.floorUsd != null
                ? n.floorUsd - n.costBasisUsd
                : null;
            return (
              <div
                key={k}
                className={`relative rounded-xl border border-border bg-surface-2/40 overflow-hidden ${isVisuallyHidden ? "opacity-70" : ""}`}
              >
                <div className="aspect-square bg-surface-2 relative">
                  {n.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={n.imageUrl}
                      alt={n.name ?? "NFT"}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-3xl text-text-muted">
                      ⬡
                    </div>
                  )}
                  {/* Top-right: eye toggle + spam badge */}
                  <div className="absolute top-1 right-1 flex items-center gap-1">
                    {n.isSpam && (
                      <span className="pill bg-danger/20 text-danger text-[10px]">
                        spam
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleHidden(n)}
                      aria-label={n.userHidden ? "Show NFT" : "Hide NFT"}
                      title={n.userHidden ? "Unhide" : "Hide — treat as spam"}
                      className="h-6 w-6 rounded-full bg-surface/80 backdrop-blur-sm text-text-muted hover:text-primary inline-flex items-center justify-center"
                    >
                      {n.userHidden ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <ChainPill
                    chain={n.chain}
                    size="xs"
                    className="absolute bottom-1 left-1 shadow-sm"
                  />
                </div>
                <div className="p-2 space-y-1">
                  <div
                    className="text-xs text-text-muted truncate"
                    title={n.collectionName ?? ""}
                  >
                    {n.collectionName ?? "Unknown collection"}
                  </div>
                  <div className="text-sm font-bold truncate" title={n.name ?? `#${n.tokenId}`}>
                    {n.name ?? `#${n.tokenId.slice(0, 8)}`}
                  </div>
                  <div className="flex items-center justify-between text-xs tabular">
                    <span className="text-text-muted">Floor</span>
                    <span className="font-semibold">
                      {n.floorEth != null ? (
                        <>
                          {n.floorEth.toFixed(4)} Ξ
                          {n.floorUsd != null && (
                            <span className="text-text-muted ml-1">
                              (<UsdValue value={n.floorUsd} priceUsd={1} />)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs tabular">
                    <span className="text-text-muted">Cost</span>
                    {isEditing ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={costInput}
                          onChange={(e) => setCostInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveCost(n);
                            if (e.key === "Escape") {
                              setEditing(null);
                              setCostInput("");
                            }
                          }}
                          placeholder="$"
                          className="w-16 px-1.5 py-0.5 rounded border border-border bg-surface text-xs tabular text-right"
                        />
                        <button
                          type="button"
                          onClick={() => saveCost(n)}
                          className="text-primary hover:text-primary-hover text-[10px] font-semibold"
                        >
                          ✓
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(k);
                          setCostInput(n.costBasisUsd?.toString() ?? "");
                        }}
                        className="hover:text-primary transition"
                        title="Click to set purchase price"
                      >
                        {n.costBasisUsd != null ? (
                          <UsdValue value={n.costBasisUsd} priceUsd={1} className="font-semibold" />
                        ) : (
                          <span className="text-text-muted underline-offset-2 hover:underline">+ set</span>
                        )}
                      </button>
                    )}
                  </div>
                  {pl != null && (
                    <div className="flex items-center justify-between text-xs tabular">
                      <span className="text-text-muted">P&amp;L</span>
                      <span className={`font-semibold ${pl >= 0 ? "text-success" : "text-danger"}`}>
                        {pl >= 0 ? "+" : ""}
                        <UsdValue value={pl} priceUsd={1} />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}
