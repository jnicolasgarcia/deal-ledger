import { requireUser } from "@/lib/auth";
import { RoleBadge } from "./role-badge";
import { SignOutButton } from "./sign-out-button";

/** Signed-in user's name, role and sign out. Reads the session: render inside <Suspense>. */
export async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-footnote font-medium text-ink">{user.name}</span>
        <RoleBadge role={user.role} />
      </div>
      <span aria-hidden className="h-5 w-px bg-separator" />
      <SignOutButton className="rounded-md px-3 py-1.5 text-callout text-accent transition-colors hover:bg-accent-soft" />
    </div>
  );
}

export function UserMenuSkeleton() {
  return (
    <div className="flex items-center gap-3" aria-label="Loading account">
      <span className="h-3 w-24 animate-pulse rounded-sm bg-black/5" />
      <span className="h-5 w-14 animate-pulse rounded-full bg-black/5" />
      <span className="h-7 w-16 animate-pulse rounded-md bg-black/5" />
    </div>
  );
}
