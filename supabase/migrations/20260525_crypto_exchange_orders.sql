-- Order history per exchange (placed orders, including filled, cancelled,
-- expired, partially-filled). Separate from trades (which is per-fill).

create table public.crypto_exchange_orders (
  exchange_id uuid not null references public.crypto_exchanges(id) on delete cascade,
  order_id    text not null,
  symbol      text not null,
  base_asset  text not null,
  quote_asset text not null,
  side        text not null check (side in ('BUY','SELL')),
  type        text,
  status      text,
  price       numeric,
  orig_qty    numeric,
  executed_qty numeric,
  quote_qty   numeric,
  fee         numeric,
  fee_asset   text,
  placed_at   timestamptz not null,
  updated_at  timestamptz,
  fetched_at  timestamptz not null default now(),
  primary key (exchange_id, order_id)
);
create index crypto_exchange_orders_exchange_time_idx
  on public.crypto_exchange_orders (exchange_id, placed_at desc);

alter table public.crypto_exchanges
  add column last_synced_orders_at timestamptz;

alter table public.crypto_exchange_orders enable row level security;

create policy "owner can read orders" on public.crypto_exchange_orders
  for select using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );
create policy "owner can write orders" on public.crypto_exchange_orders
  for all using (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  ) with check (
    exchange_id in (select id from public.crypto_exchanges where user_id = auth.uid())
  );
