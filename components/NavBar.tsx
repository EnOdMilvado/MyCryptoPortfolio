import Link from "next/link";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { HideBalanceToggle } from "@/components/HideBalanceToggle";
import { ProfileMenu, type ProfileMenuUser } from "@/components/ProfileMenu";

export function NavBar({
  isAdmin,
  profileUser,
}: {
  isAdmin: boolean;
  profileUser?: ProfileMenuUser;
}) {
  return (
    <nav className="sticky top-0 z-40 backdrop-blur-md bg-bg/70 border-b border-border">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-3">
        <Link
          href="/dashboard"
          className="text-base sm:text-xl font-extrabold tracking-tight text-text truncate"
        >
          MyCryptoPortfolio
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <ThemeSwitcher />
          <HideBalanceToggle />
          <DarkModeToggle />
          {profileUser ? (
            <ProfileMenu user={{ ...profileUser, isAdmin }} />
          ) : null}
        </div>
      </div>
    </nav>
  );
}
