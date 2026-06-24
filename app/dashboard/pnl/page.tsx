import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { PnlReport, type PnlWallet } from "@/components/PnlReport";
import {
  exchangeTradesToEvents,
  type ExchangeTradeRow,
} from "@/lib/pnl/exchange";
import type { PnlEvent } from "@/lib/pnl/engine";
import type { ChainType } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

/**
 * Tax P&L report page. Realized profit/loss per token over a configurable date
 * range, from TAX-marked wallets and exchanges only. Exchange trades are exact;
 * on-chain activity is priced with estimated historical prices client-side.
 */
export default async function PnlPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("is_admin, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  // TAX exclusions (wallet-level keys: wallet uuid / "exchange:{id}").
  const { data: taxRows } = await supabase
    .from("crypto_tax_excludes")
    .select("kind, key");
  const excludedWalletKeys = new Set(
    (taxRows ?? [])
      .filter((r: { kind: string }) => r.kind === "wallet")
      .map((r: { key: string }) => r.key),
  );

  // TAX-included exchanges + their trades → exact P&L events.
  const { data: exRows } = await supabase
    .from("crypto_exchanges")
    .select("id, provider, label");
  const exchanges = (
    (exRows as { id: string; provider: string; label: string }[] | null) ?? []
  ).filter((e) => !excludedWalletKeys.has(`exchange:${e.id}`));
  const exLabel = new Map(exchanges.map((e) => [e.id, e.label]));

  const exchangeEvents: PnlEvent[] = [];
  if (exchanges.length > 0) {
    const { data: trades } = await supabase
      .from("crypto_exchange_trades")
      .select(
        "exchange_id, base_asset, quote_asset, side, price, qty, quote_qty, fee, fee_asset, executed_at",
      )
      .in(
        "exchange_id",
        exchanges.map((e) => e.id),
      );
    const byExchange = new Map<string, ExchangeTradeRow[]>();
    for (const t of (trades as (ExchangeTradeRow & { exchange_id: string })[] | null) ??
      []) {
      const arr = byExchange.get(t.exchange_id);
      if (arr) arr.push(t);
      else byExchange.set(t.exchange_id, [t]);
    }
    for (const [exId, rows] of byExchange) {
      exchangeEvents.push(
        ...exchangeTradesToEvents(rows, exLabel.get(exId) ?? "Exchange"),
      );
    }
  }

  // TAX-included wallets → the client fetches their on-chain transactions.
  const { data: rawPortfolios } = await supabase
    .from("crypto_portfolios")
    .select("id, crypto_wallets ( id, name, address, chain_type )");
  const wallets: PnlWallet[] = [];
  for (const p of (rawPortfolios as
    | {
        crypto_wallets:
          | { id: string; name: string; address: string; chain_type: ChainType }[]
          | null;
      }[]
    | null) ?? []) {
    for (const w of p.crypto_wallets ?? []) {
      if (excludedWalletKeys.has(w.id)) continue;
      wallets.push({
        id: w.id,
        name: w.name,
        address: w.address,
        chainType: w.chain_type,
      });
    }
  }

  return (
    <>
      <NavBar
        isAdmin={!!profile?.is_admin}
        profileUser={{
          email: user.email ?? "",
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <PnlReport exchangeEvents={exchangeEvents} wallets={wallets} />
      </main>
    </>
  );
}
