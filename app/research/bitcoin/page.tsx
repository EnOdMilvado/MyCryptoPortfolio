import Link from "next/link";
import { BitcoinInsightsClient } from "@/components/research/BitcoinInsightsClient";

export const dynamic = "force-dynamic";

export default function BitcoinResearchPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <Link href="/research" className="text-sm text-primary hover:underline">
          ← Research
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-text">Bitcoin insights</h1>
        <p className="max-w-3xl text-sm text-text-muted">
          Cycle context, network health, and technicals for BTC — free-first data, best-effort
          where an exact on-chain source isn&apos;t publicly available.
        </p>
      </div>

      <BitcoinInsightsClient />
    </main>
  );
}
