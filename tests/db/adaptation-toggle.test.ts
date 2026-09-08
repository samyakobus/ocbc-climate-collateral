/**
 * tests/db/adaptation-toggle.test.ts - AC-2, AC-3.
 *
 * Adaptation is a credit in haircut units, floored at zero (ADR-4), and
 * membership is a curated foreign key with no polygon, so nothing can derive a
 * second opinion about which properties a project protects.
 *
 * The foreign keys are asserted directly, because that is the fact the numbers
 * actually rest on. AC-2 depends on SG-EC-001 and SG-EC-002 having no
 * adaptation project while SG-EC-003, on the same East Coast, points at Long
 * Island. A shoreline polygon drawn the obvious way would have contained all
 * three and quietly broken the worked example.
 */

import { describe, expect, it } from 'vitest';

import { RULE_SET_SEED_DEFAULTS } from '@/lib/rules/bands';
import { BUILDING_DAMAGE_CLASS, DEPTH_DAMAGE_CURVES } from '@/lib/rules/curves';
import { valuate } from '@/lib/valuation/combine';
import type { DamageTables } from '@/lib/valuation/damage';
import type { RuleConstants } from '@/lib/valuation/hazards';

import { HAIRCUT_PRECISION, PINNED_FIXTURES, inputsFor } from '../fixtures/cases';
import { dbOne, dbQuery } from '../setup/db';

const tables: DamageTables = { curves: DEPTH_DAMAGE_CURVES, classOf: BUILDING_DAMAGE_CLASS };
const rules: RuleConstants = { ...RULE_SET_SEED_DEFAULTS };

describe('adaptation membership is a curated foreign key', () => {
  it('points the three East Coast fixtures where AC-2 and AC-3 need them', async () => {
    const rows = await dbQuery<{ id: string; adaptation_project_id: string | null }>(
      `SELECT id, adaptation_project_id FROM collateral
       WHERE id IN ('SG-EC-001', 'SG-EC-002', 'SG-EC-003', 'SG-KB-003') ORDER BY id`,
    );

    expect(rows).toEqual([
      { id: 'SG-EC-001', adaptation_project_id: null },
      { id: 'SG-EC-002', adaptation_project_id: null },
      { id: 'SG-EC-003', adaptation_project_id: 'sg-long-island' },
      { id: 'SG-KB-003', adaptation_project_id: 'sg-marina-barrage' },
    ]);
  });

  it('resolves every referenced project, so no case shows a dangling credit', async () => {
    const orphans = await dbQuery(
      `SELECT c.id FROM collateral c
       LEFT JOIN adaptation_projects a ON a.id = c.adaptation_project_id
       WHERE c.adaptation_project_id IS NOT NULL AND a.id IS NULL`,
    );
    expect(orphans).toEqual([]);
  });

  it('has no geometry column, so membership cannot be derived from a polygon', async () => {
    const row = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'adaptation_projects'
         AND data_type IN ('USER-DEFINED', 'geometry', 'geography')`,
    );
    expect(row.n).toBe(0);
  });
});

describe('AC-3: the toggle changes the haircut by the documented credit', () => {
  it('reads 7.74 percent with Marina Barrage and 9.24 without, a delta of 1.50 points', async () => {
    const stored = await dbOne<{ flood_haircut: string; gross: string; documented: string }>(
      `SELECT flood_haircut, flood_haircut_gross AS gross,
              adaptation_credit_documented_pp AS documented
       FROM valuations v JOIN rule_sets r ON r.id = v.rule_set_id AND r.is_active
       WHERE v.collateral_id = 'SG-KB-003' AND v.scenario = 'y2050'`,
    );

    expect(Number(stored.flood_haircut)).toBeCloseTo(0.0774, HAIRCUT_PRECISION);
    expect(Number(stored.gross)).toBeCloseTo(0.0924, HAIRCUT_PRECISION);
    expect(Number(stored.documented)).toBeCloseTo(1.5, 2);

    /* The toggle is a per-case PREVIEW: it recomputes in memory and writes
       nothing, so the same inputs without the project must give the gross. */
    const fixture = PINNED_FIXTURES.find((f) => f.collateral_id === 'SG-KB-003')!;
    const base = {
      collateral: {
        building_type: fixture.building_type,
        occupancy_class: fixture.occupancy_class,
        appraised_value_sgd: fixture.appraised_value_sgd,
      },
      loan: { segment: 'personal' as const },
      scenario: 'y2050' as const,
      rules,
      samples: {
        flood_coastal: { value: inputsFor(fixture.collateral_id).depth_m.y2050, coverage: 'scored' as const },
      },
      tables,
    };

    const on = valuate({ ...base, adaptation: { haircut_credit_pp: 1.5 } });
    const off = valuate({ ...base, adaptation: null });

    expect(on.flood_haircut).toBeCloseTo(Number(stored.flood_haircut), HAIRCUT_PRECISION);
    expect(off.flood_haircut).toBeCloseTo(Number(stored.gross), HAIRCUT_PRECISION);
    expect(off.flood_haircut - on.flood_haircut).toBeCloseTo(0.015, 10);
  });

  it('writes nothing when the preview is toggled', async () => {
    const before = await dbOne<{ flood_haircut: string }>(
      `SELECT flood_haircut FROM valuations v
       JOIN rule_sets r ON r.id = v.rule_set_id AND r.is_active
       WHERE v.collateral_id = 'SG-KB-003' AND v.scenario = 'y2050'`,
    );

    /* Run the preview both ways; it is a pure function and touches no row. */
    const fixture = PINNED_FIXTURES.find((f) => f.collateral_id === 'SG-KB-003')!;
    for (const adaptation of [null, { haircut_credit_pp: 1.5 }]) {
      valuate({
        collateral: {
          building_type: fixture.building_type,
          occupancy_class: fixture.occupancy_class,
          appraised_value_sgd: fixture.appraised_value_sgd,
        },
        loan: { segment: 'personal' },
        scenario: 'y2050',
        rules,
        samples: {
          flood_coastal: {
            value: inputsFor(fixture.collateral_id).depth_m.y2050,
            coverage: 'scored',
          },
        },
        adaptation,
        tables,
      });
    }

    const after = await dbOne<{ flood_haircut: string }>(
      `SELECT flood_haircut FROM valuations v
       JOIN rule_sets r ON r.id = v.rule_set_id AND r.is_active
       WHERE v.collateral_id = 'SG-KB-003' AND v.scenario = 'y2050'`,
    );

    expect(after.flood_haircut).toBe(before.flood_haircut);
  });
});

describe('ADR-4: the zero floor, where the credit is worth less than it documents', () => {
  it('reads 0.00 percent with a documented 3.00 and an effective 2.64', async () => {
    const row = await dbOne<{
      flood_haircut: string;
      gross: string;
      documented: string;
      effective: string;
      winning_peril: string | null;
    }>(
      `SELECT flood_haircut, flood_haircut_gross AS gross,
              adaptation_credit_documented_pp AS documented,
              adaptation_credit_effective_pp AS effective,
              winning_peril::text AS winning_peril
       FROM valuations v JOIN rule_sets r ON r.id = v.rule_set_id AND r.is_active
       WHERE v.collateral_id = 'SG-EC-003' AND v.scenario = 'y2050'`,
    );

    expect(Number(row.flood_haircut)).toBe(0);
    expect(Number(row.gross)).toBeCloseTo(0.0264, HAIRCUT_PRECISION);
    expect(Number(row.documented)).toBeCloseTo(3.0, 2);
    expect(Number(row.effective)).toBeCloseTo(2.64, 2);

    /* The two figures differ, which is the whole point of showing both. */
    expect(Number(row.effective)).toBeLessThan(Number(row.documented));

    /* The peril IS named, selected on gross, so the panel can say the credit
       was fully absorbed on coastal flood rather than on an unnamed peril. */
    expect(row.winning_peril).toBe('flood_coastal');
  });

  it('never records an effective credit above the documented one, anywhere', async () => {
    const violations = await dbQuery(
      `SELECT collateral_id, scenario FROM valuations
       WHERE adaptation_credit_effective_pp > adaptation_credit_documented_pp + 0.0001`,
    );
    expect(violations).toEqual([]);
  });

  it('never records a negative haircut, anywhere', async () => {
    const violations = await dbQuery(
      `SELECT collateral_id, scenario FROM valuations
       WHERE flood_haircut < 0 OR total_haircut < 0 OR chronic_haircut < 0`,
    );
    expect(violations).toEqual([]);
  });
});
