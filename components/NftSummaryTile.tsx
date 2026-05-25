import Link from "next/link";
import { UsdValue } from "./MaskedValue";

export interface NftSummary {
  totalCount: number;
  nonSpamCount: number;
  totalFloorUsd: number;
}

/**
 * NFT summary entry shown on the dashboard.
 *
 * `variant="card"` (default) renders as a grid card matching `PortfolioCard`.
 * `variant="list"` renders as a horizontal row matching `PortfolioListItem`
 * so the NFT entry stays visible when the user switches the portfolio view
 * to list mode.
 */
export function NftSummaryTile({
  summary,
  variant = "card",
}: {
  summary: NftSummary;
  variant?: "card" | "list";
}) {
  if (summary.totalCount === 0) return null;

  if (variant === "list") {
    return (
      <Link
        href="/dashboard/nfts"
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface hover:border-primary/40 transition"
      >
        <div className="min-w-0 flex-1">
          <div className="font-bold text-text truncate">NFTs</div>
          <div className="text-xs text-text-muted">
            {summary.nonSpamCount}{" "}
            {summary.nonSpamCount === 1 ? "item" : "items"}
            {summary.totalCount > summary.nonSpamCount && (
              <>
                {" "}
                · {summary.totalCount - summary.nonSpamCount} spam hidden
              </>
            )}
          </div>
        </div>
        <div className="text-right tabular shrink-0">
          <UsdValue
            value={summary.totalFloorUsd}
            priceUsd={summary.totalFloorUsd > 0 ? 1 : null}
            className="font-extrabold block"
          />
          <span className="block text-xs text-text-muted">Total floor</span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href="/dashboard/nfts"
      className="card group block transition hover:-translate-y-0.5 hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold text-text">NFTs</h3>
        <span className="pill">{summary.nonSpamCount}</span>
      </div>
      <UsdValue
        value={summary.totalFloorUsd}
        priceUsd={summary.totalFloorUsd > 0 ? 1 : null}
        className="mt-4 block text-3xl font-extrabold text-text tabular"
      />
      <p className="text-sm text-text-muted">Total floor value</p>
      <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
        <span>
          {summary.nonSpamCount} non-spam · {summary.totalCount - summary.nonSpamCount} spam hidden
        </span>
        <span className="text-primary group-hover:text-primary-hover">Open →</span>
      </div>
    </Link>
  );
}
