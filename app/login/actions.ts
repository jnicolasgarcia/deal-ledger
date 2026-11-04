"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/supabase/server";

export type SignInState = { error: string | null; email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and password.", email };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "Enter a valid email address.", email };
  if (password.length > 256) return { error: "Email or password is incorrect.", email };

  const db = await getDb();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    // Don't say which of the two was wrong.
    const message =
      error.code === "invalid_credentials"
        ? "Email or password is incorrect."
        : "Couldn't sign in right now. Try again in a moment.";
    return { error: message, email };
  }
  redirect("/");
}
