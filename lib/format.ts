const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * Compact USD formatter for big numbers (market cap, volume) — always
 * rounds to exactly 2 decimal places within its scale, matching CMC's
 * homepage style ("$2.65T", "$162.26B") instead of the full un-abbreviated
 * figure. Falls back to formatUsd's normal 2-decimal formatting below $1K.
 */
export function formatUsdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return usdFormatter.format(value);
}

// Dynamic small-value USD formatter — shows up to 5 decimals for sub-$1
// prices (so GEMS at $0.0000064 reads as "$0.00001" instead of "$0.01").
// Negative values use the same logic with the minus sign prepended.
const usdSmallFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 5,
});

const btcFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const amountSmall = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const amountLarge = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

// Whole-dollar USD formatter (no cents) with thousands separators, e.g.
// "$2,031,471" — used for the dashboard header total per Or's request to
// show the full figure (not abbreviated to $2.03M) without noisy cents.
const usdWholeFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatUsdWhole(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return usdWholeFormatter.format(value);
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  // Anything ≥ $1 → standard 2-decimal cents formatting.
  if (abs >= 1) return usdFormatter.format(value);
  // Anything that rounds to 0 at 5 decimal places → "<$0.00001".
  if (abs > 0 && abs < 0.000005) return value < 0 ? ">-$0.00001" : "<$0.00001";
  // Sub-$1 → 2-to-5 decimal formatter (auto-strips trailing zeros past
  // the second). So $0.50 stays "$0.50" and $0.0000064 reads "$0.00001".
  return usdSmallFormatter.format(value);
}

/**
 * Used when displaying USD value of a holding: if no price was found, show a
 * neutral "—" rather than $0.00 (which would imply the holding is worthless).
 */
export function formatHoldingUsd(
  valueUsd: number | null | undefined,
  priceUsd: number | null | undefined,
): string {
  if (priceUsd == null) return "—";
  return formatUsd(valueUsd);
}

export function formatBtc(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${btcFormatter.format(value)} ₿`;
}

export function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 1 ? amountLarge.format(value) : amountSmall.format(value);
}

/**
 * Abbreviated token-amount formatter ("76.5K", "288.5K", "44.7K", ...) —
 * same K/M/B/T scaling as formatUsdCompact but WITHOUT a "$" prefix, since
 * this is a raw token quantity, not a dollar figure. Used in the All
 * Holdings summary table's Amount column: an aggregated holding across
 * many wallets/networks (e.g. ETH bridged across 10+ L2s, or a token with
 * naturally huge unit counts) can run into 6-7 raw digits, which reads as
 * alarmingly large/wrong at a glance even though the underlying math is
 * correct. Below 1000 still shows the full precise amount (small
 * quantities are exactly where the extra decimals matter).
 */
export function formatAmountCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return formatAmount(value);
}

export function shortenAddress(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function formatRelative(ts: string | Date | null): string {
  if (!ts) return "";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m === 1) return "1 minute ago";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return "1 hour ago";
  if (h < 24) return `${h} hours ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
