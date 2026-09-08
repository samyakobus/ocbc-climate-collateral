/**
 * tests/db/reference-seed.test.ts - S8. What 02_reference.sql actually seeded.
 *
 * `tests/unit/curve-fixtures.test.ts` pins the curve as TypeScript constants.
 * This pins the rows those constants were generated into, so a hand edit to the
 * generated SQL, or a schema change that silently drops a column, fails here
 * rather than on stage.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILDING_DAMAGE_CLASS,
  BUILDING_TYPES,
  CURVE_LABEL,
  DEPTH_DAMAGE_CURVES,
} from '../../lib/rules/curves';
import { RULE_SET_SEED_DEFAULTS } from '../../lib/rules/bands';
import { dbOne, dbQuery } from '../setup/db';

describe('depth_damage_functions', () => {
  it('holds all three curves, labelled as a curated fit', async () => {
    /* Ordered as text: ORDER BY on an enum column sorts by DECLARATION order,
       which here is residential, commercial, industrial. */
    const rows = await dbQuery<{ damage_class: string; curve_label: string }>(
      'SELECT damage_class::text, curve_label FROM depth_damage_functions ORDER BY damage_class::text',
    );

    expect(rows.map((r) => r.damage_class)).toEqual(['commercial', 'industrial', 'residential']);
    for (const row of rows) {
      expect(row.curve_label).toBe(CURVE_LABEL);
    }
  });

  it('stores points identical to lib/rules/curves.ts, so the seed cannot drift', async () => {
    for (const [damageClass, points] of Object.entries(DEPTH_DAMAGE_CURVES)) {
      const row = await dbOne<{ points: { depth_m: number; damage_fraction: number }[] }>(
        'SELECT points FROM depth_damage_functions WHERE damage_class = $1',
        [damageClass],
      );
      expect(row.points).toEqual(points.map((p) => ({ ...p })));
    }
  });

  it('pins the two residential points AC-2 and AC-3 rest on', async () => {
    const row = await dbOne<{ at_half: string; at_one: string }>(
      `SELECT
         (points -> 1 ->> 'damage_fraction') AS at_half,
         (points -> 2 ->> 'damage_fraction') AS at_one
       FROM depth_damage_functions WHERE damage_class = 'residential'`,
    );
    expect(Number(row.at_half)).toBe(0.3);
    expect(Number(row.at_one)).toBe(0.5);
  });
});

describe('building_damage_class', () => {
  it('maps exactly the six building types onto their damage classes', async () => {
    const rows = await dbQuery<{ building_type: string; damage_class: string }>(
      'SELECT building_type, damage_class FROM building_damage_class',
    );

    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.building_type))).toEqual(new Set(BUILDING_TYPES));
    for (const row of rows) {
      expect(row.damage_class).toBe(
        BUILDING_DAMAGE_CLASS[row.building_type as keyof typeof BUILDING_DAMAGE_CLASS],
      );
    }
  });
});

describe('hazard_applicability', () => {
  it('has exactly 25 rows, five hazards by five countries', async () => {
    const row = await dbOne<{ n: number; hazards: number; countries: number }>(
      `SELECT count(*)::int AS n,
              count(DISTINCT hazard)::int AS hazards,
              count(DISTINCT country)::int AS countries
       FROM hazard_applicability`,
    );
    expect(row.n).toBe(25);
    expect(row.hazards).toBe(5);
    expect(row.countries).toBe(5);
  });

  it('scores nothing but wind and PM2.5 out, and only in SG, MY and ID', async () => {
    const rows = await dbQuery<{ hazard: string; country: string }>(
      'SELECT hazard::text, country FROM hazard_applicability WHERE NOT scored ORDER BY hazard, country',
    );

    expect(rows.map((r) => `${r.hazard}/${r.country}`)).toEqual([
      'pm25/ID',
      'pm25/MY',
      'pm25/SG',
      'wind/ID',
      'wind/MY',
      'wind/SG',
    ]);
  });

  it('gives every row a reason and a source url, which the provenance panel renders', async () => {
    const row = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM hazard_applicability
       WHERE coalesce(reason, '') = '' OR coalesce(source_url, '') = ''`,
    );
    expect(row.n).toBe(0);
  });
});

describe('adaptation_projects', () => {
  /* The ids are foreign keys from collateral, so they are a contract. */
  const EXPECTED: readonly [string, number][] = [
    ['cn-shanghai-seawall', 2.5],
    ['hk-drainage-tunnels', 2.25],
    ['id-banger-polder', 1.5],
    ['id-ncicd-phase-a', 2.5],
    ['my-smart-tunnel', 2.0],
    ['sg-long-island', 3.0],
    ['sg-marina-barrage', 1.5],
  ];

  it('holds the seven curated projects with the plan credits, keyed by their slugs', async () => {
    const rows = await dbQuery<{ id: string; haircut_credit_pp: string }>(
      'SELECT id, haircut_credit_pp FROM adaptation_projects ORDER BY id',
    );

    expect(rows.map((r) => [r.id, Number(r.haircut_credit_pp)])).toEqual(
      EXPECTED.map(([id, pp]) => [id, pp]),
    );
  });

  it('carries no polygon, because membership is a curated foreign key (ADR-4)', async () => {
    const row = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'adaptation_projects'
         AND column_name IN ('area', 'geom', 'centroid')`,
    );
    expect(row.n).toBe(0);
  });
});

describe('the active rule set', () => {
  it('is unique, and carries every ADR-5 and ADR-6 constant', async () => {
    const count = await dbOne<{ n: number }>(
      'SELECT count(*)::int AS n FROM rule_sets WHERE is_active',
    );
    expect(count.n).toBe(1);

    const row = await dbOne<Record<string, string | number | boolean>>(
      `SELECT base_ltv_personal, base_ltv_corporate, band_low, band_mid, band_high,
              total_cap, chronic_cap, p_today, p_2030, p_2050,
              today_year, today_label, return_period, inundation_threshold_m,
              adaptation_enabled
       FROM rule_sets WHERE is_active`,
    );

    const r = RULE_SET_SEED_DEFAULTS;
    expect(Number(row.base_ltv_personal)).toBe(r.base_ltv_personal);
    expect(Number(row.base_ltv_corporate)).toBe(r.base_ltv_corporate);
    expect(Number(row.band_low)).toBe(r.band_low);
    expect(Number(row.band_mid)).toBe(r.band_mid);
    expect(Number(row.band_high)).toBe(r.band_high);
    expect(Number(row.total_cap)).toBe(r.total_cap);
    expect(Number(row.chronic_cap)).toBe(r.chronic_cap);
    expect(Number(row.p_today)).toBe(r.p_today);
    expect(Number(row.p_2030)).toBe(r.p_2030);
    expect(Number(row.p_2050)).toBe(r.p_2050);
    expect(Number(row.today_year)).toBe(r.today_year);
    expect(row.today_label).toBe(r.today_label);
    expect(Number(row.return_period)).toBe(r.return_period);
    expect(Number(row.inundation_threshold_m)).toBe(r.inundation_threshold_m);
    expect(row.adaptation_enabled).toBe(r.adaptation_enabled);
  });
});

describe('the three seeded users', () => {
  it('are the only accounts, one per role', async () => {
    const rows = await dbQuery<{ email: string; role: string }>(
      'SELECT email, role::text FROM users ORDER BY email',
    );

    expect(rows).toEqual([
      { email: 'corp@ocbc.demo', role: 'corporate_credit_officer' },
      { email: 'officer@ocbc.demo', role: 'loan_officer' },
      { email: 'risk@ocbc.demo', role: 'risk_manager' },
    ]);
  });

  it('store a bcrypt hash at cost 10, never a plaintext password', async () => {
    const rows = await dbQuery<{ password_hash: string }>('SELECT password_hash FROM users');
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^\$2[aby]\$10\$/);
    }
  });
});
