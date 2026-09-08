import { redirect } from 'next/navigation';

import { getCurrentUser, homeRouteFor } from '@/lib/auth/session';

/**
 * The root is a router, not a page (S3, AC-1).
 *
 * An unauthenticated visitor goes to `/login`; a signed-in one goes straight to
 * their role's home route under the amended AC-1. There is no landing page and
 * no sign-up.
 */
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homeRouteFor(user.role) : '/login');
}
