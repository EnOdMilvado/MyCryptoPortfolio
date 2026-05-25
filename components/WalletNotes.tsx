"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Status = "idle" | "saving" | "saved" | "error";

interface Props {
  walletId: string;
  initialValue: string;
}

const SAVE_DEBOUNCE_MS = 800;

export function WalletNotes({ walletId, initialValue }: Props) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<string>(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save on change (debounced).
  useEffect(() => {
    if (value === lastSavedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    timerRef.current = setTimeout(async () => {
      setError(null);
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("crypto_wallets")
        .update({ notes: value })
        .eq("id", walletId);
      if (error) {
        setStatus("error");
        setError(error.message);
        return;
      }
      lastSavedRef.current = value;
      setStatus("saved");
      // Fade the "Saved" indicator after a couple seconds.
      setTimeout(() => setStatus("idle"), 1800);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, walletId]);

  const statusText =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved ✓"
        : status === "error"
          ? error ?? "Save failed"
          : "";

  return (
    <section className="card animate-fade-up">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-text">Notes</h3>
        <span
          className={`text-xs ${
            status === "saved"
              ? "text-success"
              : status === "error"
                ? "text-danger"
                : "text-text-muted"
          }`}
          aria-live="polite"
        >
          {statusText}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Anything you want to remember about this wallet — exchange, seed-phrase backup location, who else has access, …"
        rows={5}
        maxLength={2000}
        className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-text placeholder:text-text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition resize-y"
      />
      <p className="mt-1.5 text-xs text-text-muted">
        {value.length} / 2000 · Visible only to you. Autosaves while you type.
      </p>
    </section>
  );
}
