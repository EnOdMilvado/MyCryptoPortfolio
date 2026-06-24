import type { PnlEvent } from "./engine";

/** Quote assets we treat as 1 USD. */
const STABLE = new Set([
  "USDT",
  "USDC",
  "USD",
  "BUSD",
  "DAI",
  "TUSD",
  "FDUSD",
  "USDD",
  "PYUSD",
  "USDE",
  "USDP",
]);

export interface ExchangeTradeRow {
  base_asset: string | null;
  quote_asset: string | null;
  side: string | null; // "buy" | "sell" (provider casing varies)
  price: number | string | null;
  qty: number | string | null;
  quote_qty: number | string | null;
  fee: number | string | null;
  fee_asset: string | null;
  executed_at: string | null;
}

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map exchange trade rows to P&L events. USD-stable quote pairs (USDT/USDC/…)
 * are exact — `quote_qty` is the USD value. Non-stable quote pairs (e.g. an
 * alt priced in BTC) can't be valued in USD here without a historical quote
 * price, so they're emitted as estimated with quote_qty used as a placeholder.
 */
export function exchangeTradesToEvents(
  rows: ExchangeTradeRow[],
  sourceLabel: string,
): PnlEvent[] {
  const out: PnlEvent[] = [];
  for (const r of rows) {
    const base = (r.base_asset ?? "").trim().toUpperCase();
    const quote = (r.quote_asset ?? "").trim().toUpperCase();
    const qty = num(r.qty);
    if (!base || qty <= 0 || !r.executed_at) continue;

    const side = (r.side ?? "").trim().toLowerCase();
    const kind: "buy" | "sell" = side === "sell" ? "sell" : "buy";
    const stable = STABLE.has(quote);
    const usdValue = num(r.quote_qty); // USD when quote is stable
    const price = num(r.price);

    // Fee → USD best-effort.
    const feeAsset = (r.fee_asset ?? "").trim().toUpperCase();
    const fee = num(r.fee);
    let feeUsd = 0;
    if (fee > 0) {
      if (STABLE.has(feeAsset)) feeUsd = fee;
      else if (feeAsset === base && stable) feeUsd = fee * price;
      else if (feeAsset === quote && stable) feeUsd = fee;
    }

    out.push({
      asset: base,
      date: r.executed_at,
      kind,
      qty,
      usdValue,
      feeUsd,
      source: sourceLabel,
      estimated: !stable, // non-stable quote → USD value is approximate
    });
  }
  return out;
}
