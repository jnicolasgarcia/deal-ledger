import { requireUser, ROLE_LABELS } from "@/lib/auth";
import { signOut } from "@/app/(app)/actions";

/** Signed-in user's name, role and sign out. Reads the session: render inside <Suspense>. */
export async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end leading-tight">
        <span className="text-footnote font-medium text-ink">{user.name}</span>
        <span className="text-caption text-ink-secondary">
          {user.role ? ROLE_LABELS[user.role] : "No role"}
        </span>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md px-3 py-1.5 text-callout text-accent transition-colors hover:bg-accent-soft"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export function UserMenuSkeleton() {
  return (
    <div className="flex items-center gap-3" aria-label="Loading account">
      <div className="flex flex-col items-end gap-1">
        <span className="h-3 w-24 animate-pulse rounded-sm bg-black/5" />
        <span className="h-2.5 w-12 animate-pulse rounded-sm bg-black/5" />
      </div>
      <span className="h-7 w-16 animate-pulse rounded-md bg-black/5" />
    </div>
  );
}
