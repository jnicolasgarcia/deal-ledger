"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClickedEvent,
  type CellEditRequestEvent,
  type CellKeyDownEvent,
  type ColDef,
  type SortComparatorFn,
} from "ag-grid-community";
import { EDITABLE_FIELDS, byNumber, byStage, byText, isEditableField, type DealRow, type EditableField, type NumberKind } from "@/lib/deals";
import { STAGES, stageMeta } from "@/lib/stages";
import { DealCell, OpenDetailsCell, type CellParams } from "./cells";

ModuleRegistry.registerModules([AllCommunityModule]);

/** Our tokens applied to AG Grid's Quartz theme. Dense: 36px rows. */
const dealsTheme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  rowHeight: 36,
  headerHeight: 36,
  spacing: 6,
  cellHorizontalPadding: 12,
  accentColor: "var(--color-accent)",
  foregroundColor: "var(--color-ink)",
  backgroundColor: "var(--color-surface)",
  headerBackgroundColor: "var(--color-surface-muted)",
  headerTextColor: "var(--color-ink-secondary)",
  borderColor: "var(--color-hairline)",
  rowHoverColor: "rgb(0 113 227 / 0.05)",
  selectedRowBackgroundColor: "rgb(0 113 227 / 0.08)",
  oddRowBackgroundColor: "var(--color-surface)",
  wrapperBorder: false,
  wrapperBorderRadius: 14,
  columnBorder: false,
  browserColorScheme: "light",
});

// ---------- column catalogue ----------

export type ColumnOption = { colId: string; label: string; group: "Default" | "More fields" | "Attributes" };

type Spec = { colId: string; label: string; visible: boolean; width: number; cell: CellParams; sort?: SortComparatorFn<DealRow> };

const text = (colId: keyof DealRow, label: string, visible: boolean, width = 130): Spec => ({
  colId, label, visible, width, cell: { kind: "text", field: colId },
});
const num = (colId: keyof DealRow, label: string, numberKind: NumberKind, width = 120): Spec => ({
  colId, label, visible: true, width, cell: { kind: "number", field: colId, numberKind },
});

const SPECS: Spec[] = [
  text("client", "Client", true, 110),
  text("vertical", "Vertical", true, 175),
  text("market", "Market", true, 100),
  text("city", "City", true, 130),
  { colId: "stage", label: "Stage", visible: true, width: 160, cell: { kind: "stage" },
    sort: byStage as SortComparatorFn<DealRow> },
  text("address", "Address", true, 190),
  text("state", "State", true, 80),
  num("bldg_sf", "Bldg SF", "area", 100),
  num("list_price", "List price", "money", 125),
  num("list_price_per_sf", "$/SF", "money_per_unit", 100),
  num("lot_sf", "Lot SF", "area", 100),
  num("list_price_per_lot_sf", "$/Lot SF", "money_per_unit", 105),
  text("notes_raw", "Notes", true, 240),
  { colId: "days_in_stage", label: "Days in stage", visible: true, width: 120, cell: { kind: "days" } },
  { colId: "updated_at", label: "Last updated", visible: true, width: 210, cell: { kind: "updated" } },
  // Hidden by default, available from the Columns menu.
  text("stage_raw", "Status (raw)", false, 140),
  { colId: "stage_changed_at", label: "Stage changed", visible: false, width: 130, cell: { kind: "date", field: "stage_changed_at" } },
  text("source_tab", "Source tab", false, 170),
  { ...text("source_row", "Source row", false, 105), sort: byNumber as SortComparatorFn<DealRow> },
  text("natural_key", "Natural key", false, 220),
  { colId: "created_at", label: "Imported", visible: false, width: 130, cell: { kind: "date", field: "created_at" } },
];

/** Column ids shown by default. Everything else is in the Columns menu. */
export const DEFAULT_VISIBLE: readonly string[] = SPECS.filter((s) => s.visible).map((s) => s.colId);

export function columnOptions(attributeKeys: string[]): ColumnOption[] {
  return [
    ...SPECS.map((s) => ({ colId: s.colId, label: s.label, group: s.visible ? "Default" : "More fields" }) as ColumnOption),
    ...attributeKeys.map((k) => ({ colId: `attr:${k}`, label: k, group: "Attributes" }) as ColumnOption),
  ];
}

/** Inline editor for an editable field. Saving goes through update_deal (see DealsView). */
function editorFor(field: EditableField): Partial<ColDef<DealRow>> {
  const spec = EDITABLE_FIELDS[field];
  const base: Partial<ColDef<DealRow>> = { editable: true, cellClass: "deal-editable" };
  switch (spec.kind) {
    case "stage":
      return {
        ...base,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: [...STAGES] },
        valueFormatter: (p) => stageMeta(p.value).label, // labels in the editor list
      };
    case "number":
      return { ...base, cellEditor: "agNumberCellEditor", cellEditorParams: { min: 0 } };
    case "notes":
      return {
        ...base,
        cellEditor: "agLargeTextCellEditor",
        cellEditorPopup: true,
        cellEditorParams: { maxLength: 5000, rows: 6, cols: 50 },
      };
    default:
      return { ...base, cellEditor: "agTextCellEditor", cellEditorParams: { maxLength: 500 } };
  }
}

function toColDef(s: Spec, visible: Set<string>, canEdit: boolean): ColDef<DealRow> {
  const isNumber = s.cell.kind === "number" || s.cell.kind === "days";
  return {
    ...(canEdit && isEditableField(s.colId) ? editorFor(s.colId) : {}),
    colId: s.colId,
    field: s.colId as keyof DealRow,
    headerName: s.label,
    width: s.width,
    hide: !visible.has(s.colId),
    type: isNumber ? "rightAligned" : undefined,
    comparator: s.sort ?? ((isNumber ? byNumber : byText) as SortComparatorFn<DealRow>),
    cellRendererParams: { cell: s.cell },
  };
}

type Props = {
  rows: DealRow[];
  attributeKeys: string[];
  /** Visible column ids */
  visible: Set<string>;
  canEdit: boolean;
  onOpen: (row: DealRow) => void;
  /** Called with the edited value; the grid itself never changes the data (readOnlyEdit). */
  onEdit: (row: DealRow, field: EditableField, value: unknown) => void;
};

export function DealsGrid({ rows, attributeKeys, visible, canEdit, onOpen, onEdit }: Props) {
  const columnDefs = useMemo<ColDef<DealRow>[]>(
    () => [
      {
        colId: "open",
        headerName: "",
        width: 44,
        minWidth: 44,
        pinned: "left",
        lockPosition: "left",
        sortable: false,
        resizable: false,
        suppressMovable: true,
        cellRenderer: OpenDetailsCell,
        cellRendererParams: { onOpen },
        cellStyle: { display: "flex", alignItems: "center", justifyContent: "center", paddingInline: 0 },
      },
      ...SPECS.map((s) => toColDef(s, visible, canEdit)),
      ...attributeKeys.map<ColDef<DealRow>>((key) => ({
        colId: `attr:${key}`,
        headerName: key,
        width: 140,
        hide: !visible.has(`attr:${key}`),
        valueGetter: (p) => p.data?.attributes[key] ?? null,
        comparator: byText as SortComparatorFn<DealRow>,
        cellRendererParams: { cell: { kind: "attribute", attrKey: key } satisfies CellParams },
      })),
    ],
    [attributeKeys, visible, canEdit, onOpen],
  );

  const defaultColDef = useMemo<ColDef<DealRow>>(
    () => ({ sortable: true, resizable: true, cellRenderer: DealCell, suppressHeaderMenuButton: true, minWidth: 70 }),
    [],
  );

  // Fit the rows (plus header and horizontal scrollbar), up to the viewport,
  // so short lists don't leave a tall empty box.
  const height = `min(${rows.length * 36 + 38 + 16}px, calc(100dvh - 15rem))`;

  return (
    <div className="overflow-hidden rounded-lg bg-surface shadow-card" style={{ height, minHeight: 160 }}>
      <AgGridReact<DealRow>
        theme={dealsTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={(p) => p.data.id}
        readOnlyEdit
        onCellEditRequest={(e: CellEditRequestEvent<DealRow>) => {
          const field = e.colDef.colId;
          if (e.data && isEditableField(field)) onEdit(e.data, field, e.newValue);
        }}
        // Read-only cells open the details sheet; editable cells edit on double-click or Enter.
        onCellClicked={(e: CellClickedEvent<DealRow>) => {
          if (e.data && !e.colDef.editable && e.colDef.colId !== "open") onOpen(e.data);
        }}
        onCellKeyDown={(e: CellKeyDownEvent<DealRow>) => {
          const key = (e.event as KeyboardEvent | null)?.key;
          if (key === "Enter" && e.data && !e.colDef.editable && e.colDef.colId !== "open") onOpen(e.data);
        }}
        stopEditingWhenCellsLoseFocus
        suppressColumnVirtualisation
        animateRows={false}
      />
    </div>
  );
}
