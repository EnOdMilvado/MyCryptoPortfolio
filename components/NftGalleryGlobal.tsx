"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { UsdValue } from "./MaskedValue";
import { ChainPill } from "./ChainPill";
import { CHAIN_LABEL, type ChainId } from "@/lib/chains/types";
import { formatAmount } from "@/lib/format";
import {
  ViewToggle,
  readViewMode,
  writeViewMode,
  type ViewMode,
} from "./ViewToggle";

export interface GlobalNft {
  walletId: string;
  walletName: string;
  walletAddress: string;
  portfolioId: string;
  portfolioName: string;
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

type SortKey = "floor" | "name" | "collection";

function nftKey(n: GlobalNft) {
  return `${n.walletId}|${n.chain}|${n.contract}|${n.tokenId}`;
}

function walletHref(n: GlobalNft) {
  return `/dashboard/portfolio/${n.portfolioId}/wallet/${n.walletId}?tab=nfts`;
}

export function NftGalleryGlobal({ nfts: initialNfts }: { nfts: GlobalNft[] }) {
  const [nfts, setNfts] = useState<GlobalNft[]>(initialNfts);
  const [showHidden, setShowHidden] = useState(false);
  const [walletFilter, setWalletFilter] = useState<string>("all");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("floor");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    setViewMode(readViewMode("crypto-nft-global-view"));
  }, []);
  function setView(v: ViewMode) {
    setViewMode(v);
    writeViewMode("crypto-nft-global-view", v);
  }

  function isHidden(n: GlobalNft): boolean {
    return n.isSpam || !!n.userHidden;
  }

  async function toggleHidden(n: GlobalNft) {
    const next = !n.userHidden;
    const k = nftKey(n);
    setNfts((prev) => prev.map((x) => (nftKey(x) === k ? { ...x, userHidden: next } : x)));
    await supabaseBrowser()
      .from("crypto_nfts_cache")
      .update({ user_hidden: next })
      .eq("wallet_id", n.walletId)
      .eq("chain", n.chain)
      .eq("contract", n.contract)
      .eq("token_id", n.tokenId);
  }

  const wallets = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const n of nfts) {
      if (!showHidden && isHidden(n)) continue;
      const cur = map.get(n.walletId);
      if (cur) cur.count += 1;
      else map.set(n.walletId, { name: n.walletName, count: 1 });
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [nfts, showHidden]);

  const collections = useMemo(() => {
    const map = new Map<string, { name: string; count: number; chain: ChainId }>();
    for (const n of nfts) {
      if (!showHidden && isHidden(n)) continue;
      const key = `${n.chain}:${n.contract}`;
      const cur = map.get(key);
      if (cur) cur.count += 1;
      else
        map.set(key, {
          name: n.collectionName ?? "Unknown",
          count: 1,
          chain: n.chain,
        });
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 50);
  }, [nfts, showHidden]);

  const filtered = useMemo(() => {
    return nfts.filter((n) => {
      if (!showHidden && isHidden(n)) return false;
      if (walletFilter !== "all" && n.walletId !== walletFilter) return false;
      if (collectionFilter !== "all") {
        const key = `${n.chain}:${n.contract}`;
        if (key !== collectionFilter) return false;
      }
      return true;
    });
  }, [nfts, showHidden, walletFilter, collectionFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortKey === "floor") {
        return (b.floorUsd ?? -1) - (a.floorUsd ?? -1);
      }
      if (sortKey === "name") {
        return (a.name ?? "").localeCompare(b.name ?? "");
      }
      return (a.collectionName ?? "").localeCompare(b.collectionName ?? "");
    });
    return arr;
  }, [filtered, sortKey]);

  const totalFloor = filtered.reduce((s, n) => s + (n.floorUsd ?? 0), 0);

  function EyeButton({ n }: { n: GlobalNft }) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleHidden(n);
        }}
        aria-label={n.userHidden ? "Show NFT" : "Hide NFT"}
        title={n.userHidden ? "Unhide" : "Hide — treat as spam"}
        className="h-7 w-7 rounded-full bg-surface/80 backdrop-blur-sm text-text-muted hover:text-primary inline-flex items-center justify-center"
      >
        {n.userHidden ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <section className="space-y-4 animate-fade-up">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-text">
              {filtered.length} NFTs
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Total floor{" "}
              <UsdValue
                value={totalFloor}
                priceUsd={totalFloor > 0 ? 1 : null}
                className="font-semibold"
              />
              {" · "}
              {wallets.length} {wallets.length === 1 ? "wallet" : "wallets"}
              {" · "}
              {collections.length} collections
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={viewMode} onChange={setView} />
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="text-primary font-semibold">Show hidden</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-text-muted">Sort:</span>
          {(["floor", "collection", "name"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortKey(k)}
              className={`pill ${sortKey === k ? "bg-primary/15 text-primary" : ""}`}
            >
              {k === "floor" ? "Floor (high→low)" : k === "collection" ? "Collection A-Z" : "Name A-Z"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-text-muted">Wallet:</span>
          <button
            type="button"
            onClick={() => setWalletFilter("all")}
            className={`pill ${walletFilter === "all" ? "bg-primary/15 text-primary" : ""}`}
          >
            All ({filtered.length})
          </button>
          {wallets.map(([id, info]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWalletFilter(id)}
              className={`pill ${walletFilter === id ? "bg-primary/15 text-primary" : ""}`}
            >
              {info.name} ({info.count})
            </button>
          ))}
        </div>

        {collections.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-text-muted">Collection:</span>
            <button
              type="button"
              onClick={() => setCollectionFilter("all")}
              className={`pill ${collectionFilter === "all" ? "bg-primary/15 text-primary" : ""}`}
            >
              All
            </button>
            {collections.slice(0, 12).map(([key, info]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCollectionFilter(key)}
                className={`pill ${collectionFilter === key ? "bg-primary/15 text-primary" : ""}`}
              >
                {info.name} ({info.count})
              </button>
            ))}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="card text-center text-text-muted text-sm py-8">
          No NFTs match the current filters.
        </div>
      ) : viewMode === "list" ? (
        <ul className="flex flex-col gap-2">
          {sorted.map((n) => (
            <li
              key={nftKey(n)}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-surface ${
                isHidden(n) ? "opacity-60" : ""
              }`}
            >
              <div className="h-12 w-12 rounded-lg bg-surface-2 overflow-hidden shrink-0">
                {n.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={n.imageUrl}
                    alt={n.name ?? "NFT"}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-lg text-text-muted">⬡</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">{n.name ?? `#${n.tokenId.slice(0, 8)}`}</div>
                <div className="text-xs text-text-muted truncate">
                  {n.collectionName ?? "Unknown"} · {CHAIN_LABEL[n.chain]}
                </div>
                <Link
                  href={walletHref(n)}
                  className="text-xs text-primary hover:text-primary-hover truncate inline-block"
                  title={`Open ${n.walletName}`}
                >
                  📁 {n.walletName} →
                </Link>
              </div>
              <div className="text-right tabular shrink-0 text-xs">
                {n.floorEth != null ? (
                  <>
                    <div className="font-semibold">{formatAmount(n.floorEth)} Ξ</div>
                    {n.floorUsd != null && (
                      <UsdValue value={n.floorUsd} priceUsd={1} className="text-text-muted" />
                    )}
                  </>
                ) : (
                  <span className="text-text-muted">No floor</span>
                )}
              </div>
              <EyeButton n={n} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {sorted.map((n) => (
            <div
              key={nftKey(n)}
              className={`rounded-xl border border-border bg-surface-2/40 overflow-hidden ${isHidden(n) ? "opacity-70" : ""}`}
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
                <div className="absolute top-1 right-1 flex items-center gap-1">
                  {n.isSpam && (
                    <span className="pill bg-danger/20 text-danger text-[10px]">
                      spam
                    </span>
                  )}
                  <EyeButton n={n} />
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
                  {n.collectionName ?? "Unknown"}
                </div>
                <div className="text-sm font-bold truncate" title={n.name ?? `#${n.tokenId}`}>
                  {n.name ?? `#${n.tokenId.slice(0, 8)}`}
                </div>
                <Link
                  href={walletHref(n)}
                  className="text-[10px] text-primary hover:text-primary-hover truncate block"
                  title={`Open ${n.walletName}`}
                >
                  📁 {n.walletName}
                </Link>
                {n.floorEth != null ? (
                  <div className="text-xs tabular flex items-center justify-between">
                    <span className="text-text-muted">Floor</span>
                    <span className="font-semibold">
                      {n.floorEth.toFixed(3)} Ξ
                      {n.floorUsd != null && (
                        <span className="text-text-muted ml-1">
                          (<UsdValue value={n.floorUsd} priceUsd={1} />)
                        </span>
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-text-muted">No floor</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
