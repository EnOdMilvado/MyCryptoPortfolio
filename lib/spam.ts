/**
 * Heuristic detection of obvious airdrop / phishing spam tokens.
 *
 * Crypto spam tokens almost always embed a URL or instruction in the
 * symbol / name (so they show up directly in a user's wallet UI as a
 * marketing message). They typically also have no real DEX price.
 */

const URL_RE = /(https?:\/\/|www\.)/i;
const CLAIM_RE = /\b(claim|reward|airdrop|visit|gift|free)\b/i;
const HASH_PREFIX_RE = /^#\s/;
const DOLLAR_PREFIX_RE = /^\$[A-Z]+/;

interface Likely {
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
}

/**
 * Return true if the holding is almost certainly an airdrop spam token.
 */
export function isLikelySpam(h: Likely): boolean {
  const sym = (h.symbol ?? "").trim();
  const name = (h.name ?? "").trim();
  const combined = `${sym} ${name}`;

  // URL in either field → spam.
  if (URL_RE.test(combined)) return true;

  // "# something.xyz" name format is a common spam pattern.
  if (HASH_PREFIX_RE.test(sym) || HASH_PREFIX_RE.test(name)) return true;

  // "$REWARD" / "$SWARM" prefix in name, combined with claim/reward keyword.
  if ((DOLLAR_PREFIX_RE.test(name) || DOLLAR_PREFIX_RE.test(sym)) && CLAIM_RE.test(combined)) {
    return true;
  }

  // "Claim … reward" style names — even without explicit URL.
  if (/\bclaim\b/i.test(combined) && /\b(reward|at|here|visit)\b/i.test(combined)) {
    return true;
  }

  // Any name with the word "airdrop" or "visit … .org"
  if (/\bairdrop\b/i.test(combined)) return true;
  if (/visit\s+\w+\.(io|com|org|xyz|net|app)/i.test(combined)) return true;

  return false;
}
