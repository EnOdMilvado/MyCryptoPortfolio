"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SummaryHeader } from "./SummaryHeader";
import { WalletCard, type WalletDisplay } from "./WalletCard";
import { WalletListItem } from "./WalletListItem";
import { AddWalletDialog } from "./AddWalletDialog";
import {
  AllHoldingsProvider,
  AllHoldingsOverview,
  AllHoldingsDetailTable,
  useAllHoldings,
} from "./AllHoldingsView";
import {
  EditButton,
  ViewToggle,
  readViewMode,
  writeViewMode,
  type ViewMode,
} from "./ViewToggle";
import { SortableGrid } from "./SortableGrid";
import { SortableCard } from "./SortableCard";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { HoldingRow } from "./HoldingsTable";
import type { ChainId, ChainType, WalletHoldings } from "@/lib/chains/types";
import { formatRelative } from "@/lib/format";

export interface InitialHolding {
  walletId: string;
  chain: ChainId;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number;
}

export interface InitialWallet {
  id: string;
  name: string;
  address: string;
  chainType: ChainType;
}

interface Props {
  portfolioId: string;
  portfolioName: string;
  wallets: InitialWallet[];
  initialHoldings: InitialHolding[];
  initialBtcPriceUsd: number | null;
  initialFetchedAt: string | null;
}

export function PortfolioView({
  portfolioId,
  portfolioName,
  wallets,
  initialHoldings,
  initialBtcPriceUsd,
  initialFetchedAt,
}: Props) {
  const router = useRouter();
  const [holdings, setHoldings] = useState<InitialHolding[]>(initialHoldings);
  const [btcPrice, setBtcPrice] = useState<number | null>(initialBtcPriceUsd);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initialFetchedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [orderedIds, setOrderedIds] = useState<string[]>(() => wallets.map((w) => w.id));

  useEffect(() => {
    setViewMode(readViewMode("crypto-wallet-view"));
  }, []);

  useEffect(() => {
    setOrderedIds((prev) => {
      const incoming = wallets.map((w) => w.id);
      const incomingSet = new Set(incoming);
      const filtered = prev.filter((id) => incomingSet.has(id));
      const known = new Set(prev);
      for (const id of incoming) if (!known.has(id)) filtered.push(id);
      return filtered;
    });
  }, [wallets]);

  function setView(v: ViewMode) {
    setViewMode(v);
    writeViewMode("crypto-wallet-view", v);
  }

  function moveWallet(id: string, dir: -1 | 1) {
    setOrderedIds((prev) => {
      const idx = prev.indexOf(id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      void persistWalletOrder(next);
      return next;
    });
  }

  function reorderWalletsDrag(ids: string[]) {
    setOrderedIds(ids);
    void persistWalletOrder(ids);
  }

  async function persistWalletOrder(ids: string[]) {
    const supabase = supabaseBrowser();
    await Promise.all(
      ids.map((id, i) =>
        supabase.from("crypto_wallets").update({ sort_order: i }).eq("id", id),
      ),
    );
  }

  const walletById = useMemo(() => new Map(wallets.map((w) => [w.id, w])), [wallets]);

  const walletTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      map.set(h.walletId, (map.get(h.walletId) ?? 0) + h.valueUsd);
    }
    return map;
  }, [holdings]);

  const walletDisplays: WalletDisplay[] = wallets.map((w) => {
    const usd = walletTotals.get(w.id) ?? 0;
    return {
      id: w.id,
      portfolioId,
      name: w.name,
      address: w.address,
      chainType: w.chainType,
      totalUsd: usd,
      totalBtc: btcPrice ? usd / btcPrice : 0,
    };
  });

  const rows: HoldingRow[] = holdings
    .map((h) => {
      const w = walletById.get(h.walletId);
      if (!w) return null;
      return {
        walletId: w.id,
        walletName: w.name,
        walletAddress: w.address,
        portfolioId,
        portfolioName,
        chain: h.chain,
        contract: h.contract,
        symbol: h.symbol,
        name: h.name,
        amount: h.amount,
        priceUsd: h.priceUsd,
        valueUsd: h.valueUsd,
      } as HoldingRow;
    })
    .filter((x): x is HoldingRow => x !== null);

  // Note: top-of-page totals are now derived from the AllHoldingsProvider
  // context (PortfolioSummaryHeader) so they react to per-holding excludes
  // toggled in the "All holdings in this portfolio" table.

  async function refresh() {
    if (wallets.length === 0) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletIds: wallets.map((w) => w.id) }),
      });
      const json = (await res.json()) as {
        wallets?: WalletHoldings[];
        btcPriceUsd?: number | null;
        fetchedAt?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Refresh failed");
      const flat: InitialHolding[] = [];
      for (const w of json.wallets ?? []) {
        for (const h of w.holdings) {
          flat.push({
            walletId: w.walletId,
            chain: h.chain,
            contract: h.contract,
            symbol: h.symbol,
            name: h.name,
            amount: h.amount,
            priceUsd: h.priceUsd,
            valueUsd: h.valueUsd,
          });
        }
      }
      setHoldings(flat);
      if (typeof json.btcPriceUsd === "number") setBtcPrice(json.btcPriceUsd);
      setFetchedAt(json.fetchedAt ?? new Date().toISOString());
      // Refresh server-rendered counts on parent page silently.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <AllHoldingsProvider
      rows={rows}
      storageKey={`portfolio-${portfolioId}`}
      btcPriceUsd={btcPrice}
    >
      <div className="space-y-8">
        <PortfolioSummaryHeader
          portfolioName={portfolioName}
          fetchedAt={fetchedAt}
          btcPrice={btcPrice}
          extra={
            <>
              <AddWalletDialog portfolioId={portfolioId} />
              <button
                type="button"
                className="btn-ghost"
                onClick={refresh}
                disabled={refreshing || wallets.length === 0}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </>
          }
        />

        {error && (
          <div className="card-tight text-sm text-danger bg-danger/10 border-danger/20">
            {error}
          </div>
        )}

        {wallets.length === 0 ? (
          <div className="card text-center animate-fade-up">
            <p className="text-text-muted mb-4">
              This portfolio is empty. Add a wallet to start loading holdings.
            </p>
            <AddWalletDialog portfolioId={portfolioId} />
          </div>
        ) : (
          <>
            {(() => {
              const byId = new Map(walletDisplays.map((w) => [w.id, w]));
              const ordered = orderedIds
                .map((id) => byId.get(id))
                .filter((w): w is WalletDisplay => !!w);

              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 animate-fade-up">
                    <h3 className="text-base font-bold text-text">Wallets</h3>
                    <div className="flex items-center gap-2">
                      <ViewToggle value={viewMode} onChange={setView} />
                      <EditButton
                        editing={editing}
                        onToggle={() => setEditing((e) => !e)}
                      />
                    </div>
                  </div>

                  <SortableGrid
                    ids={ordered.map((w) => w.id)}
                    onReorder={reorderWalletsDrag}
                  >
                    {viewMode === "grid" ? (
                      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {ordered.map((w, i) => (
                          <SortableCard key={w.id} id={w.id} enabled={editing}>
                            <WalletCard
                              wallet={w}
                              editing={editing}
                              onMoveUp={() => moveWallet(w.id, -1)}
                              onMoveDown={() => moveWallet(w.id, 1)}
                              isFirst={i === 0}
                              isLast={i === ordered.length - 1}
                              wiggleVariant={i % 2 === 0 ? "a" : "b"}
                            />
                          </SortableCard>
                        ))}
                      </section>
                    ) : (
                      <section className="flex flex-col gap-2">
                        {ordered.map((w, i) => (
                          <SortableCard key={w.id} id={w.id} enabled={editing}>
                            <WalletListItem
                              wallet={w}
                              portfolioId={portfolioId}
                              editing={editing}
                              onMoveUp={() => moveWallet(w.id, -1)}
                              onMoveDown={() => moveWallet(w.id, 1)}
                              isFirst={i === 0}
                              isLast={i === ordered.length - 1}
                              wiggleVariant={i % 2 === 0 ? "a" : "b"}
                            />
                          </SortableCard>
                        ))}
                      </section>
                    )}
                  </SortableGrid>
                </>
              );
            })()}

            <AllHoldingsOverview
              title="All holdings in this portfolio"
              btcPriceUsd={btcPrice}
            />
            <AllHoldingsDetailTable />
          </>
        )}
      </div>
    </AllHoldingsProvider>
  );
}

/** Top-of-portfolio header that pulls totals from the holdings provider. */
function PortfolioSummaryHeader({
  portfolioName,
  fetchedAt,
  btcPrice,
  extra,
}: {
  portfolioName: string;
  fetchedAt: string | null;
  btcPrice: number | null;
  extra: React.ReactNode;
}) {
  const { includedRows, cleanRows, hydrated } = useAllHoldings();
  const effectiveRows = hydrated ? includedRows : cleanRows;
  const totalUsd = effectiveRows.reduce((s, r) => s + r.valueUsd, 0);
  const totalBtc = btcPrice ? totalUsd / btcPrice : 0;
  return (
    <SummaryHeader
      title={portfolioName}
      subtitle={
        fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : "Not refreshed yet"
      }
      totalUsd={totalUsd}
      totalBtc={totalBtc}
      extra={extra}
    />
  );
}
