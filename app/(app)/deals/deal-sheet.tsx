"use client";

import { useEffect, useRef, useState } from "react";
import { StagePill } from "@/app/_components/stage-pill";
import {
  formatAttribute,
  formatHistoryValue,
  historyFieldLabel,
  isAttributeAssumption,
  type DealRow,
  type HistoryEntry,
} from "@/lib/deals";
import { getDealHistory } from "./actions";
import { Assumption, NotAvailable, dateTimeFormat } from "./cells";

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-3 border-b border-hairline py-2 last:border-b-0">
      <dt className="text-footnote text-ink-secondary">{label}</dt>
      <dd className={`min-w-0 text-callout break-words ${mono ? "font-mono text-footnote" : ""}`}>{children}</dd>
    </div>
  );
}

type HistoryState = { key: string; entries: HistoryEntry[] } | { key: string; error: string };

/** deal_events for this deal, newest first. Reloads when the deal changes. */
function History({ deal }: { deal: DealRow }) {
  const key = `${deal.id}@${deal.updated_at}`;
  const [state, setState] = useState<HistoryState | null>(null);

  useEffect(() => {
    let live = true;
    getDealHistory(deal.id).then((r) => {
      if (!live) return;
      setState(r.ok ? { key, entries: r.entries } : { key, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [deal.id, key]);

  if (!state || state.key !== key) {
    return (
      <div aria-label="Loading history" className="flex flex-col gap-2 py-2">
        {[0, 1].map((i) => <span key={i} className="h-4 w-3/4 animate-pulse rounded-sm bg-black/5" />)}
      </div>
    );
  }
  if ("error" in state) return <p role="alert" className="py-2 text-callout text-danger">{state.error}</p>;
  if (!state.entries.length) return <p className="py-2 text-callout text-ink-tertiary">No changes since import.</p>;

  return (
    <ol className="flex flex-col">
      {state.entries.map((e) => {
        const from = formatHistoryValue(e.field, e.old_value);
        const to = formatHistoryValue(e.field, e.new_value);
        return (
          <li key={e.id} className="border-b border-hairline py-2.5 last:border-b-0">
            <p className="text-footnote text-ink-secondary">
              <span className="font-medium text-ink">{e.changed_by_label}</span>
              {" · "}
              <time dateTime={e.changed_at}>{dateTimeFormat.format(new Date(e.changed_at))}</time>
            </p>
            <p className="mt-0.5 text-callout break-words">
              <span className="font-medium">{historyFieldLabel(e.field)}</span>
              {": "}
              <span className="text-ink-secondary line-through decoration-ink-tertiary/60">{from ?? "n/a"}</span>
              {" → "}
              <span>{to ?? <span className="text-ink-tertiary">n/a</span>}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Right-hand sheet with the deal's raw and source detail. Escape or the backdrop closes it. */
export function DealSheet({ deal, onClose }: { deal: DealRow | null; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!deal) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [deal, onClose]);

  if (!deal) return null;
  const attributes = Object.keys(deal.attributes).sort((a, b) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/15" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="deal-sheet-title"
        className="absolute top-0 right-0 flex h-full w-full max-w-md animate-sheet-in flex-col bg-surface shadow-raised"
      >
        <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="deal-sheet-title" className="text-title-3 break-words">
              {deal.address ?? <span className="text-ink-tertiary">No address</span>}
            </h2>
            <p className="mt-0.5 text-footnote text-ink-secondary">
              {[deal.client, deal.vertical, deal.market].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2">
              <StagePill stage={deal.stage} />
            </div>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-black/5"
          >
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-1 text-caption font-semibold tracking-wide text-ink-secondary uppercase">Source</h3>
            <dl>
              <Row label="Status (raw)">{deal.stage_raw ?? <NotAvailable />}</Row>
              <Row label="Notes (raw)">
                {deal.notes_raw ? <span className="whitespace-pre-wrap">{deal.notes_raw}</span> : <NotAvailable />}
              </Row>
              <Row label="Source tab" mono>{deal.source_tab}</Row>
              <Row label="Source row" mono>{deal.source_row}</Row>
              <Row label="Last updated">
                {dateTimeFormat.format(new Date(deal.updated_at))}
                <span className="text-ink-secondary"> · {deal.updated_by_label}</span>
              </Row>
            </dl>
          </section>

          <section className="mt-6">
            <h3 className="mb-1 text-caption font-semibold tracking-wide text-ink-secondary uppercase">History</h3>
            <History deal={deal} />
          </section>

          <section className="mt-6">
            <h3 className="mb-1 text-caption font-semibold tracking-wide text-ink-secondary uppercase">
              Attributes
            </h3>
            {attributes.length === 0 ? (
              <p className="py-2 text-callout text-ink-tertiary">No other fields for this deal.</p>
            ) : (
              <dl>
                {attributes.map((key) => {
                  const text = formatAttribute(deal.attributes[key]);
                  return (
                    <Row key={key} label={key}>
                      {text === null ? (
                        <NotAvailable />
                      ) : isAttributeAssumption(deal, key) ? (
                        <Assumption>{text}</Assumption>
                      ) : (
                        text
                      )}
                    </Row>
                  );
                })}
              </dl>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
