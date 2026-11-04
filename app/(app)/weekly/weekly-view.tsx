"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WeeklyModel } from "@/lib/weekly";
import { Overview, VerticalScreen } from "./screens";

const OVERVIEW = "overview";
const ALL = "all";

/**
 * Presenter mode: one screen at a time (?v=overview | <vertical> | all),
 * Previous / Next and arrow keys. Every screen is in the page; printing
 * shows all of them, one vertical per page.
 */
export function WeeklyView({ model }: { model: WeeklyModel }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sequence = [OVERVIEW, ...model.verticals.map((v) => v.slug)];
  const requested = params.get("v") ?? OVERVIEW;
  const current = requested === ALL || sequence.includes(requested) ? requested : OVERVIEW;
  const index = sequence.indexOf(current);
  const prev = index > 0 ? sequence[index - 1] : null;
  const next = index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null;
  const nameOf = (key: string) => (key === OVERVIEW ? "Overview" : model.verticals.find((v) => v.slug === key)?.name ?? key);
  const href = useCallback((key: string) => (key === OVERVIEW ? pathname : `${pathname}?v=${key}`), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))) return;
      const target = e.key === "ArrowRight" ? next : e.key === "ArrowLeft" ? prev : null;
      if (!target) return;
      e.preventDefault();
      router.push(href(target));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, router, href]);

  const visible = (key: string) => (current === ALL || current === key ? "flex" : "hidden print:flex");
  const tab = (key: string, label: string) => (
    <Link
      key={key}
      href={href(key)}
      aria-current={current === key ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-[15px] whitespace-nowrap transition-colors ${
        current === key ? "bg-surface font-medium text-ink shadow-hairline" : "text-ink-secondary hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
  const step = (key: string | null, dir: "prev" | "next") =>
    key ? (
      <Link
        href={href(key)}
        aria-label={`${dir === "prev" ? "Previous" : "Next"}: ${nameOf(key)}`}
        className="flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[15px] font-medium text-ink shadow-card transition-shadow hover:shadow-raised"
      >
        {dir === "prev" && <span aria-hidden>←</span>}
        {nameOf(key)}
        {dir === "next" && <span aria-hidden>→</span>}
      </Link>
    ) : (
      <span className="h-10 w-px" />
    );

  return (
    <div className="flex flex-col gap-8 print:gap-0 print:px-2">
      <nav aria-label="Weekly review" className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex flex-wrap gap-1 rounded-lg bg-black/4 p-1">
          {tab(OVERVIEW, "Overview")}
          {model.verticals.map((v) => tab(v.slug, v.name))}
          {tab(ALL, "Show all")}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {current === ALL ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="flex h-10 items-center rounded-full bg-accent px-4 text-[15px] font-medium text-white hover:bg-accent-hover"
            >
              Print
            </button>
          ) : (
            <>
              {step(prev, "prev")}
              {step(next, "next")}
            </>
          )}
        </div>
      </nav>

      <div className={`${visible(OVERVIEW)} flex-col animate-fade-in`} key={`o-${current}`}>
        <Overview model={model} />
      </div>
      {model.verticals.map((v) => (
        <div
          key={`${v.slug}-${current}`}
          className={`${visible(v.slug)} flex-col animate-fade-in print:break-before-page ${current === ALL ? "border-t border-hairline pt-8 print:border-0 print:pt-0" : ""}`}
        >
          <VerticalScreen vertical={v} model={model} />
        </div>
      ))}
      {current !== ALL && (
        <p className="text-[15px] text-ink-tertiary print:hidden">Use ← and → to move between screens.</p>
      )}
    </div>
  );
}
