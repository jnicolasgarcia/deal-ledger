// TEMPORARY: design token preview. Delete before deploying.
import { StagePill } from "@/app/_components/stage-pill";
import { FUNNEL, STAGES, stageMeta } from "@/lib/stages";

const TYPE_SCALE = [
  ["text-display", "Display 56", "Weekly review"],
  ["text-large-title", "Large title 40", "Weekly review"],
  ["text-title-1", "Title 1 32", "Acquisitions pipeline"],
  ["text-title-2", "Title 2 24", "Food · NYC"],
  ["text-title-3", "Title 3 20", "7500 NW 25th St"],
  ["text-headline", "Headline 17", "Negotiating PSA, 60 day DD"],
  ["text-body", "Body 17", "Full cooler, 60 day dd, 30 day close."],
  ["text-callout", "Callout 14 (dense default)", "List price $11,000,000 · 42,000 SF"],
  ["text-footnote", "Footnote 13", "Updated 2 days ago by Demo Editor"],
  ["text-caption", "Caption 12", "est. · n/a · source row 4"],
] as const;

const COLORS = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["surface-muted", "bg-surface-muted"],
  ["ink", "bg-ink"],
  ["ink-secondary", "bg-ink-secondary"],
  ["ink-tertiary", "bg-ink-tertiary"],
  ["separator", "bg-separator"],
  ["accent", "bg-accent"],
  ["accent-soft", "bg-accent-soft"],
  ["danger", "bg-danger"],
  ["warning", "bg-warning"],
  ["warning-soft", "bg-warning-soft"],
] as const;

const RADII = ["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl"] as const;
const SHADOWS = ["shadow-hairline", "shadow-card", "shadow-raised", "shadow-focus"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-surface p-6 shadow-card">
      <h2 className="mb-4 text-title-3">{title}</h2>
      {children}
    </section>
  );
}

export default function TokensPage() {
  return (
    <div className="flex flex-col gap-6 pb-section">
      <header>
        <p className="text-footnote font-medium text-warning">Temporary page. Delete before deploying.</p>
        <h1 className="text-title-1">Design tokens</h1>
      </header>

      <Section title="Type scale">
        <div className="flex flex-col gap-3">
          {TYPE_SCALE.map(([cls, name, sample]) => (
            <div key={cls} className="grid grid-cols-[220px_1fr] items-baseline gap-4">
              <code className="font-mono text-caption text-ink-secondary">
                {cls} <span className="text-ink-tertiary">· {name}</span>
              </code>
              <span className={cls}>{sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Color">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {COLORS.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-14 rounded-md shadow-hairline ${cls}`} />
              <code className="font-mono text-caption text-ink-secondary">{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Stages">
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-footnote text-ink-secondary">Funnel, in order (md)</p>
            <div className="flex flex-wrap gap-2">
              {FUNNEL.map((s) => <StagePill key={s} stage={s} />)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-footnote text-ink-secondary">Outside the funnel (md)</p>
            <div className="flex flex-wrap gap-2">
              <StagePill stage="on_hold" />
              <StagePill stage="unknown" />
              <StagePill stage={null} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-footnote text-ink-secondary">Dense grid size (sm)</p>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => <StagePill key={s} stage={s} size="sm" />)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-footnote text-ink-secondary">Dot colors (for charts)</p>
            <div className="flex flex-wrap gap-4">
              {STAGES.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-footnote text-ink-secondary">
                  <span className="size-3 rounded-full" style={{ backgroundColor: stageMeta(s).dot }} />
                  {stageMeta(s).label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Radii">
          <div className="flex flex-wrap gap-4">
            {RADII.map((r) => (
              <div key={r} className="flex flex-col items-center gap-1.5">
                <div className={`size-16 bg-accent-soft shadow-hairline ${r}`} />
                <code className="font-mono text-caption text-ink-secondary">{r}</code>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Shadows">
          <div className="flex flex-wrap gap-6 bg-canvas p-4">
            {SHADOWS.map((s) => (
              <div key={s} className="flex flex-col items-center gap-2">
                <div className={`size-16 rounded-lg bg-surface ${s}`} />
                <code className="font-mono text-caption text-ink-secondary">{s}</code>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Dense row (36px max) and controls">
        <div className="overflow-hidden rounded-lg shadow-hairline">
          {[["7500 NW 25th St", "negotiating_psa", "$11,000,000"], ["2426 Amsler St", "negotiating_loi", "$3,000,000"], ["n/a", null, "n/a"]].map(
            ([addr, stage, price], i) => (
              <div
                key={i}
                className="flex h-row items-center gap-4 border-b border-hairline px-3 text-callout last:border-b-0 odd:bg-surface even:bg-surface-muted"
              >
                <span className={`w-56 ${addr === "n/a" ? "text-ink-tertiary" : ""}`}>{addr}</span>
                <StagePill stage={stage} size="sm" />
                <span className={`ml-auto tabular-nums ${price === "n/a" ? "text-ink-tertiary" : ""}`}>{price}</span>
                <span className="w-16 text-caption italic text-warning">{i === 1 ? "est." : ""}</span>
              </div>
            ),
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="h-9 rounded-md bg-accent px-4 text-callout font-medium text-white hover:bg-accent-hover">
            Primary
          </button>
          <button className="h-9 rounded-md px-4 text-callout text-accent hover:bg-accent-soft">Secondary</button>
          <input
            placeholder="Filter"
            className="h-8 w-48 rounded-sm border border-separator bg-surface px-2.5 text-callout outline-none placeholder:text-ink-tertiary focus:border-accent focus:shadow-focus"
          />
        </div>
      </Section>
    </div>
  );
}
