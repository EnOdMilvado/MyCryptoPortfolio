const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const btcFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
});

const amountSmall = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const amountLarge = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.005) return "<$0.01";
  return usdFormatter.format(value);
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
