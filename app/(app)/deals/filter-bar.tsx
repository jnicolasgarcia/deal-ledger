"use client";

import { Popover } from "@/app/_components/popover";
import { StagePill } from "@/app/_components/stage-pill";
import { STAGES, type Stage } from "@/lib/stages";
import type { DealFilters } from "@/lib/deals";
import type { ColumnOption } from "./deals-grid";

type Props = {
  filters: DealFilters;
  search: string;
  options: { client: string[]; vertical: string[]; market: string[] };
  onChange: (patch: Partial<DealFilters>) => void;
  onSearch: (q: string) => void;
  onToggleStage: (stage: Stage) => void;
  onClear: () => void;
  active: boolean;
  shown: number;
  total: number;
  columns: ColumnOption[];
  visible: Set<string>;
  onToggleColumn: (colId: string) => void;
  onResetColumns: () => void;
};

function Select({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string | null;
  values: string[];
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={`h-8 appearance-none rounded-sm border pr-7 pl-2.5 text-callout outline-none focus:border-accent focus:shadow-focus ${
          value ? "border-accent/40 bg-accent-soft text-accent" : "border-separator bg-surface text-ink"
        }`}
      >
        <option value="">{`All ${label.toLowerCase()}s`}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 opacity-60">
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-callout hover:bg-black/4">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 accent-(--color-accent)" />
      {children}
    </label>
  );
}

export function FilterBar(props: Props) {
  const { filters, options, onChange } = props;
  const groups = ["Default", "More fields", "Attributes"] as const;

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter deals">
      <Select label="Client" value={filters.client} values={options.client} onChange={(v) => onChange({ client: v })} />
      <Select label="Vertical" value={filters.vertical} values={options.vertical} onChange={(v) => onChange({ vertical: v })} />
      <Select label="Market" value={filters.market} values={options.market} onChange={(v) => onChange({ market: v })} />

      <Popover
        active={filters.stages.length > 0}
        ariaLabel={`Stage filter${filters.stages.length ? `, ${filters.stages.length} selected` : ""}`}
        label={filters.stages.length ? `Stage · ${filters.stages.length}` : "All stages"}
      >
        {STAGES.map((s) => (
          <Check key={s} checked={filters.stages.includes(s)} onChange={() => props.onToggleStage(s)}>
            <StagePill stage={s} size="sm" />
          </Check>
        ))}
        {filters.stages.length > 0 && (
          <button
            type="button"
            onClick={() => onChange({ stages: [] })}
            className="mt-1 h-7 w-full rounded-sm text-left text-footnote text-accent hover:bg-accent-soft px-2"
          >
            Any stage
          </button>
        )}
      </Popover>

      <label className="relative">
        <span className="sr-only">Search address, city and notes</span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-tertiary">
          <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="Search address, city, notes"
          maxLength={200}
          className="h-8 w-64 rounded-sm border border-separator bg-surface pr-2.5 pl-8 text-callout outline-none placeholder:text-ink-tertiary focus:border-accent focus:shadow-focus"
        />
      </label>

      {props.active && (
        <button type="button" onClick={props.onClear} className="h-8 rounded-sm px-2.5 text-callout text-accent hover:bg-accent-soft">
          Clear filters
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <p className="text-footnote text-ink-secondary tabular-nums" aria-live="polite">
          Showing {props.shown} of {props.total} deals
        </p>
        <Popover label="Columns" align="right">
          <div className="max-h-[60vh] w-60 overflow-y-auto">
            {groups.map((g) => {
              const cols = props.columns.filter((c) => c.group === g);
              if (!cols.length) return null;
              return (
                <div key={g} className="py-1">
                  <p className="px-2 pt-1 pb-0.5 text-caption font-medium text-ink-secondary">{g}</p>
                  {cols.map((c) => (
                    <Check key={c.colId} checked={props.visible.has(c.colId)} onChange={() => props.onToggleColumn(c.colId)}>
                      {c.label}
                    </Check>
                  ))}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={props.onResetColumns}
            className="mt-1 h-7 w-full rounded-sm border-t border-hairline px-2 text-left text-footnote text-accent hover:bg-accent-soft"
          >
            Reset columns
          </button>
        </Popover>
      </div>
    </div>
  );
}
