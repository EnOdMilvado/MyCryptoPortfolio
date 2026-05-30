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
        walletId: w.id,
        walletName: w.name,
        walletAddress: w.address,
        chainType: w.chain_type,
        portfolioId: p.id,
        portfolioName: p.name,
        totalUsd,
        holdings: rows,
        lastFetchedAt: fetchedAtMax,
      });
    }
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
