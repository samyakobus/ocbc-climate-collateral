/**
 * The one `pg` Pool (plan 4.1, `lib/db/client.ts`).
 *
 * Three modules had each grown a private pool: `lib/auth/session.ts`,
 * `app/(app)/map/pins.ts` and the prep scripts. That is harmless against a real
 * Postgres and not harmless here: the local server is PGlite behind a socket
 * with a bounded connection ceiling, so N pools of five is N times the
 * connections for the same work, and the ceiling is what fails first.
 *
 * The pool is cached on `globalThis` rather than in a module variable because
 * the Next dev server re-evaluates modules on every hot reload, and a fresh
 * pool per reload leaks connections until the ceiling is hit.
 *
 * Offline-first (plan 4.9): the only I/O on any render path is a query over
 * DATABASE_URL. Nothing here makes an outbound call, and
 * `tests/unit/no-network-on-render.test.ts` enforces that by scanning call sites.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const KEY = Symbol.for('ocbc.db.pool');

type Holder = { [KEY]?: Pool };

/** Max connections. The PGlite socket server allows 25; leave room for tests and scripts. */
const MAX_CONNECTIONS = Number(process.env.DATABASE_POOL_MAX ?? 8);

export function pool(): Pool {
  const holder = globalThis as unknown as Holder;

  if (!holder[KEY]) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set; copy .env.example to .env');
    }
    holder[KEY] = new Pool({ connectionString, max: MAX_CONNECTIONS });
  }

  return holder[KEY];
}

/** Run one query and return its rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool().query<T>(text, values as unknown[]);
  return result.rows;
}

/** Run a query expected to return exactly one row. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T> {
  const rows = await query<T>(text, values);
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one row, got ${rows.length}: ${text}`);
  }
  return rows[0];
}

/**
 * Run several statements in one transaction.
 *
 * `/rules` uses this so writing the new active rule set and recomputing every
 * valuation are one atomic step with no restart, which is what AC-9 is.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
