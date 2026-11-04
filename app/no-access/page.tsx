import { Suspense } from "react";
import { redirect } from "next/navigation";
import { homePathFor, requireUser } from "@/lib/auth";
import { SignOutButton } from "@/app/_components/sign-out-button";

/** Signed in, but no role yet (005). */
async function NoAccess() {
  const user = await requireUser();
  if (user.role) redirect(homePathFor(user.role)); // backstop for proxy.ts
  return (
    <>
      <p className="mt-3 text-body text-ink-secondary">
        You&apos;re signed in as <span className="text-ink">{user.email ?? user.name}</span>, but your account
        hasn&apos;t been given access to Deal Ledger. Ask an admin to give you access, then sign in again.
      </p>
      <div className="mt-8">
        <SignOutButton className="h-11 w-full rounded-md bg-accent text-headline text-white transition-colors hover:bg-accent-hover" />
      </div>
    </>
  );
}

export default function NoAccessPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-gutter py-section">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 shadow-raised">
        <p className="text-footnote font-medium text-ink-secondary">Deal Ledger</p>
        <h1 className="mt-1 text-title-2">Your account has no access yet</h1>
        <Suspense fallback={<span className="mt-3 block h-16 animate-pulse rounded-md bg-black/5" />}>
          <NoAccess />
        </Suspense>
      </div>
    </main>
  );
}
