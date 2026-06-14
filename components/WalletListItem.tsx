"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BtcValue, UsdValue } from "./MaskedValue";
import { ReorderButtons } from "./ViewToggle";
import { EditableName } from "./EditableName";
import { shortenAddress } from "@/lib/format";
import type { WalletDisplay } from "./WalletCard";

const CHAIN_BADGE: Record<WalletDisplay["chainType"], string> = {
  btc: "₿",
  evm: "Ξ",
  sol: "◎",
  ton: "💎",
  dot: "●",
  theta: "Θ",
};

export function WalletListItem({
  wallet,
  portfolioId,
  editing,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  wiggleVariant,
}: {
  wallet: WalletDisplay;
  portfolioId: string;
  editing?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  wiggleVariant?: "a" | "b";
}) {
  const router = useRouter();

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete wallet "${wallet.name}"?`)) return;
    await supabaseBrowser().from("crypto_wallets").delete().eq("id", wallet.id);
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
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface hover:border-primary/40 transition ${wiggleClass}`}
    >
      {editing && onMoveUp && onMoveDown && (
        <ReorderButtons
          onUp={onMoveUp}
          onDown={onMoveDown}
          isFirst={!!isFirst}
          isLast={!!isLast}
        />
      )}
      <span className="pill shrink-0" title={wallet.chainType.toUpperCase()}>
        {CHAIN_BADGE[wallet.chainType]}
      </span>
      {editing ? (
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <EditableName
              value={wallet.name}
              onSave={rename}
              editing={editing}
              className="font-bold text-text truncate block"
              inputClassName="font-bold text-text w-full"
            />
            <div className="text-xs text-text-muted font-mono truncate">
              {shortenAddress(wallet.address, 8, 6)}
            </div>
          </div>
          <div className="text-right tabular shrink-0">
            <UsdValue value={wallet.totalUsd} className="font-extrabold block" />
            <BtcValue value={wallet.totalBtc} className="text-xs text-text-muted block" />
          </div>
        </div>
      ) : (
        <Link
          href={`/dashboard/portfolio/${portfolioId}/wallet/${wallet.id}`}
          className="flex-1 flex items-center gap-3 min-w-0"
        >
          <div className="min-w-0 flex-1">
            <div className="font-bold text-text truncate">{wallet.name}</div>
            <div className="text-xs text-text-muted font-mono truncate">
              {shortenAddress(wallet.address, 8, 6)}
            </div>
          </div>
          <div className="text-right tabular shrink-0">
            <UsdValue value={wallet.totalUsd} className="font-extrabold block" />
            <BtcValue value={wallet.totalBtc} className="text-xs text-text-muted block" />
          </div>
        </Link>
      )}
      <button
        type="button"
        onClick={remove}
        className="text-xs text-text-muted hover:text-danger px-1"
        aria-label="Delete wallet"
        title="Delete wallet"
      >
        🗑
      </button>
    </div>
  );
}
