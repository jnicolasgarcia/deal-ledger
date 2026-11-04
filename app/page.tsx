import { Suspense } from "react";
import { redirect } from "next/navigation";
import { homePathFor, requireUser } from "@/lib/auth";

// proxy.ts normally redirects "/" by role before this renders. This covers
// renders that skip the proxy (e.g. a server action redirecting to "/").
async function RoleRedirect() {
  const user = await requireUser();
  redirect(homePathFor(user.role));
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <RoleRedirect />
    </Suspense>
  );
}
