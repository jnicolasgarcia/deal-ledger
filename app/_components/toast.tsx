"use client";

import { useEffect } from "react";

export type ToastMessage = { id: number; kind: "success" | "error" | "info"; text: string };

/**
 * One toast at a time, bottom right. Success and info fade after a few
 * seconds; errors stay until dismissed so they can't be missed.
 */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const isError = toast.kind === "error";
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-[60] flex justify-end">
      <div
        key={toast.id}
        role={isError ? "alert" : "status"}
        className={`pointer-events-auto flex max-w-sm animate-rise-in items-start gap-3 rounded-lg px-4 py-3 text-callout shadow-raised ring-1 ${
          isError ? "bg-danger-soft text-danger ring-danger/20" : "bg-ink text-white ring-black/10"
        }`}
      >
        {isError && (
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
        <p className="min-w-0 flex-1">{toast.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={`-mr-1 shrink-0 rounded-sm px-1 ${isError ? "hover:bg-danger/10" : "hover:bg-white/10"}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
