import "server-only";

import { getDb } from "@/lib/supabase/server";
import { daysSince, updatedByLabel, type DealRow, type HistoryEntry } from "@/lib/deals";

const COLUMNS = [
  "id", "client", "vertical", "market", "address", "city", "state",
  "bldg_sf", "list_price", "list_price_per_sf", "lot_sf", "list_price_per_lot_sf",
  "stage", "stage_raw", "stage_changed_at", "notes_raw", "attributes", "assumption_fields",
  "source_tab", "source_row", "natural_key", "created_at", "updated_at", "updated_by",
  "deal_events(count)",
].join(", ");

type Db = Awaited<ReturnType<typeof getDb>>;
type DealRecord = Omit<DealRow, "days_in_stage" | "updated_by_label"> & { deal_events: { count: number }[] };

/**
 * Display names for user ids. Editors can't read other profiles (RLS), so
 * this goes through get_profile_names (003), which returns names only.
 */
async function profileNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data, error } = await db.rpc("get_profile_names", { user_ids: unique });
  if (error) console.error("get_profile_names failed:", error.message); // labels fall back to "Unknown user"
  for (const n of (data ?? []) as { user_id: string; display_name: string | null }[]) {
    if (n.display_name) names.set(n.user_id, n.display_name);
  }
  return names;
}

async function toRows(db: Db, records: DealRecord[]): Promise<DealRow[]> {
  const names = await profileNames(db, records.map((r) => r.updated_by));
  const now = Date.now();
  return records.map(({ deal_events, ...d }) => ({
    ...d,
    attributes: d.attributes ?? {},
    assumption_fields: d.assumption_fields ?? [],
    days_in_stage: daysSince(d.stage_changed_at, now),
    updated_by_label: updatedByLabel(
      d.updated_by,
      d.updated_by ? names.get(d.updated_by) : undefined,
      deal_events?.[0]?.count ?? 0,
    ),
  }));
}

/**
 * All deals the signed-in user may read (RLS: editors and admins), with
 * days in stage computed at request time (null: no stage history) and who
 * made the last change.
 */
export async function loadDeals(): Promise<{ rows: DealRow[] } | { error: string }> {
  const db = await getDb();
  const { data, error } = await db
    .from("deals")
    .select(COLUMNS)
    .order("vertical")
    .order("client")
    .order("source_tab")
    .order("source_row");
  if (error) return { error: error.message };
  return { rows: await toRows(db, data as unknown as DealRecord[]) };
}

/** One deal, freshly read (used after a save). */
export async function loadDeal(id: string): Promise<DealRow | null> {
  const db = await getDb();
  const { data, error } = await db.from("deals").select(COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const [row] = await toRows(db, [data as unknown as DealRecord]);
  return row;
}

/** A deal's change history, newest first (RLS: editors and admins). */
export async function loadDealHistory(id: string): Promise<{ entries: HistoryEntry[] } | { error: string }> {
  const db = await getDb();
  const { data, error } = await db
    .from("deal_events")
    .select("id, field, old_value, new_value, changed_by, changed_at")
    .eq("deal_id", id)
    .order("changed_at", { ascending: false })
    .order("field")
    .limit(500);
  if (error) return { error: error.message };
  const events = data as { id: string; field: string; old_value: unknown; new_value: unknown; changed_by: string | null; changed_at: string }[];
  const names = await profileNames(db, events.map((e) => e.changed_by));
  return {
    entries: events.map((e) => ({
      id: e.id,
      field: e.field,
      old_value: e.old_value,
      new_value: e.new_value,
      changed_at: e.changed_at,
      changed_by_label: e.changed_by ? (names.get(e.changed_by) ?? "Unknown user") : "Unknown user",
    })),
  };
}
