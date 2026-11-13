"use client";

import { useEffect, useRef } from "react";
import { recordPageView } from "@/app/(app)/activity-actions";
import type { LoggedPage } from "@/lib/activity";

/**
 * Logs a page view once per mount. Query string changes on the same page
 * (deal filters, weekly slides) keep this mounted, so they don't log again.
 */
export function PageViewLogger({ page }: { page: LoggedPage }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    recordPageView(page).catch(() => {});
  }, [page]);
  return null;
}
