import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { ImportTradesClient, type ImportExchange } from "@/components/ImportTradesClient";

export const dynamic = "force-dynamic";

/**
 * Import exchange trade history from a CSV. Exchange APIs only return a short
 * recent window, so for older tax years the reliable source is the official
 * CSV export each exchange offers. This page lets the user upload it, map the
 * columns, and store the trades — which then feed the P&L report.
 */
export default async function ImportTradesPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("is_admin, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const { data: exRows } = await supabase
    .from("crypto_exchanges")
    .select("id, provider, label")
    .order("created_at", { ascending: true });
  const exchanges: ImportExchange[] = (
    (exRows as { id: string; provider: string; label: string }[] | null) ?? []
  ).map((e) => ({ id: e.id, provider: e.provider, label: e.label }));

  return (
    <>
      <NavBar
        isAdmin={!!profile?.is_admin}
        profileUser={{
          email: user.email ?? "",
          displayName: profile?.display_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <ImportTradesClient exchanges={exchanges} />
      </main>
    </>
  );
}
