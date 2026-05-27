-- Store 24h % change alongside cached spot balances so the exchange
-- dashboard (Spot tab + "By network" weighted change) can render fresh
-- per-asset 24h badges without re-hitting the price API on every render.
alter table public.crypto_exchange_balances_cache
  add column if not exists price_change_24h numeric;
