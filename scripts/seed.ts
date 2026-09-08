/**
 * npm run db:seed
 *
 * Generates `db/seed/01_users.sql` from the three seeded users (bcrypt cost 10)
 * and applies every `db/seed/*.sql` in filename order against DATABASE_URL,
 * each file in its own transaction.
 *
 *   npm run db:seed                    apply every seed file in order
 *   npm run db:seed -- --regen-users   regenerate 01_users.sql with fresh salts first
 *   npm run db:seed -- --only=02       apply only files whose name starts with 02
 *   npm run db:seed -- --list          show what would be applied, and apply nothing
 *
 * `01_users.sql` is generated once and then committed, so the hashes are stable
 * across runs and across machines. A bcrypt salt is random, so regenerating on
 * every seed would churn the file for no gain. `--regen-users` forces it.
 *
 * File order matters and the numeric prefixes carry it:
 *   01_users      three seeded users            (S3, this script)
 *   02_reference  curves, rules, applicability  (S8, scripts/gen-reference-sql.ts)
 *   03_portfolio  applicants, loans, collateral (S5, prep/gen_portfolio.py)
 *   04_samples    hazard samples                (S7, prep/sample_hazards.py)
 *   05_regional   hotspots, events, tiles       (S19, S20)
 *
 * Files that do not exist yet are skipped with a note, so this runs while the
 * later steps are still being written.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { hash } from 'bcryptjs';
import { Client } from 'pg';
import 'dotenv/config';

import { syncIdentitySequences } from './db-migrate';

const SEED_DIR = resolve(process.cwd(), 'db/seed');
const USERS_FILE = join(SEED_DIR, '01_users.sql');

/** bcrypt work factor, fixed by plan S3. */
const BCRYPT_COST = 10;

/**
 * The three seeded users. Email plus password, role-specific home screens, and
 * no sign-up: a binding spec constraint. These are demo fixtures and the
 * password is published in the plan and on the login screen.
 */
const DEMO_PASSWORD = 'Demo!2026';

const USERS = [
  {
    id: 'u-officer',
    email: 'officer@ocbc.demo',
    role: 'loan_officer',
    display_name: 'Amirah Rahim',
  },
  {
    id: 'u-corp',
    email: 'corp@ocbc.demo',
    role: 'corporate_credit_officer',
    display_name: 'Daniel Koh',
  },
  {
    id: 'u-risk',
    email: 'risk@ocbc.demo',
    role: 'risk_manager',
    display_name: 'Priya Nair',
  },
] as const;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function generateUsersSql(): Promise<string> {
  const rows: string[] = [];
  for (const user of USERS) {
    const passwordHash = await hash(DEMO_PASSWORD, BCRYPT_COST);
    rows.push(
      `  (${sqlString(user.id)}, ${sqlString(user.email)}, ${sqlString(passwordHash)}, ` +
        `${sqlString(user.role)}, ${sqlString(user.display_name)})`,
    );
  }

  return [
    '-- db/seed/01_users.sql',
    '--',
    '-- GENERATED FILE. Do not edit by hand.',
    '-- Source: scripts/seed.ts. Regenerate: npm run db:seed -- --regen-users',
    '--',
    `-- Three seeded users, bcrypt cost ${BCRYPT_COST}, all with the password ${DEMO_PASSWORD}.`,
    '-- These are demo fixtures: the password is published in the plan and printed on the',
    '-- login screen. There is no sign-up and these are the only accounts that exist.',
    '--',
    '-- Landing routes, per the amended AC-1 (spec amendment 2026-09-07):',
    '--   loan_officer              -> /cases?segment=personal',
    '--   corporate_credit_officer  -> /cases?segment=corporate',
    '--   risk_manager              -> /ai, with /portfolio one click away in the top nav',
    '',
    'INSERT INTO users (id, email, password_hash, role, display_name) VALUES',
    `${rows.join(',\n')}`,
    'ON CONFLICT (email) DO UPDATE SET',
    '  password_hash = EXCLUDED.password_hash,',
    '  role = EXCLUDED.role,',
    '  display_name = EXCLUDED.display_name;',
    '',
  ].join('\n');
}

async function seedFiles(): Promise<string[]> {
  const entries = await readdir(SEED_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

/**
 * Seed a database. Exported so the Vitest `db` project seeds its own isolated
 * in-memory instance through the same code path the CLI uses, rather than
 * keeping a second copy of the seed order in the test harness.
 */
export async function seedDatabase(
  connectionString: string,
  options: {
    regenUsers?: boolean;
    only?: string;
    log?: (message: string) => void;
  } = {},
): Promise<string[]> {
  const log = options.log ?? ((message: string) => console.log(message));

  if (options.regenUsers || !existsSync(USERS_FILE)) {
    await writeFile(USERS_FILE, await generateUsersSql(), 'utf8');
    log(`[seed] wrote db/seed/01_users.sql (bcrypt cost ${BCRYPT_COST})`);
  }

  const files = (await seedFiles()).filter(
    (name) => !options.only || name.startsWith(options.only),
  );
  if (files.length === 0) {
    log('[seed] nothing to apply');
    return [];
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const name of files) {
      const sql = await readFile(join(SEED_DIR, name), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        log(`[seed] applied ${name}`);
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`[seed] ${name} failed: ${reason}`);
      }
    }

    /*
      Curated tables carry explicit TEXT ids; machine tables use BIGINT identity
      columns. Seeding rows with explicit ids leaves those sequences at 1, so the
      next id-less insert collides on the primary key. That would surface as AC-9
      failing the first time the risk manager saves a new active rule set, which
      is a demo-day failure, not a test-time one. Syncing here closes it, and
      tests/db/identity-sequences.test.ts proves the insert succeeds.
    */
    const synced = await syncIdentitySequences(client, log);
    log(`[seed] identity sequences synced: ${synced}`);
  } finally {
    await client.end();
  }

  log(`[seed] done: ${files.length} file(s) applied`);
  return files;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

  if (listOnly) {
    const files = (await seedFiles()).filter((name) => !only || name.startsWith(only));
    for (const name of files) console.log(`[seed] would apply ${name}`);
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  await seedDatabase(connectionString, {
    regenUsers: argv.includes('--regen-users'),
    only,
  });
}

/* Only run the CLI when invoked directly, so importing seedDatabase is inert. */
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
