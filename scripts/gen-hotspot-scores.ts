/**
 * npm run prep:scores   (plan S22, section 4.5, AC-17)
 *
 * Pre-generates the hotspot scores the AI dashboard shows, with the live
 * regenerate button in `app/actions/rescore-hotspot.ts` as the runtime twin of
 * this pass.
 *
 * IT ALWAYS EXITS 0. With no `ANTHROPIC_API_KEY`, or with every call failing,
 * every hotspot is left unscored with `score_fallback` raised and the dashboard
 * shows `reference_index` with a fallback badge. That is a tested, documented
 * state, not a degraded one: the build host for this project has no key at all,
 * and a prep pipeline that fails the build because a credential is absent would
 * take the whole demo down for the one part of it that is optional by design.
 *
 * This is one of the entry points plan 4.9 allows to construct a client. The
 * prompt building and the validation live in `lib/index/`, which never imports
 * the vendor package, so `no-network-on-render.test.ts` can scan that directory
 * with no exception for them.
 *
 *   --limit=N   score only the first N hotspots, for a cheap smoke test.
 *   --dry-run   build every request and print the payload, calling nothing.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import Anthropic from '@anthropic-ai/sdk';
import { Pool, type PoolClient } from 'pg';
import 'dotenv/config';

import { readEnv } from '../lib/config/env';
import { promptPayload } from '../lib/index/inputs';
import {
  buildScoreRequest,
  scoreHotspot,
  SCORING_MODEL,
  SCORING_TIMEOUT_MS,
  type ScoringClient,
} from '../lib/index/llm-score';
import { applyScoreOutcome, loadScorableHotspots, markAllFallback } from '../lib/index/store';

export type ScoreRunResult = {
  hotspots: number;
  scored: number;
  fallback: number;
  /** Failure reasons by kind, so a prep log names what went wrong. */
  reasons: Record<string, number>;
  key_present: boolean;
};

/**
 * Run the pass over an injected client and an injected database client.
 *
 * Both are injected so `tests/db/hotspot-score.test.ts` can drive the whole
 * thing with a client that throws, and with one pointed at a closed port, and
 * assert the rows that result. AC-17 asks for exactly that.
 */
export async function scoreAllHotspots(
  db: PoolClient,
  client: ScoringClient | null,
  options: { limit?: number; log?: (message: string) => void } = {},
): Promise<ScoreRunResult> {
  const log = options.log ?? (() => {});
  const hotspots = await loadScorableHotspots(db);
  const selected = options.limit ? hotspots.slice(0, options.limit) : hotspots;

  if (client === null) {
    const marked = await markAllFallback(db);
    return {
      hotspots: marked,
      scored: 0,
      fallback: marked,
      reasons: { no_api_key: marked },
      key_present: false,
    };
  }

  const reasons: Record<string, number> = {};
  let scored = 0;

  for (const hotspot of selected) {
    const outcome = await scoreHotspot(client, hotspot, hotspot.inputs);
    await applyScoreOutcome(db, hotspot.id, outcome);

    if (outcome.ok) {
      scored += 1;
      const gap =
        hotspot.reference_index === null
          ? 'no reference'
          : `reference ${hotspot.reference_index}, gap ${Math.abs(outcome.value.score - hotspot.reference_index)}`;
      log(`[scores] ${hotspot.id} scored ${outcome.value.score} (${gap})`);
    } else {
      reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;
      log(`[scores] ${hotspot.id} fell back: ${outcome.reason} - ${outcome.detail}`);
    }
  }

  return {
    hotspots: selected.length,
    scored,
    fallback: selected.length - scored,
    reasons,
    key_present: true,
  };
}

/**
 * The same pass on a connection string of its own, for a test bootstrap.
 *
 * THE CLIENT DEFAULTS TO NULL, AND THAT IS THE POINT. `scripts/e2e-server.ts`
 * and `tests/setup/db-global.ts` call this so their isolated database mirrors
 * demo state - sixteen rows with `score_fallback` raised, which is what the
 * dashboard shows on a host with no key. Constructing a client from the
 * environment here instead would make an e2e run reach the API sixteen times on
 * any machine that happens to have a key set, turning a hermetic suite into one
 * whose results depend on whose laptop it ran on.
 */
export async function scorePass(
  connectionString: string,
  client: ScoringClient | null = null,
): Promise<ScoreRunResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const db = await pool.connect();

  try {
    await db.query('BEGIN');
    const result = await scoreAllHotspots(db, client);
    await db.query('COMMIT');
    return result;
  } catch (cause) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw cause;
  } finally {
    db.release();
    await pool.end();
  }
}

function parseLimit(argv: readonly string[]): number | undefined {
  const flag = argv.find((argument) => argument.startsWith('--limit='));
  if (!flag) return undefined;

  const value = Number(flag.slice('--limit='.length));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--limit expects a positive integer, got "${flag}".`);
  }
  return value;
}

async function dryRun(db: PoolClient, limit?: number): Promise<void> {
  const hotspots = await loadScorableHotspots(db);
  for (const hotspot of limit ? hotspots.slice(0, limit) : hotspots) {
    const request = buildScoreRequest(hotspot, hotspot.inputs);
    console.log(`--- ${hotspot.id} ${hotspot.name}`);
    console.log(JSON.stringify(promptPayload(hotspot.inputs)));
    console.log(`tool_choice ${request.tool_choice.type}:${request.tool_choice.name}`);
  }
  console.log(`[scores] dry run over ${hotspots.length} hotspots. Nothing was called or written.`);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  const argv = process.argv.slice(2);
  const limit = parseLimit(argv);
  const apiKey = readEnv('ANTHROPIC_API_KEY');

  const pool = new Pool({ connectionString, max: 1 });
  const db = await pool.connect();

  try {
    if (argv.includes('--dry-run')) {
      await dryRun(db, limit);
      return;
    }

    /*
      One client for the run, with the plan's 8 s timeout and a single retry.
      Constructed here rather than in `lib/` (plan 4.9), and only when there is
      a key to construct it with.
    */
    const client = apiKey
      ? (new Anthropic({
          apiKey,
          timeout: SCORING_TIMEOUT_MS,
          maxRetries: 1,
        }) as unknown as ScoringClient)
      : null;

    await db.query('BEGIN');
    const result = await scoreAllHotspots(db, client, { limit, log: (line) => console.log(line) });
    await db.query('COMMIT');

    if (!result.key_present) {
      console.log('[scores] ANTHROPIC_API_KEY is not set.');
      console.log(
        `[scores] ${result.fallback} hotspots marked score_fallback; the dashboard shows ` +
          'reference_index with a fallback badge. This is the documented offline state.',
      );
      return;
    }

    console.log(`[scores] model ${SCORING_MODEL}`);
    console.log(`[scores] ${result.scored} of ${result.hotspots} scored, ${result.fallback} fell back`);
    for (const [reason, count] of Object.entries(result.reasons)) {
      console.log(`[scores]   ${reason}: ${count}`);
    }
  } catch (cause) {
    await db.query('ROLLBACK').catch(() => undefined);
    /*
      Still exit 0. A failed scoring pass leaves the previous rows untouched and
      the dashboard reads the reference index; it is not a reason to fail a
      build or a seed.
    */
    console.error(
      `[scores] the pass did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    console.error('[scores] nothing was written. The dashboard falls back to reference_index.');
  } finally {
    db.release();
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    /*
      Reaching here is a broken SETUP, not a failed scoring pass: every LLM
      failure is handled inside `main` and returns normally with exit 0. A
      missing DATABASE_URL is not an optional credential and should not be
      reported as a successful run.
    */
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
