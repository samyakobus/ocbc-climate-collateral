/**
 * npm run prep:narratives   (plan S25, section 4.8, AC-10)
 *
 * Pre-generates one narrative per seeded case and one portfolio summary per
 * scenario, so the case screen and the dashboard open with text already on them
 * and the demo never waits on a model.
 *
 * WITHOUT A KEY IT STILL WRITES EVERY ROW. The fallback is the rule text, built
 * from the same whitelist a generated narrative is checked against, so the case
 * screen is never blank and `narrative-assertions.test.ts` has rows to assert
 * over on a machine with no credentials. It always exits 0 for that reason; a
 * missing DATABASE_URL exits 1, because that is a broken setup rather than an
 * absent optional credential.
 *
 * SCOPE. By default the six pinned fixture cases at all three scenarios, plus a
 * portfolio summary per scenario: 21 narratives, which is what the demo opens
 * and what the assertions need. `--all` covers all 200 properties at every
 * scenario, 603 narratives, which is free without a key and deliberate with one.
 *
 *   --all             every seeded case, not only the pinned fixtures.
 *   --scenario=y2050  one scenario instead of all three.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import Anthropic from '@anthropic-ai/sdk';
import { Pool, type PoolClient } from 'pg';
import 'dotenv/config';

import { readEnv } from '../lib/config/env';
import {
  NARRATIVE_TIMEOUT_MS,
  type NarrativeClient,
} from '../lib/narrative/prompt';
import { loadCaseFacts, loadPortfolioFacts, saveNarrative } from '../lib/narrative/store';
import { generateCaseNarrative, generatePortfolioNarrative } from '../lib/narrative/validate';
import type { Scenario } from '../lib/valuation/hazards';

/**
 * The six pinned fixtures (plan 4.3.2), which are the cases the demo opens.
 *
 * Held here rather than imported from `tests/fixtures/cases.ts`: a prep script
 * that imports from the test tree makes the tests a build dependency of the
 * seed, and the ids are what `docs/demo-script.md` walks through anyway.
 */
export const PINNED_CASE_IDS: readonly string[] = [
  'SG-EC-001',
  'SG-EC-002',
  'SG-EC-003',
  'SG-KB-003',
  'SG-MS-002',
  'SG-MS-003',
];

const ALL_SCENARIOS: readonly Scenario[] = ['today', 'y2030', 'y2050'];

export type NarrativeRunResult = {
  cases: number;
  portfolios: number;
  validated: number;
  fallback: number;
  key_present: boolean;
};

/**
 * Generate and store, over an injected model client and database client.
 *
 * A null client is the no-key path: every narrative is the rule text, written
 * with `fallback_used` true and `validated` false. That is a state the dashboard
 * renders and the tests assert, not a failure.
 */
export async function generateAllNarratives(
  db: PoolClient,
  client: NarrativeClient | null,
  options: {
    scenarios?: readonly Scenario[];
    collateralIds?: readonly string[] | null;
    log?: (message: string) => void;
  } = {},
): Promise<NarrativeRunResult> {
  const log = options.log ?? (() => {});
  const scenarios = options.scenarios ?? ALL_SCENARIOS;
  const ids = options.collateralIds === null ? undefined : (options.collateralIds ?? PINNED_CASE_IDS);

  let cases = 0;
  let portfolios = 0;
  let validated = 0;
  let fallback = 0;

  for (const scenario of scenarios) {
    for (const facts of await loadCaseFacts(db, scenario, ids)) {
      const outcome = await generateCaseNarrative(client, facts);
      await saveNarrative(db, { type: 'case', id: facts.collateral_id, scenario }, outcome);

      cases += 1;
      if (outcome.validated) validated += 1;
      if (outcome.fallback_used) fallback += 1;
      if (outcome.attempts.length > 0 && client !== null) {
        log(`[narratives] ${facts.collateral_id} ${scenario}: ${outcome.attempts.join('; ')}`);
      }
    }

    const portfolioFacts = await loadPortfolioFacts(db, scenario);
    const summary = await generatePortfolioNarrative(client, portfolioFacts);
    await saveNarrative(db, { type: 'portfolio', id: 'portfolio', scenario }, summary);

    portfolios += 1;
    if (summary.validated) validated += 1;
    if (summary.fallback_used) fallback += 1;
  }

  return { cases, portfolios, validated, fallback, key_present: client !== null };
}

/**
 * The same pass on a connection string of its own, for a test bootstrap.
 *
 * The client defaults to null for the reason `scorePass` gives: an isolated e2e
 * or db database must mirror demo state - every narrative the rule text, with
 * `fallback_used` true - without its result depending on whether the machine
 * running it happens to have a key. It also means the case screen under test
 * always has text on it rather than the "no summary stored" line.
 */
export async function narrativePass(
  connectionString: string,
  client: NarrativeClient | null = null,
): Promise<NarrativeRunResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const db = await pool.connect();

  try {
    await db.query('BEGIN');
    const result = await generateAllNarratives(db, client);
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

function parseScenario(argv: readonly string[]): readonly Scenario[] {
  const flag = argv.find((argument) => argument.startsWith('--scenario='));
  if (!flag) return ALL_SCENARIOS;

  const value = flag.slice('--scenario='.length) as Scenario;
  if (!ALL_SCENARIOS.includes(value)) {
    throw new Error(`--scenario expects one of ${ALL_SCENARIOS.join(', ')}, got "${value}".`);
  }
  return [value];
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  }

  const argv = process.argv.slice(2);
  const apiKey = readEnv('ANTHROPIC_API_KEY');

  const pool = new Pool({ connectionString, max: 1 });
  const db = await pool.connect();

  try {
    /* One of the entry points plan 4.9 allows to construct a client. */
    const client = apiKey
      ? (new Anthropic({
          apiKey,
          timeout: NARRATIVE_TIMEOUT_MS,
          maxRetries: 1,
        }) as unknown as NarrativeClient)
      : null;

    await db.query('BEGIN');
    const result = await generateAllNarratives(db, client, {
      scenarios: parseScenario(argv),
      collateralIds: argv.includes('--all') ? null : undefined,
      log: (line) => console.log(line),
    });
    await db.query('COMMIT');

    console.log(
      `[narratives] ${result.cases} case narratives and ${result.portfolios} portfolio summaries`,
    );
    console.log(`[narratives] ${result.validated} model-written, ${result.fallback} rule text`);

    if (!result.key_present) {
      console.log('[narratives] ANTHROPIC_API_KEY is not set.');
      console.log(
        '[narratives] every narrative is the rule text, stored with fallback_used = true. ' +
          'This is the documented offline state, and the case screen is never blank.',
      );
    }
  } catch (cause) {
    await db.query('ROLLBACK').catch(() => undefined);
    console.error(
      `[narratives] the pass did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    console.error('[narratives] nothing was written. Existing narratives are untouched.');
  } finally {
    db.release();
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    /* A broken setup, not a failed generation: every model failure is handled
       inside `main` and returns 0. */
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
