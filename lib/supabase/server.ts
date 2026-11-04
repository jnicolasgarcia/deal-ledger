import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * The signed-in user's Supabase client, bound to this request's cookies.
 * Every page and server action reads and writes through this, so RLS and
 * the database functions always see the real user. One client per request.
 *
 * Session refresh happens in proxy.ts. Server Components can't set cookies,
 * so setAll here is best effort (it works inside server actions).
 */
export const getDb = cache(async () => {
  // Per-user data is never prerendered. supabase-js also reads the clock
  // (session expiry), which Cache Components rejects during prerendering.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: ignore, proxy.ts refreshes the session.
          }
        },
      },
    },
  );
});
