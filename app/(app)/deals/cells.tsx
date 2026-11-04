"use client";

import type { CustomCellRendererProps } from "ag-grid-react";
import { StagePill } from "@/app/_components/stage-pill";
import { Assumption, NotAvailable } from "@/app/_components/value-marks";

export { Assumption, NotAvailable };
import {
  formatAttribute,
  formatNumber,
  isAttributeAssumption,
  isFieldAssumption,
  type DealRow,
  type NumberKind,
} from "@/lib/deals";

export const NO_STAGE_HISTORY_TOOLTIP = "No stage history before import";

export type CellParams =
  | { kind: "text"; field: keyof DealRow }
  | { kind: "number"; field: keyof DealRow; numberKind: NumberKind }
  | { kind: "stage" }
  | { kind: "days" }
  | { kind: "date"; field: keyof DealRow }
  | { kind: "updated" }
  | { kind: "attribute"; attrKey: string };

export const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
export const dateTimeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export function DealCell(props: CustomCellRendererProps<DealRow> & { cell: CellParams }) {
  const row = props.data;
  const { cell } = props;
  if (!row) return null;

  switch (cell.kind) {
    case "stage": {
      const pill = <StagePill stage={row.stage} size="sm" />;
      return isFieldAssumption(row, "stage") ? <Assumption>{pill}</Assumption> : pill;
    }
    case "days": {
      if (row.days_in_stage === null) return <NotAvailable title={NO_STAGE_HISTORY_TOOLTIP} />;
      const n = row.days_in_stage;
      return <span className="block text-right tabular-nums">{n === 1 ? "1 day" : `${n} days`}</span>;
    }
    case "date": {
      const iso = row[cell.field] as string | null;
      if (!iso) return <NotAvailable />;
      const d = new Date(iso);
      return <span title={dateTimeFormat.format(d)}>{dateFormat.format(d)}</span>;
    }
    case "updated": {
      const d = new Date(row.updated_at);
      return (
        <span className="block truncate" title={`${dateTimeFormat.format(d)} · ${row.updated_by_label}`}>
          {dateFormat.format(d)}
          <span className="text-ink-secondary"> · {row.updated_by_label}</span>
        </span>
      );
    }
    case "number": {
      const v = row[cell.field] as number | null;
      if (v === null || v === undefined) {
        // Raw text kept in attributes when the source value wasn't a clean number.
        return <span className="block text-right"><NotAvailable /></span>;
      }
      const text = formatNumber(v, cell.numberKind);
      return isFieldAssumption(row, cell.field) ? (
        <Assumption align="right">{text}</Assumption>
      ) : (
        <span className="block text-right tabular-nums">{text}</span>
      );
    }
    case "attribute": {
      const text = formatAttribute(row.attributes[cell.attrKey] ?? null);
      if (text === null) return <NotAvailable />;
      return isAttributeAssumption(row, cell.attrKey) ? (
        <Assumption>{text}</Assumption>
      ) : (
        <span className="block truncate" title={text}>{text}</span>
      );
    }
    case "text": {
      const v = row[cell.field];
      if (v === null || v === undefined || v === "") return <NotAvailable />;
      const text = String(v);
      return isFieldAssumption(row, cell.field) ? (
        <Assumption>{text}</Assumption>
      ) : (
        <span className="block truncate" title={text}>{text}</span>
      );
    }
  }
}

/** Details button in the pinned first column. Opens the side sheet. */
export function OpenDetailsCell(props: CustomCellRendererProps<DealRow> & { onOpen: (row: DealRow) => void }) {
  const row = props.data;
  if (!row) return null;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(row)}
      aria-label={`Open details for ${row.address ?? `${row.client}, row ${row.source_row}`}`}
      title="Open details"
      className="flex size-6 items-center justify-center rounded-sm text-ink-secondary hover:bg-black/5 hover:text-ink"
    >
      <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
        <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
