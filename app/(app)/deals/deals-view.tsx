"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EDITABLE_FIELDS,
  EMPTY_FILTERS,
  distinctValues,
  filterDeals,
  filtersToQuery,
  hasActiveFilters,
  parseFilters,
  type DealFilters,
  type DealRow,
  type EditableField,
} from "@/lib/deals";
import { Toast, type ToastMessage } from "@/app/_components/toast";
import { saveDealField } from "./actions";
import type { Stage } from "@/lib/stages";
import { DealsGrid, DEFAULT_VISIBLE, columnOptions } from "./deals-grid";
import { DealSheet } from "./deal-sheet";
import { FilterBar } from "./filter-bar";

/** Filter bar + grid + side sheet. Filters live in the URL query string. */
export function DealsView({ rows: initialRows, canEdit }: { rows: DealRow[]; canEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Local state is the source of truth while the page is open (so quick
  // successive changes never read a stale URL); it is mirrored into the URL
  // query string, which is what a reload or a shared link restores from.
  const [filters, setFilters] = useState<DealFilters>(() => parseFilters(params));
  // Rows are replaced one at a time with the stored version after each save.
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [visible, setVisible] = useState(() => new Set(DEFAULT_VISIBLE));

  const currentQuery = params.toString() ? `?${params.toString()}` : "";
  useEffect(() => {
    const next = filtersToQuery(filters);
    if (next === currentQuery) return;
    // Short pause so typing in search doesn't rewrite the URL on every key.
    const t = setTimeout(() => router.replace(`${pathname}${next}`, { scroll: false }), 200);
    return () => clearTimeout(t);
  }, [filters, currentQuery, pathname, router]);

  const onChange = useCallback((patch: Partial<DealFilters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const toggleStage = useCallback(
    (stage: Stage) =>
      setFilters((f) => ({
        ...f,
        stages: f.stages.includes(stage) ? f.stages.filter((s) => s !== stage) : [...f.stages, stage],
      })),
    [],
  );
  const clear = () => setFilters(EMPTY_FILTERS);

  const shown = useMemo(() => filterDeals(rows, filters), [rows, filters]);
  const options = useMemo(
    () => ({
      client: distinctValues(rows, "client"),
      vertical: distinctValues(rows, "vertical"),
      market: distinctValues(rows, "market"),
    }),
    [rows],
  );
  const attributeKeys = useMemo(
    () => [...new Set(rows.flatMap((r) => Object.keys(r.attributes)))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const columns = useMemo(() => columnOptions(attributeKeys), [attributeKeys]);

  const toggleColumn = (colId: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });

  const closeSheet = useCallback(() => setSelectedId(null), []);
  const openSheet = useCallback((row: DealRow) => setSelectedId(row.id), []);
  const dismissToast = useCallback(() => setToast(null), []);

  /** Save through update_deal (server action as the signed-in user), then show the stored row. */
  const onEdit = useCallback(async (row: DealRow, field: EditableField, value: unknown) => {
    const label = EDITABLE_FIELDS[field].label;
    setToast({ id: Date.now(), kind: "info", text: `Saving ${label}…` });
    const result = await saveDealField(row.id, field, value ?? null);
    if (result.ok) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? result.row : r)));
      setToast({ id: Date.now(), kind: "success", text: `${label} saved.` });
    } else {
      setToast({ id: Date.now(), kind: "error", text: result.error });
    }
  }, []);
  const active = hasActiveFilters(filters);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-surface p-10 text-center shadow-card">
        <p className="text-headline">No deals yet</p>
        <p className="mt-1 text-callout text-ink-secondary">Deals appear here once the spreadsheet is imported.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={filters}
        search={filters.q}
        options={options}
        onChange={onChange}
        onSearch={(q) => onChange({ q })}
        onToggleStage={toggleStage}
        onClear={clear}
        active={active}
        shown={shown.length}
        total={rows.length}
        columns={columns}
        visible={visible}
        onToggleColumn={toggleColumn}
        onResetColumns={() => setVisible(new Set(DEFAULT_VISIBLE))}
      />

      {shown.length === 0 ? (
        <div className="rounded-lg bg-surface p-10 text-center shadow-card">
          <p className="text-headline">No deals match these filters</p>
          <p className="mt-1 text-callout text-ink-secondary">Try a different stage or search, or clear the filters.</p>
          <button
            type="button"
            onClick={clear}
            className="mt-4 h-8 rounded-md bg-accent px-4 text-callout font-medium text-white hover:bg-accent-hover"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <DealsGrid
          rows={shown}
          attributeKeys={attributeKeys}
          visible={visible}
          canEdit={canEdit}
          onOpen={openSheet}
          onEdit={onEdit}
        />
      )}

      <DealSheet deal={selected} onClose={closeSheet} />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
