/**
 * Native form post to /auth/signout (see that route). Deliberately not a
 * server action or a <Link>: the browser does a full page load to /login,
 * so the previous user's pages don't stay in memory.
 */
export function SignOutButton({ className }: { className: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
