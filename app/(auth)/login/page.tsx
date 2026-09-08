import { redirect } from 'next/navigation';

import { getCurrentUser, homeRouteFor } from '@/lib/auth/session';

import { LoginForm } from './login-form';

/**
 * The only entry point into the application (S3, AC-1).
 *
 * There is no sign-up: three users are seeded and `/signup` is not a route, per
 * a binding spec constraint. `tests/e2e/auth.spec.ts` asserts it returns 404.
 */
export const metadata = { title: 'Sign in - OCBC Climate Collateral' };

/** Seeded demo accounts, shown on screen because all three are walked on stage. */
const SEEDED = [
  { email: 'officer@ocbc.demo', role: 'Loan officer' },
  { email: 'corp@ocbc.demo', role: 'Corporate credit officer' },
  { email: 'risk@ocbc.demo', role: 'Risk manager' },
];

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(homeRouteFor(user.role));
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide opacity-60">
          Synthetic portfolio, illustrative figures
        </p>
        <h1 className="text-xl font-semibold">OCBC Climate Risk Platform</h1>
        <p className="text-sm opacity-70">Climate-adjusted collateral decisions.</p>
      </div>

      <LoginForm />

      <div className="rounded border border-black/10 p-3 text-xs opacity-70 dark:border-white/15">
        <p className="mb-1.5 font-medium">Seeded demo accounts</p>
        <ul className="flex flex-col gap-0.5">
          {SEEDED.map((account) => (
            <li key={account.email}>
              <code>{account.email}</code> - {account.role}
            </li>
          ))}
        </ul>
        <p className="mt-1.5">
          Password <code>Demo!2026</code> for all three. No sign-up: these are the only accounts.
        </p>
      </div>
    </main>
  );
}
