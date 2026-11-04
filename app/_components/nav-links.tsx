"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AppRole } from "@/lib/auth";

const LINKS: { href: string; label: string; roles: AppRole[] }[] = [
  { href: "/deals", label: "Deals", roles: ["editor", "admin"] },
  { href: "/weekly", label: "Weekly review", roles: ["viewer", "editor", "admin"] },
  { href: "/admin", label: "Admin", roles: ["admin"] },
];

/** Main nav: only the areas this role can use. Presentation only; the database enforces access. */
export function NavLinks({ role }: { role: AppRole | null }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      {LINKS.filter((l) => role && l.roles.includes(role)).map(({ href, label }) => {
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
