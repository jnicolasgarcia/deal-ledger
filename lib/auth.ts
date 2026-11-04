import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/supabase/server";

export type AppRole = "admin" | "editor" | "viewer";

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string;
  role: AppRole | null; // null: signed in but no profile yet
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

/**
 * The signed-in user, or null. Verifies the session with getClaims() and
 * reads the profile through RLS (users can read their own row).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const db = await getDb();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const id = data.claims.sub;
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, email, role")
    .eq("user_id", id)
    .maybeSingle();

  const email = profile?.email ?? (typeof data.claims.email === "string" ? data.claims.email : null);
  return {
    id,
    email,
    name: profile?.full_name || email || "Signed in",
    role: (profile?.role as AppRole | undefined) ?? null,
  };
});

/** The signed-in user, or a redirect to /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
