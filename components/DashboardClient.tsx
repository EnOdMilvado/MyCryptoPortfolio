"use client";

import { useEffect, useMemo, useState } from "react";
import { SummaryHeader } from "./SummaryHeader";
import { PortfolioCard, type PortfolioSummary } from "./PortfolioCard";
import { AddPortfolioDialog } from "./AddPortfolioDialog";
import {
  AllHoldingsProvider,
  AllHoldingsOverview,
  AllHoldingsDetailTable,
  useAllHoldings,
} from "./AllHoldingsView";
import { AggregatedHoldingsTable } from "./AggregatedHoldingsTable";
import { RefreshAllButton } from "./RefreshAllButton";
import { ChangeCards, type Snapshot } from "./ChangeCards";
import { NftSummaryTile, type NftSummary } from "./NftSummaryTile";
import { PortfolioListItem } from "./PortfolioListItem";
import { SortableGrid } from "./SortableGrid";
import { SortableCard } from "./SortableCard";
import {
  EditButton,
  ViewToggle,
  readViewMode,
  writeViewMode,
  type ViewMode,
} from "./ViewToggle";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { SortableSectionsLayout, type PageSection } from "./SortableSectionsLayout";
import { WalletsTable } from "./WalletsTable";
import type { HoldingRow } from "./HoldingsTable";
import { useExchangeAssetExcludes } from "./exchange/useExchangeAssetExcludes";
import type { ReactNode } from "react";

interface PortfolioMeta {
  id: string;
  name: string;
  walletIds: string[];
}

interface Props {
  email: string;
  portfolios: PortfolioMeta[];
  holdings: HoldingRow[];
  btcPriceUsd: number | null;
  oldestFetchedAt: string | null;
  snapshots: Snapshot[];
  /** CMC Fear & Greed + Altcoin Season — fetched server-side, may be null
   *  if upstream was unreachable. ChangeCards renders gracefully either way. */
  fearGreed?: import("@/lib/market/sentiment").FearGreed | null;
  altcoinSeason?: import("@/lib/market/sentiment").AltcoinSeason | null;
  nftSummary?: NftSummary;
  /** Slot rendered above the big tables (e.g. exchanges & off-chain). */
  beforeTables?: ReactNode;
}

const EXCLUDE_PORTFOLIOS_KEY = "crypto-excluded-portfolios";
const EXCLUDE_WALLETS_KEY = "crypto-excluded-wallets";

export function DashboardClient({
  email,
  portfolios,
  holdings,
  btcPriceUsd,
  oldestFetchedAt,
  snapshots,
  fearGreed = null,
  altcoinSeason = null,
  nftSummary,
  beforeTables,
}: Props) {
  const [excludedPortfolios, setExcludedPortfolios] = useState<Set<string>>(new Set());
  const [excludedWallets, setExcludedWallets] = useState<Set<string>>(new Set());
  const [editingPortfolios, setEditingPortfolios] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  // Local ordering — derived from props but mutated by reorder actions so we
  // get optimistic updates without round-tripping the dashboard fetch.
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    portfolios.map((p) => p.id),
  );

  useEffect(() => {
    try {
      const ep = window.localStorage.getItem(EXCLUDE_PORTFOLIOS_KEY);
      if (ep) setExcludedPortfolios(new Set(JSON.parse(ep) as string[]));
      const ew = window.localStorage.getItem(EXCLUDE_WALLETS_KEY);
      if (ew) setExcludedWallets(new Set(JSON.parse(ew) as string[]));
    } catch {}
    setViewMode(readViewMode("crypto-portfolio-view"));
  }, []);

  // Whenever the server-provided portfolio list changes (e.g. after a refresh
  // or after a new portfolio is added), sync our local order list to it —
  // append any newcomers + drop any deletions while preserving manual order.
  useEffect(() => {
    setOrderedIds((prev) => {
      const known = new Set(prev);
      const incoming = portfolios.map((p) => p.id);
      const incomingSet = new Set(incoming);
      const filtered = prev.filter((id) => incomingSet.has(id));
      for (const id of incoming) if (!known.has(id)) filtered.push(id);
      return filtered;
    });
  }, [portfolios]);

  function moveOrder(id: string, dir: -1 | 1) {
    setOrderedIds((prev) => {
      const idx = prev.indexOf(id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      void persistOrder(next);
      return next;
    });
  }

  function reorderDrag(ids: string[]) {
    setOrderedIds(ids);
    void persistOrder(ids);
  }

  async function persistOrder(ids: string[]) {
    const supabase = supabaseBrowser();
    await Promise.all(
      ids.map((id, i) =>
        supabase.from("crypto_portfolios").update({ sort_order: i }).eq("id", id),
      ),
    );
  }

  function setView(v: ViewMode) {
    setViewMode(v);
    writeViewMode("crypto-portfolio-view", v);
  }

  function persistPortfolios(next: Set<string>) {
    try {
      window.localStorage.setItem(EXCLUDE_PORTFOLIOS_KEY, JSON.stringify([...next]));
    } catch {}
  }
  function persistWallets(next: Set<string>) {
    try {
      window.localStorage.setItem(EXCLUDE_WALLETS_KEY, JSON.stringify([...next]));
    } catch {}
  }

  function togglePortfolio(id: string) {
    setExcludedPortfolios((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistPortfolios(next);
      return next;
    });
  }
  function toggleWallet(id: string) {
    setExcludedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistWallets(next);
      return next;
    });
  }

  // Build wallet → portfolio map.
  const walletToPortfolio = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of portfolios) for (const w of p.walletIds) map.set(w, p.id);
    return map;
  }, [portfolios]);

  // Effective set of "excluded wallets" includes wallets whose portfolio is
  // disabled.
  const effectiveExcludedWallets = useMemo(() => {
    const set = new Set(excludedWallets);
    for (const p of portfolios) {
      if (excludedPortfolios.has(p.id)) {
        for (const w of p.walletIds) set.add(w);
      }
    }
    return set;
  }, [excludedPortfolios, excludedWallets, portfolios]);

  // Per-exchange asset excludes (Set of UPPERCASED asset symbols, keyed by
  // exchangeId) — toggled from the exchange-detail Spot tab and stored in
  // localStorage. We apply them here so excluded assets disappear from the
  // main dashboard tables, charts, and the grand total.
  const exchangeIds = useMemo(() => {
    const out = new Set<string>();
    for (const h of holdings) if (h.exchangeId) out.add(h.exchangeId);
    return [...out];
  }, [holdings]);
  const exchangeExcludes = useExchangeAssetExcludes(exchangeIds);

  const includedHoldings = useMemo(
    () =>
      holdings.filter((h) => {
        if (effectiveExcludedWallets.has(h.walletId)) return false;
        if (h.exchangeId && h.symbol) {
          const ex = exchangeExcludes[h.exchangeId];
          if (ex && ex.has(h.symbol.toUpperCase())) return false;
        }
        return true;
      }),
    [holdings, effectiveExcludedWallets, exchangeExcludes],
  );

  // Per-portfolio totals + wallet counts based on the *included* holdings.
  const portfolioSummaries: PortfolioSummary[] = useMemo(() => {
    return portfolios.map((p) => {
      const activeWallets = p.walletIds.filter((w) => !excludedWallets.has(w));
      const isPortfolioOff = excludedPortfolios.has(p.id);
      const usableWallets = isPortfolioOff ? [] : activeWallets;
      let totalUsd = 0;
      let holdingCount = 0;
      for (const h of holdings) {
        if (h.walletId in {}) continue; // noop typescript hint
        if (!usableWallets.includes(h.walletId)) continue;
        totalUsd += h.valueUsd;
        holdingCount += 1;
      }
      return {
        id: p.id,
        name: p.name,
        walletCount: activeWallets.length, // visible wallet count
        holdingCount,
        totalUsd,
        totalBtc: btcPriceUsd ? totalUsd / btcPriceUsd : 0,
      };
    });
  }, [portfolios, excludedPortfolios, excludedWallets, holdings, btcPriceUsd]);

  const allWalletIds = useMemo(
    () => portfolios.flatMap((p) => p.walletIds),
    [portfolios],
  );

  // Wrap the whole dashboard in the holdings provider so the top-of-page
  // total can subtract per-holding excludes (toggled via the checkboxes
  // in the "Every holding" / "All holdings summary" tables), not just
  // per-wallet / per-portfolio excludes.
  return (
    <AllHoldingsProvider
      rows={includedHoldings}
      storageKey="dashboard-main"
      btcPriceUsd={btcPriceUsd}
    >
      <DashboardHeader
        email={email}
        excludedPortfolios={excludedPortfolios}
        excludedWallets={excludedWallets}
        btcPriceUsd={btcPriceUsd}
        allWalletIds={allWalletIds}
        oldestFetchedAt={oldestFetchedAt}
      />

      {portfolioSummaries.length === 0 ? (
        <>
          <ChangeCards
            snapshots={snapshots}
            fearGreed={fearGreed}
            altcoinSeason={altcoinSeason}
          />
          <div className="card text-center animate-fade-up">
            <p className="text-text-muted">No portfolios yet. Let&apos;s create your first one!</p>
            <div className="mt-4">
              <AddPortfolioDialog />
            </div>
          </div>
        </>
      ) : (
        <DashboardSections
          snapshots={snapshots}
          fearGreed={fearGreed}
          altcoinSeason={altcoinSeason}
          includedHoldings={includedHoldings}
          btcPriceUsd={btcPriceUsd}
          portfolios={portfolios}
          portfolioSummaries={portfolioSummaries}
          orderedIds={orderedIds}
          excludedPortfolios={excludedPortfolios}
          excludedWallets={excludedWallets}
          editingPortfolios={editingPortfolios}
          setEditingPortfolios={setEditingPortfolios}
          togglePortfolio={togglePortfolio}
          toggleWallet={toggleWallet}
          setExcludedWallets={setExcludedWallets}
          persistWallets={persistWallets}
          moveOrder={moveOrder}
          reorderDrag={reorderDrag}
          viewMode={viewMode}
          setView={setView}
          nftSummary={nftSummary}
          holdings={holdings}
          beforeTables={beforeTables}
        />
      )}
    </AllHoldingsProvider>
  );
}

/**
 * Wraps the dashboard's middle sections in SortableSectionsLayout so the
 * user can drag-reorder the top-level cards/tables. All the section logic
 * (portfolios IIFE, wallet toggles, exchanges, tables, etc.) is the same
 * as the legacy inline render — just extracted into a sections[] so the
 * layout component can sort them.
 */
function DashboardSections({
  snapshots,
  fearGreed,
  altcoinSeason,
  includedHoldings,
  btcPriceUsd,
  portfolios,
  portfolioSummaries,
  orderedIds,
  excludedPortfolios,
  excludedWallets,
  editingPortfolios,
  setEditingPortfolios,
  togglePortfolio,
  toggleWallet,
  setExcludedWallets,
  persistWallets,
  moveOrder,
  reorderDrag,
  viewMode,
  setView,
  nftSummary,
  holdings,
  beforeTables,
}: {
  snapshots: Snapshot[];
  fearGreed?: import("@/lib/market/sentiment").FearGreed | null;
  altcoinSeason?: import("@/lib/market/sentiment").AltcoinSeason | null;
  includedHoldings: HoldingRow[];
  btcPriceUsd: number | null;
  portfolios: PortfolioMeta[];
  portfolioSummaries: PortfolioSummary[];
  orderedIds: string[];
  excludedPortfolios: Set<string>;
  excludedWallets: Set<string>;
  editingPortfolios: boolean;
  setEditingPortfolios: (fn: (e: boolean) => boolean) => void;
  togglePortfolio: (id: string) => void;
  toggleWallet: (id: string) => void;
  setExcludedWallets: (s: Set<string>) => void;
  persistWallets: (s: Set<string>) => void;
  moveOrder: (id: string, dir: -1 | 1) => void;
  reorderDrag: (next: string[]) => void;
  viewMode: ViewMode;
  setView: (v: ViewMode) => void;
  nftSummary?: NftSummary;
  holdings: HoldingRow[];
  beforeTables?: ReactNode;
}) {
  const portfoliosNode = (() => {
    const byId = new Map(portfolioSummaries.map((p) => [p.id, p]));
    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((p): p is (typeof portfolioSummaries)[number] => !!p);
    const editControlsRow = (
      <div className="flex flex-wrap items-center justify-between gap-2 animate-fade-up">
        <h3 className="text-base font-bold text-text">Portfolios</h3>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={setView} />
          <EditButton
            editing={editingPortfolios}
            onToggle={() => setEditingPortfolios((e) => !e)}
          />
        </div>
      </div>
    );
    const items = ordered.map((p, i) => {
      const card =
        viewMode === "grid" ? (
          <PortfolioCard
            portfolio={p}
            disabled={excludedPortfolios.has(p.id)}
            onToggleDisabled={() => togglePortfolio(p.id)}
            editing={editingPortfolios}
            onMoveUp={() => moveOrder(p.id, -1)}
            onMoveDown={() => moveOrder(p.id, 1)}
            isFirst={i === 0}
            isLast={i === ordered.length - 1}
            wiggleVariant={i % 2 === 0 ? "a" : "b"}
          />
        ) : (
          <PortfolioListItem
            portfolio={p}
            disabled={excludedPortfolios.has(p.id)}
            onToggleDisabled={() => togglePortfolio(p.id)}
            editing={editingPortfolios}
            onMoveUp={() => moveOrder(p.id, -1)}
            onMoveDown={() => moveOrder(p.id, 1)}
            isFirst={i === 0}
            isLast={i === ordered.length - 1}
            wiggleVariant={i % 2 === 0 ? "a" : "b"}
          />
        );
      return (
        <SortableCard key={p.id} id={p.id} enabled={editingPortfolios}>
          {card}
        </SortableCard>
      );
    });
    return (
      <div className="space-y-4">
        {editControlsRow}
        <SortableGrid ids={ordered.map((p) => p.id)} onReorder={reorderDrag}>
          {viewMode === "grid" ? (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-up">
              {items}
              {!editingPortfolios &&
                nftSummary &&
                nftSummary.totalCount > 0 && (
                  <NftSummaryTile key="nft-summary-tile" summary={nftSummary} />
                )}
            </section>
          ) : (
            <section className="flex flex-col gap-2 animate-fade-up">
              {items}
              {!editingPortfolios &&
                nftSummary &&
                nftSummary.totalCount > 0 && (
                  <NftSummaryTile
                    key="nft-summary-tile"
                    summary={nftSummary}
                    variant="list"
                  />
                )}
            </section>
          )}
        </SortableGrid>
      </div>
    );
  })();

  const allWalletIds = portfolios.flatMap((p) => p.walletIds);
  const walletTogglesNode = (
    <section className="card animate-fade-up space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-text">Disable individual wallets</h3>
        {excludedWallets.size > 0 && (
          <button
            type="button"
            onClick={() => {
              setExcludedWallets(new Set());
              persistWallets(new Set());
            }}
            className="btn-ghost text-xs"
          >
            Re-enable all
          </button>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Toggle a wallet to remove it from the dashboard total, pie and tables.
      </p>
      <WalletsTable
        rows={holdings}
        walletIds={allWalletIds}
        btcPriceUsd={btcPriceUsd}
        excludedWallets={excludedWallets}
        excludedPortfolios={excludedPortfolios}
        onToggleWallet={toggleWallet}
      />
    </section>
  );

  const sections: PageSection[] = [];
  sections.push({
    id: "change-cards",
    label: "Changes",
    node: (
      <ChangeCards
        snapshots={snapshots}
        fearGreed={fearGreed}
        altcoinSeason={altcoinSeason}
      />
    ),
  });
  if (includedHoldings.length > 0) {
    sections.push({
      id: "overview",
      label: "Overview",
      node: (
        <AllHoldingsOverview
          title="All holdings across active portfolios"
          btcPriceUsd={btcPriceUsd}
        />
      ),
    });
  }
  sections.push({ id: "portfolios", label: "Portfolios", node: portfoliosNode });
  if (portfolios.some((p) => p.walletIds.length > 0)) {
    sections.push({ id: "wallet-toggles", label: "Wallets", node: walletTogglesNode });
  }
  if (beforeTables) {
    sections.push({ id: "exchanges", label: "Exchanges", node: beforeTables });
  }
  if (includedHoldings.length > 0) {
    sections.push({
      id: "all-holdings",
      label: "All holdings",
      node: (
        <div className="space-y-8">
          <AggregatedHoldingsTable rows={includedHoldings} btcPriceUsd={btcPriceUsd} />
          <AllHoldingsDetailTable title="Every holding (one row per wallet × token)" />
        </div>
      ),
    });
  }

  return (
    <SortableSectionsLayout
      storageKey="crypto-dashboard-section-order"
      sections={sections}
    />
  );
}

/**
 * Top-of-dashboard header. Lives inside the AllHoldingsProvider so the total
 * subtracts per-holding excludes (in addition to per-wallet / per-portfolio
 * excludes that are already baked into `includedHoldings`).
 */
function DashboardHeader({
  email,
  excludedPortfolios,
  excludedWallets,
  btcPriceUsd,
  allWalletIds,
  oldestFetchedAt,
}: {
  email: string;
  excludedPortfolios: Set<string>;
  excludedWallets: Set<string>;
  btcPriceUsd: number | null;
  allWalletIds: string[];
  oldestFetchedAt: string | null;
}) {
  const { includedRows, cleanRows, hydrated } = useAllHoldings();
  // Pre-hydration the excluded set isn't loaded yet, so render the
  // pre-exclude total to keep server + first-paint client in sync.
  const effectiveRows = hydrated ? includedRows : cleanRows;
  const totalUsd = effectiveRows.reduce((s, r) => s + r.valueUsd, 0);
  const totalBtc = btcPriceUsd ? totalUsd / btcPriceUsd : 0;
  const perHoldingExcluded = Math.max(cleanRows.length - includedRows.length, 0);
  return (
    <SummaryHeader
      title="All portfolios"
      subtitle={
        <div>
          <span>{email}</span>
          {(excludedPortfolios.size > 0 ||
            excludedWallets.size > 0 ||
            perHoldingExcluded > 0) && (
            <span className="ml-2 text-text-muted/70">
              · {excludedPortfolios.size} portfolios /{" "}
              {excludedWallets.size} wallets
              {perHoldingExcluded > 0 && (
                <> / {perHoldingExcluded} holdings</>
              )}{" "}
              disabled
            </span>
          )}
        </div>
      }
      totalUsd={totalUsd}
      totalBtc={totalBtc}
      extra={
        <div className="flex flex-col items-end gap-3">
          {allWalletIds.length > 0 && (
            <RefreshAllButton
              walletIds={allWalletIds}
              lastFetchedAt={oldestFetchedAt}
            />
          )}
          <AddPortfolioDialog />
        </div>
      }
    />
  );
}

function walletNameLookup(rows: HoldingRow[], walletId: string): string | null {
  for (const r of rows) if (r.walletId === walletId) return r.walletName;
  return null;
}
