import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { PortfolioView, type InitialHolding, type InitialWallet } from "@/components/PortfolioView";
import type { ChainId, ChainType } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

interface WalletRow {
  id: string;
  name: string;
  address: string;
  chain_type: ChainType;
}

interface HoldingRow {
  wallet_id: string;
  chain: string;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number | string;
  price_usd: number | string | null;
  value_usd: number | string | null;
  fetched_at: string;
}

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  const { data: portfolio } = await supabase
    .from("crypto_portfolios")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!portfolio) notFound();

  const { data: wallets } = await supabase
    .from("crypto_wallets")
    .select("id, name, address, chain_type")
    .eq("portfolio_id", id)
    .order("created_at", { ascending: true });

  const walletIds = (wallets ?? []).map((w) => w.id);
  let holdings: HoldingRow[] = [];
  let fetchedAt: string | null = null;
  if (walletIds.length > 0) {
    const { data } = await supabase
      .from("crypto_holdings_cache")
      .select("wallet_id, chain, contract, symbol, name, amount, price_usd, value_usd, fetched_at")
      .in("wallet_id", walletIds);
    holdings = (data ?? []) as HoldingRow[];
    fetchedAt =
      holdings.reduce<string | null>(
        (latest, h) => (!latest || h.fetched_at > latest ? h.fetched_at : latest),
        null,
      );
  }

  let btcPriceUsd: number | null = null;
  const btcRow = holdings.find((h) => h.chain === "bitcoin" && h.price_usd != null);
  if (btcRow?.price_usd != null) {
    btcPriceUsd = Number(btcRow.price_usd);
  } else {
    const { data: anyBtc } = await supabase
      .from("crypto_holdings_cache")
      .select("price_usd")
      .eq("chain", "bitcoin")
      .not("price_usd", "is", null)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anyBtc?.price_usd != null) btcPriceUsd = Number(anyBtc.price_usd);
  }

  const initialWallets: InitialWallet[] = (wallets ?? []).map((w: WalletRow) => ({
    id: w.id,
    name: w.name,
    address: w.address,
    chainType: w.chain_type,
  }));

  const initialHoldings: InitialHolding[] = holdings.map((h) => ({
    walletId: h.wallet_id,
    chain: h.chain as ChainId,
    contract: h.contract,
    symbol: h.symbol,
    name: h.name,
    amount: Number(h.amount),
    priceUsd: h.price_usd == null ? null : Number(h.price_usd),
    valueUsd: h.value_usd == null ? 0 : Number(h.value_usd),
  }));

  return (
    <>
      <NavBar isAdmin={!!profile?.is_admin} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-4">
          <Link href="/dashboard" className="text-sm text-text-muted hover:text-text">
            ← Back to all portfolios
          </Link>
        </div>
        <PortfolioView
          portfolioId={portfolio.id}
          portfolioName={portfolio.name}
          wallets={initialWallets}
          initialHoldings={initialHoldings}
          initialBtcPriceUsd={btcPriceUsd}
          initialFetchedAt={fetchedAt}
        />
      </main>
    </>
  );
}
