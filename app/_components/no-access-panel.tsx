import Link from "next/link";
import { homePathFor, ROLE_LABELS, type CurrentUser } from "@/lib/auth";

/**
 * Friendly "no access" page for an area the signed-in role can't use,
 * decided on the server. Presentation only: the database enforces access.
 */
export function NoAccessPanel({ user, area, allowed }: { user: CurrentUser; area: string; allowed: string }) {
  const home = homePathFor(user.role);
  return (
    <section className="mx-auto mt-section flex max-w-lg flex-col items-center rounded-2xl bg-surface px-8 py-10 text-center shadow-card">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-black/5 text-ink-secondary">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </svg>
      </span>
      <h1 className="mt-4 text-title-2">{area} isn&apos;t available to you</h1>
      <p className="mt-2 text-body text-ink-secondary">
        {area} is for {allowed}. You&apos;re signed in as {user.name}
        {user.role ? ` (${ROLE_LABELS[user.role]})` : ""}. If you need access, ask an admin.
      </p>
      <Link
        href={home}
        className="mt-6 flex h-10 items-center rounded-full bg-accent px-5 text-callout font-medium text-white hover:bg-accent-hover"
      >
        {home === "/weekly" ? "Go to the weekly review" : home === "/deals" ? "Go to deals" : "Back"}
      </Link>
    </section>
  );
}
