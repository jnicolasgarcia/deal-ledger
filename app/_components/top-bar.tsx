import Link from "next/link";
import { Suspense } from "react";
import { NavLinks } from "./nav-links";
import { UserMenu, UserMenuSkeleton } from "./user-menu";

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-white/72 backdrop-blur-xl backdrop-saturate-180">
      <div className="mx-auto flex h-bar max-w-[1440px] items-center gap-6 px-gutter">
        <Link href="/" className="text-headline tracking-tight text-ink">
          Deal Ledger
        </Link>
        <NavLinks />
        <div className="ml-auto">
          <Suspense fallback={<UserMenuSkeleton />}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
