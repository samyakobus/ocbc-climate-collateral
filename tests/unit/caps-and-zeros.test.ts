/**
 * tests/unit/caps-and-zeros.test.ts - AC-4. No database.
 *
 * Two properties the engine must hold everywhere, not just on the fixtures.
 *
 * ZEROS. A sample contributes only when `coverage` is `scored`. Both
 * `measured_not_scored` and `absent` contribute exactly zero, and the two are
 * different statements: Jakarta's PM2.5 is measured at a real 41 micrograms and
 * excluded by policy, while Singapore's wind has no STORM coverage at all. The
 * haircut is the same, zero, and the provenance panel says different things.
 *
 * CAPS. Each hazard term is bounded on its own, and the two combination caps,
 * the 5 percent chronic sum and the 25 percent total, are asserted through
 * `valuate` at the end of this file.
 */

import { describe, expect, it } from 'vitest';

import { RULE_SET_SEED_DEFAULTS } from '@/lib/rules/bands';
import { BUILDING_DAMAGE_CLASS, BUILDING_TYPES, DEPTH_DAMAGE_CURVES } from '@/lib/rules/curves';
import { valuate } from '@/lib/valuation/combine';
import { type DamageTables, damageFractionFromRules } from '@/lib/valuation/damage';
import {
  ABSENT_FLOOD,
  type Coverage,
  type HazardSample,
  type OccupancyClass,
  type RuleConstants,
  type Scenario,
  contributes,
  heatHaircut,
  horizonProbability,
  pm25Haircut,
  windHaircut,
} from '@/lib/valuation/hazards';

const rules: RuleConstants = { ...RULE_SET_SEED_DEFAULTS };

const NON_CONTRIBUTING: Coverage[] = ['measured_not_scored', 'absent'];
const OCCUPANCIES: OccupancyClass[] = ['rc_highrise', 'lowrise_industrial'];
const SCENARIOS: Scenario[] = ['today', 'y2030', 'y2050'];

describe('zeros: only a scored sample contributes', () => {
  it('treats measured_not_scored and absent alike, at zero, for every hazard', () => {
    for (const coverage of NON_CONTRIBUTING) {
      /* A real measured value present on the row must still contribute zero. */
      const measured: HazardSample = { value: 41, coverage };
      const empty: HazardSample = { value: null, coverage };

      for (const sample of [measured, empty]) {
        expect(contributes(sample)).toBe(false);
        expect(pm25Haircut(sample)).toBe(0);
        expect(heatHaircut(sample, { suhi_tertile: 2, ndvi_tertile: 0 })).toBe(0);
        for (const occupancy of OCCUPANCIES) {
          expect(windHaircut(sample, occupancy)).toBe(0);
        }
      }
    }
  });

  it('treats a missing sample as absent rather than throwing', () => {
    for (const missing of [null, undefined]) {
      expect(contributes(missing)).toBe(false);
      expect(pm25Haircut(missing)).toBe(0);
      expect(heatHaircut(missing, { suhi_tertile: 2, ndvi_tertile: 0 })).toBe(0);
      expect(windHaircut(missing, 'rc_highrise')).toBe(0);
    }
  });

  it('refuses a scored sample with a null value, which would be a prep failure', () => {
    expect(contributes({ value: null, coverage: 'scored' })).toBe(false);
  });

  it('returns the same flood shape when absent as when scored', () => {
    expect(Object.keys(ABSENT_FLOOD).sort()).toEqual([
      'damage',
      'documented',
      'effective',
      'gross',
      'net',
    ]);
    expect(ABSENT_FLOOD.net).toBe(0);
    expect(ABSENT_FLOOD.gross).toBe(0);
  });

  it('gives every hazard a zero haircut at origination or below its threshold', () => {
    /* Heat is zero at today by definition: today IS the reference window. */
    expect(heatHaircut({ value: 0, coverage: 'scored' }, { suhi_tertile: 2, ndvi_tertile: 0 })).toBe(
      0,
    );
    /* Flood is zero at today because p_today is zero. */
    expect(horizonProbability(rules, 'today')).toBe(0);
    /* Wind below severe-tropical-storm strength, PM2.5 below the first band. */
    expect(windHaircut({ value: 32.9, coverage: 'scored' }, 'lowrise_industrial')).toBe(0);
    expect(pm25Haircut({ value: 34.9, coverage: 'scored' })).toBe(0);
  });
});

describe('caps: each hazard term is bounded on its own', () => {
  it('keeps wind inside its band whatever the occupancy multiplier does', () => {
    for (let speed = 33; speed <= 90; speed += 0.5) {
      const sample: HazardSample = { value: speed, coverage: 'scored' };
      const [lo, hi] = speed <= 45 ? [0.01, 0.03] : [0.03, 0.06];

      for (const occupancy of OCCUPANCIES) {
        const haircut = windHaircut(sample, occupancy);
        expect(haircut).toBeGreaterThanOrEqual(lo);
        expect(haircut).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('never lets wind exceed 6 percent, however extreme the wind speed', () => {
    for (const speed of [60, 90, 150, 500]) {
      for (const occupancy of OCCUPANCIES) {
        expect(windHaircut({ value: speed, coverage: 'scored' }, occupancy)).toBeLessThanOrEqual(
          0.06,
        );
      }
    }
  });

  it('joins the two wind curves continuously at 45 m/s before occupancy applies', () => {
    /* Both expressions give 0.03 at the join: 0.01 + (12/12) x 0.02, and
       0.03 + 0 x 0.03. The underlying curve has no step. */
    const unclamped = (speed: number) =>
      speed <= 45
        ? 0.01 + ((speed - 33) / 12) * 0.02
        : 0.03 + Math.min((speed - 45) / 15, 1) * 0.03;

    expect(unclamped(45)).toBeCloseTo(0.03, 10);
    expect(unclamped(44.999)).toBeCloseTo(unclamped(45.001), 4);
  });

  it('steps by 0.6 points at the band edge, because the clamp window moves', () => {
    /*
      A deliberate consequence of "occupancy modulates WITHIN the band, never
      outside it". The curve is continuous, but the clamp window jumps from
      [0.01, 0.03] to [0.03, 0.06] at 45 m/s, so the clamped result steps for
      both occupancies. Pinned rather than smoothed: the plan's formula is
      authoritative, and a step this size is invisible against a 25 percent cap.
    */
    for (const occupancy of OCCUPANCIES) {
      const below = windHaircut({ value: 44.999, coverage: 'scored' }, occupancy);
      const above = windHaircut({ value: 45.001, coverage: 'scored' }, occupancy);

      expect(above - below).toBeCloseTo(0.006, 4);
      expect(above).toBeGreaterThan(below);
    }

    /* Each side still sits inside the band its wind speed selected. */
    expect(windHaircut({ value: 44.999, coverage: 'scored' }, 'lowrise_industrial')).toBeCloseTo(
      0.03,
      4,
    );
    expect(windHaircut({ value: 45.001, coverage: 'scored' }, 'rc_highrise')).toBeCloseTo(0.03, 4);
  });

  it('keeps rc_highrise below the 6 percent ceiling even at extreme wind', () => {
    /* 0.06 x 0.8 = 0.048, and the lower clamp bound is 0.03, so the multiplier
       binds rather than the ceiling. Low-rise industrial does reach 0.06. */
    expect(windHaircut({ value: 200, coverage: 'scored' }, 'rc_highrise')).toBeCloseTo(0.048, 10);
    expect(windHaircut({ value: 200, coverage: 'scored' }, 'lowrise_industrial')).toBeCloseTo(
      0.06,
      10,
    );
  });

  it('gives rc_highrise a lower wind haircut than lowrise_industrial inside a band', () => {
    /* Mid-band, where neither clamp is active. */
    const sample: HazardSample = { value: 52, coverage: 'scored' };
    expect(windHaircut(sample, 'rc_highrise')).toBeLessThan(
      windHaircut(sample, 'lowrise_industrial'),
    );
  });

  it('caps the heat elasticity term at 5 percent before the urban-heat factor', () => {
    /* 500 extra days would give 50 percent uncapped; the inner cap holds it. */
    const extreme: HazardSample = { value: 500, coverage: 'scored' };
    expect(heatHaircut(extreme, { suhi_tertile: 0, ndvi_tertile: 0 })).toBeCloseTo(0.05, 10);
    /* The factor then applies on top, so heat alone can reach 7.5 percent. */
    expect(heatHaircut(extreme, { suhi_tertile: 2, ndvi_tertile: 0 })).toBeCloseTo(0.075, 10);
  });

  it('steps a green pin down one urban-heat tertile, floored at the lowest', () => {
    const sample: HazardSample = { value: 40, coverage: 'scored' };
    const bare = heatHaircut(sample, { suhi_tertile: 2, ndvi_tertile: 0 });
    const green = heatHaircut(sample, { suhi_tertile: 2, ndvi_tertile: 2 });

    expect(green).toBeLessThan(bare);
    expect(green).toBeCloseTo(heatHaircut(sample, { suhi_tertile: 1, ndvi_tertile: 0 }), 10);

    /* Already in the lowest tertile: greenery cannot take it below 1.0. */
    expect(heatHaircut(sample, { suhi_tertile: 0, ndvi_tertile: 2 })).toBeCloseTo(
      heatHaircut(sample, { suhi_tertile: 0, ndvi_tertile: 0 }),
      10,
    );
  });

  it('puts PM2.5 on exactly two steps at 35 and 50', () => {
    expect(pm25Haircut({ value: 34.99, coverage: 'scored' })).toBe(0);
    expect(pm25Haircut({ value: 35, coverage: 'scored' })).toBe(0.01);
    expect(pm25Haircut({ value: 50, coverage: 'scored' })).toBe(0.01);
    expect(pm25Haircut({ value: 50.01, coverage: 'scored' })).toBe(0.02);
    expect(pm25Haircut({ value: 300, coverage: 'scored' })).toBe(0.02);
  });

  it('keeps the damage fraction inside [0, 1] for every building type and depth', () => {
    for (const buildingType of BUILDING_TYPES) {
      for (let depth = -2; depth <= 12; depth += 0.25) {
        const damage = damageFractionFromRules(depth, buildingType);
        expect(damage).toBeGreaterThanOrEqual(0);
        expect(damage).toBeLessThanOrEqual(1);
      }
    }
  });

  it('bounds the flood term by the horizon probability, so today is always zero', () => {
    for (const scenario of SCENARIOS) {
      const probability = horizonProbability(rules, scenario);
      /* Worst possible damage fraction is 1.0, so the flood term cannot exceed P. */
      const worstFlood = 1 * probability;
      expect(worstFlood).toBeLessThanOrEqual(0.22);
      if (scenario === 'today') expect(worstFlood).toBe(0);
    }
  });
});

describe('combination caps, through valuate', () => {
  const tables: DamageTables = {
    curves: DEPTH_DAMAGE_CURVES,
    classOf: BUILDING_DAMAGE_CLASS,
  };

  const scored = (value: number): HazardSample => ({ value, coverage: 'scored' });

  /** The worst pin the model can express: deep water, extreme wind and air. */
  function worstCase(overrides: Partial<Parameters<typeof valuate>[0]> = {}) {
    return valuate({
      collateral: {
        building_type: 'residential_highrise_rc',
        occupancy_class: 'lowrise_industrial',
        appraised_value_sgd: 1_000_000,
      },
      loan: { segment: 'personal' },
      scenario: 'y2050',
      rules,
      samples: {
        flood_riverine: scored(10),
        flood_coastal: scored(10),
        wind: scored(200),
        heat_days35: scored(500),
        pm25: scored(300),
      },
      modifiers: { suhi_tertile: 2, ndvi_tertile: 0 },
      tables,
      ...overrides,
    });
  }

  it('caps the chronic sum at 5 percent even when heat and PM2.5 both max out', () => {
    const result = worstCase();
    /* Heat alone reaches 7.5 percent, plus 2 percent PM2.5. */
    expect(result.heat_haircut).toBeCloseTo(0.075, 10);
    expect(result.pm25_haircut).toBe(0.02);
    expect(result.chronic_haircut).toBe(rules.chronic_cap);
    expect(result.chronic_haircut).toBe(0.05);
  });

  it('caps the total at 25 percent', () => {
    const result = worstCase();
    /* Uncapped this would be 22 flood + 6 wind + 5 chronic = 33 percent. */
    expect(result.flood_haircut + result.wind_haircut + result.chronic_haircut).toBeGreaterThan(
      rules.total_cap,
    );
    expect(result.total_haircut).toBe(rules.total_cap);
    expect(result.total_haircut).toBe(0.25);
    expect(result.adjusted_value_sgd).toBeCloseTo(750_000, 6);
  });

  it('takes the maximum of the two water perils, never their sum', () => {
    const both = valuate({
      collateral: {
        building_type: 'residential_highrise_rc',
        occupancy_class: 'rc_highrise',
        appraised_value_sgd: 1_000_000,
      },
      loan: { segment: 'personal' },
      scenario: 'y2050',
      rules,
      samples: { flood_riverine: scored(0.5), flood_coastal: scored(0.5) },
      tables,
    });

    /* Two identical 6.6 percent perils give 6.6 percent, not 13.2. */
    expect(both.flood_haircut).toBeCloseTo(0.066, 10);
    expect(both.total_haircut).toBeCloseTo(0.066, 10);
  });

  it('names the deeper peril as the winner and reports its depth', () => {
    const result = valuate({
      collateral: {
        building_type: 'residential_highrise_rc',
        occupancy_class: 'rc_highrise',
        appraised_value_sgd: 1_000_000,
      },
      loan: { segment: 'personal' },
      scenario: 'y2050',
      rules,
      samples: { flood_riverine: scored(0.5), flood_coastal: scored(0.8) },
      tables,
    });

    expect(result.winning_peril).toBe('flood_coastal');
    expect(result.depth_m).toBe(0.8);
    expect(result.damage_fraction).toBeCloseTo(0.42, 10);
    expect(result.flood_haircut).toBeCloseTo(0.0924, 10);
  });

  it('names the peril whose credit was absorbed, which is the SG-EC-003 case', () => {
    /*
      Plan 4.2 reads as though a fully floored flood names no peril; plan 4.3.2
      requires the case screen to say the 3.00 point Long Island credit was
      absorbed ON COASTAL FLOOD against a 2.64 percent gross. Selection is on
      GROSS, so the name, the depth and the damage fraction all survive the floor.
    */
    const result = valuate({
      collateral: {
        building_type: 'residential_landed',
        occupancy_class: 'lowrise_industrial',
        appraised_value_sgd: 1_500_000,
      },
      loan: { segment: 'personal' },
      scenario: 'y2050',
      rules,
      samples: {
        flood_riverine: { value: null, coverage: 'absent' },
        flood_coastal: scored(0.2),
      },
      adaptation: { haircut_credit_pp: 3.0 },
      tables,
    });

    expect(result.winning_peril).toBe('flood_coastal');
    expect(result.depth_m).toBe(0.2);
    expect(result.damage_fraction).toBeCloseTo(0.12, 10);
    expect(result.flood_haircut_gross).toBeCloseTo(0.0264, 10);
    expect(result.flood_haircut).toBe(0);
    expect(result.adaptation_credit_documented_pp).toBeCloseTo(3.0, 10);
    expect(result.adaptation_credit_effective_pp).toBeCloseTo(2.64, 10);
  });

  it('names no winning peril where both perils contribute zero', () => {
    const atOrigination = valuate({
      collateral: {
        building_type: 'residential_highrise_rc',
        occupancy_class: 'rc_highrise',
        appraised_value_sgd: 1_000_000,
      },
      loan: { segment: 'personal' },
      /* p_today is 0.00, so both perils are zero however deep the water. */
      scenario: 'today',
      rules,
      samples: { flood_riverine: scored(3), flood_coastal: scored(3) },
      tables,
    });

    expect(atOrigination.winning_peril).toBeNull();
    expect(atOrigination.depth_m).toBeNull();
    expect(atOrigination.damage_fraction).toBeNull();
    expect(atOrigination.total_haircut).toBe(0);
  });

  it('applies the per-case LTV override in preference to the rule set', () => {
    const base = {
      collateral: {
        building_type: 'residential_highrise_rc' as const,
        occupancy_class: 'rc_highrise' as const,
        appraised_value_sgd: 1_000_000,
      },
      scenario: 'y2050' as const,
      rules,
      samples: {},
      tables,
    };

    expect(valuate({ ...base, loan: { segment: 'personal' } }).ltv_applied).toBe(0.75);
    expect(valuate({ ...base, loan: { segment: 'corporate' } }).ltv_applied).toBe(0.6);
    expect(
      valuate({ ...base, loan: { segment: 'personal', base_ltv_override: 0.5 } }).ltv_applied,
    ).toBe(0.5);
    /* A null override is not an override. */
    expect(
      valuate({ ...base, loan: { segment: 'personal', base_ltv_override: null } }).ltv_applied,
    ).toBe(0.75);
  });

  it('subtracts the adaptation credit and floors it at zero, reporting both figures', () => {
    const base = {
      collateral: {
        building_type: 'residential_landed' as const,
        occupancy_class: 'rc_highrise' as const,
        appraised_value_sgd: 1_500_000,
      },
      loan: { segment: 'personal' as const },
      scenario: 'y2050' as const,
      rules,
      tables,
    };

    /* SG-EC-003: 0.20 m gives 2.64 percent gross against a 3.00 point credit. */
    const floored = valuate({
      ...base,
      samples: { flood_riverine: scored(0.2) },
      adaptation: { haircut_credit_pp: 3.0 },
    });

    expect(floored.flood_haircut_gross).toBeCloseTo(0.0264, 10);
    expect(floored.flood_haircut).toBe(0);
    expect(floored.adaptation_credit_documented_pp).toBeCloseTo(3.0, 10);
    expect(floored.adaptation_credit_effective_pp).toBeCloseTo(2.64, 10);

    /* The preview without the project: the same pin, no credit. */
    const withoutCredit = valuate({ ...base, samples: { flood_riverine: scored(0.2) } });
    expect(withoutCredit.flood_haircut).toBeCloseTo(0.0264, 10);
    expect(withoutCredit.adaptation_credit_documented_pp).toBe(0);
  });

  it('ignores adaptation entirely when the risk manager switches it off', () => {
    const off: RuleConstants = { ...rules, adaptation_enabled: false };
    const result = valuate({
      collateral: {
        building_type: 'residential_highrise_rc',
        occupancy_class: 'rc_highrise',
        appraised_value_sgd: 1_200_000,
      },
      loan: { segment: 'personal' },
      scenario: 'y2050',
      rules: off,
      samples: { flood_riverine: scored(0.8) },
      adaptation: { haircut_credit_pp: 1.5 },
      tables,
    });

    expect(result.flood_haircut).toBeCloseTo(0.0924, 10);
    expect(result.adaptation_credit_documented_pp).toBe(0);
  });

  it('never exceeds either cap across a wide sweep of inputs', () => {
    for (const depth of [0, 0.3, 1, 3, 8]) {
      for (const speed of [0, 33, 45, 60, 120]) {
        for (const days of [0, 20, 60, 400]) {
          for (const pm of [0, 40, 90]) {
            const result = valuate({
              collateral: {
                building_type: 'industrial_warehouse',
                occupancy_class: 'lowrise_industrial',
                appraised_value_sgd: 5_000_000,
              },
              loan: { segment: 'corporate' },
              scenario: 'y2050',
              rules,
              samples: {
                flood_riverine: scored(depth),
                flood_coastal: scored(depth / 2),
                wind: scored(speed),
                heat_days35: scored(days),
                pm25: scored(pm),
              },
              modifiers: { suhi_tertile: 2, ndvi_tertile: 0 },
              tables,
            });

            expect(result.chronic_haircut).toBeLessThanOrEqual(rules.chronic_cap);
            expect(result.total_haircut).toBeLessThanOrEqual(rules.total_cap);
            expect(result.total_haircut).toBeGreaterThanOrEqual(0);
            expect(result.adjusted_value_sgd).toBeGreaterThanOrEqual(0);
            expect(result.max_loan_sgd).toBeLessThanOrEqual(result.adjusted_value_sgd);
          }
        }
      }
    }
  });
});
