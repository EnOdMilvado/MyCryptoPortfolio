import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { NavBar } from "@/components/NavBar";

export const dynamic = "force-dynamic";

interface AdminUserRow {
  user_id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
  portfolio_count: number | string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function AdminPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("crypto_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) redirect("/dashboard");

  const { data: rawUsers, error } = await supabase.rpc("crypto_admin_user_summary");
  const users: AdminUserRow[] = (rawUsers as AdminUserRow[] | null) ?? [];

  return (
    <>
      <NavBar isAdmin />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <section className="card animate-fade-up">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-text">Admin dashboard</h1>
              <p className="text-sm text-text-muted mt-1">
                List of registered users. You cannot see their wallet data.
              </p>
            </div>
            <div className="pill">{users.length} users</div>
          </div>
        </section>

        {error && (
          <div className="card text-danger text-sm">Failed to load users: {error.message}</div>
        )}

        <section className="card p-0 overflow-hidden animate-fade-up">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/60 text-text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Signed up</th>
                  <th className="px-4 py-3 text-left">Portfolios</th>
                  <th className="px-4 py-3 text-left">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                      No users yet.
                    </td>
                  </tr>
                )}
                {users.map((u, i) => (
                  <tr key={u.user_id} className={i % 2 ? "bg-surface-2/30" : ""}>
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3 tabular text-text-muted">
                      {formatDate(u.created_at)}
                    </td>
                    <td className="px-4 py-3 tabular">{Number(u.portfolio_count)}</td>
                    <td className="px-4 py-3">
                      {u.is_admin ? (
                        <span className="pill bg-primary/15 text-primary">Admin</span>
                      ) : (
                        <span className="pill">User</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
