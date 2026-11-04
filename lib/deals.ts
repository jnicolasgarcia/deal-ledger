/**
 * Deal row shape and filtering for /deals. Safe on server and client.
 * Rules come from ASSUMPTIONS.md (shared fields, assumptions, stages).
 */
import { isStage, stageMeta, stageOrder, type Stage } from "@/lib/stages";

export type AttributeValue = string | number | boolean | null;

export type DealRow = {
  id: string;
  client: string;
  vertical: string;
  market: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  bldg_sf: number | null;
  list_price: number | null;
  list_price_per_sf: number | null;
  lot_sf: number | null;
  list_price_per_lot_sf: number | null;
  stage: Stage;
  stage_raw: string | null;
  stage_changed_at: string | null;
  notes_raw: string | null;
  attributes: Record<string, AttributeValue>;
  assumption_fields: string[];
  source_tab: string;
  source_row: number;
  natural_key: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  /** Whole days since stage_changed_at, computed on the server. Null: no stage history. */
  days_in_stage: number | null;
  /** Who made the last change: a name, "Import", or "Unknown user". See updatedByLabel. */
  updated_by_label: string;
};

/**
 * Who last changed a deal. updated_by is set by update_deal; null means the
 * row only came from the import, unless it has edit history (its editor's
 * account was deleted, which nulls updated_by), so never claim "Import" then.
 */
export function updatedByLabel(updatedBy: string | null, name: string | undefined, eventCount: number): string {
  if (updatedBy) return name ?? "Unknown user";
  return eventCount > 0 ? "Unknown user" : "Import";
}

/**
 * Typed column -> source header (lowercase), so assumption_fields (which
 * stores source headers) can be matched to a grid column.
 */
const FIELD_SOURCE_HEADER: Partial<Record<keyof DealRow, string>> = {
  client: "client name",
  market: "metro",
  address: "address",
  city: "city",
  state: "state",
  stage: "status",
  bldg_sf: "bldg sf",
  list_price: "list price",
  list_price_per_sf: "list price/sf",
  lot_sf: "lot sf",
  list_price_per_lot_sf: "list price/lot sf",
  notes_raw: "notes",
};

const norm = (s: string) => s.trim().toLowerCase();

/** Is this typed field an unconfirmed assumption on this deal? */
export function isFieldAssumption(row: DealRow, field: keyof DealRow): boolean {
  const header = FIELD_SOURCE_HEADER[field];
  return !!header && row.assumption_fields.some((f) => norm(f) === header);
}

/** Is this attribute (keyed by source header) an unconfirmed assumption? */
export function isAttributeAssumption(row: DealRow, key: string): boolean {
  return row.assumption_fields.some((f) => norm(f) === norm(key));
}

export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

// ---------- filters (live in the URL query string) ----------

export type DealFilters = {
  client: string | null;
  vertical: string | null;
  market: string | null;
  stages: Stage[];
  q: string;
};

export const EMPTY_FILTERS: DealFilters = { client: null, vertical: null, market: null, stages: [], q: "" };

type ParamsLike = { get(name: string): string | null };

export function parseFilters(params: ParamsLike): DealFilters {
  const one = (k: string) => {
    const v = params.get(k)?.trim();
    return v ? v.slice(0, 200) : null;
  };
  const stages = (params.get("stage") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isStage);
  return {
    client: one("client"),
    vertical: one("vertical"),
    market: one("market"),
    stages: [...new Set(stages)],
    q: (params.get("q") ?? "").slice(0, 200),
  };
}

export function filtersToQuery(f: DealFilters): string {
  const p = new URLSearchParams();
  if (f.client) p.set("client", f.client);
  if (f.vertical) p.set("vertical", f.vertical);
  if (f.market) p.set("market", f.market);
  if (f.stages.length) p.set("stage", f.stages.join(","));
  if (f.q.trim()) p.set("q", f.q.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: DealFilters): boolean {
  return !!(f.client || f.vertical || f.market || f.stages.length || f.q.trim());
}

export function filterDeals(rows: DealRow[], f: DealFilters): DealRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.client || r.client === f.client) &&
      (!f.vertical || r.vertical === f.vertical) &&
      (!f.market || r.market === f.market) &&
      (!f.stages.length || f.stages.includes(r.stage)) &&
      (!q ||
        [r.address, r.city, r.notes_raw].some((v) => v?.toLowerCase().includes(q))),
  );
}

/** Distinct non-empty values, sorted, for a filter dropdown. */
export function distinctValues(rows: DealRow[], key: "client" | "vertical" | "market"): string[] {
  return [...new Set(rows.map((r) => r[key]).filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}

// ---------- display ----------

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export type NumberKind = "money" | "money_per_unit" | "area";

export function formatNumber(value: number, kind: NumberKind): string {
  if (kind === "money") return money.format(value);
  if (kind === "money_per_unit") return money2.format(value);
  return integer.format(value);
}

/** Attribute values as written, booleans as Yes/No. */
export function formatAttribute(value: AttributeValue): string | null {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// ---------- sorting (AG Grid comparator signature) ----------

type Comparator<T> = (a: T | null | undefined, b: T | null | undefined, nodeA: unknown, nodeB: unknown, isDescending: boolean) => number;

/**
 * Missing values always sort last, whichever way the column is sorted.
 * AG Grid flips the result for descending sorts, so nulls compensate.
 * Used for days in stage: n/a is unknown, never zero days.
 */
export function nullsLast<T>(compare: (a: T, b: T) => number): Comparator<T> {
  return (a, b, _na, _nb, isDescending) => {
    const aNull = a === null || a === undefined || (a as unknown) === "";
    const bNull = b === null || b === undefined || (b as unknown) === "";
    if (aNull && bNull) return 0;
    if (aNull) return isDescending ? -1 : 1;
    if (bNull) return isDescending ? 1 : -1;
    return compare(a as T, b as T);
  };
}

export const byText = nullsLast<string>((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
export const byNumber = nullsLast<number>((a, b) => a - b);
/** Funnel order, then On Hold, then Unknown. */
export const byStage: Comparator<string> = (a, b) => stageOrder(a) - stageOrder(b);

// ---------- editing (only through update_deal) ----------

/** Fields editable inline. Must match update_deal's allowlist (002_auth.sql). */
export const EDITABLE_FIELDS = {
  stage: { kind: "stage", label: "Stage" },
  market: { kind: "text", label: "Market" },
  address: { kind: "text", label: "Address" },
  city: { kind: "text", label: "City" },
  state: { kind: "text", label: "State" },
  bldg_sf: { kind: "number", label: "Bldg SF", numberKind: "area" },
  list_price: { kind: "number", label: "List price", numberKind: "money" },
  list_price_per_sf: { kind: "number", label: "$/SF", numberKind: "money_per_unit" },
  lot_sf: { kind: "number", label: "Lot SF", numberKind: "area" },
  list_price_per_lot_sf: { kind: "number", label: "$/Lot SF", numberKind: "money_per_unit" },
  notes_raw: { kind: "notes", label: "Notes" },
} as const satisfies Record<string, { kind: "stage" | "text" | "number" | "notes"; label: string; numberKind?: NumberKind }>;

export type EditableField = keyof typeof EDITABLE_FIELDS;

export function isEditableField(field: unknown): field is EditableField {
  return typeof field === "string" && Object.hasOwn(EDITABLE_FIELDS, field);
}

export type EditValue = string | number | null;

/**
 * Validate and normalize one edited value. Runs on the server before
 * update_deal (which checks again). Returns the value to send, or an error.
 */
export function validateEdit(field: EditableField, value: unknown): { value: EditValue } | { error: string } {
  const spec = EDITABLE_FIELDS[field];
  if (spec.kind === "stage") {
    return isStage(value) ? { value } : { error: "Choose a stage from the list." };
  }
  if (spec.kind === "number") {
    if (value === null || value === undefined || value === "") return { value: null };
    const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return { error: `${spec.label} must be a number.` };
    if (n < 0) return { error: `${spec.label} can't be negative.` };
    return { value: n };
  }
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== "string") return { error: `${spec.label} must be text.` };
  const text = spec.kind === "notes" ? value : value.trim();
  const max = spec.kind === "notes" ? 5000 : 500;
  if (text.length > max) return { error: `${spec.label} is too long (max ${max} characters).` };
  return { value: text.trim() === "" ? null : text };
}

// ---------- history (deal_events) ----------

export type HistoryEntry = {
  id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
  changed_by_label: string;
};

/** "stage" -> "Stage", "attributes.Power" -> "Power". */
export function historyFieldLabel(field: string): string {
  if (field.startsWith("attributes.")) return field.slice("attributes.".length);
  return isEditableField(field) ? EDITABLE_FIELDS[field].label : field;
}

/** A history value for display. Null means "n/a" (empty). */
export function formatHistoryValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (field === "stage" && typeof value === "string") return stageMetaLabel(value);
  if (isEditableField(field)) {
    const spec = EDITABLE_FIELDS[field];
    if (spec.kind === "number" && typeof value === "number") return formatNumber(value, spec.numberKind);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function stageMetaLabel(stage: string): string {
  return isStage(stage) ? stageMeta(stage).label : stage;
}
