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

interface ShareWalletRow {
  id: string;
  name: string;
  address: string;
  chain_type: ChainType;
}

/**
 * On-chain transactions for a wallet, gated by a valid accountant share token
 * (no login). `share_get_wallet` validates the token and that the wallet is the
 * owner's AND not tax-excluded; it returns nothing otherwise, so the accountant
 * can only ever pull transactions for wallets the owner shared.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    walletId?: string;
  };
  const token = typeof body.token === "string" ? body.token : null;
  const walletId = typeof body.walletId === "string" ? body.walletId : null;
  if (!token || !walletId) {
    return NextResponse.json(
      { error: "token and walletId required" },
      { status: 400 },
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("share_get_wallet", {
    p_token: token,
    p_wallet_id: walletId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as ShareWalletRow[];
  const wallet = rows[0];
  if (!wallet) {
    return NextResponse.json(
      { error: "not found or not shared" },
      { status: 404 },
    );
  }

  const detected = detectChain(wallet.address);
  const chainType = detected ?? wallet.chain_type;

  let transactions: Transaction[] = [];
  try {
    if (chainType === "btc") {
      transactions = await fetchBitcoinTransactions(wallet.address);
    } else if (chainType === "evm") {
      transactions = await fetchEvmTransactions(wallet.address);
    } else if (chainType === "sol") {
      transactions = await fetchSolanaTransactions(wallet.address);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ transactions, fetchedAt: new Date().toISOString() });
}
