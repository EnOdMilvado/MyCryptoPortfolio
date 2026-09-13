import Link from "next/link";
import { ResearchOverviewClient } from "@/components/research/ResearchOverviewClient";

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">Research</p>
          <h1 className="text-3xl font-semibold tracking-tight text-text">Market overview</h1>
          <p className="max-w-3xl text-sm text-text-muted">
            Market sentiment, hot tokens from the top 100, and portfolio-first recommendations.
          </p>
        </div>
        <Link
          href="/research/bitcoin"
          className="btn-primary whitespace-nowrap text-sm !px-4 !py-2"
        >
          Bitcoin insights →
        </Link>
      </div>

      <ResearchOverviewClient />
    </main>
  );
}
