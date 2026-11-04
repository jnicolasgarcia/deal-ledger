import { LoginForm } from "./login-form";

// Bare for now; polished in step 6.
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-gutter py-section">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-raised">
        <h1 className="text-title-2">Deal Ledger</h1>
        <p className="mt-1 mb-6 text-callout text-ink-secondary">Sign in to continue.</p>
        <LoginForm />
      </div>
    </main>
  );
}
