/**
 * Deal stages: funnel order, labels and colors. Single source of truth for
 * how a stage looks anywhere in the app. Values match the deal_stage enum
 * (supabase/migrations/001_init.sql) and ASSUMPTIONS.md section 1.
 *
 * Colors are muted and distinguishable, and a pill always shows its label,
 * so color is never the only signal. Label text is >= 4.5:1 on its fill.
 */

export const STAGES = [
  "sourcing",
  "in_pipeline",
  "pre_loi",
  "negotiating_loi",
  "negotiating_psa",
  "in_contract",
  "closed",
  "on_hold",
  "unknown",
] as const;

export type Stage = (typeof STAGES)[number];

/** The active funnel, in order. On Hold and Unknown sit outside it. */
export const FUNNEL: readonly Stage[] = STAGES.slice(0, 7);

export type StageMeta = {
  id: Stage;
  label: string;
  /** Pill fill */
  bg: string;
  /** Label text */
  text: string;
  /** Pill border */
  border: string;
  /** Dot / chart color */
  dot: string;
};

const META: Record<Stage, Omit<StageMeta, "id">> = {
  sourcing:        { label: "Sourcing",        bg: "#EEF0F3", text: "#4A5361", border: "#EEF0F3", dot: "#8E96A3" },
  in_pipeline:     { label: "In Pipeline",     bg: "#E6F0FD", text: "#0B5CAD", border: "#E6F0FD", dot: "#3B8EEA" },
  pre_loi:         { label: "Pre LOI",         bg: "#ECEBFC", text: "#4B44B8", border: "#ECEBFC", dot: "#7A73E0" },
  negotiating_loi: { label: "Negotiating LOI", bg: "#F4EAFB", text: "#7A3AA6", border: "#F4EAFB", dot: "#B07CD6" },
  negotiating_psa: { label: "Negotiating PSA", bg: "#FCE9F0", text: "#AD2D61", border: "#FCE9F0", dot: "#E4789F" },
  in_contract:     { label: "In Contract",     bg: "#E3F4F3", text: "#0E6E69", border: "#E3F4F3", dot: "#3FAFA8" },
  closed:          { label: "Closed",          bg: "#E5F4E8", text: "#1E7A3A", border: "#E5F4E8", dot: "#4CB86A" },
  on_hold:         { label: "On Hold",         bg: "#F2EFEA", text: "#5E574E", border: "#E2DDD5", dot: "#A39A8E" },
  // Unknown: orange outline, no fill. Blank or unmappable stage, never "zero".
  unknown:         { label: "Unknown",         bg: "#FFFFFF", text: "#A84E00", border: "#C46A00", dot: "#C46A00" },
};

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/** Meta for any stage value. Null, blank or unrecognized values are Unknown. */
export function stageMeta(stage: string | null | undefined): StageMeta {
  const id: Stage = isStage(stage) ? stage : "unknown";
  return { id, ...META[id] };
}

/** Sort key: funnel order, then On Hold, then Unknown. */
export function stageOrder(stage: string | null | undefined): number {
  return STAGES.indexOf(stageMeta(stage).id);
}
