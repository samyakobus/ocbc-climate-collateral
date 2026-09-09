/**
 * npm run prep:reference   (plan S21, section 4.4, AC-15, AC-17)
 *
 * Writes `hotspots.score_inputs` and `hotspots.reference_index` for every
 * hotspot. No API key, no outbound call, no clock beyond the day the window is
 * measured from: this is the deterministic half of the AI dashboard and it must
 * run on a machine with no credentials at all.
 *
 * WHY IT IS CHAINED AFTER EVERY RECOMPUTE. `score_inputs` snapshots the hotspot
 * exposure that `v_hotspot_exposure` computes live, and AC-15 asserts the two
 * are equal. Any change to the portfolio, to a loan amount or to the thresholds
 * moves the live figure, so a snapshot taken before it is stale and AC-15 breaks
 * for a reason that has nothing to do with the dashboard. `scripts/recompute.ts`
 * and `scripts/e2e-server.ts` therefore both call this after recomputing, and so
 * does `app/actions/rules.ts` inside the transaction that saves new thresholds.
 *
 *   --as-of=YYYY-MM-DD   measure the 90-day event window from this day instead
 *                        of today. The seeded feed is a frozen replay whose
 *                        newest event is 2026-09-07; once the calendar moves
 *                        past that by 90 days every V term would fall to zero,
 *                        and a rehearsal on a later date can pin the window
 *                        rather than watch the index quietly flatten.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { Pool } from 'pg';
import 'dotenv/config';

import { refreshReferenceIndex, todayIso, type ReferenceResult } from '../lib/index/inputs';

export type { ReferenceResult };

/** The same pass, on a connection string of its own. */
export async function computeReference(
  connectionString: string,
  options: { asOf?: string } = {},
): Promise<ReferenceResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await refreshReferenceIndex(client, options.asOf ?? todayIso());
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

function parseAsOf(argv: readonly string[]): string | undefined {
  const flag = argv.find((argument) => argument.startsWith('--as-of='));
  if (!flag) return undefined;

  const value = flag.slice('--as-of='.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--as-of expects YYYY-MM-DD, got "${value}".`);
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  const result = await computeReference(connectionString, { asOf: parseAsOf(process.argv.slice(2)) });

  console.log(`[reference] as of ${result.as_of}, total_cap ${result.total_cap}`);
  console.log(
    `[reference] ${result.hotspots} hotspots, index ${result.min_index}-${result.max_index}, ` +
      `${result.empty} at the floor of 1`,
  );
  console.log('[reference] score_inputs and reference_index written. No API key was used.');
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
