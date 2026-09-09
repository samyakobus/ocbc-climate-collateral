import { redirect } from 'next/navigation';

import { IllustrativeRibbon } from '@/components/IllustrativeRibbon';
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
    <div className="flex min-h-full flex-1 flex-col">
      {/* The ribbon is on the sign-in screen too: see IllustrativeRibbon. */}
      <IllustrativeRibbon />

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-accent">
            <span aria-hidden className="inline-block h-3 w-1 rounded-sm bg-accent" />
            OCBC
          </p>
          <h1 className="text-xl font-semibold">Climate Risk Platform</h1>
          <p className="text-sm text-muted">Climate-adjusted collateral decisions.</p>
        </div>

        <LoginForm />

        <div className="panel p-3 text-xs text-muted">
          <p className="mb-1.5 font-medium text-foreground">Seeded demo accounts</p>
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
    </div>
  );
}
