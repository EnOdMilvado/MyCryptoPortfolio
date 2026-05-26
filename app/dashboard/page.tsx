import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { DashboardClient } from "@/components/DashboardClient";
import {
  ExchangesAndOffchain,
  type ExchangeRow,
  type OffchainRow,
} from "@/components/ExchangesAndOffchain";
import { NftSummaryTile } from "@/components/NftSummaryTile";
import type { HoldingRow } from "@/components/HoldingsTable";
import type { ChainId } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

interface PortfolioRow {
  id: string;
  name: string;
  created_at: string;
  sort_order: number;
  crypto_wallets:
    | {
        id: string;
        name: string;
        address: string;
        sort_order: number;
        crypto_holdings_cache: {
          chain: string;
          contract: string;
          symbol: string | null;
          name: string | null;
          amount: number | string;
          price_usd: number | string | null;
          value_usd: number | string | null;
          price_change_24h: number | string | null;
          fetched_at: string;
        }[];
      }[]
    | null;
}

export default async function DashboardPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("is_admin, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const { data: rawPortfolios } = await supabase
    .from("crypto_portfolios")
    .select(
      "id, name, created_at, sort_order, crypto_wallets ( id, name, address, sort_order, crypto_holdings_cache ( chain, contract, symbol, name, amount, price_usd, value_usd, price_change_24h, fetched_at ) )",
    )
    .order("sort_order", { ascending: true });

  // Latest BTC price from cache.
  let btcPriceUsd: number | null = null;
  const { data: btcRow } = await supabase
    .from("crypto_holdings_cache")
    .select("price_usd")
    .eq("chain", "bitcoin")
    .not("price_usd", "is", null)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (btcRow?.price_usd) btcPriceUsd = Number(btcRow.price_usd);

  const portfoliosRaw = (rawPortfolios as PortfolioRow[] | null) ?? [];

  const allHoldings: HoldingRow[] = [];
  let oldestFetchedAt: string | null = null;
  const portfolios = portfoliosRaw.map((p) => {
    // Pre-sort wallets within each portfolio (Supabase doesn't sort nested
    // relations server-side).
    const wallets = [...(p.crypto_wallets ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    const walletIds: string[] = [];
    for (const w of wallets) {
      walletIds.push(w.id);
      for (const h of w.crypto_holdings_cache ?? []) {
        if (!oldestFetchedAt || h.fetched_at < oldestFetchedAt) {
          oldestFetchedAt = h.fetched_at;
        }
        allHoldings.push({
          walletId: w.id,
          walletName: w.name,
          walletAddress: w.address,
          portfolioId: p.id,
          portfolioName: p.name,
          chain: h.chain as ChainId,
          contract: h.contract,
          symbol: h.symbol,
          name: h.name,
          amount: Number(h.amount),
          priceUsd: h.price_usd == null ? null : Number(h.price_usd),
          valueUsd: h.value_usd == null ? 0 : Number(h.value_usd),
          priceChange24h:
            h.price_change_24h == null ? null : Number(h.price_change_24h),
        });
      }
    }
    return { id: p.id, name: p.name, walletIds };
  });

  // Load exchanges + off-chain balances. Pull amount + price_usd too so we
  // can both feed ExchangesAndOffchain totals AND synthesise HoldingRows
  // that merge with wallet holdings in the main tables.
  const { data: exRowsFull } = await supabase
    .from("crypto_exchanges")
    .select(
      "id, provider, label, last_synced_at, crypto_exchange_balances_cache ( asset, amount, price_usd, value_usd )",
    )
    .order("created_at", { ascending: true });

  interface RawExBalance {
    asset: string;
    amount: number | string | null;
    price_usd: number | string | null;
    value_usd: number | string | null;
  }
  interface RawExchange {
    id: string;
    provider: string;
    label: string;
    last_synced_at: string | null;
    crypto_exchange_balances_cache: RawExBalance[] | null;
  }

  const exchanges: ExchangeRow[] = ((exRowsFull as RawExchange[] | null) ?? []).map(
    (ex) => {
      const balances = (ex.crypto_exchange_balances_cache ?? []).map((b) => ({
        asset: b.asset,
        valueUsd: Number(b.value_usd ?? 0),
      }));
      const totalUsd = balances.reduce((s, b) => s + b.valueUsd, 0);
      return {
        id: ex.id,
        provider: ex.provider,
        label: ex.label,
        totalUsd,
        lastSyncedAt: ex.last_synced_at,
        balanceCount: balances.length,
        balances,
      };
    },
  );

  // Synthesise HoldingRows for exchange spot balances so they aggregate
  // alongside wallet holdings in the main tables.
  for (const ex of (exRowsFull as RawExchange[] | null) ?? []) {
    for (const b of ex.crypto_exchange_balances_cache ?? []) {
      const amount = Number(b.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const priceUsd = b.price_usd == null ? null : Number(b.price_usd);
      const valueUsd = b.value_usd == null ? 0 : Number(b.value_usd);
      allHoldings.push({
        walletId: `exchange:${ex.id}`,
        walletName: ex.label,
        walletAddress: "",
        portfolioId: undefined,
        portfolioName: ex.provider.toUpperCase(),
        chain: "exchange" as ChainId,
        contract: `${ex.id}:${b.asset.toUpperCase()}`,
        symbol: b.asset,
        name: b.asset,
        amount,
        priceUsd,
        valueUsd,
        priceChange24h: null,
        exchangeId: ex.id,
      });
    }
  }

  const { data: ocRows } = await supabase
    .from("crypto_offchain_balances")
    .select("id, label, kind, currency, amount")
    .order("created_at", { ascending: true });

  const offchain: OffchainRow[] = (ocRows ?? []).map((o: {
    id: string;
    label: string;
    kind: string;
    currency: string;
    amount: number | string;
  }) => {
    const amount = Number(o.amount ?? 0);
    // For now treat all currencies as 1:1 USD (manual entry). Future: FX rates.
    return {
      id: o.id,
      label: o.label,
      kind: o.kind,
      currency: o.currency,
      amount,
      valueUsd: amount,
    };
  });

  // Portfolio value snapshots → change-over-time cards.
  const { data: snapRows } = await supabase
    .from("crypto_portfolio_snapshots")
    .select("captured_at, total_usd")
    .order("captured_at", { ascending: true });
  const snapshots = (snapRows ?? []).map((s: { captured_at: string; total_usd: number | string }) => ({
    capturedAt: s.captured_at,
    totalUsd: Number(s.total_usd),
  }));

  // NFT summary (aggregated across all wallets).
  const { data: nftRows } = await supabase
    .from("crypto_nfts_cache")
    .select("floor_usd, is_spam");
  const totalNftCount = nftRows?.length ?? 0;
  const nonSpamNftCount = (nftRows ?? []).filter(
    (n: { is_spam: boolean | null }) => !n.is_spam,
  ).length;
  const totalNftFloorUsd = (nftRows ?? []).reduce(
    (s, n: { floor_usd: number | string | null; is_spam: boolean | null }) =>
      n.is_spam ? s : s + Number(n.floor_usd ?? 0),
    0,
  );
  const nftSummary = {
    totalCount: totalNftCount,
    nonSpamCount: nonSpamNftCount,
    totalFloorUsd: totalNftFloorUsd,
  };

  return (
    <>
      <NavBar
        isAdmin={!!profile?.is_admin}
        profileUser={{
          email: user.email ?? "",
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <DashboardClient
          email={user.email ?? ""}
          portfolios={portfolios}
          holdings={allHoldings}
          btcPriceUsd={btcPriceUsd}
          oldestFetchedAt={oldestFetchedAt}
          snapshots={snapshots}
          nftSummary={nftSummary}
          beforeTables={<ExchangesAndOffchain exchanges={exchanges} offchain={offchain} />}
        />
      </main>
    </>
  );
}
