import { AuthForm } from "@/components/AuthForm";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <header className="w-full max-w-sm flex items-center justify-between mb-6">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-text">
          MyCryptoPortfolio
        </Link>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <DarkModeToggle />
        </div>
      </header>
      <AuthForm mode="login" />
    </main>
  );
}
