import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { PnlReport, type PnlWallet } from "@/components/PnlReport";
import {
  exchangeTradesToEvents,
  type ExchangeTradeRow,
} from "@/lib/pnl/exchange";
import type { PnlEvent } from "@/lib/pnl/engine";
import type { HoldingRow } from "@/components/HoldingsTable";
import type { ChainId, ChainType } from "@/lib/chains/types";

export const dynamic = "force-dynamic";

interface RawHolding {
  chain: string;
  contract: string;
  symbol: string | null;
  name: string | null;
  amount: number | string;
  price_usd: number | string | null;
  value_usd: number | string | null;
  price_change_24h: number | string | null;
}

/**
 * חישוב רווח והפסד — the "All holdings summary" table (with the per-token
 * wallet drill-down) plus Buys / Sells / realized P&L columns scoped to a
 * chosen date range. TAX-marked wallets and exchanges only. Exchange trades
 * are exact; on-chain is estimated client-side.
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

  // Latest BTC price (for the table's BTC column).
  let btcPriceUsd: number | null = null;
  const { data: btcRow } = await supabase
    .from("crypto_holdings_cache")
    .select("price_usd")
    .eq("chain", "bitcoin")
    .not("price_usd", "is", null)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (btcRow?.price_usd) btcPriceUsd = Number(btcRow.price_usd);

  const rows: HoldingRow[] = [];

  // TAX-included wallets → full holding rows (with portfolio context for the
  // drill-down) + the wallet list the client uses for on-chain P&L.
  const { data: rawPortfolios } = await supabase
    .from("crypto_portfolios")
    .select(
      "id, name, crypto_wallets ( id, name, address, chain_type, crypto_holdings_cache ( chain, contract, symbol, name, amount, price_usd, value_usd, price_change_24h ) )",
    );
  const wallets: PnlWallet[] = [];
  for (const p of (rawPortfolios as
    | {
        id: string;
        name: string;
        crypto_wallets:
          | {
              id: string;
              name: string;
              address: string;
              chain_type: ChainType;
              crypto_holdings_cache: RawHolding[] | null;
            }[]
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
      for (const h of w.crypto_holdings_cache ?? []) {
        rows.push({
          walletId: w.id,
          walletName: w.name,
          walletAddress: w.address,
          portfolioId: p.id,
          portfolioName: p.name,
          chain: h.chain as ChainId,
          contract: h.contract,
          symbol: h.symbol,
          name: h.name,
          amount: Number(h.amount),
          priceUsd: h.price_usd == null ? null : Number(h.price_usd),
          valueUsd: h.value_usd == null ? 0 : Number(h.value_usd),
          priceChange24h:
            h.price_change_24h == null ? null : Number(h.price_change_24h),
        });
      }
    }
  }

  // TAX-included exchanges: trades → exact events, balances → holding rows.
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
      .in("exchange_id", exchanges.map((e) => e.id));
    const byExchange = new Map<string, ExchangeTradeRow[]>();
    for (const t of (trades as (ExchangeTradeRow & { exchange_id: string })[] | null) ??
      []) {
      const arr = byExchange.get(t.exchange_id);
      if (arr) arr.push(t);
      else byExchange.set(t.exchange_id, [t]);
    }
    for (const [exId, tr] of byExchange) {
      exchangeEvents.push(
        ...exchangeTradesToEvents(tr, exLabel.get(exId) ?? "Exchange"),
      );
    }

    const { data: bc } = await supabase
      .from("crypto_exchange_balances_cache")
      .select("exchange_id, asset, amount, price_usd, value_usd, price_change_24h")
      .in("exchange_id", exchanges.map((e) => e.id));
    for (const b of (bc as
      | {
          exchange_id: string;
          asset: string;
          amount: number | string | null;
          price_usd: number | string | null;
          value_usd: number | string | null;
          price_change_24h: number | string | null;
        }[]
      | null) ?? []) {
      const amount = Number(b.amount ?? 0);
      if (!(amount > 0)) continue;
      const ex = exchanges.find((e) => e.id === b.exchange_id);
      rows.push({
        walletId: `exchange:${b.exchange_id}`,
        walletName: ex?.label ?? "Exchange",
        walletAddress: "",
        portfolioId: undefined,
        portfolioName: ex?.provider.toUpperCase() ?? "EXCHANGE",
        chain: "exchange" as ChainId,
        contract: `${b.exchange_id}:${b.asset.toUpperCase()}`,
        symbol: b.asset,
        name: b.asset,
        amount,
        priceUsd: b.price_usd == null ? null : Number(b.price_usd),
        valueUsd: b.value_usd == null ? 0 : Number(b.value_usd),
        priceChange24h:
          b.price_change_24h == null ? null : Number(b.price_change_24h),
        exchangeId: b.exchange_id,
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
        <PnlReport
          rows={rows}
          exchangeEvents={exchangeEvents}
          wallets={wallets}
          exchangeIds={exchanges.map((e) => e.id)}
          btcPriceUsd={btcPriceUsd}
        />
      </main>
    </>
  );
}
