import { ALCHEMY_EVM_SUBDOMAIN, type EvmChain } from "@/lib/chains/types";

/**
 * Alchemy NFT API client. Reuses the existing ALCHEMY_API_KEY (no separate
 * key required — the NFT endpoints sit on the same domain as the JSON-RPC).
 *
 * Free-tier limits:
 *   - getNFTsForOwner: 100 per page; we paginate until pageKey is empty.
 *   - excludeFilters[]=SPAM requires Growth plan; we filter client-side via
 *     the `contract.isSpam` flag returned with each NFT.
 *   - getFloorPrice: one collection per call. We call once per unique
 *     contract and cache the result for the duration of this refresh.
 */

interface RawNftContract {
  address: string;
  name: string | null;
  symbol: string | null;
  isSpam: boolean;
}

interface RawNftImage {
  thumbnailUrl?: string | null;
  cachedUrl?: string | null;
  originalUrl?: string | null;
}

interface RawNft {
  contract: RawNftContract;
  tokenId: string;
  name: string | null;
  description: string | null;
  image?: RawNftImage;
  tokenUri?: string | null;
}

interface NftsByOwnerResponse {
  ownedNfts: RawNft[];
  totalCount: number;
  pageKey?: string;
}

export interface NftItem {
  contract: string;
  tokenId: string;
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  tokenUri: string | null;
  isSpam: boolean;
}

export interface FloorPrice {
  ethFloor: number | null;
  source: "opensea" | "looksrare" | null;
  retrievedAt: string | null;
}

interface FloorResponse {
  openSea?: {
    floorPrice: number | null;
    priceCurrency: string | null;
    retrievedAt: string | null;
    error: string | null;
  };
  looksRare?: {
    floorPrice: number | null;
    priceCurrency: string | null;
    retrievedAt: string | null;
    error: string | null;
  };
}

function baseUrl(chain: EvmChain): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("Missing ALCHEMY_API_KEY");
  return `https://${ALCHEMY_EVM_SUBDOMAIN[chain]}.g.alchemy.com/nft/v3/${key}`;
}

/** Fetch every NFT held by an address on a single chain, paginated. */
export async function fetchNftsForWallet(
  chain: EvmChain,
  address: string,
): Promise<NftItem[]> {
  const out: NftItem[] = [];
  let pageKey: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ owner: address, pageSize: "100" });
    if (pageKey) qs.set("pageKey", pageKey);
    let res: Response;
    try {
      res = await fetch(`${baseUrl(chain)}/getNFTsForOwner?${qs.toString()}`);
    } catch {
      break;
    }
    if (!res.ok) break;
    const json = (await res.json()) as NftsByOwnerResponse;
    for (const n of json.ownedNfts ?? []) {
      out.push({
        contract: n.contract.address.toLowerCase(),
        tokenId: n.tokenId,
        name: n.name,
        collectionName: n.contract.name,
        imageUrl:
          n.image?.cachedUrl ??
          n.image?.thumbnailUrl ??
          n.image?.originalUrl ??
          null,
        tokenUri: n.tokenUri ?? null,
        isSpam: !!n.contract.isSpam,
      });
    }
    if (!json.pageKey) break;
    pageKey = json.pageKey;
  }
  return out;
}

/**
 * Best-of-marketplace floor price in ETH (we pick the higher of OpenSea /
 * LooksRare). Returns null if neither marketplace knows the collection.
 */
export async function fetchFloorPrice(
  chain: EvmChain,
  contract: string,
): Promise<FloorPrice> {
  try {
    const res = await fetch(
      `${baseUrl(chain)}/getFloorPrice?contractAddress=${contract}`,
    );
    if (!res.ok) return { ethFloor: null, source: null, retrievedAt: null };
    const j = (await res.json()) as FloorResponse;
    const candidates: { eth: number; src: "opensea" | "looksrare"; at: string | null }[] = [];
    if (
      j.openSea?.floorPrice != null &&
      (j.openSea.priceCurrency ?? "ETH") === "ETH" &&
      !j.openSea.error
    ) {
      candidates.push({
        eth: j.openSea.floorPrice,
        src: "opensea",
        at: j.openSea.retrievedAt,
      });
    }
    if (
      j.looksRare?.floorPrice != null &&
      (j.looksRare.priceCurrency ?? "ETH") === "ETH" &&
      !j.looksRare.error
    ) {
      candidates.push({
        eth: j.looksRare.floorPrice,
        src: "looksrare",
        at: j.looksRare.retrievedAt,
      });
    }
    if (candidates.length === 0)
      return { ethFloor: null, source: null, retrievedAt: null };
    // OpenSea is canonical for floor — prefer it when both present.
    candidates.sort((a, b) => (a.src === "opensea" ? -1 : 1));
    const best = candidates[0];
    return { ethFloor: best.eth, source: best.src, retrievedAt: best.at };
  } catch {
    return { ethFloor: null, source: null, retrievedAt: null };
  }
}
