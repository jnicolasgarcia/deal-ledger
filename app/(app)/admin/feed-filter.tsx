"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

/** User filter for the activity feed, mirrored to ?user= in the URL. */
export function FeedFilter({ users, value }: { users: { id: string; name: string }[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <label className="relative inline-flex">
        <span className="sr-only">Show activity for</span>
        <select
          value={value ?? ""}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            startTransition(() => router.replace(next ? `${pathname}?user=${next}` : pathname, { scroll: false }));
          }}
          className={`h-8 appearance-none rounded-sm border pr-7 pl-2.5 text-callout outline-none focus:border-accent focus:shadow-focus disabled:opacity-60 ${
            value ? "border-accent/40 bg-accent-soft text-accent" : "border-separator bg-surface text-ink"
          }`}
        >
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 opacity-60">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </label>
    {pending && <span className="text-footnote text-ink-tertiary">Loading…</span>}
    </div>
  );
}
