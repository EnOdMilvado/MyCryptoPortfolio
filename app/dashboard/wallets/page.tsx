import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { AllWalletsList, type WalletGroup } from "@/components/AllWalletsList";
import type { HoldingRow } from "@/components/HoldingsTable";
import type { ChainId, ChainType } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

interface RawPortfolio {
  id: string;
  name: string;
  crypto_wallets:
    | {
        id: string;
        name: string;
        address: string;
        chain_type: ChainType;
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

interface RawExBalance {
  asset: string;
  amount: number | string | null;
  price_usd: number | string | null;
  value_usd: number | string | null;
  price_change_24h: number | string | null;
}
interface RawExchange {
  id: string;
  provider: string;
  label: string;
  last_synced_at: string | null;
  crypto_exchange_balances_cache: RawExBalance[] | null;
}
interface RawOffchain {
  id: string;
  label: string;
  kind: string;
  currency: string;
  amount: number | string;
  created_at: string | null;
}

const OFFCHAIN_KIND_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  credit_card: "Credit card",
  brokerage: "Brokerage",
  other: "Other",
};

/**
 * Unified wallets page: every wallet the user owns, across all
 * portfolios, in one list sorted largest-to-smallest by USD value.
 *
 * Each wallet is expandable client-side to reveal its full holdings
 * table and (lazy-loaded) on-chain transactions, with a date-filtered
 * CSV export. See AllWalletsList for the interaction details.
 *
 * Data shape matches the main dashboard's holdings shape so HoldingsTable
 * can be reused unchanged.
 */
export default async function WalletsPage() {
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

  // Same nested fetch the main dashboard does, so we hit the same RLS
  // path and reuse the cached holdings without an extra refresh.
  const { data: rawPortfolios } = await supabase
    .from("crypto_portfolios")
    .select(
      "id, name, crypto_wallets ( id, name, address, chain_type, sort_order, crypto_holdings_cache ( chain, contract, symbol, name, amount, price_usd, value_usd, price_change_24h, fetched_at ) )",
    )
    .order("sort_order", { ascending: true });

  // Latest BTC price for the page-level total (and the per-wallet BTC
  // equivalent line inside each accordion item).
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

  // Flatten portfolios → wallets, compute per-wallet total, sort desc.
  const groups: WalletGroup[] = [];
  for (const p of (rawPortfolios as RawPortfolio[] | null) ?? []) {
    for (const w of p.crypto_wallets ?? []) {
      const rows: HoldingRow[] = (w.crypto_holdings_cache ?? []).map((h) => ({
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
      }));
      const totalUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
      const fetchedAtMax = (w.crypto_holdings_cache ?? []).reduce<
        string | null
      >((acc, h) => (acc == null || h.fetched_at > acc ? h.fetched_at : acc), null);
      groups.push({
        kind: "wallet",
        walletId: w.id,
        walletName: w.name,
        walletAddress: w.address,
        chainType: w.chain_type,
        portfolioId: p.id,
        portfolioName: p.name,
        totalUsd,
        holdings: rows,
        lastFetchedAt: fetchedAtMax,
        expandable: true,
      });
    }
  }

  // Exchanges (CEX). Each exchange becomes a "wallet" whose holdings are its
  // synthesised spot balances — same HoldingRow shape the dashboard uses so
  // they merge naturally and carry per-asset tax toggles.
  const { data: exRowsFull } = await supabase
    .from("crypto_exchanges")
    .select(
      "id, provider, label, last_synced_at, crypto_exchange_balances_cache ( asset, amount, price_usd, value_usd, price_change_24h )",
    )
    .order("created_at", { ascending: true });

  for (const ex of (exRowsFull as RawExchange[] | null) ?? []) {
    const rows: HoldingRow[] = [];
    for (const b of ex.crypto_exchange_balances_cache ?? []) {
      const amount = Number(b.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      rows.push({
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
        priceUsd: b.price_usd == null ? null : Number(b.price_usd),
        valueUsd: b.value_usd == null ? 0 : Number(b.value_usd),
        priceChange24h:
          b.price_change_24h == null ? null : Number(b.price_change_24h),
        exchangeId: ex.id,
      });
    }
    groups.push({
      kind: "exchange",
      walletId: `exchange:${ex.id}`,
      walletName: ex.label,
      walletAddress: "",
      chainType: null,
      badge: ex.provider.toUpperCase(),
      portfolioId: null,
      portfolioName: "Exchange",
      totalUsd: rows.reduce((s, r) => s + r.valueUsd, 0),
      holdings: rows,
      lastFetchedAt: ex.last_synced_at,
      expandable: rows.length > 0,
    });
  }

  // Off-chain balances (cash, bank, brokerage, …). Single manual value each,
  // so they show as a non-expandable row with just the wallet-level TAX toggle.
  const { data: ocRows } = await supabase
    .from("crypto_offchain_balances")
    .select("id, label, kind, currency, amount, created_at")
    .order("created_at", { ascending: true });

  for (const o of (ocRows as RawOffchain[] | null) ?? []) {
    const amount = Number(o.amount ?? 0);
    groups.push({
      kind: "offchain",
      walletId: `offchain:${o.id}`,
      walletName: o.label,
      walletAddress: "",
      chainType: null,
      badge: OFFCHAIN_KIND_LABEL[o.kind] ?? o.kind,
      portfolioId: null,
      portfolioName: o.currency,
      // For now treat all currencies as 1:1 USD (manual entry) — same as the
      // dashboard. Future: FX rates.
      totalUsd: amount,
      holdings: [],
      lastFetchedAt: o.created_at ?? null,
      expandable: false,
    });
  }

  groups.sort((a, b) => b.totalUsd - a.totalUsd);

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
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <AllWalletsList wallets={groups} btcPriceUsd={btcPriceUsd} />
      </main>
    </>
  );
}
