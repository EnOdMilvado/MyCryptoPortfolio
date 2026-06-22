-- Accountant read-only sharing.
-- Applied to the live DB via MCP on 2026-06-22; kept here for repo history.
--
-- 1) Tax-inclusion marks moved from per-browser localStorage to the DB so a
--    shared accountant link reflects exactly what the owner marked.
-- 2) crypto_shares: unguessable read-only share tokens.
-- 3) SECURITY DEFINER RPCs that validate a token and return ONLY tax-included,
--    non-sensitive data (exchange API keys/secrets are never selected).

create table if not exists crypto_tax_excludes (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('wallet','holding')),
  key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);
alter table crypto_tax_excludes enable row level security;
do $$ begin
  create policy "tax_excludes_select_own" on crypto_tax_excludes for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "tax_excludes_insert_own" on crypto_tax_excludes for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "tax_excludes_delete_own" on crypto_tax_excludes for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create table if not exists crypto_shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'accountant',
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz
);
alter table crypto_shares enable row level security;
do $$ begin
  create policy "shares_select_own" on crypto_shares for select using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "shares_insert_own" on crypto_shares for insert with check (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "shares_update_own" on crypto_shares for update using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "shares_delete_own" on crypto_shares for delete using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;

create or replace function share_owner(p_token text)
returns uuid language sql security definer set search_path = public as $$
  select owner_id from crypto_shares
  where token = p_token and revoked_at is null
    and (expires_at is null or expires_at > now())
  limit 1;
$$;

create or replace function share_get_data(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_excl_wallets text[];
  v_excl_holdings text[];
  v_result jsonb;
begin
  v_owner := share_owner(p_token);
  if v_owner is null then return null; end if;

  select coalesce(array_agg(key) filter (where kind = 'wallet'), '{}'),
         coalesce(array_agg(key) filter (where kind = 'holding'), '{}')
    into v_excl_wallets, v_excl_holdings
  from crypto_tax_excludes where user_id = v_owner;

  v_result := jsonb_build_object(
    'owner', (select jsonb_build_object('displayName', coalesce(pr.display_name, pr.email))
              from crypto_profiles pr where pr.id = v_owner),
    'wallets', (
      select coalesce(jsonb_agg(w order by so), '[]'::jsonb) from (
        select wal.sort_order as so, jsonb_build_object(
          'id', wal.id, 'name', wal.name, 'address', wal.address,
          'chainType', wal.chain_type, 'portfolioName', p.name,
          'holdings', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'chain', h.chain, 'contract', h.contract, 'symbol', h.symbol,
              'name', h.name, 'amount', h.amount, 'priceUsd', h.price_usd,
              'valueUsd', h.value_usd, 'priceChange24h', h.price_change_24h
            ) order by h.value_usd desc nulls last), '[]'::jsonb)
            from crypto_holdings_cache h
            where h.wallet_id = wal.id
              and not ((wal.id::text || '|' || h.chain || '|' || h.contract) = any(v_excl_holdings))
          )) as w
        from crypto_portfolios p
        join crypto_wallets wal on wal.portfolio_id = p.id
        where p.user_id = v_owner and not (wal.id::text = any(v_excl_wallets))
      ) t
    ),
    'exchanges', (
      select coalesce(jsonb_agg(e order by created_at), '[]'::jsonb) from (
        select ex.created_at, jsonb_build_object(
          'id', ex.id, 'provider', ex.provider, 'label', ex.label,
          'lastSyncedAt', ex.last_synced_at,
          'balances', (select coalesce(jsonb_agg(jsonb_build_object(
              'asset', b.asset, 'amount', b.amount, 'priceUsd', b.price_usd,
              'valueUsd', b.value_usd, 'priceChange24h', b.price_change_24h
            ) order by b.value_usd desc nulls last), '[]'::jsonb)
            from crypto_exchange_balances_cache b
            where b.exchange_id = ex.id
              and not (('exchange:' || ex.id::text || '|exchange|' || ex.id::text || ':' || upper(b.asset)) = any(v_excl_holdings))),
          'trades', (select coalesce(jsonb_agg(to_jsonb(tr) - 'exchange_id' order by tr.executed_at desc nulls last), '[]'::jsonb)
            from crypto_exchange_trades tr where tr.exchange_id = ex.id),
          'deposits', (select coalesce(jsonb_agg(to_jsonb(dp) - 'exchange_id' order by dp.occurred_at desc nulls last), '[]'::jsonb)
            from crypto_exchange_deposits dp where dp.exchange_id = ex.id),
          'withdrawals', (select coalesce(jsonb_agg(to_jsonb(wd) - 'exchange_id' order by wd.occurred_at desc nulls last), '[]'::jsonb)
            from crypto_exchange_withdrawals wd where wd.exchange_id = ex.id),
          'orders', (select coalesce(jsonb_agg(to_jsonb(od) - 'exchange_id' order by od.placed_at desc nulls last), '[]'::jsonb)
            from crypto_exchange_orders od where od.exchange_id = ex.id)
        ) as e
        from crypto_exchanges ex
        where ex.user_id = v_owner and not (('exchange:' || ex.id::text) = any(v_excl_wallets))
      ) t
    ),
    'offchain', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'label', o.label, 'kind', o.kind, 'currency', o.currency, 'amount', o.amount
      ) order by o.created_at), '[]'::jsonb)
      from crypto_offchain_balances o
      where o.user_id = v_owner and not (('offchain:' || o.id::text) = any(v_excl_wallets))
    )
  );
  return v_result;
end;
$$;

create or replace function share_get_wallet(p_token text, p_wallet_id uuid)
returns table(id uuid, name text, address text, chain_type text)
language sql security definer set search_path = public as $$
  select wal.id, wal.name, wal.address, wal.chain_type
  from crypto_wallets wal
  join crypto_portfolios p on p.id = wal.portfolio_id
  where wal.id = p_wallet_id
    and p.user_id = share_owner(p_token)
    and not exists (select 1 from crypto_tax_excludes te
                    where te.user_id = p.user_id and te.kind = 'wallet' and te.key = wal.id::text);
$$;

grant execute on function share_get_data(text) to anon, authenticated;
grant execute on function share_get_wallet(text, uuid) to anon, authenticated;
revoke execute on function share_owner(text) from anon, authenticated;
