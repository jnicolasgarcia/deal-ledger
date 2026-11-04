"use server";

import { getDb } from "@/lib/supabase/server";
import { loadDeal, loadDealHistory } from "@/lib/deals-server";
import { isEditableField, validateEdit, type DealRow, type HistoryEntry } from "@/lib/deals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveResult = { ok: true; row: DealRow } | { ok: false; error: string };

/**
 * Save one edited field. Runs as the signed-in user and writes only through
 * update_deal, which checks the role, the allowlist and the types again,
 * and records the change in deal_events. Returns the row as stored.
 */
export async function saveDealField(dealId: unknown, field: unknown, value: unknown): Promise<SaveResult> {
  if (typeof dealId !== "string" || !UUID.test(dealId)) return { ok: false, error: "That deal couldn't be found." };
  if (!isEditableField(field)) return { ok: false, error: "That field can't be edited." };
  const checked = validateEdit(field, value);
  if ("error" in checked) return { ok: false, error: checked.error };

  const db = await getDb();
  const { error } = await db.rpc("update_deal", { deal_id: dealId, changes: { [field]: checked.value } });
  if (error) return { ok: false, error: friendlyError(error) };

  const row = await loadDeal(dealId);
  if (!row) return { ok: false, error: "Saved, but the deal couldn't be reloaded. Refresh the page." };
  return { ok: true, row };
}

export type HistoryResult = { ok: true; entries: HistoryEntry[] } | { ok: false; error: string };

export async function getDealHistory(dealId: unknown): Promise<HistoryResult> {
  if (typeof dealId !== "string" || !UUID.test(dealId)) return { ok: false, error: "That deal couldn't be found." };
  const result = await loadDealHistory(dealId);
  return "error" in result ? { ok: false, error: "History couldn't be loaded." } : { ok: true, entries: result.entries };
}

/** Turn a database rejection into a short, plain message. */
function friendlyError(error: { code?: string; message: string }): string {
  const detail = error.message.replace(/^update_deal:\s*/, "");
  switch (error.code) {
    case "42501":
      // Role check in update_deal, or no session at all (anon can't execute it).
      return /role required|permission denied/.test(error.message)
        ? "You don't have permission to edit deals. If you were signed out, sign in again."
        : `Not allowed: ${detail}.`;
    case "22023":
    case "22001":
      return `Not saved: ${detail}.`;
    case "P0002":
      return "That deal no longer exists.";
    default:
      return "Couldn't save the change. Try again.";
  }
}
