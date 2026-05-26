-- Exchange trade / deposit / withdrawal history caches
-- Mirrors the RLS pattern used by crypto_exchange_balances_cache: rows are
-- scoped via exchange_id -> crypto_exchanges.user_id = auth.uid().

create table public.crypto_exchange_trades (
  exchange_id uuid not null references public.crypto_exchanges(id) on delete cascade,
  trade_id    text not null,
  symbol      text not null,
  base_asset  text not null,
  quote_asset text not null,
  side        text not null check (side in ('BUY','SELL')),
  price       numeric not null,
  qty         numeric not null,
  quote_qty   numeric not null,
  fee         numeric,
  fee_asset   text,
  executed_at timestamptz not null,
  fetched_at  timestamptz not null default now(),
  primary key (exchange_id, trade_id)
);
create index crypto_exchange_trades_exchange_time_idx
  on public.crypto_exchange_trades (exchange_id, executed_at desc);

create table public.crypto_exchange_deposits (
  exchange_id uuid not null references public.crypto_exchanges(id) on delete cascade,
  deposit_id  text not null,
  coin        text not null,
  network     text,
  amount      numeric not null,
  address     text,
  tx_id       text,
  status      text,
  occurred_at timestamptz not null,
  fetched_at  timestamptz not null default now(),
  primary key (exchange_id, deposit_id)
);
create index crypto_exchange_deposits_exchange_time_idx
  on public.crypto_exchange_deposits (exchange_id, occurred_at desc);

create table public.crypto_exchange_withdrawals (
  exchange_id   uuid not null references public.crypto_exchanges(id) on delete cascade,
  withdrawal_id text not null,
  coin          text not null,
  network       text,
  amount        numeric not null,
  fee           numeric,
  address       text,
  tx_id         text,
  status        text,
  occurred_at   timestamptz not null,
  fetched_at    timestamptz not null default now(),
  primary key (exchange_id, withdrawal_id)
);
create index crypto_exchange_withdrawals_exchange_time_idx
  on public.crypto_exchange_withdrawals (exchange_id, occurred_at desc);

alter table public.crypto_exchanges
  add column last_synced_trades_at      timestamptz,
  add column last_synced_deposits_at    timestamptz,
  add column last_synced_withdrawals_at timestamptz;

alter table public.crypto_exchange_trades       enable row level security;
alter table public.crypto_exchange_deposits     enable row level security;
alter table public.crypto_exchange_withdrawals  enable row level security;

create policy "owner can read trades" on public.crypto_exchange_trades
  for select using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );
create policy "owner can write trades" on public.crypto_exchange_trades
  for all using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  ) with check (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );

create policy "owner can read deposits" on public.crypto_exchange_deposits
  for select using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );
create policy "owner can write deposits" on public.crypto_exchange_deposits
  for all using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  ) with check (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );

create policy "owner can read withdrawals" on public.crypto_exchange_withdrawals
  for select using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );
create policy "owner can write withdrawals" on public.crypto_exchange_withdrawals
  for all using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  ) with check (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );
