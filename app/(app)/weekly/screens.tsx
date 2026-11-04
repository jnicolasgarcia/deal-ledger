import Link from "next/link";
import { StagePill } from "@/app/_components/stage-pill";
import { stageMeta } from "@/lib/stages";
import {
  formatDateTime,
  formatLongDate,
  plural,
  summarySentence,
  type WeeklyModel,
  type WeeklyVertical,
} from "@/lib/weekly";
import { DealAddress, DealCard } from "./deal-card";

/** "Weekly pipeline review · Week of …": on every vertical screen and printed page. */
export function Eyebrow({ model }: { model: WeeklyModel }) {
  return (
    <p className="text-body font-medium text-ink-secondary print:text-[12px]">
      Weekly pipeline review · Week of {formatLongDate(model.weekOf)}
    </p>
  );
}

function StageBar({ vertical }: { vertical: WeeklyVertical }) {
  const label = vertical.stageCounts.map((c) => `${c.count} ${stageMeta(c.stage).label}`).join(", ");
  return (
    <div>
      <div role="img" aria-label={`Stages: ${label}`} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {vertical.stageCounts.map((c) => (
          <span key={c.stage} className="h-full" style={{ flexGrow: c.count, backgroundColor: stageMeta(c.stage).dot }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[15px] text-ink-secondary">
        {vertical.stageCounts.map((c) => (
          <li key={c.stage} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: stageMeta(c.stage).dot }} />
            <span className="tabular-nums text-ink">{c.count}</span> {stageMeta(c.stage).label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-large-title tabular-nums print:text-[28px] print:leading-8">{value}</p>
      <p className="text-body text-ink-secondary print:text-[12px]">{label}</p>
    </div>
  );
}

export function Overview({ model }: { model: WeeklyModel }) {
  const s = model.summary;
  return (
    <section aria-labelledby="weekly-title" className="flex flex-col gap-6 print:gap-4">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="flex flex-col gap-1">
            <p className="text-body font-medium text-ink-secondary print:text-[12px]">Week of {formatLongDate(model.weekOf)}</p>
            <h1 id="weekly-title" className="text-display print:text-[32px] print:leading-9">Weekly pipeline review</h1>
            {model.lastUpdated && (
              <p className="text-body text-ink-secondary print:text-[12px]">Last updated {formatDateTime(model.lastUpdated)}</p>
            )}
          </div>
          <div className="flex gap-x-10 pb-1">
            <Stat value={s.active} label="Active deals" />
            <Stat value={s.moved} label="Moved in the last 7 days" />
            <Stat value={s.inContract} label="In contract" />
          </div>
        </div>
        <p className="max-w-5xl text-title-3 font-normal text-ink print:text-[14px] print:leading-5">{summarySentence(model)}</p>
      </header>

      <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
        {model.verticals.map((v) => (
          <li key={v.slug}>
            <Link
              href={`?v=${v.slug}`}
              scroll
              aria-label={`Review ${v.name}`}
              className="group flex h-full flex-col gap-3.5 rounded-2xl bg-surface p-5 shadow-card transition-shadow hover:shadow-raised print:rounded-lg print:p-4 print:shadow-none print:ring-1 print:ring-black/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-title-2 print:text-[18px]">
                    {v.name}
                    <span aria-hidden className="text-ink-tertiary transition-transform group-hover:translate-x-0.5 print:hidden">›</span>
                  </h2>
                  <p className="text-body text-ink-secondary print:text-[12px]">{v.markets.join(", ") || "No market"}</p>
                </div>
                <div className="text-right">
                  <p className="text-large-title tabular-nums print:text-[28px] print:leading-8">{v.total}</p>
                  <p className="text-[15px] text-ink-secondary">{v.total === 1 ? "deal" : "deals"}</p>
                </div>
              </div>
              <StageBar vertical={v} />
              <div className="mt-auto border-t border-hairline pt-3">
                <p className="text-[15px] font-medium text-ink-secondary">Moved in the last 7 days</p>
                {v.moved.length === 0 ? (
                  <p className="text-body text-ink-tertiary">Nothing moved</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {v.moved.map((d) => (
                      <li key={d.id} className="text-body">
                        <DealAddress deal={d} className="font-medium" />
                        <span className="text-ink-secondary">
                          {": "}
                          {stageMeta(d.previous_stage).label} → {stageMeta(d.stage).label}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VerticalScreen({ vertical: v, model }: { vertical: WeeklyVertical; model: WeeklyModel }) {
  const multiMarket = v.markets.length > 1;
  return (
    <section aria-labelledby={`v-${v.slug}`} className="flex flex-col gap-6 print:gap-2">
      <header className="flex flex-col gap-3 print:gap-1.5">
        <Eyebrow model={model} />
        <h2 id={`v-${v.slug}`} className="text-large-title print:text-[26px] print:leading-8">
          {v.name}
          <span className="text-ink-secondary"> · {v.markets.join(", ") || "No market"}</span>
          <span className="text-ink-tertiary"> · {plural(v.total, "deal")}</span>
        </h2>
        <ul className="flex flex-wrap gap-2" aria-label="Deals per stage">
          {v.stageCounts.map((c) => (
            <li key={c.stage} className="flex items-center gap-1.5">
              <StagePill stage={c.stage} />
              <span className="text-body tabular-nums text-ink-secondary">{c.count}</span>
            </li>
          ))}
        </ul>
      </header>

      {v.cards.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2 print:gap-1.5">
          {v.cards.map((d) => <DealCard key={d.id} deal={d} showMarket={multiMarket} />)}
        </div>
      )}

      {v.parked.length > 0 && (
        <div className="break-inside-avoid rounded-xl bg-surface-muted px-5 py-4 ring-1 ring-black/5 print:px-3 print:py-1.5">
          <h3 className="text-headline text-ink-secondary print:text-[13px]">Closed and on hold</h3>
          <ul className="mt-2 flex flex-col gap-2 print:mt-1 print:gap-1">
            {v.parked.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body print:text-[12px]">
                <StagePill stage={d.stage} size="sm" />
                <DealAddress deal={d} className="font-medium" />
                <span className="min-w-0 flex-1 truncate text-ink-secondary print:whitespace-normal">{d.notes ?? "n/a"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
