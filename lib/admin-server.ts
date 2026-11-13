import "server-only";

import { getDb } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth";
import type { ActivityRow, DealLabelSource } from "@/lib/activity";

export type AdminUser = {
  user_id: string;
  name: string;
  email: string | null;
  role: AppRole | null;
  last_login_at: string | null;
  edits_7d: number;
};

/** Every profile with last sign-in and edits in the last 7 days (get_admin_users, 007: admins only). */
export async function loadAdminUsers(): Promise<{ users: AdminUser[] } | { error: string }> {
  const db = await getDb();
  const { data, error } = await db.rpc("get_admin_users");
  if (error) {
    console.error("get_admin_users failed:", error.message);
    return { error: error.message };
  }
  const users = ((data ?? []) as (Omit<AdminUser, "name"> & { full_name: string | null })[]).map(
    ({ full_name, ...u }) => ({ ...u, name: full_name?.trim() || u.email || "Unnamed user" }),
  );
  return { users };
}

export const FEED_LIMIT = 100;

export type ActivityFeed = {
  rows: ActivityRow[];
  deals: Map<string, DealLabelSource>;
  hasMore: boolean;
};

/** Newest activity first, optionally for one user. RLS: admins only. */
export async function loadActivity(userId: string | null): Promise<ActivityFeed | { error: string }> {
  const db = await getDb();
  let query = db
    .from("activity_log")
    .select("id, user_id, action, page, deal_id, target_user_id, detail, is_demo, created_at")
    .order("created_at", { ascending: false })
    .order("id")
    .limit(FEED_LIMIT + 1);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    console.error("activity_log read failed:", error.message);
    return { error: error.message };
  }
  const all = (data ?? []) as ActivityRow[];
  const rows = all.slice(0, FEED_LIMIT);

  const dealIds = [...new Set(rows.map((r) => r.deal_id).filter((id): id is string => !!id))];
  const deals = new Map<string, DealLabelSource>();
  if (dealIds.length) {
    const { data: found, error: dealError } = await db.from("deals").select("id, address, city, state, client, vertical").in("id", dealIds);
    if (dealError) console.error("deal labels failed:", dealError.message); // falls back to "a deal that no longer exists"
    for (const d of (found ?? []) as (DealLabelSource & { id: string })[]) deals.set(d.id, d);
  }
  return { rows, deals, hasMore: all.length > FEED_LIMIT };
}
