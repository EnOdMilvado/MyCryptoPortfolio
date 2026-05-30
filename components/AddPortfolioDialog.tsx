"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";

interface AddPortfolioDialogProps {
  /** Override the trigger button's classes. Default: btn-primary.
   *  Use this when the dialog is rendered alongside other narrow buttons
   *  that need to share a stacked column width. */
  triggerClassName?: string;
}

export function AddPortfolioDialog({ triggerClassName }: AddPortfolioDialogProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    const supabase = supabaseBrowser();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in");
      setLoading(false);
      return;
    }
    const { error: insErr } = await supabase
      .from("crypto_portfolios")
      .insert({ name: name.trim(), user_id: user.id });
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setOpen(false);
    setName("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className={triggerClassName ?? "btn-primary"}
        onClick={() => setOpen(true)}
      >
        + New portfolio
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New portfolio">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="pname">Portfolio name</label>
            <input
              id="pname"
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal wallets"
              maxLength={60}
              required
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
