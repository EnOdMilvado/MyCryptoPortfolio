"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Generates / shows / revokes a read-only "accountant" share link for the
 * wallets + exchanges view. The token is an unguessable secret stored in
 * crypto_shares; the public /share/[token] route validates it server-side via
 * SECURITY DEFINER RPCs and only ever exposes tax-included, non-sensitive data.
 */
export function ShareAccountantButton({
  userId,
  existingToken,
}: {
  userId: string;
  existingToken: string | null;
}) {
  const [token, setToken] = useState<string | null>(existingToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/share/${token}`
      : "";

  function newToken(): string {
    // 64 hex chars (~256 bits) — unguessable bearer secret.
    const rnd = () =>
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "")
        : Math.random().toString(16).slice(2).padEnd(16, "0");
    return rnd() + rnd();
  }

  async function createLink() {
    setBusy(true);
    setError(null);
    try {
      const t = newToken();
      const { error: e } = await supabaseBrowser()
        .from("crypto_shares")
        .insert({ owner_id: userId, scope: "accountant", token: t });
      if (e) throw new Error(e.message);
      setToken(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create link");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!token) return;
    if (!confirm("Revoke the accountant link? The current URL stops working."))
      return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabaseBrowser()
        .from("crypto_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token", token);
      if (e) throw new Error(e.message);
      setToken(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  if (!token) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={createLink}
          disabled={busy}
          className="btn-primary text-xs !px-3 !py-1.5"
        >
          {busy ? "Creating…" : "Share with accountant"}
        </button>
        {error && <span className="text-[10px] text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1 w-full sm:w-auto sm:min-w-[20rem]">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          readOnly
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 px-2 py-1 text-xs rounded border border-border bg-surface text-text-muted font-mono truncate"
        />
        <button
          type="button"
          onClick={copy}
          className="btn-ghost text-xs whitespace-nowrap"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          onClick={revoke}
          disabled={busy}
          className="text-xs text-text-muted hover:text-danger whitespace-nowrap"
        >
          Revoke
        </button>
      </div>
      <span className="text-[10px] text-text-muted/80">
        Read-only · tax-included rows only · revoke anytime
      </span>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
