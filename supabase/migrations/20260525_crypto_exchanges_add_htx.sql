-- Allow 'htx' as a provider on crypto_exchanges.
alter table public.crypto_exchanges
  drop constraint if exists crypto_exchanges_provider_check;

alter table public.crypto_exchanges
  add constraint crypto_exchanges_provider_check
  check (provider = any (array[
    'binance'::text,
    'coinbase'::text,
    'kraken'::text,
    'kucoin'::text,
    'bybit'::text,
    'okx'::text,
    'gate'::text,
    'mexc'::text,
    'htx'::text,
    'other'::text
  ]));
