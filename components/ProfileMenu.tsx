"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Avatar } from "./Avatar";

export interface ProfileMenuUser {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
}

export function ProfileMenu({ user }: { user: ProfileMenuUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open profile menu"
        className="inline-flex items-center gap-2 rounded-full px-1 py-1 transition hover:bg-surface-2/60"
      >
        <Avatar
          url={user.avatarUrl}
          name={user.displayName}
          email={user.email}
          size={32}
        />
        <span className="hidden sm:inline text-sm font-semibold text-text truncate max-w-[10rem]">
          {user.displayName ?? user.email}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-text-muted transition ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-border bg-surface shadow-soft p-2 z-50">
          <div className="px-3 py-2.5 flex items-center gap-3 border-b border-border mb-1">
            <Avatar
              url={user.avatarUrl}
              name={user.displayName}
              email={user.email}
              size={40}
            />
            <div className="min-w-0">
              {user.displayName && (
                <div className="font-bold truncate">{user.displayName}</div>
              )}
              <div className="text-xs text-text-muted truncate">{user.email}</div>
            </div>
          </div>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
          >
            🏠 Dashboard
          </Link>
          <Link
            href="/dashboard/wallets"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
          >
            💼 All wallets
          </Link>
          <Link
            href="/dashboard/pnl"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
          >
            📊 Profit &amp; Loss
          </Link>
          <Link
            href="/dashboard/import-trades"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
          >
            📥 Import trades (CSV)
          </Link>
          <Link
            href="/dashboard/nfts"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
          >
            🖼️ All NFTs
          </Link>
          <Link
            href="/dashboard/profile"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
          >
            👤 Profile &amp; security
          </Link>
          {user.isAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 rounded-xl text-sm hover:bg-surface-2 transition"
            >
              ⚡ Admin
            </Link>
          )}
          <button
            type="button"
            onClick={signOut}
            className="w-full text-left block px-3 py-2 rounded-xl text-sm text-danger hover:bg-danger/10 transition"
          >
            🚪 Sign out
          </button>
        </div>
      )}
    </div>
  );
}
