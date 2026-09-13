export const dynamic = "force-dynamic";

export default function BitcoinResearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-muted">Research / Bitcoin</p>
        <h1 className="text-3xl font-semibold tracking-tight text-text">Bitcoin insights</h1>
        <p className="max-w-3xl text-sm text-text-muted">
          Cycle, on-chain, and technical context for BTC — built as a fast, free-first MVP.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["BTC Price", "—"],
          ["24h Volume", "—"],
          ["RSI", "—"],
          ["200D MA", "—"],
          ["SOPR", "—"],
          ["Hash Rate", "—"],
          ["Difficulty", "—"],
          ["Mempool", "—"],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-lg font-semibold">Cycle position</h2>
          <p className="mt-1 text-sm text-text-muted">Halving timeline, rainbow bands, and where BTC sits in the current cycle.</p>
          <div className="mt-4 h-56 rounded-lg border border-dashed border-border bg-surface-alt" />
        </div>
        <div className="card p-4">
          <h2 className="text-lg font-semibold">Profit / loss distribution</h2>
          <p className="mt-1 text-sm text-text-muted">Supply in profit, supply in loss, and long-term vs short-term holders.</p>
          <div className="mt-4 h-56 rounded-lg border border-dashed border-border bg-surface-alt" />
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold">Market charts</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="h-48 rounded-lg border border-dashed border-border bg-surface-alt" />
          <div className="h-48 rounded-lg border border-dashed border-border bg-surface-alt" />
          <div className="h-48 rounded-lg border border-dashed border-border bg-surface-alt" />
        </div>
      </section>
    </main>
  );
}
