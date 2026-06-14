import type { ChainType } from "./types";

const RE_EVM = /^0x[a-fA-F0-9]{40}$/;
const RE_BTC_BECH32 = /^(bc1|tb1)[a-zA-HJ-NP-Z0-9]{25,90}$/;
const RE_BTC_LEGACY = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const RE_SOL_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// TON user-friendly addresses are 48 chars base64url-ish, prefixed with
// "EQ" / "UQ" (mainnet bouncable / non-bouncable) or "kf" / "0f" (raw).
const RE_TON = /^(EQ|UQ|kf|0f)[A-Za-z0-9_-]{46}$/;
// Polkadot SS58 addresses start with "1" and are 47–48 chars of base58.
// BTC legacy also starts with "1" but never exceeds 34 chars — length is
// the only reliable discriminator without doing the full SS58 checksum.
const RE_DOT = /^1[a-km-zA-HJ-NP-Z1-9]{46,47}$/;

/**
 * Best-effort detection of a wallet address's chain family.
 * Order matters: EVM → BTC bech32 → BTC legacy → DOT → TON → Solana.
 * Theta uses the same 0x40-hex format as EVM and cannot be distinguished
 * from the address alone — the AddWalletDialog lets the user override
 * "evm" → "theta" explicitly. Returns null for inputs we cannot
 * confidently classify.
 */
export function detectChain(addr: string): ChainType | null {
  const a = addr.trim();
  if (!a) return null;
  if (RE_EVM.test(a)) return "evm";
  if (RE_BTC_BECH32.test(a)) return "btc";
  if (RE_BTC_LEGACY.test(a) && a.length <= 35) return "btc";
  // DOT must come BEFORE SOL: a 47–48-char base58 string that starts with
  // "1" matches RE_SOL_BASE58 too, so the more specific DOT pattern wins.
  if (RE_DOT.test(a)) return "dot";
  if (RE_TON.test(a)) return "ton";
  if (RE_SOL_BASE58.test(a)) return "sol";
  return null;
}
