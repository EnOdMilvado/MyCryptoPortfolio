"use client";

import Link from "next/link";
import { BtcValue, UsdValue } from "./MaskedValue";
import { ReorderButtons } from "./ViewToggle";
import { EditableName } from "./EditableName";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

export interface PortfolioSummary {
  id: string;
  name: string;
  walletCount: number;
  holdingCount: number;
  totalUsd: number;
  totalBtc: number;
}

export function PortfolioCard({
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
    const second = confirm(`Are you sure? Type-confirm not required — last chance.`);
    if (!second) return;
    await supabaseBrowser()
      .from("crypto_portfolios")
      .delete()
      .eq("id", portfolio.id);
    router.refresh();
  }
  const wiggleClass = editing
    ? wiggleVariant === "b"
      ? "animate-wiggle-b"
      : "animate-wiggle-a"
    : "";
  return (
    <div
      className={`card group block transition relative ${
        disabled ? "opacity-50" : "hover:-translate-y-0.5 hover:shadow-soft"
      } ${wiggleClass}`}
    >
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
      {onToggleDisabled && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleDisabled();
          }}
          aria-label={disabled ? "Enable portfolio" : "Disable portfolio"}
          title={
            disabled
              ? "Re-enable in dashboard total"
              : "Disable — won't count toward dashboard total"
          }
          className="absolute top-3 right-3 z-10 inline-flex items-center justify-center h-7 w-7 rounded-full bg-surface-2 text-text-muted hover:text-primary transition"
        >
          {disabled ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="m4.9 4.9 14.2 14.2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          )}
        </button>
      )}
      {/* In edit mode the title is an editable input — clicking opens the
          editor without navigating away. */}
      {editing ? (
        <div className={`flex items-start justify-between gap-3 ${editing ? "pl-20" : ""} pr-8`}>
          <EditableName
            value={portfolio.name}
            onSave={rename}
            editing={editing}
            className="text-lg font-bold text-text truncate"
            inputClassName="text-lg font-bold text-text w-full"
          />
          <span className="pill">
            {portfolio.walletCount} {portfolio.walletCount === 1 ? "wallet" : "wallets"}
          </span>
        </div>
      ) : (
        <Link href={`/dashboard/portfolio/${portfolio.id}`} className="block">
          <div className="flex items-start justify-between gap-3 pr-8">
            <h3 className="text-lg font-bold text-text truncate">{portfolio.name}</h3>
            <span className="pill">
              {portfolio.walletCount} {portfolio.walletCount === 1 ? "wallet" : "wallets"}
            </span>
          </div>
        </Link>
      )}
      <Link
        href={editing ? "#" : `/dashboard/portfolio/${portfolio.id}`}
        onClick={(e) => {
          if (editing) e.preventDefault();
        }}
        className="block"
      >
        <UsdValue
          value={portfolio.totalUsd}
          className="mt-4 block text-3xl font-extrabold text-text tabular"
        />
        <BtcValue value={portfolio.totalBtc} className="block text-sm text-text-muted tabular" />
        <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
          <span>
            {portfolio.holdingCount} {portfolio.holdingCount === 1 ? "holding" : "holdings"}
          </span>
          <span className="text-primary group-hover:text-primary-hover">Open →</span>
        </div>
      </Link>
      {editing && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={remove}
            className="text-xs text-text-muted hover:text-danger"
            title="Delete portfolio + all its wallets"
          >
            🗑 Delete portfolio
          </button>
        </div>
      )}
    </div>
  );
}
