/**
 * Fallback ERC-20 metadata reader using direct `eth_call` on the contract.
 * Use this when Alchemy's `alchemy_getTokenMetadata` returns null fields —
 * many legitimate tokens implement name()/symbol()/decimals() but aren't
 * indexed by Alchemy's metadata catalog.
 *
 * Selectors (Keccak-256 of the function signature, first 4 bytes):
 *   - name()      0x06fdde03
 *   - symbol()    0x95d89b41
 *   - decimals()  0x313ce567
 */

export const SEL_NAME = "0x06fdde03";
export const SEL_SYMBOL = "0x95d89b41";
export const SEL_DECIMALS = "0x313ce567";

export interface EthCallReq {
  id: number;
  jsonrpc: "2.0";
  method: "eth_call";
  params: [{ to: string; data: string }, string];
}

/**
 * Decode an ABI-encoded string return value. Handles both:
 *   • the standard dynamic-string layout: offset(32) | length(32) | data(padded)
 *   • the legacy bytes32 layout used by old tokens like MakerDAO MKR
 */
export function decodeAbiString(hex: string | null | undefined): string | null {
  if (!hex || hex === "0x") return null;
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length === 0) return null;

  // Heuristic: if the response is exactly 32 bytes (64 hex chars) it's the
  // legacy bytes32 string format.
  if (data.length <= 64) {
    const bytes = hexToBytes(data.padEnd(64, "0").slice(0, 64));
    const str = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes)
      .replace(/\0+$/u, "")
      .trim();
    return str.length > 0 ? str : null;
  }

  try {
    // Standard dynamic-string format
    // [0..32]   offset (usually 0x20)
    // [32..64]  length
    // [64..end] data
    const lenHex = data.slice(64, 128);
    const len = parseInt(lenHex, 16);
    if (!Number.isFinite(len) || len <= 0 || len > 1024) return null;
    const strHex = data.slice(128, 128 + len * 2);
    if (strHex.length < len * 2) return null;
    const bytes = hexToBytes(strHex);
    const str = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return str.length > 0 ? str : null;
  } catch {
    return null;
  }
}

/** Decode a uint8 (decimals). Returns null if not a valid uint8 value. */
export function decodeAbiUint8(hex: string | null | undefined): number | null {
  if (!hex || hex === "0x") return null;
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length === 0) return null;
  try {
    const v = parseInt(data, 16);
    if (Number.isFinite(v) && v >= 0 && v <= 255) return v;
    return null;
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 1 ? "0" + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

/**
 * Build the 3-call JSON-RPC batch for a contract's metadata.
 * Uses unique ids that won't collide with the rest of the batch.
 */
export function buildMetadataCalls(
  contract: string,
  baseId: number,
): EthCallReq[] {
  return [
    {
      id: baseId,
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: contract, data: SEL_NAME }, "latest"],
    },
    {
      id: baseId + 1,
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: contract, data: SEL_SYMBOL }, "latest"],
    },
    {
      id: baseId + 2,
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: contract, data: SEL_DECIMALS }, "latest"],
    },
  ];
}
