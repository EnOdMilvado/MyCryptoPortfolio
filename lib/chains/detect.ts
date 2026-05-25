import type { ChainType } from "./types";

const RE_EVM = /^0x[a-fA-F0-9]{40}$/;
const RE_BTC_BECH32 = /^(bc1|tb1)[a-zA-HJ-NP-Z0-9]{25,90}$/;
const RE_BTC_LEGACY = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const RE_SOL_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Best-effort detection of a wallet address's chain family.
 * Order matters: EVM → BTC bech32 → BTC legacy → Solana.
 * Returns `null` for inputs we cannot confidently classify.
 */
export function detectChain(addr: string): ChainType | null {
  const a = addr.trim();
  if (!a) return null;
  if (RE_EVM.test(a)) return "evm";
  if (RE_BTC_BECH32.test(a)) return "btc";
  if (RE_BTC_LEGACY.test(a) && a.length <= 35) return "btc";
  if (RE_SOL_BASE58.test(a)) return "sol";
  return null;
}
