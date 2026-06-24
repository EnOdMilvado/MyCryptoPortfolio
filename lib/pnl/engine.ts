/**
 * FIFO realized profit-and-loss engine.
 *
 * Feed it every acquisition (buy/receive) and disposal (sell/send) of each
 * asset, across all venues, and it computes — per asset, for a requested date
 * window — total buys, total sells, and the realized gain/loss attributed to
 * the disposals that fall inside the window.
 *
 * Cost basis is FIFO: each disposal consumes the oldest un-consumed
 * acquisition lots first. Acquisitions from BEFORE the window still count as
 * cost basis for in-window disposals (that's correct — you can sell in 2025
 * something you bought in 2023). Only the *realized* event (the disposal) has
 * to fall inside the window to be reported.
 *
 * This is a tool to assist tax preparation, not tax advice. On-chain inputs
 * may carry estimated prices; those flow through `estimated`.
 */

export interface PnlEvent {
  /** Normalized asset symbol, e.g. "BTC", "ETH", "PEPE". */
  asset: string;
  /** ISO timestamp of the trade/transfer. */
  date: string;
  kind: "buy" | "sell";
  /** Units of the asset (always positive). */
  qty: number;
  /** Total USD value of this event (cost for a buy, proceeds for a sell). */
  usdValue: number;
  /** Fee in USD, if known. */
  feeUsd?: number;
  /** Human label of where it happened, e.g. "Binance" or "Trezor 1". */
  source: string;
  /** True when the USD value is an estimate (e.g. on-chain historical price). */
  estimated?: boolean;
}

export interface AssetPnl {
  asset: string;
  /** Buys whose date is inside the window. */
  buysQty: number;
  buysUsd: number;
  /** Sells whose date is inside the window. */
  sellsQty: number;
  sellsUsd: number;
  /** Realized gain/loss (proceeds − FIFO cost) for sells inside the window. */
  realizedUsd: number;
  feeUsd: number;
  /** Any event contributing to this asset used an estimated price. */
  estimated: boolean;
  /** A sell consumed more than the known acquired quantity — cost basis is
   *  incomplete, so realizedUsd is overstated. Flag for manual review. */
  missingCostBasis: boolean;
  /** Per-event breakdown for the asset's detail view (all events, sorted). */
  events: PnlEvent[];
}

export interface PnlResult {
  assets: AssetPnl[];
  totalBuysUsd: number;
  totalSellsUsd: number;
  totalRealizedUsd: number;
  totalFeeUsd: number;
  anyEstimated: boolean;
  anyMissingCostBasis: boolean;
}

interface Lot {
  qty: number;
  costPerUnit: number;
  estimated: boolean;
}

function inWindow(dateIso: string, fromIso: string | null, toIso: string | null): boolean {
  const t = new Date(dateIso).getTime();
  if (Number.isNaN(t)) return false;
  if (fromIso && t < new Date(fromIso).getTime()) return false;
  if (toIso && t > new Date(toIso).getTime()) return false;
  return true;
}

/**
 * Compute FIFO P&L. `from`/`to` are ISO strings (inclusive-ish); pass null for
 * an open end. Events outside the window still build cost basis but are not
 * counted in the buys/sells/realized totals.
 */
export function computePnl(
  events: PnlEvent[],
  from: string | null,
  to: string | null,
): PnlResult {
  // Group by asset.
  const byAsset = new Map<string, PnlEvent[]>();
  for (const e of events) {
    if (!(e.qty > 0)) continue;
    const arr = byAsset.get(e.asset);
    if (arr) arr.push(e);
    else byAsset.set(e.asset, [e]);
  }

  const assets: AssetPnl[] = [];

  for (const [asset, evs] of byAsset) {
    // Chronological — acquisitions must be processed before the disposals that
    // consume them.
    const sorted = [...evs].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const lots: Lot[] = [];
    let buysQty = 0;
    let buysUsd = 0;
    let sellsQty = 0;
    let sellsUsd = 0;
    let realizedUsd = 0;
    let feeUsd = 0;
    let estimated = false;
    let missingCostBasis = false;

    for (const e of sorted) {
      const within = inWindow(e.date, from, to);
      if (e.estimated) estimated = true;
      if (within && e.feeUsd) feeUsd += e.feeUsd;

      if (e.kind === "buy") {
        const costPerUnit = e.qty > 0 ? e.usdValue / e.qty : 0;
        lots.push({ qty: e.qty, costPerUnit, estimated: !!e.estimated });
        if (within) {
          buysQty += e.qty;
          buysUsd += e.usdValue;
        }
      } else {
        // sell — consume FIFO lots for cost basis
        let remaining = e.qty;
        let costBasis = 0;
        while (remaining > 1e-18 && lots.length > 0) {
          const lot = lots[0];
          const take = Math.min(remaining, lot.qty);
          costBasis += take * lot.costPerUnit;
          if (lot.estimated) estimated = true;
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 1e-18) lots.shift();
        }
        if (remaining > 1e-12) {
          // Sold more than we have acquisition records for — cost basis for the
          // shortfall is unknown (treated as 0). Flag it.
          missingCostBasis = true;
        }
        if (within) {
          sellsQty += e.qty;
          sellsUsd += e.usdValue;
          realizedUsd += e.usdValue - costBasis;
        }
      }
    }

    // Only surface assets that had activity inside the window.
    if (buysQty === 0 && sellsQty === 0) continue;

    assets.push({
      asset,
      buysQty,
      buysUsd,
      sellsQty,
      sellsUsd,
      realizedUsd,
      feeUsd,
      estimated,
      missingCostBasis,
      events: sorted.filter((e) => inWindow(e.date, from, to)),
    });
  }

  assets.sort((a, b) => Math.abs(b.realizedUsd) - Math.abs(a.realizedUsd));

  return {
    assets,
    totalBuysUsd: assets.reduce((s, a) => s + a.buysUsd, 0),
    totalSellsUsd: assets.reduce((s, a) => s + a.sellsUsd, 0),
    totalRealizedUsd: assets.reduce((s, a) => s + a.realizedUsd, 0),
    totalFeeUsd: assets.reduce((s, a) => s + a.feeUsd, 0),
    anyEstimated: assets.some((a) => a.estimated),
    anyMissingCostBasis: assets.some((a) => a.missingCostBasis),
  };
}
