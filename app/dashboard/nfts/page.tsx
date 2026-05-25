import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { NftGalleryGlobal, type GlobalNft } from "@/components/NftGalleryGlobal";
import type { ChainId } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

interface Row {
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
  crypto_wallets:
    | {
        id: string;
        name: string;
        address: string;
        crypto_portfolios: { id: string; name: string } | null;
      }
    | null;
}

export default async function NftsPage() {
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

  const { data: rawNfts } = await supabase
    .from("crypto_nfts_cache")
    .select(
      "chain, contract, token_id, name, collection_name, image_url, floor_eth, floor_usd, cost_basis_usd, is_spam, user_hidden, crypto_wallets!inner ( id, name, address, crypto_portfolios!inner ( id, name ) )",
    );

  const nfts: GlobalNft[] = ((rawNfts as Row[] | null) ?? []).flatMap((r) => {
    const w = r.crypto_wallets;
    if (!w) return [];
    const p = w.crypto_portfolios;
    if (!p) return [];
    return [
      {
        walletId: w.id,
        walletName: w.name,
        walletAddress: w.address,
        portfolioId: p.id,
        portfolioName: p.name,
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
      },
    ];
  });

  return (
    <>
      <NavBar isAdmin={!!profile?.is_admin} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-text-muted hover:text-text"
          >
            ← Back to dashboard
          </Link>
        </div>
        <h1 className="text-3xl font-extrabold text-text">All NFTs</h1>
        <NftGalleryGlobal nfts={nfts} />
      </main>
    </>
  );
}
