import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes a signed-out visitor may open. Everything else redirects to /login.
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Refreshes the Supabase session on every request (the only place it is
 * refreshed) and protects routes. Follows the @supabase/ssr Next.js guide,
 * adapted from middleware.ts to the Next.js 16 proxy.ts convention.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          cacheHeaders = { ...cacheHeaders, ...headers };
          Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Keep this call directly after createServerClient: it validates the JWT
  // and refreshes the session if needed. Never trust getSession() here.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.has(request.nextUrl.pathname);

  if (!signedIn && !isPublic) return redirectTo("/login", request, response, cacheHeaders);
  if (signedIn && isPublic) return redirectTo("/", request, response, cacheHeaders);
  return response;
}

/** Redirect while keeping any refreshed auth cookies and cache headers. */
function redirectTo(
  pathname: string,
  request: NextRequest,
  from: NextResponse,
  cacheHeaders: Record<string, string>,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(cacheHeaders).forEach(([key, value]) => redirect.headers.set(key, value));
  return redirect;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
