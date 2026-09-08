/**
 * Per-file setup and connection fixture for the `db` Vitest project.
 *
 * The database these tests talk to is provisioned by
 * `tests/setup/db-global.ts`: an in-memory PGlite instance with the real
 * PostGIS extension, on its own port, migrated and seeded once per run and
 * discarded afterwards. `vitest.config.mts` puts its URL in this project's
 * environment, so DATABASE_URL here is never the shared development instance.
 *
 * The tests speak the ordinary Postgres wire protocol through `pg` and cannot
 * tell which server is behind it, which is the point: the same files run
 * unchanged against postgis/postgis:16-3.4 under compose on demo day.
 *
 * ONE RULE FOR EVERY TEST THAT TOUCHES `rule_sets`. Restore the EXACT rule set
 * id that was active before, not merely the highest id, and delete any rule set
 * the test created. Every valuation row references the rule set it was computed
 * against, so leaving a different one active silently orphans all 600 of them
 * and every fixture assertion then finds no active-rule-set row at all. See
 * `identity-sequences.test.ts` and `seed-self-correcting.test.ts` for the shape.
 */

import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;

const SETUP_HINT = [
  'The db project provisions its own database in tests/setup/db-global.ts.',
  'Reaching this message means that global setup did not leave a usable server:',
  'run with VITEST_DB_VERBOSE=1 to see its migration and seed output.',
].join('\n');

let pool: Pool | undefined;

/** The shared connection pool for this test file. */
export function dbPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error(`DATABASE_URL is not set for the db project.\n\n${SETUP_HINT}`);
  }
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  }
  return pool;
}

/** Run one query and return its rows. */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result: QueryResult<T> = await dbPool().query<T>(text, values as unknown[]);
  return result.rows;
}

/** Run a query expected to return exactly one row, and return it. */
export async function dbOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T> {
  const rows = await dbQuery<T>(text, values);
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one row, got ${rows.length}: ${text}`);
  }
  return rows[0];
}

beforeAll(async () => {
  try {
    await dbPool().query('SELECT 1');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Cannot reach the test database (${reason}).\n\n${SETUP_HINT}`);
  }
});

afterAll(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});
