"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { signIn, type SignInState } from "./actions";

const initial: SignInState = { error: null, field: null, email: "" };

const inputBase =
  "h-12 w-full rounded-md border bg-surface px-3.5 text-body outline-none transition-[border-color,box-shadow] placeholder:text-ink-tertiary";
const inputOk = "border-separator focus:border-accent focus:shadow-focus";
const inputBad = "border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgb(196_0_26/0.18)]";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);
  const [showPassword, setShowPassword] = useState(false);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  // Put the cursor where the problem is.
  useEffect(() => {
    if (state.field === "email") email.current?.focus();
    else if (state.field === "password" || state.field === "form") password.current?.select();
  }, [state]);

  const emailBad = state.field === "email";
  const passwordBad = state.field === "password";

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.field === "form" && state.error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md bg-danger-soft px-3.5 py-3 text-callout text-danger">
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <p>{state.error}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-callout font-medium text-ink">
          Email
        </label>
        <input
          ref={email}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@company.com"
          defaultValue={state.email}
          aria-invalid={emailBad || undefined}
          aria-describedby={emailBad ? "email-error" : undefined}
          className={`${inputBase} ${emailBad ? inputBad : inputOk}`}
        />
        {emailBad && (
          <p id="email-error" role="alert" className="text-footnote text-danger">
            {state.error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-callout font-medium text-ink">
          Password
        </label>
        <div className="relative">
          <input
            ref={password}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            aria-invalid={passwordBad || state.field === "form" || undefined}
            aria-describedby={passwordBad ? "password-error" : undefined}
            className={`${inputBase} pr-16 ${passwordBad ? inputBad : inputOk}`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute top-1/2 right-2 h-8 -translate-y-1/2 rounded-sm px-2 text-footnote font-medium text-accent hover:bg-accent-soft"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {passwordBad && (
          <p id="password-error" role="alert" className="text-footnote text-danger">
            {state.error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="mt-1 flex h-12 items-center justify-center gap-2 rounded-md bg-accent text-headline text-white transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-progress disabled:opacity-70"
      >
        {pending && (
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" className="animate-spin">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
