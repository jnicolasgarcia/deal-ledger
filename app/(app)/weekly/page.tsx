import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NO_ACCESS_PATH, requireUser } from "@/lib/auth";
import { loadWeekly } from "@/lib/weekly-server";
import { PageViewLogger } from "@/app/_components/page-view-logger";
import { WeeklyView } from "./weekly-view";

async function WeeklyData() {
  const user = await requireUser();
  if (!user.role) redirect(NO_ACCESS_PATH); // backstop for proxy.ts
  const result = await loadWeekly();
  if ("error" in result) {
    return (
      <div role="alert" className="mx-auto mt-section max-w-xl rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="text-title-3">Couldn&apos;t load the weekly review</p>
        <p className="mt-2 text-body text-ink-secondary">Refresh the page to try again.</p>
      </div>
    );
  }
  if (result.model.summary.total === 0) {
    return (
      <div className="mx-auto mt-section max-w-xl rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="text-title-3">No deals to review yet</p>
        <p className="mt-2 text-body text-ink-secondary">Deals appear here once the spreadsheet is imported.</p>
      </div>
    );
  }
  return <WeeklyView model={result.model} />;
}

function WeeklySkeleton() {
  return (
    <div aria-label="Loading the weekly review" className="flex flex-col gap-6 pt-4">
      <span className="h-4 w-48 animate-pulse rounded-sm bg-black/5" />
      <span className="h-12 w-[28rem] max-w-full animate-pulse rounded-md bg-black/5" />
      <span className="h-5 w-[40rem] max-w-full animate-pulse rounded-sm bg-black/5" />
      <div className="grid gap-5 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <span key={i} className="h-56 animate-pulse rounded-2xl bg-black/5" />)}
      </div>
    </div>
  );
}

/** Weekly review for every role, from get_weekly_review() only. */
export default function WeeklyPage() {
  return (
    <div className="py-2 print:py-0">
      <PageViewLogger page="weekly" />
      <Suspense fallback={<WeeklySkeleton />}>
        <WeeklyData />
      </Suspense>
    </div>
  );
}
