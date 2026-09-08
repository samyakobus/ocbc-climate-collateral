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
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="rounded border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/20"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/20"
        />
      </label>

      {state.error ? (
        <p role="alert" data-testid="login-error" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
