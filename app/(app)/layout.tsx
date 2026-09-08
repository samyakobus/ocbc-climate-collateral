import Link from 'next/link';

import { logoutAction } from '@/lib/auth/actions';
import { requireUser, segmentFor, type UserRole } from '@/lib/auth/session';

/**
 * The guarded shell for every signed-in route (S3, AC-1; plan 4.1 and 4.9).
 *
 * One guard for the whole `(app)` group: `requireUser` redirects an
 * unauthenticated visitor to `/login`, so no page inside this group repeats the
 * check. Pages with a narrower audience, `/rules` for the risk manager, call
 * `requireRole` on top of this.
 *
 * The navigation is role-aware, and it is what satisfies the amended AC-1's
 * second clause: the risk manager lands on `/ai` and reaches `/portfolio` in one
 * click from here.
 */

const ALL_ROLES: readonly UserRole[] = [
  'loan_officer',
  'corporate_credit_officer',
  'risk_manager',
];

type NavItem = {
  href: string;
  label: string;
  roles: readonly UserRole[];
};

const NAV: readonly NavItem[] = [
  { href: '/ai', label: 'AI Dashboard', roles: ['risk_manager'] },
  { href: '/portfolio', label: 'Portfolio', roles: ['risk_manager'] },
  { href: '/cases', label: 'Cases', roles: ALL_ROLES },
  { href: '/map', label: 'Map', roles: ALL_ROLES },
  { href: '/rules', label: 'Thresholds', roles: ['risk_manager'] },
];

/** The two officer roles see only their own segment's cases. */
function hrefFor(item: NavItem, role: UserRole): string {
  if (item.href !== '/cases') return item.href;
  const segment = segmentFor(role);
  return segment ? `/cases?segment=${segment}` : '/cases';
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = NAV.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/*
        Illustrative-data ribbon (plan 4.9, a spec non-goal made explicit). Every
        S$ figure in the app is derived from a synthetic portfolio, and this says
        so on every screen. worker-c lifts this into components/IllustrativeRibbon
        during the S27 visual pass.
      */}
      <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Synthetic portfolio, illustrative figures. Not a credit decision.
      </div>

      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-black/10 px-4 py-2.5 dark:border-white/15">
        <span className="text-sm font-semibold">OCBC Climate Collateral</span>

        <nav className="flex flex-1 flex-wrap items-center gap-4 text-sm">
          {items.map((item) => (
            <Link key={item.href} href={hrefFor(item, user.role)} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-xs">
          <span className="opacity-70">
            {user.display_name} - {user.role.replace(/_/g, ' ')}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
