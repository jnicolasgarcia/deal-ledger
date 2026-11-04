import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Sign out with a full document navigation. The sign-out buttons are plain
 * HTML forms posting here (no client-side router), and this answers with a
 * 303 to /login, so the browser loads a fresh page: no route the previous
 * user saw stays in the tab's memory.
 */
export async function POST(request: NextRequest) {
  // Only our own pages may sign a user out (blocks cross-site form posts).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );
  // Local scope: end this browser's session only. Demo accounts are shared,
  // so signing out on one device mustn't end the others' sessions.
  await supabase.auth.signOut({ scope: "local" });
  // Never let a browser or proxy keep any part of this response, and drop
  // cached pages for this site, including the back/forward cache, so Back
  // can't bring the previous user's page back (see also BfcacheGuard).
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Clear-Site-Data", '"cache"');
  return response;
}
