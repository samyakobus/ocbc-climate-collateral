/**
 * tests/db/provenance-panel.test.ts - S13. AC-12.
 *
 * Principle 3: a number without a dataset name, version, scenario and sampled-at
 * date does not ship. AC-12 says every rendered number must resolve to a row
 * carrying those four, and that a `measured_not_scored` row must render its
 * applicability reason AND its measured value rather than the word "n/a".
 *
 * This asserts the data behind the panel rather than the panel itself. The
 * component test covers what is drawn; if the row cannot answer "where did this
 * come from", no component can draw it, and a director asking the question on
 * stage gets silence.
 *
 * Every table below feeds a line on that panel: `hazard_samples` the four hazard
 * figures, `site_modifiers` the UHI and greenness tertiles behind the heat term,
 * `depth_damage_functions` the curve the flood depth is read through,
 * `adaptation_projects` the credit, `hazard_applicability` the exclusion reason,
 * and `context_factors` the seven unscored rows in the context panel.
 */

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

const run = promisify(execFile);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const URL_RE = /^https?:\/\/\S+$/;

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('hazard_samples carry full provenance', () => {
  it('gives every sample a dataset, a version, a unit, a scenario and a sample date', async () => {
    const bad = await dbQuery<{ collateral_id: string; hazard: string; scenario: string }>(
      `SELECT collateral_id, hazard, scenario FROM hazard_samples
       WHERE dataset_name IS NULL OR btrim(dataset_name) = ''
          OR dataset_version IS NULL OR btrim(dataset_version) = ''
          OR unit IS NULL OR btrim(unit) = ''
          OR sampled_at IS NULL
       LIMIT 20`,
    );
    expect(bad, `${bad.length} sample(s) without full provenance`).toEqual([]);
  });

  it('records the pinned Aqueduct ensemble and SLR percentile on every flood row', async () => {
    // An unpinned Aqueduct pick makes two runs disagree, so the version string is
    // where that choice is recorded and a reviewer can check it.
    const versions = await dbQuery<{ dataset_version: string; n: number }>(
      `SELECT dataset_version, count(*)::int AS n FROM hazard_samples
       WHERE hazard IN ('flood_riverine', 'flood_coastal')
       GROUP BY 1 ORDER BY 2 DESC`,
    );
    expect(versions.length).toBeGreaterThan(0);
    for (const row of versions) {
      expect(isFilled(row.dataset_version), 'flood dataset_version').toBe(true);
    }

    // The flood rows are the ones that carry a pathway and a return period,
    // because the haircut is a 100-year event under RCP 8.5.
    const missing = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM hazard_samples
       WHERE hazard IN ('flood_riverine', 'flood_coastal')
         AND coverage <> 'absent'
         AND (pathway IS NULL OR return_period_yrs IS NULL)`,
    );
    expect(Number(missing.n)).toBe(0);
  });

  it('dates every sample, so "sampled at" is never blank on the panel', async () => {
    const rows = await dbQuery<{ sampled_at: string }>(
      'SELECT DISTINCT sampled_at::text AS sampled_at FROM hazard_samples',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sampled_at).toMatch(ISO_DATE);
    }
  });

  it('discloses the pinned fixture rows instead of passing them off as sampled', async () => {
    // The six fixtures are the only unsampled rows in the database. The demo
    // script says so out loud, and the provenance panel shows it, so the version
    // string has to be the disclosure rather than a plausible-looking dataset.
    const pinned = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM hazard_samples WHERE dataset_version = 'fixture: pinned'`,
    );
    expect(Number(pinned.n)).toBe(90);

    const ids = await dbQuery<{ collateral_id: string }>(
      `SELECT DISTINCT collateral_id FROM hazard_samples
       WHERE dataset_version = 'fixture: pinned' ORDER BY 1`,
    );
    expect(ids.map((r) => r.collateral_id)).toEqual([
      'SG-EC-001',
      'SG-EC-002',
      'SG-EC-003',
      'SG-KB-003',
      'SG-MS-002',
      'SG-MS-003',
    ]);
  });
});

describe('measured_not_scored rows render a reason AND a value', () => {
  it('resolves every excluded sample to an applicability reason and a source URL', async () => {
    // "Measured at 41 micrograms and not scored in Indonesia" needs three things
    // on screen: the value, the reason, and somewhere the reader can check it.
    // This asserts all three are reachable from the row by a single join.
    const rows = await dbQuery<{
      collateral_id: string;
      hazard: string;
      value: number | null;
      reason: string;
      source_url: string;
    }>(
      `SELECT h.collateral_id, h.hazard, h.value::float8 AS value, a.reason, a.source_url
       FROM hazard_samples h
       JOIN collateral c ON c.id = h.collateral_id
       JOIN hazard_applicability a ON a.hazard = h.hazard AND a.country = c.country
       WHERE h.coverage = 'measured_not_scored'`,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.value, `${row.collateral_id} ${row.hazard} keeps its measured value`).not.toBeNull();
      expect(isFilled(row.reason), `${row.collateral_id} ${row.hazard} reason`).toBe(true);
      expect(row.source_url).toMatch(URL_RE);
    }
  });

  it('leaves an absent sample with no value to render, and says why by omission', async () => {
    // An absent row has nothing to show, which is a different panel line from an
    // excluded one. Conflating them is the failure this partition exists to stop.
    const bad = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM hazard_samples WHERE coverage = 'absent' AND value IS NOT NULL`,
    );
    expect(Number(bad.n)).toBe(0);
  });
});

describe('the rest of the panel resolves to a source', () => {
  it('sources every depth-damage curve and labels it as a curated fit', async () => {
    // The curve is a curated fit adapted from Huizinga et al. 2017, not a
    // transcription, and the case screen says so. An unlabelled curve would be
    // the one number on the panel presenting a judgement as a citation.
    const rows = await dbQuery<{
      damage_class: string;
      curve_label: string;
      source_name: string;
      source_url: string;
    }>('SELECT damage_class, curve_label, source_name, source_url FROM depth_damage_functions');

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(isFilled(row.curve_label), `${row.damage_class} label`).toBe(true);
      expect(isFilled(row.source_name), `${row.damage_class} source`).toBe(true);
      expect(row.source_url).toMatch(URL_RE);
    }
  });

  it('sources every adaptation credit and marks it curated, not published', async () => {
    // Plan assumption 20: these are curated judgements traceable to named
    // programmes, not published protection values. The panel labels them that
    // way, so the flag has to be on the row.
    const rows = await dbQuery<{
      id: string;
      name: string;
      source_name: string;
      source_url: string;
      curated: boolean;
      haircut_credit_pp: number;
    }>(
      `SELECT id, name, source_name, source_url, curated, haircut_credit_pp::float8 AS haircut_credit_pp
       FROM adaptation_projects`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const row of rows) {
      expect(isFilled(row.name), `${row.id} name`).toBe(true);
      expect(isFilled(row.source_name), `${row.id} source`).toBe(true);
      expect(row.source_url).toMatch(URL_RE);
      expect(row.curated, `${row.id} curated`).toBe(true);
      expect(row.haircut_credit_pp).toBeGreaterThan(0);
    }
  });

  it('sources the two site modifiers behind the heat term', async () => {
    const bad = await dbQuery<{ collateral_id: string }>(
      `SELECT collateral_id FROM site_modifiers
       WHERE dataset_name IS NULL OR btrim(dataset_name) = ''
          OR dataset_version IS NULL OR btrim(dataset_version) = ''
          OR sampled_at IS NULL
       LIMIT 20`,
    );
    expect(bad).toEqual([]);

    const total = await dbOne<{ n: number }>('SELECT count(*)::int AS n FROM site_modifiers');
    expect(Number(total.n)).toBe(200);
  });

  it('sources all seven context factors on every pin', async () => {
    const bad = await dbQuery<{ collateral_id: string; factor: string }>(
      `SELECT collateral_id, factor FROM context_factors
       WHERE dataset_name IS NULL OR btrim(dataset_name) = ''
          OR source_url IS NULL OR source_url !~ '^https?://'
          OR unit IS NULL OR btrim(unit) = ''
          OR sampled_at IS NULL
       LIMIT 20`,
    );
    expect(bad).toEqual([]);

    const perPin = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT collateral_id FROM context_factors GROUP BY 1 HAVING count(*) <> 7
       ) wrong`,
    );
    expect(Number(perPin.n), 'every pin carries exactly seven context factors').toBe(0);
  });

  it('keeps the seven context factors unscored, with no path into a haircut', async () => {
    // They are shown, never summed. The schema gives them no scored flag and no
    // link to hazard_applicability, and this pins that they stay a separate table
    // from hazard_samples rather than drifting into it.
    const overlap = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM context_factors c
       WHERE c.factor::text IN (SELECT DISTINCT hazard::text FROM hazard_samples)`,
    );
    expect(Number(overlap.n)).toBe(0);
  });
});

/**
 * The valuation-linked half of AC-12: every number the case screen renders must
 * resolve back to a sampled row for the SAME scenario.
 *
 * `valuations` is written by `npm run db:recompute` (S12), which the db project's
 * global setup does not run, so this block runs the recompute itself when the
 * script exists. Until S12 lands it reports that it is not asserting rather than
 * passing quietly.
 */
describe('rendered valuations resolve to their inputs', () => {
  it('ties every stored valuation to samples of its own scenario', async () => {
    const recompute = resolve(process.cwd(), 'scripts/recompute.ts');
    if (!existsSync(recompute)) {
      console.warn(
        '[provenance-panel] scripts/recompute.ts does not exist yet (S12), so the ' +
          'valuation half of AC-12 is NOT asserted by this run. The sample, curve, ' +
          'adaptation and applicability provenance above is asserted in full.',
      );
      return;
    }

    const existing = await dbOne<{ n: number }>('SELECT count(*)::int AS n FROM valuations');
    if (Number(existing.n) === 0) {
      // Spawn node against tsx's own entry point rather than `npx`. On Windows
      // `npx` is a .cmd shim, which execFile cannot start without a shell, and
      // running it through a shell would need the arguments quoted by hand.
      const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
      await run(process.execPath, [tsx, recompute], {
        cwd: process.cwd(),
        env: { ...process.env },
      });
    }

    const total = await dbOne<{ n: number }>('SELECT count(*)::int AS n FROM valuations');
    expect(Number(total.n), '200 collateral x 3 scenarios').toBe(600);

    // A valuation that names a flood peril must have a sample for that peril in
    // that scenario. Reading a 2050 depth onto a 2030 row is the drift this stops.
    const orphaned = await dbQuery<{ collateral_id: string; scenario: string; winning_peril: string }>(
      `SELECT v.collateral_id, v.scenario::text AS scenario, v.winning_peril::text AS winning_peril
       FROM valuations v
       WHERE v.winning_peril IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM hazard_samples h
           WHERE h.collateral_id = v.collateral_id
             AND h.hazard::text = v.winning_peril::text
             AND h.scenario = v.scenario
             AND h.coverage = 'scored'
         )
       LIMIT 20`,
    );
    expect(orphaned, 'valuations naming a peril with no scored sample for that scenario').toEqual([]);

    // Every valuation must point at the rule set whose constants produced it, so
    // the panel can show which thresholds were in force.
    const ruleless = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM valuations v
       LEFT JOIN rule_sets r ON r.id = v.rule_set_id
       WHERE r.id IS NULL`,
    );
    expect(Number(ruleless.n)).toBe(0);
  });
});
