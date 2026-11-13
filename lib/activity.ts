/**
 * Usage log (activity_log, 007): pages that log views, who may open them,
 * and plain-English labels for the admin feed. Pure: safe on server and client.
 */
import type { AppRole } from "@/lib/auth";
import { historyFieldLabel } from "@/lib/deals";
import { TIME_ZONE, locationOf } from "@/lib/weekly";

export const LOGGED_PAGES = ["deals", "weekly", "admin"] as const;
export type LoggedPage = (typeof LOGGED_PAGES)[number];

const PAGE_LABELS: Record<LoggedPage, string> = { deals: "Deals", weekly: "Weekly review", admin: "Admin" };
const ROLE_NAMES: Record<AppRole, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

export function isLoggedPage(value: unknown): value is LoggedPage {
  return typeof value === "string" && (LOGGED_PAGES as readonly string[]).includes(value);
}

/** Same rule as the pages' NoAccessPanel. Presentation only: the database enforces access. */
export function canOpenPage(page: LoggedPage, role: AppRole): boolean {
  if (page === "admin") return role === "admin";
  if (page === "deals") return role === "editor" || role === "admin";
  return true;
}

export type ActivityAction = "sign_in" | "page_view" | "deal_edit" | "role_change";

/** One activity_log row as the admin page reads it. */
export type ActivityRow = {
  id: string;
  user_id: string | null;
  action: ActivityAction;
  page: LoggedPage | null;
  deal_id: string | null;
  target_user_id: string | null;
  detail: Record<string, unknown>;
  is_demo: boolean;
  created_at: string;
};

export type DealLabelSource = {
  address: string | null;
  city: string | null;
  state: string | null;
  client: string | null;
  vertical: string | null;
};

/**
 * "9213 183rd St"; with no address, "San Diego, CA (no address)" as in the
 * weekly view; with no city either, "Client C, Autonomous Vehicle deal (no address)".
 */
export function dealLabel(deal: DealLabelSource | undefined): string {
  if (!deal) return "a deal that no longer exists";
  if (deal.address?.trim()) return deal.address.trim();
  const where = locationOf(deal);
  if (where) return `${where} (no address)`;
  const who = [deal.client, deal.vertical].map((p) => p?.trim()).filter(Boolean).join(", ");
  return who ? `${who} deal (no address)` : "a deal with no address or client";
}

export function roleName(role: unknown): string {
  return typeof role === "string" && role in ROLE_NAMES ? ROLE_NAMES[role as AppRole] : "No access";
}

/** What happened, in a short sentence without the actor ("Opened Deals"). */
export function describeActivity(
  row: ActivityRow,
  names: Map<string, string>,
  deals: Map<string, DealLabelSource>,
): string {
  switch (row.action) {
    case "sign_in":
      return "Signed in";
    case "page_view": {
      const page = row.page ? PAGE_LABELS[row.page] : "a page";
      return row.detail.denied ? `Tried to open ${page} (no access)` : `Opened ${page}`;
    }
    case "deal_edit": {
      const fields = Array.isArray(row.detail.fields)
        ? row.detail.fields.filter((f): f is string => typeof f === "string").map(historyFieldLabel)
        : [];
      const what = fields.length ? fields.join(", ") : "a deal";
      return `Edited ${what} on ${dealLabel(row.deal_id ? deals.get(row.deal_id) : undefined)}`;
    }
    case "role_change": {
      const who = (row.target_user_id && names.get(row.target_user_id)) || "a deleted user";
      return `Changed ${who}'s role from ${roleName(row.detail.from)} to ${roleName(row.detail.to)}`;
    }
  }
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

/** "Nov 12, 3:04 PM" in the team time zone; null input gives null (shown as n/a or "Never"). */
export function formatDateTime(iso: string | null): string | null {
  return iso ? dateTime.format(new Date(iso)) : null;
}
