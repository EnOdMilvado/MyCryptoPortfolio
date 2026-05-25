"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();

  async function onClick() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-ghost text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2"
    >
      Sign out
    </button>
  );
}
