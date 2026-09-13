import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-muted">Research</p>
        <h1 className="text-3xl font-semibold tracking-tight text-text">Market overview</h1>
        <p className="max-w-3xl text-sm text-text-muted">
          A fast, English-only hub for market sentiment, hot tokens, and portfolio-first
          recommendations.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted">Fear &amp; Greed</p>
          <div className="mt-2 text-2xl font-semibold">—</div>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted">Altcoin Season</p>
          <div className="mt-2 text-2xl font-semibold">—</div>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted">BTC Dominance</p>
          <div className="mt-2 text-2xl font-semibold">—</div>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted">Total Market Cap</p>
          <div className="mt-2 text-2xl font-semibold">—</div>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Hot Tokens</h2>
            <p className="text-sm text-text-muted">Top movers and underperformers from the top 100.</p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-text-muted">
            Stub
          </span>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-4 bg-surface-alt px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted">
            <span>Token</span>
            <span>Price</span>
            <span>7d</span>
            <span>Action</span>
          </div>
          <div className="px-4 py-10 text-sm text-text-muted">Data wiring coming next.</div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="card p-4">
          <h2 className="text-lg font-semibold">Recommendations</h2>
          <p className="mt-1 text-sm text-text-muted">
            First surface holdings you already own, then new ideas worth researching.
          </p>
          <div className="mt-4 space-y-3 text-sm text-text-muted">
            <div className="rounded-lg border border-border p-3">Portfolio-first recommendations will appear here.</div>
            <div className="rounded-lg border border-border p-3">New opportunities will appear here after portfolio items.</div>
          </div>
        </div>
        <div className="card p-4">
          <h2 className="text-lg font-semibold">Bitcoin Insights</h2>
          <p className="mt-1 text-sm text-text-muted">Dedicated BTC deep dive page.</p>
          <Link href="/research/bitcoin" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
            Open BTC page
          </Link>
        </div>
      </section>
    </main>
  );
}
