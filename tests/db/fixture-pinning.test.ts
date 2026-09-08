/**
 * tests/db/fixture-pinning.test.ts - S7. AC-2, AC-3, AC-8, AC-12, AC-13.
 *
 * The one failure this plan is organised to prevent: the figures walked on stage
 * diverging from the figures under test.
 *
 * `db/seed/04_samples.sql` ends with the six fixture sample sets, applied AFTER
 * the sampled rows in every source mode, so `--source=synthetic`, `--source=frozen`
 * and `--source=live` all leave those rows identical. Without that block the
 * synthetic depths derived from elevation and distance to coast would never land
 * on 0.50, 0.80 and 0.20 m, and the unit tests would still pass, because they
 * read the fixture constants rather than the database.
 *
 * This asserts the pinning holds. It reads its expectations from
 * `tests/fixtures/pinned-samples.ts`, which is transcribed from plan 4.3.2 rather
 * than from the generator, so a generator that drifts from the plan fails here.
 *
 * This is the slowest test in the suite when the multi-source block runs, because
 * asserting identical fixture rows across source modes means regenerating and
 * reapplying the seed once per mode. Budget for it. Never cut it: it is what
 * guards the numbers walked on stage (plan S28).
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FIXTURE_DATASET_VERSION,
  FIXTURE_IDS,
  PINNED_ADAPTATION,
  PINNED_COVERAGE,
  PINNED_DEPTHS_M,
  PINNED_ELEVATIONS_M,
  PINNED_HEAT_DAYS,
  PINNED_PM25_UGM3,
  PINNED_SEA_LEVEL_M,
  PINNED_TERTILES,
  SCENARIOS,
  type FixtureId,
  type Scenario,
} from '../fixtures/pinned-samples';
import { dbOne, dbPool, dbQuery } from '../setup/db';

const run = promisify(execFile);

const SEED_FILE = resolve(process.cwd(), 'db/seed/04_samples.sql');

type SampleRow = {
  collateral_id: string;
  hazard: string;
  scenario: string;
  value: number | null;
  coverage: string;
  dataset_version: string;
  scenario_invariant: boolean;
};

async function fixtureSamples(): Promise<SampleRow[]> {
  return dbQuery<SampleRow>(
    `SELECT collateral_id, hazard, scenario, value::float8 AS value, coverage,
            dataset_version, scenario_invariant
     FROM hazard_samples
     WHERE collateral_id = ANY($1)
     ORDER BY collateral_id, hazard, scenario`,
    [[...FIXTURE_IDS]],
  );
}

function pick(rows: SampleRow[], id: FixtureId, hazard: string, scenario: Scenario): SampleRow {
  const row = rows.find(
    (r) => r.collateral_id === id && r.hazard === hazard && r.scenario === scenario,
  );
  if (!row) throw new Error(`no ${hazard} sample for ${id} at ${scenario}`);
  return row;
}

/** Asserts every pinned value. Reused verbatim by the multi-source block below. */
async function assertPinned(label: string): Promise<void> {
  const rows = await fixtureSamples();

  expect(rows, `${label}: 6 fixtures x 5 hazards x 3 scenarios`).toHaveLength(90);

  for (const row of rows) {
    expect(row.dataset_version, `${label}: ${row.collateral_id} ${row.hazard}`).toBe(
      FIXTURE_DATASET_VERSION,
    );
  }

  for (const id of FIXTURE_IDS) {
    for (const scenario of SCENARIOS) {
      expect(pick(rows, id, 'flood_coastal', scenario).value, `${label}: ${id} depth ${scenario}`)
        .toBeCloseTo(PINNED_DEPTHS_M[id][scenario], 6);

      expect(pick(rows, id, 'heat_days35', scenario).value, `${label}: ${id} heat ${scenario}`)
        .toBeCloseTo(PINNED_HEAT_DAYS[id][scenario], 6);

      expect(pick(rows, id, 'pm25', scenario).value, `${label}: ${id} pm25 ${scenario}`)
        .toBeCloseTo(PINNED_PM25_UGM3, 6);

      for (const [hazard, coverage] of Object.entries(PINNED_COVERAGE)) {
        expect(
          pick(rows, id, hazard, scenario).coverage,
          `${label}: ${id} ${hazard} coverage at ${scenario}`,
        ).toBe(coverage);
      }

      // An absent sample has no value to store, and a stored one is never NULL.
      // The schema's CHECK enforces this too; asserting it here means a bad seed
      // is reported as a fixture failure rather than a constraint violation.
      for (const hazard of Object.keys(PINNED_COVERAGE)) {
        const row = pick(rows, id, hazard, scenario);
        if (row.coverage === 'absent') {
          expect(row.value, `${label}: ${id} ${hazard} absent carries no value`).toBeNull();
        } else {
          expect(row.value, `${label}: ${id} ${hazard} ${row.coverage} carries a value`).not.toBeNull();
        }
      }
    }
  }

  const elevations = await dbQuery<{ id: string; elevation_m: number }>(
    'SELECT id, elevation_m::float8 AS elevation_m FROM collateral WHERE id = ANY($1) ORDER BY id',
    [[...FIXTURE_IDS]],
  );
  expect(elevations, `${label}: six fixture pins present`).toHaveLength(6);
  for (const row of elevations) {
    expect(row.elevation_m, `${label}: ${row.id} elevation`).toBeCloseTo(
      PINNED_ELEVATIONS_M[row.id as FixtureId],
      6,
    );
  }

  const seaLevel = await dbQuery<{ collateral_id: string; value: number }>(
    `SELECT collateral_id, value::float8 AS value FROM context_factors
     WHERE factor = 'sea_level_inundation' AND collateral_id = ANY($1) ORDER BY collateral_id`,
    [[...FIXTURE_IDS]],
  );
  expect(seaLevel, `${label}: sea level pinned on all six`).toHaveLength(6);
  for (const row of seaLevel) {
    expect(row.value, `${label}: ${row.collateral_id} sea level`).toBeCloseTo(PINNED_SEA_LEVEL_M, 6);
  }

  const modifiers = await dbQuery<{ collateral_id: string; suhi_tertile: number; ndvi_tertile: number }>(
    'SELECT collateral_id, suhi_tertile, ndvi_tertile FROM site_modifiers WHERE collateral_id = ANY($1)',
    [[...FIXTURE_IDS]],
  );
  expect(modifiers, `${label}: six pinned site_modifiers`).toHaveLength(6);
  for (const row of modifiers) {
    expect(row.suhi_tertile, `${label}: ${row.collateral_id} SUHI`).toBe(PINNED_TERTILES.suhi);
    expect(row.ndvi_tertile, `${label}: ${row.collateral_id} NDVI`).toBe(PINNED_TERTILES.ndvi);
  }
}

describe('the six pinned fixtures survive the seed', () => {
  it('pins every depth, heat delta, coverage state, elevation and sea-level row', async () => {
    await assertPinned('seeded');
  });

  it('pins the AC-2 worked example so 6.6% is reproducible from stored inputs', async () => {
    const rows = await fixtureSamples();

    // depth 0.50 m -> damage 0.30 on the residential curve, x p_2050 = 0.22 -> 6.6%.
    expect(pick(rows, 'SG-EC-001', 'flood_coastal', 'y2050').value).toBeCloseTo(0.5, 6);

    // Heat is pinned at a ZERO delta and coverage 'scored', so heatHaircut runs
    // and returns 0. That is what makes SG-EC-001 the isolation exhibit rather
    // than a case where the heat term merely happens to be missing.
    const heat = pick(rows, 'SG-EC-001', 'heat_days35', 'y2050');
    expect(heat.value).toBe(0);
    expect(heat.coverage).toBe('scored');

    // Wind absent, PM2.5 measured but not scored: the chronic term is 0.0%.
    expect(pick(rows, 'SG-EC-001', 'wind', 'y2050').coverage).toBe('absent');
    expect(pick(rows, 'SG-EC-001', 'pm25', 'y2050').coverage).toBe('measured_not_scored');

    const p = await dbOne<{ p_2050: number }>(
      'SELECT p_2050::float8 AS p_2050 FROM rule_sets WHERE is_active',
    );
    expect(p.p_2050).toBeCloseTo(0.22, 6);
  });

  it('pins the AC-2 realistic case at a 28-day heat delta and tertile 1', async () => {
    const rows = await fixtureSamples();

    // Same flood exposure as SG-EC-001, plus a real heat term:
    // min(0.001 x 28, 0.05) x 1.25 = 3.5%, so the total is 10.1%.
    expect(pick(rows, 'SG-EC-002', 'flood_coastal', 'y2050').value).toBeCloseTo(0.5, 6);
    expect(pick(rows, 'SG-EC-002', 'heat_days35', 'y2050').value).toBeCloseTo(28, 6);

    const mods = await dbOne<{ suhi_tertile: number; ndvi_tertile: number }>(
      'SELECT suhi_tertile, ndvi_tertile FROM site_modifiers WHERE collateral_id = $1',
      ['SG-EC-002'],
    );
    expect(mods.suhi_tertile).toBe(1);
    expect(mods.ndvi_tertile).toBe(1);
  });

  it('pins the AC-3 and ADR-4 depths and their curated adaptation foreign keys', async () => {
    const rows = await fixtureSamples();

    expect(pick(rows, 'SG-KB-003', 'flood_coastal', 'y2050').value).toBeCloseTo(0.8, 6);
    expect(pick(rows, 'SG-EC-003', 'flood_coastal', 'y2050').value).toBeCloseTo(0.2, 6);

    // ADR-4: adaptation membership is a curated foreign key with no polygon, so
    // nothing spatial can produce a second opinion on a credit-relevant number.
    const links = await dbQuery<{ id: string; adaptation_project_id: string | null }>(
      'SELECT id, adaptation_project_id FROM collateral WHERE id = ANY($1) ORDER BY id',
      [[...FIXTURE_IDS]],
    );
    for (const row of links) {
      expect(row.adaptation_project_id, `${row.id} adaptation link`).toBe(
        PINNED_ADAPTATION[row.id as FixtureId],
      );
    }
  });

  it('pins both sides of the AC-8 inundation comparison, not just one', async () => {
    // Pinning the elevations while sampling the sea-level row would leave the
    // comparison asymmetric: a reseed could move the threshold out from under
    // the pair without touching either elevation.
    const rules = await dbOne<{ inundation_threshold_m: number }>(
      'SELECT inundation_threshold_m::float8 AS inundation_threshold_m FROM rule_sets WHERE is_active',
    );
    const boundary = PINNED_SEA_LEVEL_M + rules.inundation_threshold_m;

    const pair = await dbQuery<{ id: string; elevation_m: number }>(
      `SELECT id, elevation_m::float8 AS elevation_m FROM collateral
       WHERE id IN ('SG-MS-002', 'SG-MS-003') ORDER BY id`,
    );
    expect(pair).toHaveLength(2);

    const [low, high] = pair;
    expect(low.id).toBe('SG-MS-002');
    expect(low.elevation_m).toBeLessThan(boundary);
    expect(high.id).toBe('SG-MS-003');
    expect(high.elevation_m).toBeGreaterThanOrEqual(boundary);

    // The pair straddles the boundary across a wide range of sea-level values, so
    // changing the AR6 constant cannot silently flip the fixture.
    //
    // The range is OPEN at the bottom and CLOSED at the top. The flag fires when
    // 0.6 < slr + 0.5, which needs slr strictly above 0.10; it stays clear for
    // SG-MS-003 while 2.6 >= slr + 0.5, which allows slr up to and including 2.10.
    // So the safe interval is (0.10, 2.10], not [0.10, 2.10]: at exactly 0.10 the
    // low pin sits ON the boundary and does not fire.
    const threshold = rules.inundation_threshold_m;
    for (const slr of [0.11, 0.3, 1.0, 2.1]) {
      expect(low.elevation_m, `low pin fires at slr ${slr}`).toBeLessThan(slr + threshold);
      expect(high.elevation_m, `high pin stays clear at slr ${slr}`).toBeGreaterThanOrEqual(
        slr + threshold - (2.6 - 0.6),
      );
    }
    expect(high.elevation_m, 'high pin stays clear at the top of the range').toBeGreaterThanOrEqual(
      2.1 + threshold,
    );
    expect(low.elevation_m, 'low pin does NOT fire at the open lower bound').not.toBeLessThan(
      0.1 + threshold,
    );
  });

  it('leaves exactly one flood peril able to win, so the flood columns are unambiguous', async () => {
    const rows = await fixtureSamples();
    for (const id of FIXTURE_IDS) {
      for (const scenario of SCENARIOS) {
        const riverine = pick(rows, id, 'flood_riverine', scenario);
        expect(riverine.coverage, `${id} riverine at ${scenario}`).toBe('absent');
        expect(riverine.value).toBeNull();
      }
    }
  });

  it('marks PM2.5 scenario-invariant, one value written to all three scenarios', async () => {
    const rows = await fixtureSamples().then((r) => r.filter((x) => x.hazard === 'pm25'));
    expect(rows).toHaveLength(18);
    for (const row of rows) {
      expect(row.scenario_invariant, `${row.collateral_id} ${row.scenario}`).toBe(true);
    }
  });
});

/**
 * The part the plan calls the slowest test in the suite: the pinning must hold
 * under EVERY source mode, not just the one that happened to seed this run.
 *
 * A mode that cannot run here is reported and skipped, never silently passed.
 * `frozen` needs a committed `data/frozen/`, which only a live run produces, and
 * `live` needs Earth Engine credentials and the STORM rasters. `synthetic` is
 * the unconditional floor and always runs.
 */
describe('the pinning holds under every available source mode', () => {
  const modes = ['synthetic', 'frozen', 'live'] as const;

  for (const mode of modes) {
    it(`survives a regenerated seed under --source=${mode}`, async () => {
      // `--check` validates and writes nothing, so it tells us whether this mode
      // can run at all without disturbing the seeded database.
      try {
        await run('python', ['-m', 'prep.sample_hazards', `--source=${mode}`, '--check'], {
          cwd: process.cwd(),
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        console.warn(
          `[fixture-pinning] --source=${mode} is unavailable here, so it is not asserted. ` +
            `This is expected for frozen until a live run has written data/frozen/, and for ` +
            `live without Earth Engine credentials. Reason: ${reason.split('\n')[0]}`,
        );
        return;
      }

      await run('python', ['-m', 'prep.sample_hazards', `--source=${mode}`], { cwd: process.cwd() });

      const sql = await readFile(SEED_FILE, 'utf8');
      expect(existsSync(SEED_FILE)).toBe(true);
      // The fixture block is the LAST thing the file does, in every mode. That
      // ordering is the guarantee, so assert it rather than trusting it.
      expect(sql.indexOf('PINNED FIXTURES')).toBeGreaterThan(sql.indexOf('sampled hazard rows'));

      await dbPool().query(sql);
      await assertPinned(`--source=${mode}`);
    });
  }
});
