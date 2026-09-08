/**
 * npm run db:recompute
 *
 * Recomputes every valuation, application valuation and recommendation against
 * the active rule set. Run after seeding, after a prep run, or after editing
 * the thresholds outside the app.
 *
 * The `/rules` page does NOT shell out to this. It calls `recomputeAll` inside
 * the same transaction that writes the new active rule set, which is what makes
 * AC-9 a single in-process step with no restart (ADR-1). This script is the
 * command-line entry to the same function.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { Pool } from 'pg';
import 'dotenv/config';

import { recomputeAll } from '../lib/valuation/recompute';

export async function recompute(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await recomputeAll(client);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw cause;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  const started = Date.now();
  const result = await recompute(connectionString);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`[recompute] rule set ${result.rule_set_id}`);
  console.log(`[recompute] ${result.collateral} collateral -> ${result.valuations} valuations`);
  console.log(
    `[recompute] ${result.application_valuations} application valuations, ` +
      `${result.recommendations} recommendations`,
  );
  console.log(`[recompute] done in ${seconds}s`);

  /*
    S21 chains `npm run prep:reference` here, because score_inputs snapshots
    hotspot exposure at prep time and a recompute can move it. Left as a note
    rather than a call until compute-reference.ts exists.
  */
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
