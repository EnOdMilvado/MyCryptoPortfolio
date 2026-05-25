"use client";

import { CHAIN_COLORS, CHAIN_LABEL, type ChainId } from "@/lib/chains/types";

/**
 * Pill that displays a network name in the network's official brand color.
 *
 * Renders as a tinted chip: ~10% color background, ~33% color border,
 * 100% color text — readable on both light and dark themes.
 *
 * Use this everywhere a chain identifier appears so colors stay
 * consistent across the entire app.
 */
export function ChainPill({
  chain,
  className = "",
  size = "sm",
}: {
  chain: ChainId;
  className?: string;
  /**
   * `xs` for dense tables, `sm` (default) for general use,
   * `md` for headlines.
   */
  size?: "xs" | "sm" | "md";
}) {
  const color = CHAIN_COLORS[chain];
  const label = CHAIN_LABEL[chain];
  const sizeCls =
    size === "xs"
      ? "px-1.5 py-0 text-[10px]"
      : size === "md"
        ? "px-2.5 py-1 text-sm"
        : "px-1.5 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-semibold whitespace-nowrap ${sizeCls} ${className}`}
      style={{
        backgroundColor: `${color}1A`,
        color,
        borderColor: `${color}55`,
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
