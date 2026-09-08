'use server';

/**
 * Login and logout server actions (S3, AC-1).
 *
 * Separate from `lib/auth/session.ts` because a `'use server'` module may export
 * nothing but async functions, and the session module exports types and
 * constants the guards and the nav need.
 */

import { redirect } from 'next/navigation';

import { getSession, homeRouteFor, verifyCredentials } from './session';

/**
 * A `'use server'` module may export nothing but async functions, so this type
 * is the only other export here. TypeScript types are erased before the server
 * actions loader sees the module, so a type export is safe where a constant is
 * not; the form owns its own initial value.
 */
export type LoginState = { error: string | null };

/**
 * Verify credentials, start a session, and send the user to their role's home
 * route per the amended AC-1.
 *
 * The failure message is deliberately identical for an unknown email and a
 * wrong password.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Enter both an email address and a password.' };
  }

  let user;
  try {
    user = await verifyCredentials(email, password);
  } catch {
    return { error: 'The application cannot reach its database. Check that it is running.' };
  }

  if (!user) {
    return { error: 'Those credentials do not match a seeded user.' };
  }

  const session = await getSession();
  session.user = user;
  await session.save();

  /* redirect() throws, so it must sit outside the try above. */
  redirect(homeRouteFor(user.role));
}

/** End the session and return to the login page. */
export async function logoutAction(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect('/login');
}
