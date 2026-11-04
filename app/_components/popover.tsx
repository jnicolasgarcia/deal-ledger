"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  /** Button content */
  label: React.ReactNode;
  /** Accessible name for the button when the label isn't enough */
  ariaLabel?: string;
  active?: boolean;
  align?: "left" | "right";
  children: React.ReactNode;
};

/** Compact button + dropdown panel. Closes on outside click and Escape. */
export function Popover({ label, ariaLabel, active = false, align = "left", children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-callout transition-colors ${
          active
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-separator bg-surface text-ink hover:border-ink-tertiary"
        }`}
      >
        {label}
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="opacity-60">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          className={`absolute top-full z-50 mt-1 min-w-52 animate-fade-in rounded-md bg-surface p-1 shadow-raised ring-1 ring-black/5 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
