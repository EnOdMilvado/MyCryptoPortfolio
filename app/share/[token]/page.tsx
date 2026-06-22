import { supabaseServer } from "@/lib/supabase/server";
import { ShareView, type ShareData } from "@/components/ShareView";

export const dynamic = "force-dynamic";

/**
 * Public, read-only accountant view. No login required — access is gated only
 * by possession of the unguessable token, validated server-side by the
 * `share_get_data` SECURITY DEFINER RPC. The RPC returns ONLY tax-included,
 * non-sensitive data (never exchange API keys), so nothing here can leak more
 * than the owner intended.
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("share_get_data", {
    p_token: token,
  });

  const shareData = (data ?? null) as ShareData | null;

  if (error || !shareData) {
    return (
      <main className="max-w-md mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-text">Link not available</h1>
        <p className="mt-3 text-text-muted">
          This share link is invalid, has expired, or was revoked. Please ask
          for a fresh link.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <ShareView token={token} data={shareData} />
    </main>
  );
}
