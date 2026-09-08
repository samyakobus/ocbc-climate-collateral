/**
 * lib/auth/session.ts - credentials auth and the role guard (S3, AC-1).
 *
 * Three seeded users, email plus password, role-specific home screens, and no
 * sign-up: those are binding spec constraints, so there is no registration path
 * anywhere in the app and `/signup` is not a route.
 *
 * The session is an iron-session cookie: encrypted and signed with AUTH_SECRET,
 * httpOnly, and carrying only the four fields the nav and the guards need. No
 * password material ever reaches the cookie.
 *
 * Offline-first (plan 4.9): nothing here makes an outbound call. The only I/O is
 * one indexed lookup on `users` through the one shared pool in
 * `lib/db/client.ts`. This module used to keep a private pool, which against
 * PGlite's bounded connection ceiling meant paying twice for the same work.
 */

import { compare, hash } from 'bcryptjs';
import { getIronSession, type IronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { query } from '@/lib/db/client';

/** The three roles of the `user_role` enum. */
export type UserRole = 'loan_officer' | 'corporate_credit_officer' | 'risk_manager';

export const USER_ROLES: readonly UserRole[] = [
  'loan_officer',
  'corporate_credit_officer',
  'risk_manager',
] as const;

/** What the cookie carries. Never a hash, never a password. */
export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string;
};

export type SessionData = {
  user?: SessionUser;
};

/** bcrypt work factor for the seeded users (plan S3). */
export const BCRYPT_COST = 10;

/**
 * Where each role lands after login, per the amended AC-1 (spec amendment
 * 2026-09-07): the risk manager lands on the AI Dashboard, with the portfolio
 * dashboard one click away in the top navigation.
 */
export const HOME_ROUTE: Readonly<Record<UserRole, string>> = {
  loan_officer: '/cases?segment=personal',
  corporate_credit_officer: '/cases?segment=corporate',
  risk_manager: '/ai',
};

export function homeRouteFor(role: UserRole): string {
  return HOME_ROUTE[role];
}

/** The case segment a role is allowed to see. The risk manager sees both. */
export function segmentFor(role: UserRole): 'personal' | 'corporate' | null {
  if (role === 'loan_officer') return 'personal';
  if (role === 'corporate_credit_officer') return 'corporate';
  return null;
}

function sessionSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET must be set to at least 32 characters. Copy .env.example to .env.',
    );
  }
  return secret;
}

export function sessionOptions(): SessionOptions {
  return {
    password: sessionSecret(),
    cookieName: 'ocbc_session',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    },
  };
}

/** The current session, readable and writable. */
export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session.user ?? null;
}

/**
 * The signed-in user, or a redirect to the login page.
 * Used by the `(app)` layout, so every route inside it is guarded once.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/**
 * The signed-in user, or a redirect. A user in the wrong role is sent to their
 * own home route rather than shown a denial, which is the right behaviour for a
 * demo: the risk-manager-only threshold editor simply is not reachable.
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    redirect(homeRouteFor(user.role));
  }
  return user;
}

/* ------------------------------------------------------------------ *
 * Credentials
 * ------------------------------------------------------------------ */

/** Hash a password at the seeded work factor. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

type UserRow = SessionUser & { password_hash: string };

/**
 * Verify an email and password against the seeded users.
 *
 * Returns null for both an unknown email and a wrong password, and the login
 * form says the same thing in both cases, so the form cannot be used to
 * enumerate which of the three demo accounts exist.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised || !password) return null;

  const rows = await query<UserRow>(
    'SELECT id, email, role, display_name, password_hash FROM users WHERE email = $1',
    [normalised],
  );

  const row = rows[0];
  if (!row) return null;

  const ok = await compare(password, row.password_hash);
  if (!ok) return null;

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    display_name: row.display_name,
  };
}
