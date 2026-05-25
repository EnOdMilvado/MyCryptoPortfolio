"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { detectChain } from "@/lib/chains/detect";

export function AddWalletDialog({ portfolioId }: { portfolioId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = address.trim() ? detectChain(address.trim()) : null;
  const detectedLabel = detected
    ? detected === "btc"
      ? "Bitcoin"
      : detected === "evm"
        ? "EVM (Ethereum / Polygon / …)"
        : "Solana"
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    setError(null);
    if (!detected) {
      setError("Couldn't identify the address format. Make sure it's valid.");
      return;
    }
    setLoading(true);
    const supabase = supabaseBrowser();
    const { error: insErr } = await supabase.from("crypto_wallets").insert({
      portfolio_id: portfolioId,
      name: name.trim(),
      address: address.trim(),
      chain_type: detected,
    });
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setOpen(false);
    setName("");
    setAddress("");
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
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x… / bc1… / Sol…"
              required
            />
            <p className="mt-1.5 text-xs text-text-muted">
              {detectedLabel ? `Detected: ${detectedLabel}` : "Network is detected automatically"}
            </p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={loading || !detected} className="btn-primary">
              {loading ? "…" : "Add"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
