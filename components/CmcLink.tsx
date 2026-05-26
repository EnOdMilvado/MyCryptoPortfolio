"use client";

import { cmcUrl } from "@/lib/chains/cmc";

/**
 * Tiny external-link icon that opens the asset's CoinMarketCap page in a
 * new tab. Click bubbles via stopPropagation so it never triggers parent
 * navigation (e.g. inside a clickable row).
 */
export function CmcLink({
  symbol,
  size = 12,
  className = "",
}: {
  symbol: string | null | undefined;
  /** Icon size in px. Default 12 for inline-with-text. */
  size?: number;
  className?: string;
}) {
  if (!symbol) return null;
  return (
    <a
      href={cmcUrl(symbol)}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      title={`View ${symbol.toUpperCase()} on CoinMarketCap`}
      className={`inline-flex items-center justify-center text-text-muted hover:text-primary transition shrink-0 ${className}`}
      aria-label={`Open ${symbol.toUpperCase()} on CoinMarketCap`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14 3h7v7" />
        <path d="M10 14 21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </svg>
    </a>
  );
}
