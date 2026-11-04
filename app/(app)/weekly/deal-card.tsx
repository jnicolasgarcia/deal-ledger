import { StagePill } from "@/app/_components/stage-pill";
import { Assumption, NotAvailable } from "@/app/_components/value-marks";
import { formatNumber, type NumberKind } from "@/lib/deals";
import { stageMeta } from "@/lib/stages";
import { hasNoFigures, locationOf, type WeeklyRow } from "@/lib/weekly";

type NumberField = "list_price" | "bldg_sf" | "list_price_per_sf" | "lot_sf";
const NUMBERS: { field: NumberField; kind: NumberKind; before?: string; after?: string; missing: string }[] = [
  { field: "list_price", kind: "money", missing: "$" },
  { field: "bldg_sf", kind: "area", after: " SF", missing: "SF" },
  { field: "list_price_per_sf", kind: "money_per_unit", after: "/SF", missing: "$/SF" },
  { field: "lot_sf", kind: "area", before: "Lot ", after: " SF", missing: "Lot" },
];

/** $, SF, $/SF and lot size on one line. "est." on assumptions, muted n/a when missing. */
export function DealNumbers({ deal }: { deal: WeeklyRow }) {
  if (hasNoFigures(deal)) {
    return <p className="text-body text-ink-tertiary print:text-[12px] print:leading-4">No figures yet</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body tabular-nums print:text-[12px] print:leading-4">
      {NUMBERS.map((n, i) => {
        const v = deal[n.field];
        const text = v === null ? null : `${n.before ?? ""}${formatNumber(v, n.kind)}${n.after ?? ""}`;
        return (
          <span key={n.field} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-separator">·</span>}
            {text === null ? (
              <span className="text-ink-tertiary">
                {n.missing} <NotAvailable />
              </span>
            ) : deal.assumption_fields.includes(n.field) ? (
              <Assumption inline size="md">{text}</Assumption>
            ) : (
              <span>{text}</span>
            )}
          </span>
        );
      })}
    </p>
  );
}

const isAssumed = (deal: WeeklyRow, ...fields: string[]) => fields.some((f) => deal.assumption_fields.includes(f));

/**
 * A deal's title: its address, or "San Diego, CA (no address)" when only
 * the city is known, or "No address" when neither is.
 */
export function DealAddress({ deal, className = "" }: { deal: WeeklyRow; className?: string }) {
  if (deal.address) {
    return isAssumed(deal, "address") ? (
      <Assumption inline size="md">{deal.address}</Assumption>
    ) : (
      <span className={className}>{deal.address}</span>
    );
  }
  const location = deal.city ? locationOf(deal) : null;
  if (!location) return <span className={`text-ink-tertiary ${className}`}>No address</span>;
  return (
    <span className={className}>
      {isAssumed(deal, "city", "state") ? <Assumption inline size="md">{location}</Assumption> : location}
      <span className="font-normal text-ink-tertiary"> (no address)</span>
    </span>
  );
}

/** "City, ST" under the address. Nothing when there's no address (the city is the title then). */
function DealLocation({ deal }: { deal: WeeklyRow }) {
  const location = locationOf(deal);
  if (!deal.address || !location) return null;
  return (
    <p className="text-body text-ink-secondary print:text-[12px] print:leading-4">
      {isAssumed(deal, "city", "state") ? <Assumption inline size="md">{location}</Assumption> : location}
    </p>
  );
}

/** "Moved in the last 7 days: was X", or days in stage (n/a when there's no stage history). */
export function StageStatus({ deal }: { deal: WeeklyRow }) {
  if (deal.previous_stage) {
    return (
      <p className="inline-flex items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1 text-body font-medium text-accent">
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
          <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Moved in the last 7 days: was {stageMeta(deal.previous_stage).label}
      </p>
    );
  }
  return (
    <p className="text-body text-ink-secondary">
      Days in stage:{" "}
      {deal.days_in_stage === null ? (
        <NotAvailable />
      ) : (
        <span className="text-ink tabular-nums">{deal.days_in_stage}</span>
      )}
    </p>
  );
}

export function DealCard({ deal, showMarket }: { deal: WeeklyRow; showMarket: boolean }) {
  return (
    <article className="flex break-inside-avoid flex-col gap-3 rounded-xl bg-surface p-5 shadow-card print:gap-0.5 print:rounded-md print:px-3 print:py-1.5 print:shadow-none print:ring-1 print:ring-black/10">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title-3 break-words print:text-[14px]">
            <DealAddress deal={deal} />
            {showMarket && deal.market && <span className="ml-2 text-body font-normal text-ink-secondary">{deal.market}</span>}
          </h3>
          <DealLocation deal={deal} />
        </div>
        <StagePill stage={deal.stage} />
      </header>
      <DealNumbers deal={deal} />
      <p className="text-body break-words whitespace-pre-wrap text-ink print:text-[12px] print:leading-4">
        {deal.notes ?? <NotAvailable />}
      </p>
      <footer className="mt-auto pt-1 print:pt-0 print:[&_p]:py-0 print:[&_p]:text-[12px]">
        <StageStatus deal={deal} />
      </footer>
    </article>
  );
}
