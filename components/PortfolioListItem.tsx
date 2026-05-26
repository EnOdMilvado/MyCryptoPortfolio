"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BtcValue, UsdValue } from "./MaskedValue";
import { ReorderButtons } from "./ViewToggle";
import { EditableName } from "./EditableName";
import type { PortfolioSummary } from "./PortfolioCard";

export function PortfolioListItem({
  portfolio,
  disabled,
  onToggleDisabled,
  editing,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  wiggleVariant,
}: {
  portfolio: PortfolioSummary;
  disabled?: boolean;
  onToggleDisabled?: () => void;
  editing?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  wiggleVariant?: "a" | "b";
}) {
  const router = useRouter();
  async function rename(next: string) {
    await supabaseBrowser()
      .from("crypto_portfolios")
      .update({ name: next })
      .eq("id", portfolio.id);
    router.refresh();
  }
  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const w = portfolio.walletCount;
    const first = confirm(
      `Delete portfolio "${portfolio.name}"?\n\n` +
        `This will also delete ${w} ${w === 1 ? "wallet" : "wallets"} and all of their cached holdings & NFTs.\n\n` +
        `This cannot be undone.`,
    );
    if (!first) return;
    const second = confirm(`Last chance — really delete "${portfolio.name}"?`);
    if (!second) return;
    await supabaseBrowser().from("crypto_portfolios").delete().eq("id", portfolio.id);
    router.refresh();
  }
  const wiggleClass = editing
    ? wiggleVariant === "b"
      ? "animate-wiggle-b"
      : "animate-wiggle-a"
    : "";
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface ${
        disabled ? "opacity-50" : "hover:border-primary/40 transition"
      } ${wiggleClass}`}
    >
      {editing && onMoveUp && onMoveDown && (
        <ReorderButtons
          onUp={onMoveUp}
          onDown={onMoveDown}
          isFirst={!!isFirst}
          isLast={!!isLast}
        />
      )}
      {onToggleDisabled && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleDisabled();
          }}
          aria-label={disabled ? "Enable portfolio" : "Disable portfolio"}
          title={disabled ? "Re-enable" : "Disable"}
          className="h-6 w-6 rounded-full bg-surface-2 text-text-muted hover:text-primary transition inline-flex items-center justify-center"
        >
          {disabled ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="m4.9 4.9 14.2 14.2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          )}
        </button>
      )}
      {editing ? (
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <EditableName
              value={portfolio.name}
              onSave={rename}
              editing={editing}
              className="font-bold text-text truncate block"
              inputClassName="font-bold text-text w-full"
            />
            <div className="text-xs text-text-muted">
              {portfolio.walletCount} {portfolio.walletCount === 1 ? "wallet" : "wallets"} ·{" "}
              {portfolio.holdingCount} {portfolio.holdingCount === 1 ? "holding" : "holdings"}
            </div>
          </div>
          <div className="text-right tabular shrink-0">
            <UsdValue value={portfolio.totalUsd} className="font-extrabold block" />
            <BtcValue value={portfolio.totalBtc} className="text-xs text-text-muted block" />
          </div>
        </div>
      ) : (
        <Link href={`/dashboard/portfolio/${portfolio.id}`} className="flex-1 flex items-center gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-text truncate">{portfolio.name}</div>
            <div className="text-xs text-text-muted">
              {portfolio.walletCount} {portfolio.walletCount === 1 ? "wallet" : "wallets"} ·{" "}
              {portfolio.holdingCount} {portfolio.holdingCount === 1 ? "holding" : "holdings"}
            </div>
          </div>
          <div className="text-right tabular shrink-0">
            <UsdValue value={portfolio.totalUsd} className="font-extrabold block" />
            <BtcValue value={portfolio.totalBtc} className="text-xs text-text-muted block" />
          </div>
        </Link>
      )}
      {editing && (
        <button
          type="button"
          onClick={remove}
          className="text-xs text-text-muted hover:text-danger px-1 shrink-0"
          aria-label="Delete portfolio"
          title="Delete portfolio + all its wallets"
        >
          🗑
        </button>
      )}
    </div>
  );
}
