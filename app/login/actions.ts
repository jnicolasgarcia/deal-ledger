"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/supabase/server";
import { homePathFor, type AppRole } from "@/lib/auth";

export type SignInState = {
  error: string | null;
  /** Which field the error belongs to, so the form can mark and focus it. */
  field: "email" | "password" | "form" | null;
  email: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email) return { error: "Enter your email address.", field: "email", email };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "That doesn't look like an email address.", field: "email", email };
  if (!password) return { error: "Enter your password.", field: "password", email };
  if (password.length > 256) return { error: "Email or password is incorrect.", field: "form", email };

  const db = await getDb();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // Don't say which of the two was wrong.
    const message =
      error?.code === "invalid_credentials"
        ? "Email or password is incorrect."
        : error?.status === 429
          ? "Too many attempts. Wait a minute, then try again."
          : "Couldn't sign in right now. Try again in a moment.";
    return { error: message, field: "form", email };
  }

  // Sets last_login_at and logs the sign-in (007). A logging failure must not
  // block the sign-in.
  const { error: logError } = await db.rpc("record_sign_in");
  if (logError) console.error("record_sign_in failed:", logError.message);

  // Go straight to the role's home: a redirect from a server action renders
  // its target without passing through proxy.ts again.
  const { data: profile } = await db.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle();
  redirect(homePathFor((profile?.role as AppRole | undefined) ?? null));
}
