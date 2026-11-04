import { Suspense } from "react";
import { redirect } from "next/navigation";
import { canUseDeals, requireUser } from "@/lib/auth";

/** Server-side backstop for proxy.ts: viewers never get the deals page. */
async function DealsGate({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!canUseDeals(user.role)) redirect("/weekly");
  return <>{children}</>;
}

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <DealsGate>
        <section>
          <h1 className="text-title-2">Deals</h1>
          <div className="mt-4 rounded-lg bg-surface p-6 text-callout text-ink-secondary shadow-card">
            The deals grid isn&apos;t built yet.
          </div>
        </section>
      </DealsGate>
    </Suspense>
  );
}
