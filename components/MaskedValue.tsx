"use client";

import { useHideBalance } from "./HideBalanceProvider";
import { formatBtc, formatHoldingUsd, formatUsd } from "@/lib/format";

const MASK = "••••";

/** A USD amount that respects the global Hide-balance toggle. */
export function UsdValue({
  value,
  priceUsd,
  className,
}: {
  value: number | null | undefined;
  /** When passed, "—" is shown instead of "$0.00" if priceUsd is null. */
  priceUsd?: number | null;
  className?: string;
}) {
  const { hidden } = useHideBalance();
  const text =
    priceUsd !== undefined ? formatHoldingUsd(value, priceUsd) : formatUsd(value);
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
