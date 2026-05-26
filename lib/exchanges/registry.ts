import type { ExchangeAdapter } from "./types";
import { binanceAdapter } from "./binance";
import { mexcAdapter } from "./mexc";
import { htxAdapter } from "./htx";

const ADAPTERS: Record<string, ExchangeAdapter> = {
  [binanceAdapter.provider]: binanceAdapter,
  [mexcAdapter.provider]: mexcAdapter,
  [htxAdapter.provider]: htxAdapter,
};

export function getAdapter(provider: string): ExchangeAdapter | null {
  return ADAPTERS[provider] ?? null;
}

export function supportedProviders(): string[] {
  return Object.keys(ADAPTERS);
}
