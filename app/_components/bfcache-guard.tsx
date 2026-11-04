"use client";

import { useEffect } from "react";

/**
 * Browsers can keep a whole page in memory (back/forward cache) and show it
 * again on Back without asking the server, which would show a signed-out
 * user's pages. When this app is restored that way, reload it from the
 * server instead, so proxy.ts decides what to show. The page is hidden as
 * it's left (pagehide), so a restored page never paints old data.
 */
export function BfcacheGuard() {
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) document.documentElement.classList.add("bfcache-hidden");
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  return null;
}
