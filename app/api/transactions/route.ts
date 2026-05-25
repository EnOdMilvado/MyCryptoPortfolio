import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { detectChain } from "@/lib/chains/detect";
import { fetchEvmTransactions } from "@/lib/chains/transactions/evm";
import { fetchBitcoinTransactions } from "@/lib/chains/transactions/bitcoin";
import { fetchSolanaTransactions } from "@/lib/chains/transactions/solana";
import type { ChainType } from "@/lib/chains/types";
import type { Transaction } from "@/lib/chains/transactions/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface WalletRow {
  id: string;
  portfolio_id: string;
  name: string;
  address: string;
  chain_type: ChainType;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { walletId?: string };
  const walletId = typeof body.walletId === "string" ? body.walletId : null;
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // RLS restricts to wallets the user owns; this silently returns nothing
  // if the wallet belongs to someone else.
  const { data: wallet, error: wErr } = await supabase
    .from("crypto_wallets")
    .select("id, portfolio_id, name, address, chain_type")
    .eq("id", walletId)
    .maybeSingle();

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
  if (!wallet) return NextResponse.json({ error: "wallet not found" }, { status: 404 });

  const w = wallet as WalletRow;
  // Defensive: re-validate chain_type from the address itself.
  const detected = detectChain(w.address);
  const chainType = detected ?? w.chain_type;

  let transactions: Transaction[] = [];
  try {
    if (chainType === "btc") {
      transactions = await fetchBitcoinTransactions(w.address);
    } else if (chainType === "evm") {
      transactions = await fetchEvmTransactions(w.address);
    } else if (chainType === "sol") {
      transactions = await fetchSolanaTransactions(w.address);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    wallet: {
      id: w.id,
      name: w.name,
      address: w.address,
      chainType,
    },
    transactions,
    fetchedAt: new Date().toISOString(),
  });
}
