import "server-only";

import { getDb } from "@/lib/supabase/server";
import { buildWeekly, type WeeklyModel, type WeeklyRow } from "@/lib/weekly";

/**
 * The weekly review for any signed-in role. Reads only get_weekly_review(),
 * which returns the weekly fields and nothing else.
 */
export async function loadWeekly(): Promise<{ model: WeeklyModel } | { error: string }> {
  const db = await getDb();
  const { data, error } = await db.rpc("get_weekly_review");
  if (error) return { error: error.message };
  return { model: buildWeekly((data ?? []) as WeeklyRow[], new Date()) };
}
