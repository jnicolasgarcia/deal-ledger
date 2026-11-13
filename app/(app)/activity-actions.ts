"use server";

import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/supabase/server";
import { canOpenPage, isLoggedPage } from "@/lib/activity";

/**
 * Log one page view as the signed-in user (RLS: own page_view rows only, 007).
 * Called once per page open by PageViewLogger, so filter and slide changes
 * (same page, new query string) don't count. Access is decided here from
 * the role, not by the caller. Never throws: logging must not break a page.
 */
export async function recordPageView(page: unknown): Promise<void> {
  if (!isLoggedPage(page)) return;
  const user = await getCurrentUser();
  if (!user?.role) return;
  const denied = !canOpenPage(page, user.role);
  const db = await getDb();
  const { error } = await db
    .from("activity_log")
    .insert({ user_id: user.id, action: "page_view", page, detail: denied ? { denied: true } : {} });
  if (error) console.error("recordPageView failed:", error.message);
}
