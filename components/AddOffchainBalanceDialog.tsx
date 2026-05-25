"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";

const KINDS = [
  { id: "cash", label: "Cash" },
  { id: "bank", label: "Bank account" },
  { id: "credit_card", label: "Credit card" },
  { id: "brokerage", label: "Brokerage / stocks" },
  { id: "other", label: "Other" },
] as const;

export function AddOffchainBalanceDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("cash");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !amount) return;
    setError(null);
    const num = parseFloat(amount);
    if (!Number.isFinite(num)) {
      setError("Invalid amount");
      return;
    }
    setLoading(true);
    const supabase = supabaseBrowser();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not signed in");
      setLoading(false);
      return;
    }
    const { error: insErr } = await supabase.from("crypto_offchain_balances").insert({
      user_id: user.id,
      label: label.trim(),
      kind,
      currency: currency.toUpperCase().trim() || "USD",
      amount: num,
      notes: notes.trim() || null,
    });
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setOpen(false);
    setLabel("");
    setAmount("");
    setNotes("");
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        + Off-chain balance
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Off-chain balance">
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-text-muted">
            Track cash, bank, credit card and other off-chain assets so they count
            into your total. Manual entry for now — credit-card API integration
            (Plaid) is on the roadmap.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="oc-kind">Kind</label>
              <select
                id="oc-kind"
                className="input"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{k.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="oc-currency">Currency</label>
              <input
                id="oc-currency"
                className="input uppercase"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                maxLength={5}
                placeholder="USD"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="oc-label">Label</label>
            <input
              id="oc-label"
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Chase checking"
              maxLength={60}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="oc-amount">Amount</label>
            <input
              id="oc-amount"
              type="number"
              step="0.01"
              className="input tabular"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-text-muted">
              Use a negative number for credit card debt.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="oc-notes">Notes (optional)</label>
            <input
              id="oc-notes"
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
