import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-gutter py-section">
      {/* Soft wash of the accent behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgb(0_113_227/0.10),transparent_70%)]"
      />
      <div className="relative w-full max-w-[25rem] animate-rise-in">
        <div className="flex flex-col items-center text-center">
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-[1.1rem] bg-gradient-to-b from-[#2b8cf0] to-accent text-white shadow-raised"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
          </span>
          <h1 className="mt-6 text-large-title">Deal Ledger</h1>
          <p className="mt-2 text-body text-ink-secondary">Sign in to the acquisitions pipeline.</p>
        </div>

        <div className="mt-8 rounded-2xl bg-surface p-8 shadow-raised ring-1 ring-black/5">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-callout text-ink-secondary">
          Access is by invitation. Ask an admin to add you.
        </p>
      </div>
    </main>
  );
}
