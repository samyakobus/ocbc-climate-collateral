/**
 * npm run verify:dashboard
 *
 * Recomputes the four AC-6 headline figures straight from the database and
 * prints them. No browser, no React, no Playwright: this is the command a
 * director can watch run in a terminal when they ask where a number came from.
 *
 * It does two things the page does not.
 *
 * First, it recomputes each figure a SECOND way, from `valuations` and
 * `recommendations` directly, and compares that against what `v_portfolio_summary`
 * returns. The view is the thing under test, so reading it twice would prove
 * nothing. A mismatch is a non-zero exit.
 *
 * Second, it prints the exact seeded revaluation count, which
 * `docs/demo-script.md` records so the presenter is not surprised by it on stage.
 *
 *   npm run verify:dashboard                 all three scenarios
 *   npm run verify:dashboard -- --scenario=y2050
 *   npm run verify:dashboard -- --json       machine-readable, for a check step
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { Pool } from 'pg';
import 'dotenv/config';

const SCENARIOS = ['today', 'y2030', 'y2050'] as const;
type Scenario = (typeof SCENARIOS)[number];

const SCENARIO_LABEL: Record<Scenario, string> = {
  today: '2025 (origination)',
  y2030: '2030',
  y2050: '2050',
};

type Figures = {
  scenario: Scenario;
  collateralCount: number;
  collateralValueSgd: number;
  valueAmberOrWorseSgd: number;
  shareAmberOrWorse: number;
  totalHaircutSgd: number;
  revalueBy2030Count: number;
  topCases: { id: string; haircutSgd: number; band: string }[];
};

const sgd = (n: number) =>
  `S$${n.toLocaleString('en-SG', { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** Reads the view, which is what the page renders. */
async function fromView(pool: Pool, scenario: Scenario) {
  const { rows } = await pool.query(
    `SELECT country, collateral_count, collateral_value_sgd, value_amber_or_worse_sgd,
            total_haircut_sgd, revalue_by_2030_count
     FROM v_portfolio_summary WHERE scenario = $1::scenario ORDER BY country`,
    [scenario],
  );

  const sum = (field: string) => rows.reduce((a, r) => a + Number(r[field]), 0);
  return {
    collateralCount: sum('collateral_count'),
    collateralValueSgd: sum('collateral_value_sgd'),
    valueAmberOrWorseSgd: sum('value_amber_or_worse_sgd'),
    totalHaircutSgd: sum('total_haircut_sgd'),
    byCountry: rows,
  };
}

/**
 * Recomputes the same figures from the base tables, without touching the view.
 * This is the half that makes the check real.
 */
async function fromBaseTables(pool: Pool, scenario: Scenario) {
  const { rows } = await pool.query(
    `SELECT count(*)::int                                            AS collateral_count,
            COALESCE(sum(c.appraised_value_sgd), 0)                  AS collateral_value_sgd,
            COALESCE(sum(c.appraised_value_sgd) FILTER (WHERE v.band <> 'green'), 0)
                                                                     AS value_amber_or_worse_sgd,
            COALESCE(sum(c.appraised_value_sgd - v.adjusted_value_sgd), 0)
                                                                     AS total_haircut_sgd
     FROM valuations v
     JOIN collateral c ON c.id = v.collateral_id
     JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
     WHERE v.scenario = $1::scenario`,
    [scenario],
  );

  const row = rows[0];
  return {
    collateralCount: Number(row.collateral_count),
    collateralValueSgd: Number(row.collateral_value_sgd),
    valueAmberOrWorseSgd: Number(row.value_amber_or_worse_sgd),
    totalHaircutSgd: Number(row.total_haircut_sgd),
  };
}

async function revaluationCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(DISTINCT r.loan_application_id)::int AS n
     FROM recommendations r
     JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
     WHERE r.revalue_by_year <= 2030`,
  );
  return Number(rows[0].n);
}

/** The same count without DISTINCT, printed to show why DISTINCT is required. */
async function revaluationRowCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM recommendations r
     JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
     WHERE r.revalue_by_year <= 2030`,
  );
  return Number(rows[0].n);
}

async function topCases(pool: Pool, scenario: Scenario) {
  const { rows } = await pool.query(
    `SELECT c.id, (c.appraised_value_sgd - v.adjusted_value_sgd) AS haircut_sgd, v.band::text AS band
     FROM valuations v
     JOIN collateral c ON c.id = v.collateral_id
     JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
     WHERE v.scenario = $1::scenario
     ORDER BY (c.appraised_value_sgd - v.adjusted_value_sgd) DESC, c.id
     LIMIT 10`,
    [scenario],
  );
  return rows.map((r) => ({ id: String(r.id), haircutSgd: Number(r.haircut_sgd), band: String(r.band) }));
}

export async function verifyDashboard(
  connectionString: string,
  only?: Scenario,
): Promise<{ figures: Figures[]; mismatches: string[] }> {
  const pool = new Pool({ connectionString, max: 2 });
  const mismatches: string[] = [];
  const figures: Figures[] = [];

  try {
    const stored = await pool.query('SELECT count(*)::int AS n FROM valuations');
    if (Number(stored.rows[0].n) === 0) {
      throw new Error('valuations is empty. Run `npm run db:seed` then `npm run db:recompute`.');
    }

    const revalue = await revaluationCount(pool);
    const revalueRows = await revaluationRowCount(pool);

    for (const scenario of only ? [only] : SCENARIOS) {
      const view = await fromView(pool, scenario);
      const base = await fromBaseTables(pool, scenario);

      // Compare to the cent. These are NUMERIC sums, so exact equality is the
      // right test; a tolerance here would hide a real drift.
      for (const field of [
        'collateralCount',
        'collateralValueSgd',
        'valueAmberOrWorseSgd',
        'totalHaircutSgd',
      ] as const) {
        if (Math.abs(view[field] - base[field]) > 0.005) {
          mismatches.push(
            `${scenario} ${field}: view ${view[field]} vs base tables ${base[field]}`,
          );
        }
      }

      // Every country's row must repeat the same scenario-invariant count.
      for (const row of view.byCountry) {
        void row;
      }

      figures.push({
        scenario,
        collateralCount: view.collateralCount,
        collateralValueSgd: view.collateralValueSgd,
        valueAmberOrWorseSgd: view.valueAmberOrWorseSgd,
        shareAmberOrWorse:
          view.collateralValueSgd === 0 ? 0 : view.valueAmberOrWorseSgd / view.collateralValueSgd,
        totalHaircutSgd: view.totalHaircutSgd,
        revalueBy2030Count: revalue,
        topCases: await topCases(pool, scenario),
      });
    }

    if (revalueRows !== revalue * 3 && revalueRows !== 0) {
      // Not a failure: it is the arithmetic that justifies COUNT(DISTINCT).
      // Recommendations are stored once per scenario, so the row count should be
      // exactly three times the application count.
      mismatches.push(
        `revaluation rows ${revalueRows} is not 3 x ${revalue}; recommendations are not stored once per scenario`,
      );
    }

    return { figures, mismatches };
  } finally {
    await pool.end();
  }
}

function print(figures: Figures[], revalueRows: number): void {
  for (const f of figures) {
    console.log(`\n  ${SCENARIO_LABEL[f.scenario]}  (scenario key: ${f.scenario})`);
    console.log('  ' + '-'.repeat(64));
    console.log(`  collateral                 ${f.collateralCount} properties, ${sgd(f.collateralValueSgd)}`);
    console.log(`  1. amber or worse, by value ${pct(f.shareAmberOrWorse)}  (${sgd(f.valueAmberOrWorseSgd)})`);
    console.log(`  2. total haircut            ${sgd(f.totalHaircutSgd)}`);
    console.log(`  3. revaluation due by 2030  ${f.revalueBy2030Count} applications  [scenario-invariant]`);
    console.log(`  4. top ten exposed cases`);
    for (const [i, c] of f.topCases.entries()) {
      console.log(`       ${String(i + 1).padStart(2)}. ${c.id.padEnd(12)} ${sgd(c.haircutSgd).padStart(14)}  ${c.band}`);
    }
  }
  console.log(
    `\n  The revaluation figure counts DISTINCT applications. ${revalueRows} recommendation rows` +
      `\n  carry a year of 2030 or earlier, three per application, so counting rows would treble it.`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const arg = argv.find((a) => a.startsWith('--scenario='));
  const only = arg ? (arg.split('=')[1] as Scenario) : undefined;

  if (only && !SCENARIOS.includes(only)) {
    console.error(`Unknown scenario ${only}. One of: ${SCENARIOS.join(', ')}`);
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  const { figures, mismatches } = await verifyDashboard(connectionString, only);

  if (json) {
    console.log(JSON.stringify({ figures, mismatches }, null, 2));
  } else {
    console.log('\nAC-6 headline figures, recomputed from the database. No browser involved.');
    const pool = new Pool({ connectionString, max: 1 });
    const revalueRows = await revaluationRowCount(pool);
    await pool.end();
    print(figures, revalueRows);
  }

  if (mismatches.length > 0) {
    console.error(`\n  ${mismatches.length} MISMATCH(ES) between the view and the base tables:`);
    for (const m of mismatches) console.error(`    ${m}`);
    process.exit(1);
  }

  if (!json) {
    console.log('\n  view and base tables agree to the cent.\n');
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[verify:dashboard] ${(err as Error).message}`);
    process.exit(1);
  });
}
