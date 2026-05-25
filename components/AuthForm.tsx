"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = supabaseBrowser();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
        } else {
          setInfo("Confirmation email sent. Confirm and then sign in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/dashboard");
        router.refresh();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const title = mode === "signup" ? "Create account" : "Sign in";
  const otherHref = mode === "signup" ? "/login" : "/signup";
  const otherCta = mode === "signup" ? "Already have an account? Sign in" : "No account yet? Create one";

  return (
    <form onSubmit={onSubmit} className="card max-w-sm w-full space-y-5 animate-fade-up">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-text">{title}</h1>
        <p className="text-sm text-text-muted mt-1">Your personal crypto portfolio</p>
      </div>

      <div>
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
        />
      </div>

      {error && (
        <div className="text-sm text-danger bg-danger/10 rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}
      {info && (
        <div className="text-sm text-text bg-accent/15 rounded-xl px-4 py-2.5">
          {info}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "…" : title}
      </button>

      <Link href={otherHref} className="block text-center text-sm text-primary hover:text-primary-hover">
        {otherCta}
      </Link>
    </form>
  );
}
