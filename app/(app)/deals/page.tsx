import { Suspense } from "react";
import { canUseDeals, requireUser } from "@/lib/auth";
import { NoAccessPanel } from "@/app/_components/no-access-panel";
import { loadDeals } from "@/lib/deals-server";
import { DealsView } from "./deals-view";

/** Reads deals as the signed-in user (RLS: editors and admins only). */
async function DealsData() {
  const user = await requireUser();
  if (!canUseDeals(user.role)) return <NoAccessPanel user={user} area="Deals" allowed="editors and admins" />;

  const result = await loadDeals();
  if ("error" in result) {
    return (
      <div role="alert" className="rounded-lg bg-surface p-6 shadow-card">
        <p className="text-headline">Couldn&apos;t load deals</p>
        <p className="mt-1 text-callout text-ink-secondary">Refresh the page to try again.</p>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-title-2">Deals</h1>
      <DealsView rows={result.rows} canEdit={canUseDeals(user.role)} />
    </>
  );
}

function DealsSkeleton() {
  return (
    <div aria-label="Loading deals" className="flex flex-col gap-3">
      <div className="flex gap-2">
        {[120, 120, 110, 100, 220].map((w, i) => (
          <span key={i} className="h-8 animate-pulse rounded-sm bg-black/5" style={{ width: w }} />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex h-row items-center gap-4 border-b border-hairline px-3">
            <span className="h-3 w-24 animate-pulse rounded-sm bg-black/5" />
            <span className="h-3 w-40 animate-pulse rounded-sm bg-black/5" />
            <span className="h-3 w-20 animate-pulse rounded-sm bg-black/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DealsPage() {
  return (
    <section className="flex flex-col gap-3">
      <Suspense fallback={<DealsSkeleton />}>
        <DealsData />
      </Suspense>
    </section>
  );
}
