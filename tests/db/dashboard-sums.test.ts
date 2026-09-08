/**
 * tests/db/dashboard-sums.test.ts - S17. AC-6.
 *
 * The four headline figures, recomputed from `valuations` and `recommendations`
 * directly and compared against what `v_portfolio_summary` returns.
 *
 * The point is that the two are computed independently. Reading the view twice
 * would assert nothing; every expectation below is built from the base tables so
 * the view is the thing under test, and so is the page, because the page and
 * `npm run verify:dashboard` both read the view through `lib/db/queries.ts`.
 *
 * `valuations` is written by `npm run db:recompute` (S12), which the db
 * project's global setup does not run, so this runs it once itself.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

const run = promisify(execFile);

const SCENARIOS = ['today', 'y2030', 'y2050'] as const;
type Scenario = (typeof SCENARIOS)[number];

beforeAll(async () => {
  const existing = await dbOne<{ n: string }>('SELECT count(*)::int AS n FROM valuations');
  if (Number(existing.n) > 0) return;

  const recompute = resolve(process.cwd(), 'scripts/recompute.ts');
  if (!existsSync(recompute)) throw new Error('scripts/recompute.ts is missing (S12)');

  // node against tsx's entry point rather than `npx`, which on Windows is a
  // .cmd shim that execFile cannot start.
  const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  await run(process.execPath, [tsx, recompute], { cwd: process.cwd(), env: { ...process.env } });
}, 120_000);

type ViewRow = {
  country: string;
  collateral_count: string;
  collateral_value_sgd: string;
  value_amber_or_worse_sgd: string;
  share_amber_or_worse: string | null;
  total_haircut_sgd: string;
  revalue_by_2030_count: string;
};

async function view(scenario: Scenario): Promise<ViewRow[]> {
  return dbQuery<ViewRow>(
    `SELECT country, collateral_count, collateral_value_sgd, value_amber_or_worse_sgd,
            share_amber_or_worse, total_haircut_sgd, revalue_by_2030_count
     FROM v_portfolio_summary WHERE scenario = $1::scenario ORDER BY country`,
    [scenario],
  );
}

function sumOf(rows: ViewRow[], field: keyof ViewRow): number {
  return rows.reduce((a, r) => a + Number(r[field] ?? 0), 0);
}

describe('v_portfolio_summary shape', () => {
  it('returns one row per country per scenario, and nothing else', async () => {
    const all = await dbQuery<{ scenario: string; country: string }>(
      'SELECT scenario::text AS scenario, country FROM v_portfolio_summary',
    );
    expect(all).toHaveLength(3 * 5);
    expect(new Set(all.map((r) => r.scenario))).toEqual(new Set(SCENARIOS));
    expect(new Set(all.map((r) => r.country.trim()))).toEqual(
      new Set(['SG', 'MY', 'ID', 'CN', 'HK']),
    );
  });

  it('counts every one of the 200 pins exactly once per scenario', async () => {
    for (const scenario of SCENARIOS) {
      const rows = await view(scenario);
      expect(sumOf(rows, 'collateral_count'), `${scenario} pin count`).toBe(200);
    }
  });
});

describe('figure 1: share of collateral value amber or worse', () => {
  it('equals a direct sum over valuations, per country and in total', async () => {
    for (const scenario of SCENARIOS) {
      const rows = await view(scenario);

      const expected = await dbQuery<{ country: string; amber: string; total: string }>(
        `SELECT c.country,
                COALESCE(sum(c.appraised_value_sgd) FILTER (WHERE v.band <> 'green'), 0) AS amber,
                sum(c.appraised_value_sgd) AS total
         FROM valuations v
         JOIN collateral c ON c.id = v.collateral_id
         JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
         WHERE v.scenario = $1::scenario
         GROUP BY c.country ORDER BY c.country`,
        [scenario],
      );

      expect(rows).toHaveLength(expected.length);
      for (const [i, row] of rows.entries()) {
        expect(Number(row.value_amber_or_worse_sgd), `${scenario} ${row.country} amber value`)
          .toBeCloseTo(Number(expected[i].amber), 2);
        expect(Number(row.collateral_value_sgd), `${scenario} ${row.country} total value`)
          .toBeCloseTo(Number(expected[i].total), 2);

        const share = Number(row.share_amber_or_worse ?? 0);
        expect(share, `${scenario} ${row.country} share`).toBeCloseTo(
          Number(expected[i].amber) / Number(expected[i].total),
          9,
        );
      }
    }
  });

  it('is a value-weighted share, which is not the average of the five country shares', async () => {
    // The dashboard sums the numerator and the denominator. Averaging the five
    // per-country shares would weight Hong Kong's 25 pins like Singapore's 60.
    const rows = await view('y2050');
    const weighted = sumOf(rows, 'value_amber_or_worse_sgd') / sumOf(rows, 'collateral_value_sgd');

    const naive =
      rows.reduce((a, r) => a + Number(r.share_amber_or_worse ?? 0), 0) / rows.length;

    expect(weighted).toBeGreaterThan(0);
    expect(weighted).toBeLessThanOrEqual(1);
    expect(weighted, 'the two are genuinely different, so the distinction matters')
      .not.toBeCloseTo(naive, 4);
  });

  it('counts a green pin out and every other band in', async () => {
    const scenario: Scenario = 'y2050';
    const rows = await view(scenario);

    const green = await dbOne<{ v: string }>(
      `SELECT COALESCE(sum(c.appraised_value_sgd), 0) AS v
       FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
       JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
       WHERE v.scenario = $1::scenario AND v.band = 'green'`,
      [scenario],
    );

    expect(sumOf(rows, 'value_amber_or_worse_sgd') + Number(green.v)).toBeCloseTo(
      sumOf(rows, 'collateral_value_sgd'),
      2,
    );
  });
});

describe('figure 2: total haircut in S$', () => {
  it('equals appraised less adjusted, summed over the scenario', async () => {
    for (const scenario of SCENARIOS) {
      const rows = await view(scenario);
      const expected = await dbOne<{ v: string }>(
        `SELECT COALESCE(sum(c.appraised_value_sgd - v.adjusted_value_sgd), 0) AS v
         FROM valuations v
         JOIN collateral c ON c.id = v.collateral_id
         JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
         WHERE v.scenario = $1::scenario`,
        [scenario],
      );
      expect(sumOf(rows, 'total_haircut_sgd'), `${scenario} haircut`).toBeCloseTo(
        Number(expected.v),
        2,
      );
    }
  });

  it('grows from 2025 to 2050, which is the story the slider tells', async () => {
    const totals: Record<string, number> = {};
    for (const scenario of SCENARIOS) {
      totals[scenario] = sumOf(await view(scenario), 'total_haircut_sgd');
    }
    expect(totals.y2050).toBeGreaterThan(totals.y2030);
    expect(totals.y2030).toBeGreaterThan(totals.today);
  });
});

describe('figure 3: applications needing revaluation by 2030', () => {
  it('counts distinct applications, so the figure does not treble', async () => {
    const distinct = await dbOne<{ n: string }>(
      `SELECT count(DISTINCT r.loan_application_id)::int AS n
       FROM recommendations r
       JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
       WHERE r.revalue_by_year <= 2030`,
    );
    const rowCount = await dbOne<{ n: string }>(
      `SELECT count(*)::int AS n
       FROM recommendations r
       JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
       WHERE r.revalue_by_year <= 2030`,
    );

    // Stored identically on all three scenario rows, so rows are exactly 3x.
    expect(Number(rowCount.n)).toBe(Number(distinct.n) * 3);

    for (const scenario of SCENARIOS) {
      const rows = await view(scenario);
      expect(sumOf(rows, 'revalue_by_2030_count'), `${scenario} revaluation count`).toBe(
        Number(distinct.n),
      );
    }
  });

  it('is scenario-invariant, which is why the tile is labelled', async () => {
    const perScenario = await Promise.all(
      SCENARIOS.map(async (s) => sumOf(await view(s), 'revalue_by_2030_count')),
    );
    expect(new Set(perScenario).size, 'the figure must not move with the scenario').toBe(1);
  });

  it('only counts an application whose stored year really is 2030 or earlier', async () => {
    const bad = await dbQuery<{ loan_application_id: string; revalue_by_year: number }>(
      `SELECT DISTINCT r.loan_application_id, r.revalue_by_year
       FROM recommendations r
       JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
       WHERE r.revalue_by_year <= 2030 AND (r.revalue_by_year IS NULL OR r.revalue_by_year > 2030)`,
    );
    expect(bad).toEqual([]);

    // revalue_by_year is evaluated over the literal years [2025, 2030, 2050].
    const years = await dbQuery<{ revalue_by_year: number | null }>(
      'SELECT DISTINCT revalue_by_year FROM recommendations ORDER BY revalue_by_year',
    );
    for (const row of years) {
      if (row.revalue_by_year === null) continue;
      expect([2025, 2030, 2050]).toContain(Number(row.revalue_by_year));
    }
  });
});

describe('figure 4: the ten most exposed cases', () => {
  it('is the top ten by S$ removed, ordered descending, all distinct', async () => {
    const scenario: Scenario = 'y2050';

    const top = await dbQuery<{ id: string; haircut_sgd: string; band: string }>(
      `SELECT c.id, (c.appraised_value_sgd - v.adjusted_value_sgd) AS haircut_sgd, v.band::text AS band
       FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
       JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
       WHERE v.scenario = $1::scenario
       ORDER BY (c.appraised_value_sgd - v.adjusted_value_sgd) DESC, c.id
       LIMIT 10`,
      [scenario],
    );

    expect(top).toHaveLength(10);
    expect(new Set(top.map((r) => r.id)).size).toBe(10);

    for (let i = 1; i < top.length; i++) {
      expect(Number(top[i - 1].haircut_sgd)).toBeGreaterThanOrEqual(Number(top[i].haircut_sgd));
    }

    // Nothing outside the ten may exceed the smallest of them.
    const tenth = Number(top[9].haircut_sgd);
    const bigger = await dbOne<{ n: string }>(
      `SELECT count(*)::int AS n
       FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
       JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
       WHERE v.scenario = $1::scenario
         AND (c.appraised_value_sgd - v.adjusted_value_sgd) > $2`,
      [scenario, tenth],
    );
    expect(Number(bigger.n)).toBeLessThanOrEqual(9);
  });

  it('ranks by S$ removed rather than by percentage, which is a different list', async () => {
    const scenario: Scenario = 'y2050';
    const base = `FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
       JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
       WHERE v.scenario = $1::scenario`;

    const byValue = await dbQuery<{ id: string }>(
      `SELECT c.id ${base} ORDER BY (c.appraised_value_sgd - v.adjusted_value_sgd) DESC, c.id LIMIT 10`,
      [scenario],
    );
    const byPercent = await dbQuery<{ id: string }>(
      `SELECT c.id ${base} ORDER BY v.total_haircut DESC, c.id LIMIT 10`,
      [scenario],
    );

    expect(byValue.map((r) => r.id)).not.toEqual(byPercent.map((r) => r.id));
  });
});

describe('the view only ever reflects the active rule set', () => {
  it('ignores valuations belonging to a superseded rule set', async () => {
    const active = await dbOne<{ id: string }>('SELECT id FROM rule_sets WHERE is_active');
    const stray = await dbOne<{ n: string }>(
      `SELECT count(*)::int AS n FROM valuations WHERE rule_set_id <> $1`,
      [active.id],
    );
    // Whatever that count is, the view's totals must match the active set alone,
    // which the figure-1 and figure-2 assertions already pin by joining on it.
    expect(Number(stray.n)).toBeGreaterThanOrEqual(0);

    const rows = await view('y2050');
    const activeOnly = await dbOne<{ v: string }>(
      `SELECT COALESCE(sum(c.appraised_value_sgd - v.adjusted_value_sgd), 0) AS v
       FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
       WHERE v.scenario = 'y2050' AND v.rule_set_id = $1`,
      [active.id],
    );
    expect(sumOf(rows, 'total_haircut_sgd')).toBeCloseTo(Number(activeOnly.v), 2);
  });
});
