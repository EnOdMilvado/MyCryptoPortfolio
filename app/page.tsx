import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { DarkModeToggle } from "@/components/DarkModeToggle";

export default async function LandingPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="w-full px-6 py-5 flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-text">MyCryptoPortfolio</h1>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <DarkModeToggle />
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-3xl animate-fade-up">
          <span className="pill mb-4 mx-auto">New · v1</span>
          <h2 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-text leading-tight">
            All of your crypto,
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              in one view.
            </span>
          </h2>
          <p className="mt-6 text-lg sm:text-xl text-text-muted max-w-2xl mx-auto">
            Add wallet addresses from any network — Bitcoin, Ethereum, Solana and more — and
            get a USD summary and BTC equivalent for every portfolio, live from the blockchain.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary text-base px-7 py-3">
              Get started — it's free
            </Link>
            <Link href="/login" className="btn-ghost text-base px-7 py-3">
              Already have an account? Sign in
            </Link>
          </div>
        </div>

        <div className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl w-full animate-fade-up">
          <FeatureCard
            emoji="🌐"
            title="Every network"
            text="BTC, Ethereum, Polygon, Arbitrum, Optimism, Base, BNB, Avalanche, Solana"
          />
          <FeatureCard
            emoji="📊"
            title="Multiple portfolios"
            text="Group wallets into named portfolios. USD and BTC totals per group and across all."
          />
          <FeatureCard
            emoji="🔒"
            title="Full privacy"
            text="Every user only sees their own wallets. No one else — not even the admin."
          />
        </div>
      </section>

      <footer className="px-6 py-6 text-center text-xs text-text-muted">
        © {new Date().getFullYear()} MyCryptoPortfolio
      </footer>
    </main>
  );
}

function FeatureCard({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div className="card-tight text-left">
      <div className="text-3xl mb-2">{emoji}</div>
      <h3 className="font-bold text-text mb-1">{title}</h3>
      <p className="text-sm text-text-muted leading-relaxed">{text}</p>
    </div>
  );
}
