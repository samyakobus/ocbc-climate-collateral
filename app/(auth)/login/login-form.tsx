'use client';

import { useActionState } from 'react';

import { loginAction, type LoginState } from '@/lib/auth/actions';

/** The form owns its initial state: a 'use server' module cannot export one. */
const NO_ERROR: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    NO_ERROR,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="rounded border border-rule-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-rule-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      {state.error ? (
        <p role="alert" data-testid="login-error" className="text-sm font-medium text-accent">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
