import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchFloorPrice, fetchNftsForWallet } from "@/lib/nft/alchemy";
import { getNativePricesWithChange } from "@/lib/chains/prices";
import { type EvmChain } from "@/lib/chains/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface WalletRow {
  id: string;
  address: string;
  chain_type: string;
}

interface NftOut {
  walletId: string;
  chain: EvmChain;
  contract: string;
  tokenId: string;
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  floorEth: number | null;
  floorUsd: number | null;
  isSpam: boolean;
}

// Chains where Alchemy NFT API has reliable coverage.
const NFT_CHAINS: EvmChain[] = [
  "ethereum",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { walletIds?: string[] };
  const walletIds = Array.isArray(body.walletIds) ? body.walletIds.filter(Boolean) : [];
  if (walletIds.length === 0) {
    return NextResponse.json({ error: "walletIds required" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: wallets, error: wErr } = await supabase
    .from("crypto_wallets")
    .select("id, address, chain_type")
    .in("id", walletIds);
  if (wErr || !wallets) {
    return NextResponse.json(
      { error: wErr?.message ?? "wallets fetch failed" },
      { status: 500 },
    );
  }

  const ethPrices = await getNativePricesWithChange(["ethereum"]);
  const ethUsd = ethPrices.ethereum?.usd ?? null;

  // Floor price cache per (chain, contract) — same collection reused across
  // many NFTs only triggers a single Alchemy call.
  const floorCache = new Map<string, number | null>();

  const allOut: NftOut[] = [];
  const insertedAt = new Date().toISOString();

  for (const w of (wallets as WalletRow[]) ?? []) {
    if (w.chain_type !== "evm") continue;
    for (const chain of NFT_CHAINS) {
      let nfts: Awaited<ReturnType<typeof fetchNftsForWallet>> = [];
      try {
        nfts = await fetchNftsForWallet(chain, w.address);
      } catch {
        continue;
      }
      for (const n of nfts) {
        const ck = `${chain}:${n.contract}`;
        if (!floorCache.has(ck)) {
          const fp = await fetchFloorPrice(chain, n.contract);
          floorCache.set(ck, fp.ethFloor);
        }
        const floorEth = floorCache.get(ck) ?? null;
        const floorUsd =
          floorEth != null && ethUsd != null ? floorEth * ethUsd : null;
        allOut.push({
          walletId: w.id,
          chain,
          contract: n.contract,
          tokenId: n.tokenId,
          name: n.name,
          collectionName: n.collectionName,
          imageUrl: n.imageUrl,
          floorEth,
          floorUsd,
          isSpam: n.isSpam,
        });
      }
    }
  }

  // Persist: wipe per-wallet rows then insert fresh, preserving cost_basis
  // that the user manually set.
  const costBasisByKey = new Map<string, number | null>();
  for (const wid of walletIds) {
    const { data: existing } = await supabase
      .from("crypto_nfts_cache")
      .select("chain, contract, token_id, cost_basis_usd")
      .eq("wallet_id", wid);
    for (const row of existing ?? []) {
      const r = row as {
        chain: string;
        contract: string;
        token_id: string;
        cost_basis_usd: number | string | null;
      };
      if (r.cost_basis_usd != null) {
        costBasisByKey.set(
          `${wid}|${r.chain}|${r.contract}|${r.token_id}`,
          Number(r.cost_basis_usd),
        );
      }
    }
    await supabase.from("crypto_nfts_cache").delete().eq("wallet_id", wid);
  }

  if (allOut.length > 0) {
    for (let i = 0; i < allOut.length; i += 250) {
      const chunk = allOut.slice(i, i + 250);
      await supabase.from("crypto_nfts_cache").insert(
        chunk.map((n) => ({
          wallet_id: n.walletId,
          chain: n.chain,
          contract: n.contract,
          token_id: n.tokenId,
          name: n.name,
          collection_name: n.collectionName,
          image_url: n.imageUrl,
          floor_eth: n.floorEth,
          floor_usd: n.floorUsd,
          cost_basis_usd:
            costBasisByKey.get(
              `${n.walletId}|${n.chain}|${n.contract}|${n.tokenId}`,
            ) ?? null,
          is_spam: n.isSpam,
          fetched_at: insertedAt,
        })),
      );
    }
  }

  return NextResponse.json({
    count: allOut.length,
    spamCount: allOut.filter((n) => n.isSpam).length,
    fetchedAt: insertedAt,
  });
}
