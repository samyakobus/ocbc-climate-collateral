/**
 * tests/db/worked-example-row.test.ts - AC-2, AC-8.
 *
 * `tests/unit/worked-example.test.ts` proves the FORMULA gives 6.6 percent,
 * S$934,000 and S$700,500. This proves the STORED ROW the case screen renders
 * says the same thing, so the arithmetic on stage and the arithmetic under test
 * cannot drift apart.
 *
 * It then does the same for every other pinned fixture and for the eight band
 * fixtures, so the whole of `tests/fixtures/cases.ts` is checked against the
 * database rather than only the headline case.
 */

import { describe, expect, it } from 'vitest';

import {
  BAND_FIXTURES,
  HAIRCUT_PRECISION,
  PINNED_FIXTURES,
  inputsFor,
} from '../fixtures/cases';
import { dbOne, dbQuery } from '../setup/db';

type ValuationRow = {
  winning_peril: string | null;
  depth_m: string | null;
  damage_fraction: string | null;
  flood_haircut_gross: string;
  adaptation_credit_documented_pp: string;
  adaptation_credit_effective_pp: string;
  flood_haircut: string;
  wind_haircut: string;
  heat_haircut: string;
  pm25_haircut: string;
  chronic_haircut: string;
  total_haircut: string;
  adjusted_value_sgd: string;
  band: string;
};

function valuationAt(collateralId: string, scenario = 'y2050') {
  return dbOne<ValuationRow>(
    `SELECT winning_peril::text AS winning_peril, depth_m, damage_fraction,
            flood_haircut_gross, adaptation_credit_documented_pp,
            adaptation_credit_effective_pp, flood_haircut, wind_haircut,
            heat_haircut, pm25_haircut, chronic_haircut, total_haircut,
            adjusted_value_sgd, band::text AS band
     FROM valuations v
     JOIN rule_sets r ON r.id = v.rule_set_id AND r.is_active
     WHERE v.collateral_id = $1 AND v.scenario = $2`,
    [collateralId, scenario],
  );
}

describe('AC-2: the stored SG-EC-001 row equals the formula result', () => {
  it('stores 6.6 percent, S$934,000 and a maximum loan of S$700,500', async () => {
    const row = await valuationAt('SG-EC-001');

    expect(Number(row.damage_fraction)).toBeCloseTo(0.3, HAIRCUT_PRECISION);
    expect(Number(row.flood_haircut)).toBeCloseTo(0.066, HAIRCUT_PRECISION);
    expect(Number(row.chronic_haircut)).toBe(0);
    expect(Number(row.total_haircut)).toBeCloseTo(0.066, HAIRCUT_PRECISION);
    expect(Number(row.adjusted_value_sgd)).toBeCloseTo(934_000, 2);
    expect(row.band).toBe('amber');

    const loan = await dbOne<{ ltv_applied: string; max_loan_sgd: string }>(
      `SELECT ltv_applied, max_loan_sgd
       FROM application_valuations av
       JOIN rule_sets r ON r.id = av.rule_set_id AND r.is_active
       WHERE av.loan_application_id = 'LA-011' AND av.scenario = 'y2050'`,
    );

    expect(Number(loan.ltv_applied)).toBe(0.75);
    expect(Number(loan.max_loan_sgd)).toBeCloseTo(700_500, 2);
  });

  it('carries the pinned dataset version, which the demo names out loud', async () => {
    const rows = await dbQuery<{ dataset_version: string }>(
      `SELECT DISTINCT dataset_version FROM hazard_samples WHERE collateral_id = 'SG-EC-001'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset_version).toBe('fixture: pinned');
  });
});

describe('every pinned fixture matches its hand-computed expectation', () => {
  for (const fixture of PINNED_FIXTURES) {
    it(`${fixture.collateral_id} at 2050`, async () => {
      const row = await valuationAt(fixture.collateral_id);
      const want = fixture.expected;

      expect(row.winning_peril).toBe(want.winning_peril);
      expect(Number(row.flood_haircut_gross)).toBeCloseTo(
        want.flood_haircut_gross,
        HAIRCUT_PRECISION,
      );
      expect(Number(row.flood_haircut)).toBeCloseTo(want.flood_haircut, HAIRCUT_PRECISION);
      expect(Number(row.adaptation_credit_documented_pp)).toBeCloseTo(
        want.adaptation_credit_documented_pp,
        2,
      );
      expect(Number(row.adaptation_credit_effective_pp)).toBeCloseTo(
        want.adaptation_credit_effective_pp,
        2,
      );
      expect(Number(row.heat_haircut)).toBeCloseTo(want.heat_haircut, HAIRCUT_PRECISION);
      expect(Number(row.chronic_haircut)).toBeCloseTo(want.chronic_haircut, HAIRCUT_PRECISION);
      expect(Number(row.total_haircut)).toBeCloseTo(want.total_haircut, HAIRCUT_PRECISION);
      expect(Number(row.adjusted_value_sgd)).toBeCloseTo(want.adjusted_value_sgd, 2);
      expect(row.band).toBe(want.band);

      /* Where no peril wins, the panel has no depth or damage to show. */
      if (want.winning_peril === null) {
        expect(row.depth_m).toBeNull();
        expect(row.damage_fraction).toBeNull();
      } else {
        expect(Number(row.damage_fraction)).toBeCloseTo(want.damage_fraction, HAIRCUT_PRECISION);
      }
    });

    it(`${fixture.collateral_id} recommendation`, async () => {
      const row = await dbOne<{ refer_to_risk: boolean; revalue_by_year: number | null }>(
        `SELECT refer_to_risk, revalue_by_year
         FROM recommendations rec
         JOIN rule_sets r ON r.id = rec.rule_set_id AND r.is_active
         WHERE rec.loan_application_id = $1 AND rec.scenario = 'y2050'`,
        [fixture.loan_application_id],
      );

      expect(row.refer_to_risk).toBe(fixture.expected.refer_to_risk);
      expect(row.revalue_by_year).toBe(fixture.expected.revalue_by_year);
    });
  }
});

describe('AC-8: the inundation boundary pair differs only by elevation', () => {
  it('refers the low pin and not the high one, with everything else equal', async () => {
    const low = PINNED_FIXTURES.find((f) => f.collateral_id === 'SG-MS-002')!;
    const high = PINNED_FIXTURES.find((f) => f.collateral_id === 'SG-MS-003')!;

    /* The pair is only a controlled comparison if these actually match. */
    expect(low.appraised_value_sgd).toBe(high.appraised_value_sgd);
    expect(low.building_type).toBe(high.building_type);
    expect(inputsFor(low.collateral_id).heat_days.y2050).toBe(
      inputsFor(high.collateral_id).heat_days.y2050,
    );
    expect(inputsFor(low.collateral_id).elevation_m).toBeLessThan(
      inputsFor(high.collateral_id).elevation_m,
    );

    const rows = await dbQuery<{ collateral_id: string; elevation_m: string; refer: boolean }>(
      `SELECT c.id AS collateral_id, c.elevation_m, rec.refer_to_risk AS refer
       FROM collateral c
       JOIN loan_applications l ON l.collateral_id = c.id
       JOIN recommendations rec ON rec.loan_application_id = l.id AND rec.scenario = 'y2050'
       JOIN rule_sets r ON r.id = rec.rule_set_id AND r.is_active
       WHERE c.id IN ('SG-MS-002', 'SG-MS-003')
       ORDER BY c.id`,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ collateral_id: 'SG-MS-002', refer: true });
    expect(rows[1]).toMatchObject({ collateral_id: 'SG-MS-003', refer: false });
  });

  it('rests on the threshold comparison, not on the band', async () => {
    /* Both pins are orange, so the band cannot be what separates them. */
    const low = await valuationAt('SG-MS-002');
    const high = await valuationAt('SG-MS-003');
    expect(low.band).toBe(high.band);
  });
});

describe('the eight band fixtures match their stored rows', () => {
  for (const fixture of BAND_FIXTURES) {
    it(`${fixture.collateral_id} is ${fixture.band}`, async () => {
      const row = await valuationAt(fixture.collateral_id);

      expect(row.band).toBe(fixture.band);
      expect(Number(row.flood_haircut)).toBeCloseTo(fixture.flood_haircut, HAIRCUT_PRECISION);
      expect(Number(row.wind_haircut)).toBeCloseTo(fixture.wind_haircut, HAIRCUT_PRECISION);
      expect(Number(row.heat_haircut)).toBeCloseTo(fixture.heat_haircut, HAIRCUT_PRECISION);
      expect(Number(row.pm25_haircut)).toBeCloseTo(fixture.pm25_haircut, HAIRCUT_PRECISION);
      expect(Number(row.chronic_haircut)).toBeCloseTo(fixture.chronic_haircut, HAIRCUT_PRECISION);
      expect(Number(row.total_haircut)).toBeCloseTo(fixture.total_haircut, HAIRCUT_PRECISION);
    });

    it(`${fixture.collateral_id} components sum to its total under the caps`, async () => {
      const row = await valuationAt(fixture.collateral_id);

      const chronic = Math.min(
        Number(row.heat_haircut) + Number(row.pm25_haircut),
        0.05,
      );
      expect(Number(row.chronic_haircut)).toBeCloseTo(chronic, HAIRCUT_PRECISION);

      const total = Math.min(
        Number(row.flood_haircut) + Number(row.wind_haircut) + Number(row.chronic_haircut),
        0.25,
      );
      expect(Number(row.total_haircut)).toBeCloseTo(total, HAIRCUT_PRECISION);
    });
  }
});
