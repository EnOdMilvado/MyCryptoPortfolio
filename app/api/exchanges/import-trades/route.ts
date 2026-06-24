import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ImportTrade {
  executed_at: string;
  side: string;
  base_asset: string;
  quote_asset: string;
  price: number | null;
  qty: number;
  quote_qty: number | null;
  fee: number | null;
  fee_asset: string | null;
}

/** Small stable hash → dedupe key, so re-importing the same CSV is idempotent. */
function hashRow(parts: (string | number | null)[]): string {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Import exchange trades from a user-mapped CSV. Trades are upserted into
 * crypto_exchange_trades with a synthetic `csv:{hash}` trade_id so repeated
 * imports don't duplicate. Ownership of the exchange is verified server-side.
 */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    exchangeId?: string;
    trades?: ImportTrade[];
  };
  const exchangeId = body.exchangeId;
  const trades = Array.isArray(body.trades) ? body.trades : [];
  if (!exchangeId || trades.length === 0) {
    return NextResponse.json(
      { error: "exchangeId and trades required" },
      { status: 400 },
    );
  }

  // Verify the exchange belongs to the caller (RLS would also block, but a
  // clear 403 is friendlier).
  const { data: ex } = await supabase
    .from("crypto_exchanges")
    .select("id")
    .eq("id", exchangeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ex) {
    return NextResponse.json({ error: "exchange not found" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const rows = trades
    .filter((t) => t.base_asset && t.qty > 0 && t.executed_at)
    .map((t) => {
      const base = t.base_asset.trim().toUpperCase();
      const quote = (t.quote_asset || "").trim().toUpperCase();
      const side = t.side.trim().toLowerCase() === "sell" ? "sell" : "buy";
      const qty = Number(t.qty);
      const price = t.price == null ? null : Number(t.price);
      const quoteQty =
        t.quote_qty != null
          ? Number(t.quote_qty)
          : price != null
            ? qty * price
            : null;
      return {
        exchange_id: exchangeId,
        trade_id: `csv:${hashRow([t.executed_at, side, base, quote, qty, price])}`,
        symbol: `${base}${quote}`,
        base_asset: base,
        quote_asset: quote,
        side,
        price,
        qty,
        quote_qty: quoteQty,
        fee: t.fee == null ? null : Number(t.fee),
        fee_asset: t.fee_asset ? t.fee_asset.trim().toUpperCase() : null,
        executed_at: t.executed_at,
        fetched_at: nowIso,
      };
    });

  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid rows" }, { status: 400 });
  }

  const { error } = await supabase
    .from("crypto_exchange_trades")
    .upsert(rows, { onConflict: "exchange_id,trade_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: rows.length });
}
