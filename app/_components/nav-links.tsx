"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/deals", label: "Deals", dealsOnly: true },
  { href: "/weekly", label: "Weekly review", dealsOnly: false },
] as const;

/** Main nav. The Deals link is hidden for viewers (showDeals = false). */
export function NavLinks({ showDeals }: { showDeals: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      {LINKS.filter((l) => showDeals || !l.dealsOnly).map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-callout transition-colors ${
              active ? "bg-black/5 font-medium text-ink" : "text-ink-secondary hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
