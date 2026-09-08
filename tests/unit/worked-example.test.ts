/**
 * tests/unit/worked-example.test.ts - AC-2. A PURE formula assertion, no database.
 *
 * The spec's literal inputs, walked step by step to the three figures a director
 * will be shown: a 6.6 percent haircut, an adjusted value of S$934,000 and a
 * maximum loan of S$700,500.
 *
 * This binds to the FORMULA, not to a row. `tests/db/worked-example-row.test.ts`
 * separately asserts that SG-EC-001's stored valuation equals what this proves,
 * so the case screen and the arithmetic cannot drift apart. Binding here is the
 * stronger of the two: it holds even if the seed is wrong, and it is why this
 * test can run in the no-database project.
 *
 * Two cases, in the order the demo opens them. The realistic Marine Parade pin
 * comes first, because it is what a Singapore mortgage actually looks like. The
 * flood-only pin is the isolation exhibit, with its heat sample pinned to a zero
 * delta so the flood term stands alone.
 */

import { describe, expect, it } from 'vitest';

import { RULE_SET_SEED_DEFAULTS } from '@/lib/rules/bands';
import { BUILDING_DAMAGE_CLASS, DEPTH_DAMAGE_CURVES } from '@/lib/rules/curves';
import { valuate } from '@/lib/valuation/combine';
import { type DamageTables, damageFractionFromRules } from '@/lib/valuation/damage';
import {
  type HazardSample,
  type RuleConstants,
  heatHaircut,
  horizonProbability,
  pm25Haircut,
  windHaircut,
} from '@/lib/valuation/hazards';

const rules: RuleConstants = { ...RULE_SET_SEED_DEFAULTS };

const APPRAISED_SGD = 1_000_000;

/** Singapore: wind has no STORM coverage, PM2.5 is measured but not scored. */
const SG_WIND: HazardSample = { value: null, coverage: 'absent' };
const SG_PM25: HazardSample = { value: 41, coverage: 'measured_not_scored' };

describe('AC-2, the spec worked example: SG-EC-001, flood only', () => {
  /* Depth 0.50 m at 2050 on a residential high-rise, no adaptation project. */
  const flood: HazardSample = { value: 0.5, coverage: 'scored' };
  /* Pinned at a zero delta, and `scored`, so heatHaircut runs and returns 0. */
  const heat: HazardSample = { value: 0, coverage: 'scored' };

  it('reads a damage fraction of 0.30 at 0.50 m', () => {
    expect(damageFractionFromRules(flood.value as number, 'residential_highrise_rc')).toBeCloseTo(
      0.3,
      10,
    );
  });

  it('uses a 2050 horizon probability of 0.22', () => {
    expect(horizonProbability(rules, 'y2050')).toBe(0.22);
  });

  it('multiplies to a flood haircut of 6.6 percent', () => {
    const damage = damageFractionFromRules(flood.value as number, 'residential_highrise_rc');
    const floodHaircut = damage * horizonProbability(rules, 'y2050');
    expect(floodHaircut).toBeCloseTo(0.066, 10);
  });

  it('contributes nothing from wind, PM2.5 or the pinned zero heat delta', () => {
    expect(windHaircut(SG_WIND, 'rc_highrise')).toBe(0);
    expect(pm25Haircut(SG_PM25)).toBe(0);
    expect(heatHaircut(heat, { suhi_tertile: 1, ndvi_tertile: 1 })).toBe(0);
  });

  it('gives a total of 6.6 percent, S$934,000 adjusted and S$700,500 at 0.75 LTV', () => {
    const damage = damageFractionFromRules(flood.value as number, 'residential_highrise_rc');
    const total =
      damage * horizonProbability(rules, 'y2050') +
      windHaircut(SG_WIND, 'rc_highrise') +
      heatHaircut(heat, { suhi_tertile: 1, ndvi_tertile: 1 }) +
      pm25Haircut(SG_PM25);

    expect(total).toBeCloseTo(0.066, 10);

    const adjusted = APPRAISED_SGD * (1 - total);
    expect(adjusted).toBeCloseTo(934_000, 6);

    const maxLoan = adjusted * rules.base_ltv_personal;
    expect(maxLoan).toBeCloseTo(700_500, 6);

    /* The figure the haircut is measured against: 0.75 of the unadjusted value. */
    expect(APPRAISED_SGD * rules.base_ltv_personal).toBe(750_000);
  });
});

describe('AC-2, the realistic Singapore case: SG-EC-002, flood plus heat', () => {
  /* Same flood exposure as SG-EC-001, plus a real 2050 heat delta. */
  const flood: HazardSample = { value: 0.5, coverage: 'scored' };
  const heat: HazardSample = { value: 28, coverage: 'scored' };
  const modifiers = { suhi_tertile: 1, ndvi_tertile: 1 };

  it('gives a heat term of 3.5 percent from 28 extra days in the middle SUHI tertile', () => {
    /* min(0.001 x 28, 0.05) x 1.25 */
    expect(heatHaircut(heat, modifiers)).toBeCloseTo(0.035, 10);
  });

  it('gives a total of 10.1 percent, S$899,000 adjusted and S$674,250 at 0.75 LTV', () => {
    const damage = damageFractionFromRules(flood.value as number, 'residential_highrise_rc');
    const floodTerm = damage * horizonProbability(rules, 'y2050');
    const chronic = Math.min(
      heatHaircut(heat, modifiers) + pm25Haircut(SG_PM25),
      rules.chronic_cap,
    );

    expect(floodTerm).toBeCloseTo(0.066, 10);
    expect(chronic).toBeCloseTo(0.035, 10);

    const total = floodTerm + windHaircut(SG_WIND, 'rc_highrise') + chronic;
    expect(total).toBeCloseTo(0.101, 10);

    const adjusted = APPRAISED_SGD * (1 - total);
    expect(adjusted).toBeCloseTo(899_000, 6);
    expect(adjusted * rules.base_ltv_personal).toBeCloseTo(674_250, 6);
  });

  it('sits in the 10-20 percent band, one band worse than the flood-only pin', () => {
    const damage = damageFractionFromRules(0.5, 'residential_highrise_rc');
    const floodOnly = damage * horizonProbability(rules, 'y2050');
    const realistic = floodOnly + heatHaircut(heat, modifiers);

    expect(floodOnly).toBeLessThan(rules.band_mid);
    expect(realistic).toBeGreaterThanOrEqual(rules.band_mid);
    expect(realistic).toBeLessThan(rules.band_high);
  });
});

describe('the engine reproduces what the formula proves', () => {
  /*
    The assertions above are deliberately independent of the implementation:
    they walk the spec's arithmetic by hand. These run the same inputs through
    valuate(), so the engine and the formula cannot drift apart without a red
    test. tests/db/worked-example-row.test.ts then closes the last gap, between
    valuate() and the row the case screen renders.
  */
  const tables: DamageTables = { curves: DEPTH_DAMAGE_CURVES, classOf: BUILDING_DAMAGE_CLASS };

  const collateral = {
    building_type: 'residential_highrise_rc' as const,
    occupancy_class: 'rc_highrise' as const,
    appraised_value_sgd: APPRAISED_SGD,
  };
  const loan = { segment: 'personal' as const };

  it('values SG-EC-001 at 6.6 percent, S$934,000 and S$700,500', () => {
    const result = valuate({
      collateral,
      loan,
      scenario: 'y2050',
      rules,
      samples: {
        flood_riverine: { value: 0.5, coverage: 'scored' },
        wind: SG_WIND,
        heat_days35: { value: 0, coverage: 'scored' },
        pm25: SG_PM25,
      },
      modifiers: { suhi_tertile: 1, ndvi_tertile: 1 },
      tables,
    });

    expect(result.damage_fraction).toBeCloseTo(0.3, 10);
    expect(result.flood_haircut).toBeCloseTo(0.066, 10);
    expect(result.chronic_haircut).toBe(0);
    expect(result.total_haircut).toBeCloseTo(0.066, 10);
    expect(result.adjusted_value_sgd).toBeCloseTo(934_000, 6);
    expect(result.ltv_applied).toBe(0.75);
    expect(result.max_loan_sgd).toBeCloseTo(700_500, 6);
    expect(result.band).toBe('amber');
    expect(result.winning_peril).toBe('flood_riverine');
  });

  it('values SG-EC-002 at 10.1 percent, S$899,000 and S$674,250', () => {
    const result = valuate({
      collateral,
      loan,
      scenario: 'y2050',
      rules,
      samples: {
        flood_riverine: { value: 0.5, coverage: 'scored' },
        wind: SG_WIND,
        heat_days35: { value: 28, coverage: 'scored' },
        pm25: SG_PM25,
      },
      modifiers: { suhi_tertile: 1, ndvi_tertile: 1 },
      tables,
    });

    expect(result.flood_haircut).toBeCloseTo(0.066, 10);
    expect(result.heat_haircut).toBeCloseTo(0.035, 10);
    expect(result.chronic_haircut).toBeCloseTo(0.035, 10);
    expect(result.total_haircut).toBeCloseTo(0.101, 10);
    expect(result.adjusted_value_sgd).toBeCloseTo(899_000, 6);
    expect(result.max_loan_sgd).toBeCloseTo(674_250, 6);
    expect(result.band).toBe('orange');
  });

  it('values SG-KB-003 at 7.74 percent with its credit and 9.24 without', () => {
    const base = {
      collateral: { ...collateral, appraised_value_sgd: 1_200_000 },
      loan,
      scenario: 'y2050' as const,
      rules,
      samples: { flood_riverine: { value: 0.8, coverage: 'scored' as const } },
      tables,
    };

    const withCredit = valuate({ ...base, adaptation: { haircut_credit_pp: 1.5 } });
    const withoutCredit = valuate(base);

    expect(withCredit.flood_haircut).toBeCloseTo(0.0774, 10);
    expect(withoutCredit.flood_haircut).toBeCloseTo(0.0924, 10);
    /* AC-3: the delta is exactly the documented credit. */
    expect(withoutCredit.flood_haircut - withCredit.flood_haircut).toBeCloseTo(0.015, 10);
    expect(withCredit.adaptation_credit_documented_pp).toBeCloseTo(1.5, 10);
    expect(withCredit.adaptation_credit_effective_pp).toBeCloseTo(1.5, 10);
  });
});

describe('AC-3, the adaptation fixture: SG-KB-003 at 0.80 m', () => {
  it('gives 9.24 percent gross and 7.74 percent net, a delta of exactly 1.50 points', () => {
    const damage = damageFractionFromRules(0.8, 'residential_highrise_rc');
    expect(damage).toBeCloseTo(0.42, 10);

    const gross = damage * horizonProbability(rules, 'y2050');
    expect(gross).toBeCloseTo(0.0924, 10);

    /* Marina Barrage catchment, 1.50 percentage points. */
    const net = Math.max(gross - 1.5 / 100, 0);
    expect(net).toBeCloseTo(0.0774, 10);
    expect(gross - net).toBeCloseTo(0.015, 10);
  });
});

describe('ADR-4, the zero floor: SG-EC-003 at 0.20 m', () => {
  it('floors the haircut at zero and reports an effective credit of 2.64 points', () => {
    const damage = damageFractionFromRules(0.2, 'residential_landed');
    expect(damage).toBeCloseTo(0.12, 10);

    const gross = damage * horizonProbability(rules, 'y2050');
    expect(gross).toBeCloseTo(0.0264, 10);

    /* Long Island, 3.00 documented points, more than the gross haircut. */
    const documented = 3.0 / 100;
    const net = Math.max(gross - documented, 0);
    const effective = gross - net;

    expect(net).toBe(0);
    expect(documented).toBeCloseTo(0.03, 10);
    expect(effective).toBeCloseTo(0.0264, 10);
    /* The panel shows both: the credit bought less than it documents. */
    expect(effective).toBeLessThan(documented);
  });
});
