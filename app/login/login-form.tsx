"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const initial: SignInState = { error: null, email: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1.5">
        <span className="text-footnote font-medium text-ink-secondary">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className="h-11 rounded-md border border-separator bg-surface px-3 text-body outline-none transition-shadow focus:border-accent focus:shadow-focus"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-footnote font-medium text-ink-secondary">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 rounded-md border border-separator bg-surface px-3 text-body outline-none transition-shadow focus:border-accent focus:shadow-focus"
        />
      </label>
      <p role="alert" aria-live="polite" className="min-h-5 text-footnote text-danger">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-accent text-headline text-white transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
