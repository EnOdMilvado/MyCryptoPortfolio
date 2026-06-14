"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { detectChain } from "@/lib/chains/detect";
import type { ChainType } from "@/lib/chains/types";

// Display labels for the chain selector. The same map drives the
// "Detected: …" hint below the address field so they never diverge.
const CHAIN_LABELS: Record<ChainType, string> = {
  btc: "Bitcoin",
  evm: "EVM (Ethereum / Polygon / …)",
  sol: "Solana",
  ton: "TON",
  dot: "Polkadot",
  // Theta uses the same 0x40-hex shape as EVM and can't be auto-detected
  // from the address. The selector below makes it explicit.
  theta: "Theta",
};

export function AddWalletDialog({ portfolioId }: { portfolioId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  // null = use detected chain; a value = user explicitly overrode it.
  // Needed for Theta (indistinguishable from EVM by address shape) and
  // for any other future case where detection is ambiguous.
  const [override, setOverride] = useState<ChainType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = address.trim() ? detectChain(address.trim()) : null;
  const effective: ChainType | null = override ?? detected;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    setError(null);
    if (!effective) {
      setError("Couldn't identify the address format. Make sure it's valid.");
      return;
    }
    setLoading(true);
    const supabase = supabaseBrowser();
    const { error: insErr } = await supabase.from("crypto_wallets").insert({
      portfolio_id: portfolioId,
      name: name.trim(),
      address: address.trim(),
      chain_type: effective,
    });
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setOpen(false);
    setName("");
    setAddress("");
    setOverride(null);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        + New wallet
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New wallet">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="wname">Wallet name</label>
            <input
              id="wname"
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Ledger"
              maxLength={60}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="waddr">Wallet address</label>
            <input
              id="waddr"
              className="input font-mono text-sm"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setOverride(null);
              }}
              placeholder="0x… / bc1… / EQ… / 1… / Sol…"
              required
            />
            <p className="mt-1.5 text-xs text-text-muted">
              {detected
                ? `Detected: ${CHAIN_LABELS[detected]}`
                : "Network is detected automatically"}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="wchain">Network</label>
            <select
              id="wchain"
              className="input"
              value={effective ?? ""}
              onChange={(e) =>
                setOverride(e.target.value ? (e.target.value as ChainType) : null)
              }
            >
              <option value="" disabled>
                {detected ? `Auto (${CHAIN_LABELS[detected]})` : "Auto"}
              </option>
              {(Object.keys(CHAIN_LABELS) as ChainType[]).map((k) => (
                <option key={k} value={k}>
                  {CHAIN_LABELS[k]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-text-muted">
              Theta addresses look identical to EVM — pick it here if you're
              adding a Theta wallet.
            </p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={loading || !effective} className="btn-primary">
              {loading ? "…" : "Add"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
