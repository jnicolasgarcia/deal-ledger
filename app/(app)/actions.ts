"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/supabase/server";

export async function signOut() {
  const db = await getDb();
  await db.auth.signOut();
  redirect("/login");
}
