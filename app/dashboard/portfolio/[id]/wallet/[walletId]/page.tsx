import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { WalletDetailView } from "@/components/WalletDetailView";
import type { NftRow } from "@/components/NftSection";
import type { ChainId, ChainType } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

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

export default async function WalletPage({
  params,
}: {
  params: Promise<{ id: string; walletId: string }>;
}) {
  const { id, walletId } = await params;
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

  const { data: wallet } = await supabase
    .from("crypto_wallets")
    .select("id, name, address, chain_type, notes, portfolio_id")
    .eq("id", walletId)
    .eq("portfolio_id", id)
    .maybeSingle();
  if (!wallet) notFound();

  const { data: portfolio } = await supabase
    .from("crypto_portfolios")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  const { data: holdings } = await supabase
    .from("crypto_holdings_cache")
    .select("wallet_id, chain, contract, symbol, name, amount, price_usd, value_usd, fetched_at")
    .eq("wallet_id", walletId);
  const holdingsList = (holdings as HoldingRow[] | null) ?? [];

  const fetchedAt = holdingsList.reduce<string | null>(
    (latest, h) => (!latest || h.fetched_at > latest ? h.fetched_at : latest),
    null,
  );

  // Use the BTC price from any cached BTC holding (likely belongs to this user).
  let btcPriceUsd: number | null = null;
  const localBtc = holdingsList.find((h) => h.chain === "bitcoin" && h.price_usd != null);
  if (localBtc?.price_usd != null) {
    btcPriceUsd = Number(localBtc.price_usd);
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

  const initialHoldings = holdingsList.map((h) => ({
    walletId: h.wallet_id,
    walletName: wallet.name,
    walletAddress: wallet.address,
    chain: h.chain as ChainId,
    contract: h.contract,
    symbol: h.symbol,
    name: h.name,
    amount: Number(h.amount),
    priceUsd: h.price_usd == null ? null : Number(h.price_usd),
    valueUsd: h.value_usd == null ? 0 : Number(h.value_usd),
  }));

  // NFT cache — only EVM wallets have it.
  let nftRows: NftRow[] = [];
  let nftFetchedAt: string | null = null;
  if (wallet.chain_type === "evm") {
    const { data: nftData } = await supabase
      .from("crypto_nfts_cache")
      .select(
        "chain, contract, token_id, name, collection_name, image_url, floor_eth, floor_usd, cost_basis_usd, is_spam, user_hidden, fetched_at",
      )
      .eq("wallet_id", wallet.id);
    interface NftRecord {
      chain: string;
      contract: string;
      token_id: string;
      name: string | null;
      collection_name: string | null;
      image_url: string | null;
      floor_eth: number | string | null;
      floor_usd: number | string | null;
      cost_basis_usd: number | string | null;
      is_spam: boolean | null;
      user_hidden: boolean | null;
      fetched_at: string;
    }
    nftRows = (nftData ?? []).map((n) => {
      const r = n as NftRecord;
      if (!nftFetchedAt || r.fetched_at > nftFetchedAt) nftFetchedAt = r.fetched_at;
      return {
        walletId: wallet.id,
        chain: r.chain as ChainId,
        contract: r.contract,
        tokenId: r.token_id,
        name: r.name,
        collectionName: r.collection_name,
        imageUrl: r.image_url,
        floorEth: r.floor_eth == null ? null : Number(r.floor_eth),
        floorUsd: r.floor_usd == null ? null : Number(r.floor_usd),
        costBasisUsd: r.cost_basis_usd == null ? null : Number(r.cost_basis_usd),
        isSpam: !!r.is_spam,
        userHidden: !!r.user_hidden,
      };
    });
  }

  return (
    <>
      <NavBar isAdmin={!!profile?.is_admin} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div>
          <Link
            href={`/dashboard/portfolio/${id}`}
            className="text-sm text-text-muted hover:text-text"
          >
            ← Back to {portfolio?.name ?? "portfolio"}
          </Link>
        </div>
        <WalletDetailView
          walletId={wallet.id}
          walletName={wallet.name}
          walletAddress={wallet.address}
          chainType={wallet.chain_type as ChainType}
          notes={wallet.notes ?? ""}
          initialHoldings={initialHoldings}
          initialBtcPriceUsd={btcPriceUsd}
          initialFetchedAt={fetchedAt}
          initialNfts={nftRows}
          nftFetchedAt={nftFetchedAt}
        />
        {/* NftSection is now inside WalletDetailView under the NFTs tab. */}
      </main>
    </>
  );
}
