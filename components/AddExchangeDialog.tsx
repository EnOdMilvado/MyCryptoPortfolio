"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";

const PROVIDERS = [
  { id: "binance", label: "Binance", working: true },
  { id: "coinbase", label: "Coinbase", working: false },
  { id: "kraken", label: "Kraken", working: false },
  { id: "kucoin", label: "KuCoin", working: false },
  { id: "bybit", label: "Bybit", working: false },
  { id: "okx", label: "OKX", working: false },
  { id: "gate", label: "Gate.io", working: false },
  { id: "mexc", label: "MEXC", working: true },
  { id: "htx", label: "HTX (Huobi)", working: true },
  { id: "other", label: "Other", working: false },
] as const;

export function AddExchangeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["id"]>("binance");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerInfo = PROVIDERS.find((p) => p.id === provider)!;
  const needsPassphrase = provider === "okx" || provider === "kucoin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !apiKey.trim() || !apiSecret.trim()) return;
    setError(null);
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
    const { error: insErr } = await supabase.from("crypto_exchanges").insert({
      user_id: user.id,
      provider,
      label: label.trim(),
      api_key: apiKey.trim(),
      api_secret: apiSecret.trim(),
      api_passphrase: needsPassphrase && apiPassphrase ? apiPassphrase.trim() : null,
    });
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setOpen(false);
    setLabel("");
    setApiKey("");
    setApiSecret("");
    setApiPassphrase("");
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        + Connect exchange
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Connect exchange">
        <form onSubmit={submit} className="space-y-4">
          <div className="text-xs text-text-muted bg-surface-2 rounded-xl p-3 leading-relaxed">
            ⚠️ Always create a <span className="font-bold">read-only API key</span> on
            the exchange (no trade, no withdraw permissions). Even with our
            protection, treat exchange keys carefully.
          </div>

          <div>
            <label className="label" htmlFor="ex-provider">Exchange</label>
            <select
              id="ex-provider"
              className="input"
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {!p.working ? " (coming soon)" : ""}
                </option>
              ))}
            </select>
            {!providerInfo.working && (
              <p className="mt-1.5 text-xs text-accent">
                Credentials are stored, but balance fetching for {providerInfo.label} is
                not implemented yet — it will activate as soon as I add it.
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="ex-label">Label</label>
            <input
              id="ex-label"
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Binance main"
              maxLength={60}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="ex-key">API key</label>
            <input
              id="ex-key"
              className="input font-mono text-xs"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="ex-secret">API secret</label>
            <input
              id="ex-secret"
              type="password"
              className="input font-mono text-xs"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          {needsPassphrase && (
            <div>
              <label className="label" htmlFor="ex-pass">Passphrase</label>
              <input
                id="ex-pass"
                type="password"
                className="input font-mono text-xs"
                value={apiPassphrase}
                onChange={(e) => setApiPassphrase(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "…" : "Connect"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
