"use client";

import { useHideBalance } from "./HideBalanceProvider";
import { formatBtc, formatHoldingUsd, formatUsd, formatUsdWhole } from "@/lib/format";

const MASK = "••••";

/** A USD amount that respects the global Hide-balance toggle. */
export function UsdValue({
  value,
  priceUsd,
  className,
  whole,
}: {
  value: number | null | undefined;
  /** When passed, "—" is shown instead of "$0.00" if priceUsd is null. */
  priceUsd?: number | null;
  className?: string;
  /** Render as a whole-dollar figure with no cents (e.g. "$2,031,471")
   *  instead of the default 2-decimal format. Used by the dashboard
   *  header total per Or's request — full number, no abbreviation, no
   *  cents noise. */
  whole?: boolean;
}) {
  const { hidden } = useHideBalance();
  const text = whole
    ? formatUsdWhole(value)
    : priceUsd !== undefined
      ? formatHoldingUsd(value, priceUsd)
      : formatUsd(value);
  return <span className={className}>{hidden ? MASK : text}</span>;
}

/** A BTC equivalent line that respects the global Hide-balance toggle. */
export function BtcValue({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const { hidden } = useHideBalance();
  return <span className={className}>{hidden ? MASK : formatBtc(value)}</span>;
}
