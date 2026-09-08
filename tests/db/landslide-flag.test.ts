/**
 * tests/db/landslide-flag.test.ts - AC-7.
 *
 * Landslide is a manual-review flag and never a number. The spec is explicit,
 * and this file holds that line from two directions: structurally, that the
 * engine has no way to price it, and in the data, that flagged pins exist for
 * the badge to appear on.
 */

import { describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

describe('landslide can never enter a haircut', () => {
  it('is absent from the hazard enum, so it cannot be sampled or scored', async () => {
    const rows = await dbQuery<{ label: string }>(
      `SELECT e.enumlabel AS label
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'hazard' ORDER BY e.enumsortorder`,
    );

    const labels = rows.map((r) => r.label);
    expect(labels).toEqual([
      'flood_riverine',
      'flood_coastal',
      'wind',
      'heat_days35',
      'pm25',
    ]);
    expect(labels).not.toContain('landslide');
  });

  it('has no haircut column of its own on valuations', async () => {
    const rows = await dbQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'valuations'
         AND column_name LIKE '%landslide%'`,
    );
    expect(rows).toEqual([]);
  });

  it('leaves the total explained entirely by the four scored hazards', async () => {
    /* If landslide were leaking into the total anywhere, this identity would
       fail for that pin. It is checked across all 600 valuations. */
    const violations = await dbQuery<{ collateral_id: string; scenario: string }>(
      `SELECT collateral_id, scenario::text AS scenario FROM valuations
       WHERE abs(
         total_haircut - LEAST(flood_haircut + wind_haircut + chronic_haircut, 0.25)
       ) > 0.0002`,
    );
    expect(violations).toEqual([]);
  });

  it('stores the flag as a boolean, never as a value', async () => {
    const row = await dbOne<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'collateral'
         AND column_name = 'landslide_flag'`,
    );
    expect(row.data_type).toBe('boolean');
  });
});

describe('the badge has something to render', () => {
  it('flags at least one pin, so AC-7 can be demonstrated', async () => {
    const row = await dbOne<{ flagged: number; total: number }>(
      `SELECT count(*) FILTER (WHERE landslide_flag)::int AS flagged,
              count(*)::int AS total
       FROM collateral`,
    );

    expect(
      row.flagged,
      `No pin in the portfolio carries landslide_flag (${row.total} pins checked). ` +
        'AC-7 requires a landslide badge on the case screen, and ' +
        'tests/component/landslide-badge.test.tsx has nothing to render against. ' +
        'prep/sample_hazards.py sets this from NASA LHASA; the synthetic floor ' +
        'needs to set it too, on the steeper Hong Kong and Malaysian pins.',
    ).toBeGreaterThan(0);
  });

  it('does not flag the whole book, which would make the badge meaningless', async () => {
    const row = await dbOne<{ flagged: number; total: number }>(
      `SELECT count(*) FILTER (WHERE landslide_flag)::int AS flagged,
              count(*)::int AS total
       FROM collateral`,
    );
    expect(row.flagged).toBeLessThan(row.total);
  });

  it('gives every flagged pin a slope to justify the flag', async () => {
    const unjustified = await dbQuery<{ id: string }>(
      'SELECT id FROM collateral WHERE landslide_flag AND slope_deg IS NULL',
    );
    expect(unjustified).toEqual([]);
  });

  it('does not change the haircut of a flagged pin relative to its hazards', async () => {
    /* A flagged pin and an unflagged one with the same scored hazards must
       carry the same total. Asserted as the identity above, restricted to the
       flagged subset so the intent is explicit. */
    const violations = await dbQuery<{ collateral_id: string }>(
      `SELECT v.collateral_id FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
       WHERE c.landslide_flag
         AND abs(
           v.total_haircut - LEAST(v.flood_haircut + v.wind_haircut + v.chronic_haircut, 0.25)
         ) > 0.0002`,
    );
    expect(violations).toEqual([]);
  });
});
