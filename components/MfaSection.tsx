"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * TOTP-based two-factor authentication via Supabase's auth.mfa API.
 *
 * Flow:
 *   1. enroll → returns { factorId, totp: { qr_code, secret, uri } }
 *   2. user scans QR with Google Authenticator / 1Password / Authy
 *   3. challenge factor → returns challengeId
 *   4. verify factor+challenge with the 6-digit code → factor becomes active
 *
 * Once enrolled, the next sign-in will require a code; Supabase auth-helpers
 * handle the challenge automatically when AAL2 is required.
 */
export function MfaSection({ initiallyEnrolled }: { initiallyEnrolled: boolean }) {
  const [enrolled, setEnrolled] = useState(initiallyEnrolled);
  const [activeFactorId, setActiveFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Load active factor on mount so we can offer "Disable 2FA".
  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = data?.all?.find((f) => f.factor_type === "totp" && f.status === "verified");
      if (totp) {
        setEnrolled(true);
        setActiveFactorId(totp.id);
      }
    })();
  }, []);

  async function startEnroll() {
    setError(null);
    setLoading(true);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEnrollment({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function verifyEnroll() {
    if (!enrollment) return;
    setError(null);
    setLoading(true);
    const supabase = supabaseBrowser();
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    });
    if (chErr || !ch) {
      setLoading(false);
      setError(chErr?.message ?? "Could not start challenge");
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    setLoading(false);
    if (vErr) {
      setError(vErr.message);
      return;
    }
    setEnrolled(true);
    setActiveFactorId(enrollment.factorId);
    setEnrollment(null);
    setCode("");
    setInfo("2FA enabled. Next sign-in will require a code.");
  }

  async function disable() {
    if (!activeFactorId) return;
    if (!confirm("Disable 2FA? You'll no longer be asked for a code at sign-in.")) return;
    setError(null);
    setLoading(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.mfa.unenroll({ factorId: activeFactorId });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEnrolled(false);
    setActiveFactorId(null);
    setInfo("2FA disabled.");
  }

  function cancelEnroll() {
    setEnrollment(null);
    setCode("");
    setError(null);
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text">Two-factor authentication</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Adds a 6-digit code from an authenticator app on top of your password.
          Use Google Authenticator, 1Password, Authy or any TOTP app.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {info && !enrollment && <p className="text-sm text-success">{info}</p>}

      {!enrolled && !enrollment && (
        <button type="button" onClick={startEnroll} disabled={loading} className="btn-primary">
          {loading ? "Setting up…" : "Enable 2FA"}
        </button>
      )}

      {enrollment && (
        <div className="space-y-4">
          <div className="bg-surface-2/60 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
            {/* Supabase returns the QR code as an SVG data URI. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qr}
              alt="2FA QR code"
              className="h-40 w-40 bg-white p-2 rounded-xl shrink-0"
            />
            <div className="text-sm space-y-2 min-w-0">
              <p>1. Scan the QR with your authenticator app.</p>
              <p>2. Or paste this secret manually:</p>
              <code className="block px-2 py-1 rounded bg-surface text-xs font-mono break-all">
                {enrollment.secret}
              </code>
              <p>3. Enter the 6-digit code below to confirm.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input w-32 text-center tabular tracking-widest"
            />
            <button
              type="button"
              onClick={verifyEnroll}
              disabled={loading || code.length !== 6}
              className="btn-primary"
            >
              {loading ? "Verifying…" : "Verify & enable"}
            </button>
            <button
              type="button"
              onClick={cancelEnroll}
              className="btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {enrolled && !enrollment && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-success">✓ 2FA is enabled.</p>
          <button
            type="button"
            onClick={disable}
            disabled={loading}
            className="btn-danger text-sm"
          >
            {loading ? "Disabling…" : "Disable 2FA"}
          </button>
        </div>
      )}
    </section>
  );
}
