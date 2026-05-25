import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";
import { ProfileForm } from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("display_name, avatar_url, bio, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  // Detect existing verified TOTP factor.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasMfa = !!factors?.all?.some(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );

  return (
    <>
      <NavBar isAdmin={!!profile?.is_admin} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <Link href="/dashboard" className="text-sm text-text-muted hover:text-text">
            ← Back to dashboard
          </Link>
        </div>
        <h1 className="text-3xl font-extrabold text-text">Profile &amp; security</h1>
        <ProfileForm
          userId={user.id}
          email={user.email ?? ""}
          displayName={profile?.display_name ?? null}
          bio={profile?.bio ?? null}
          avatarUrl={profile?.avatar_url ?? null}
          hasMfa={hasMfa}
        />
      </main>
    </>
  );
}
