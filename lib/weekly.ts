/**
 * /weekly view model, built only from get_weekly_review() rows.
 * Pure: safe on server and client. No business rule here that isn't in
 * ASSUMPTIONS.md or agreed for the weekly review.
 */
import { STAGES, isStage, type Stage } from "@/lib/stages";

/** One row of get_weekly_review() (006). */
export type WeeklyRow = {
  id: string;
  vertical: string;
  market: string | null;
  address: string | null;
  /** The property's city and state (not the search market). */
  city: string | null;
  state: string | null;
  stage: Stage;
  list_price: number | null;
  bldg_sf: number | null;
  list_price_per_sf: number | null;
  lot_sf: number | null;
  notes: string | null;
  /** Weekly column names that are unconfirmed assumptions. */
  assumption_fields: string[];
  days_in_stage: number | null;
  /** Stage at the start of the last 7 days, when it changed since. */
  previous_stage: Stage | null;
  updated_at: string | null;
  imported_at: string | null;
};

/** Team time zone for "week of", dates and times. */
export const TIME_ZONE = "America/New_York";

/** Deck order (ASSUMPTIONS.md section 2). Unknown verticals follow, A to Z. */
const VERTICAL_ORDER = ["Food", "Autonomous Vehicle", "Airline Catering"];

/** Stages shown as cards, furthest first. Closed and On Hold go to a short list. */
const CARD_ORDER: Stage[] = ["in_contract", "negotiating_psa", "negotiating_loi", "pre_loi", "in_pipeline", "sourcing", "unknown"];
const PARKED: Stage[] = ["closed", "on_hold"];
/** Active = in the funnel and not finished or paused. Unknown is counted on its own. */
const ACTIVE: Stage[] = ["sourcing", "in_pipeline", "pre_loi", "negotiating_loi", "negotiating_psa", "in_contract"];

/** "Culver City, CA", or null when neither is known. */
export function locationOf(deal: Pick<WeeklyRow, "city" | "state">): string | null {
  const parts = [deal.city, deal.state].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length ? parts.join(", ") : null;
}

/** True when $, SF, $/SF and lot size are all missing. */
export function hasNoFigures(deal: Pick<WeeklyRow, "list_price" | "bldg_sf" | "list_price_per_sf" | "lot_sf">): boolean {
  return deal.list_price === null && deal.bldg_sf === null && deal.list_price_per_sf === null && deal.lot_sf === null;
}

export function verticalSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export type StageCount = { stage: Stage; count: number };

export type WeeklyVertical = {
  slug: string;
  name: string;
  markets: string[];
  total: number;
  /** Card deals, furthest stage first. */
  cards: WeeklyRow[];
  /** Closed and On Hold, listed briefly at the end. */
  parked: WeeklyRow[];
  /** Non-zero counts, in funnel order. */
  stageCounts: StageCount[];
  moved: WeeklyRow[];
};

export type WeeklySummary = {
  total: number;
  active: number;
  moved: number;
  inContract: number;
  onHold: number;
  closed: number;
  unknown: number;
  verticals: number;
  /** Deals with a known days-in-stage (a stage change since import). */
  withStageHistory: number;
};

export type WeeklyModel = {
  verticals: WeeklyVertical[];
  summary: WeeklySummary;
  /** ISO date (yyyy-mm-dd) of this week's Monday, in TIME_ZONE. */
  weekOf: string;
  lastUpdated: string | null;
  /** Earliest import time: stage history starts here. */
  historyStarts: string | null;
};

const stageRank = (s: Stage) => CARD_ORDER.indexOf(s);

function byFurthest(a: WeeklyRow, b: WeeklyRow): number {
  return (
    stageRank(a.stage) - stageRank(b.stage) ||
    Number(!!b.previous_stage) - Number(!!a.previous_stage) || // moved first within a stage
    (a.address ?? "￿").localeCompare(b.address ?? "￿")
  );
}

/** Monday of the week containing `now`, as yyyy-mm-dd in TIME_ZONE. */
export function mondayOf(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const local = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const back = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  local.setUTCDate(local.getUTCDate() - back);
  return local.toISOString().slice(0, 10);
}

export function buildWeekly(raw: WeeklyRow[], now: Date): WeeklyModel {
  const rows = raw.map((r) => ({
    ...r,
    stage: isStage(r.stage) ? r.stage : ("unknown" as Stage),
    previous_stage: isStage(r.previous_stage) ? r.previous_stage : null,
    assumption_fields: r.assumption_fields ?? [],
  }));

  const groups = new Map<string, WeeklyRow[]>();
  for (const r of rows) groups.set(r.vertical, [...(groups.get(r.vertical) ?? []), r]);
  const names = [...groups.keys()].sort((a, b) => {
    const ia = VERTICAL_ORDER.indexOf(a), ib = VERTICAL_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  const verticals = names.map((name): WeeklyVertical => {
    const deals = groups.get(name)!;
    return {
      slug: verticalSlug(name),
      name,
      markets: [...new Set(deals.map((d) => d.market).filter((m): m is string => !!m))].sort(),
      total: deals.length,
      cards: deals.filter((d) => !PARKED.includes(d.stage)).sort(byFurthest),
      parked: deals.filter((d) => PARKED.includes(d.stage)).sort((a, b) => PARKED.indexOf(a.stage) - PARKED.indexOf(b.stage)),
      stageCounts: STAGES.map((stage) => ({ stage, count: deals.filter((d) => d.stage === stage).length })).filter((c) => c.count > 0),
      moved: deals.filter((d) => d.previous_stage).sort(byFurthest),
    };
  });

  const count = (pred: (r: WeeklyRow) => boolean) => rows.filter(pred).length;
  const times = (key: "updated_at" | "imported_at") => rows.map((r) => r[key]).filter((t): t is string => !!t).sort();

  return {
    verticals,
    summary: {
      total: rows.length,
      active: count((r) => ACTIVE.includes(r.stage)),
      moved: count((r) => !!r.previous_stage),
      inContract: count((r) => r.stage === "in_contract"),
      onHold: count((r) => r.stage === "on_hold"),
      closed: count((r) => r.stage === "closed"),
      unknown: count((r) => r.stage === "unknown"),
      verticals: verticals.length,
      withStageHistory: count((r) => r.days_in_stage !== null),
    },
    weekOf: mondayOf(now),
    lastUpdated: times("updated_at").at(-1) ?? null,
    historyStarts: times("imported_at")[0] ?? null,
  };
}

// ---------- formatting (always in TIME_ZONE so server and client agree) ----------

export function formatLongDate(isoDate: string): string {
  // yyyy-mm-dd is a calendar date: format it in UTC so it never shifts a day.
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The overview's summary sentence. Says plainly when stage history is short. */
export function summarySentence(m: WeeklyModel): string {
  const s = m.summary;
  const parts = [
    `${plural(s.active, "active deal")} across ${plural(s.verticals, "vertical")}`,
    s.moved === 0 ? "none moved in the last 7 days" : `${s.moved} moved in the last 7 days`,
  ];
  let text = `${parts.join(", ")}.`;
  const aside = [
    s.onHold ? `${s.onHold} on hold` : null,
    s.closed ? `${s.closed} closed` : null,
    s.unknown ? `${plural(s.unknown, "deal")} with an unknown stage` : null,
  ].filter(Boolean);
  if (aside.length) text += ` ${aside.join(", ").replace(/^./, (c) => c.toUpperCase())}.`;
  if (m.historyStarts && s.withStageHistory < s.total) {
    text += ` Stage history starts ${formatDate(m.historyStarts)}, so days in stage is only known for ${plural(s.withStageHistory, "deal")} that changed stage since then.`;
  }
  return text;
}
