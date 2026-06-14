"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CopyButton } from "./CopyButton";
import { BtcValue, UsdValue } from "./MaskedValue";
import { ReorderButtons } from "./ViewToggle";
import { EditableName } from "./EditableName";

export interface WalletDisplay {
  id: string;
  portfolioId: string;
  name: string;
  address: string;
  chainType: "btc" | "evm" | "sol" | "ton" | "dot" | "theta";
  totalUsd: number;
  totalBtc: number;
}

const CHAIN_BADGE: Record<WalletDisplay["chainType"], string> = {
  btc: "₿ Bitcoin",
  evm: "Ξ EVM",
  sol: "◎ Solana",
  ton: "💎 TON",
  dot: "● Polkadot",
  theta: "Θ Theta",
};

export function WalletCard({
  wallet,
  editing,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  wiggleVariant,
}: {
  wallet: WalletDisplay;
  editing?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  wiggleVariant?: "a" | "b";
}) {
  const router = useRouter();

  async function remove() {
    if (!confirm(`Delete wallet "${wallet.name}"?`)) return;
    const supabase = supabaseBrowser();
    await supabase.from("crypto_wallets").delete().eq("id", wallet.id);
    router.refresh();
  }

  async function rename(next: string) {
    await supabaseBrowser()
      .from("crypto_wallets")
      .update({ name: next })
      .eq("id", wallet.id);
    router.refresh();
  }

  const wiggleClass = editing
    ? wiggleVariant === "b"
      ? "animate-wiggle-b"
      : "animate-wiggle-a"
    : "";

  return (
    <div className={`card-tight flex flex-col gap-3 animate-fade-up relative ${wiggleClass}`}>
      {editing && onMoveUp && onMoveDown && (
        <div className="absolute top-3 left-3 z-10">
          <ReorderButtons
            onUp={onMoveUp}
            onDown={onMoveDown}
            isFirst={!!isFirst}
            isLast={!!isLast}
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className={`min-w-0 ${editing ? "pl-16" : ""}`}>
          <EditableName
            value={wallet.name}
            onSave={rename}
            editing={!!editing}
            className="font-bold truncate"
            inputClassName="font-bold w-full"
          />
          <CopyButton
            value={wallet.address}
            showValue
            truncate={{ head: 8, tail: 6 }}
            label="Copy wallet address"
            variant="bare"
            className="mt-0.5"
          />
        </div>
        <span className="pill shrink-0">{CHAIN_BADGE[wallet.chainType]}</span>
      </div>

      <div>
        <UsdValue value={wallet.totalUsd} className="text-xl font-extrabold tabular block" />
        <BtcValue value={wallet.totalBtc} className="text-xs text-text-muted tabular block" />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Link
          href={`/dashboard/portfolio/${wallet.portfolioId}/wallet/${wallet.id}`}
          className="text-xs font-semibold text-primary hover:text-primary-hover"
        >
          Open wallet →
        </Link>
        <button
          type="button"
          onClick={remove}
          className="text-xs text-text-muted hover:text-danger"
        >
          Delete wallet
        </button>
      </div>
    </div>
  );
}
