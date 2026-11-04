"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto mt-section max-w-md rounded-lg bg-surface p-6 text-center shadow-card">
      <h2 className="text-headline">Something went wrong</h2>
      <p className="mt-1 text-callout text-ink-secondary">This page couldn&apos;t load. Try again.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-accent px-4 py-2 text-callout font-medium text-white hover:bg-accent-hover"
      >
        Try again
      </button>
    </div>
  );
}
