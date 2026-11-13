"use server";

import { getDb } from "@/lib/supabase/server";
import { roleName } from "@/lib/activity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["admin", "editor", "viewer"] as const;
type RoleChoice = (typeof ROLES)[number] | null;

export type RoleResult = { ok: true; role: RoleChoice } | { ok: false; error: string };

/**
 * Change a user's role (null = no access). Runs as the signed-in user through
 * set_user_role (007, 008), which checks the caller is an admin, refuses a
 * change to the caller's own role, keeps the last admin, and logs the change
 * in the same transaction.
 */
export async function changeUserRole(userId: unknown, role: unknown): Promise<RoleResult> {
  if (typeof userId !== "string" || !UUID.test(userId)) return { ok: false, error: "That user couldn't be found." };
  if (role !== null && !(typeof role === "string" && (ROLES as readonly string[]).includes(role))) {
    return { ok: false, error: "That isn't a valid role." };
  }

  const db = await getDb();
  const { data, error } = await db.rpc("set_user_role", { target_user_id: userId, new_role: role });
  if (error) {
    switch (error.code) {
      case "23514":
        return { ok: false, error: "There must always be at least one admin. Make someone else an admin first." };
      case "42501":
        return /own role/.test(error.message)
          ? { ok: false, error: "You can't change your own role. Ask another admin." }
          : { ok: false, error: "Only admins can change roles. If you were signed out, sign in again." };
      case "P0002":
        return { ok: false, error: "That user no longer exists." };
      default:
        console.error("set_user_role failed:", error.message);
        return { ok: false, error: `Couldn't change the role to ${roleName(role)}. Try again.` };
    }
  }
  return { ok: true, role: (data as RoleChoice) ?? null };
}
