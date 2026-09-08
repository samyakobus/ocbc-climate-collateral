/**
 * tests/unit/bands.fixtures.test.ts - AC-8. No database.
 *
 * The band edges, the conditions each band carries, and `revalue_by_year`.
 *
 * Two fixtures per band, one just inside each boundary and one comfortably
 * within it, so an off-by-one in a comparison operator cannot pass. Edges are
 * lower-inclusive throughout: a haircut of exactly 10 percent is orange, not
 * amber, which is what puts the realistic Singapore case in the 10-20 band.
 *
 * `revalue_by_year` is 2030, 2050 or null and never the origination year. That
 * is a property of the model rather than a rule written anywhere: heat is zero
 * at origination by definition of the metric and the flood probability is zero
 * there, so the most a pin can carry at 2025 is 6 percent wind plus 2 percent
 * PM2.5. Eight percent is below the 10 percent mid band, so no 2025 fixture is
 * authored. The last test in this file proves that ceiling rather than assuming
 * it, so if a future edit makes 2025 reachable this file goes red.
 */

import { describe, expect, it } from 'vitest';

import {
  BAND_CONDITIONS,
  type Band,
  type BandEdges,
  INUNDATION_CONDITION,
  RULE_SET_SEED_DEFAULTS,
  bandOf,
  conditionsFor,
  isAmberOrWorse,
  recommendationFor,
  refersToRisk,
  type RuleSetEdit,
  revalueByYear,
  validateRuleSetEdit,
} from '@/lib/rules/bands';

const edges: BandEdges = {
  band_low: RULE_SET_SEED_DEFAULTS.band_low,
  band_mid: RULE_SET_SEED_DEFAULTS.band_mid,
  band_high: RULE_SET_SEED_DEFAULTS.band_high,
};

/** Two fixtures per band: the boundary itself, and a value inside it. */
const BAND_FIXTURES: readonly { haircut: number; band: Band; why: string }[] = [
  { haircut: 0, band: 'green', why: 'no scored hazard at origination' },
  { haircut: 0.0299, band: 'green', why: 'just under the 3 percent edge' },

  { haircut: 0.03, band: 'amber', why: 'exactly at the 3 percent edge, lower-inclusive' },
  { haircut: 0.066, band: 'amber', why: 'the AC-2 worked example' },

  { haircut: 0.1, band: 'orange', why: 'exactly at the 10 percent edge, lower-inclusive' },
  { haircut: 0.101, band: 'orange', why: 'the realistic Singapore case' },

  { haircut: 0.2, band: 'red', why: 'exactly at the 20 percent edge, lower-inclusive' },
  { haircut: 0.25, band: 'red', why: 'the total cap, the worst a pin can carry' },
];

describe('band edges', () => {
  for (const fixture of BAND_FIXTURES) {
    it(`puts ${(fixture.haircut * 100).toFixed(2)}% in ${fixture.band}: ${fixture.why}`, () => {
      expect(bandOf(fixture.haircut, edges)).toBe(fixture.band);
    });
  }

  it('treats every edge as lower-inclusive, so no haircut falls between bands', () => {
    for (const edge of [edges.band_low, edges.band_mid, edges.band_high]) {
      const below = bandOf(edge - 1e-9, edges);
      const at = bandOf(edge, edges);
      expect(at).not.toBe(below);
    }
  });

  it('counts everything but green as amber-or-worse for the dashboard', () => {
    expect(isAmberOrWorse('green')).toBe(false);
    for (const band of ['amber', 'orange', 'red'] as Band[]) {
      expect(isAmberOrWorse(band)).toBe(true);
    }
  });

  it('moves cases between bands when the risk manager edits an edge, which is AC-9', () => {
    /* The demo raises band_mid from 10 to 12 percent. */
    const raised: BandEdges = { ...edges, band_mid: 0.12 };
    expect(bandOf(0.101, edges)).toBe('orange');
    expect(bandOf(0.101, raised)).toBe('amber');
  });
});

describe('conditions', () => {
  it('attaches nothing to a green case', () => {
    expect(conditionsFor('green')).toEqual([]);
    expect(refersToRisk('green')).toBe(false);
  });

  it('accumulates, so each band carries every milder band conditions too', () => {
    const amber = conditionsFor('amber');
    const orange = conditionsFor('orange');
    const red = conditionsFor('red');

    expect(amber).toEqual([...BAND_CONDITIONS.amber]);
    expect(orange).toEqual([...BAND_CONDITIONS.amber, ...BAND_CONDITIONS.orange]);
    expect(red).toEqual([
      ...BAND_CONDITIONS.amber,
      ...BAND_CONDITIONS.orange,
      ...BAND_CONDITIONS.red,
    ]);

    /* Monotonic: risk never removes a condition. */
    expect(orange.slice(0, amber.length)).toEqual(amber);
    expect(red.slice(0, orange.length)).toEqual(orange);
  });

  it('refers to risk above 20 percent', () => {
    expect(refersToRisk('red')).toBe(true);
    expect(conditionsFor('red')).toContain(BAND_CONDITIONS.red[0]);
  });

  it('refers to risk on the inundation flag whatever the band, which is AC-8', () => {
    for (const band of ['green', 'amber', 'orange', 'red'] as Band[]) {
      expect(refersToRisk(band, true)).toBe(true);
      expect(conditionsFor(band, true)).toContain(INUNDATION_CONDITION);
    }
    /* A green case with the flag: referred despite carrying no haircut. */
    expect(conditionsFor('green', true)).toEqual([INUNDATION_CONDITION]);
  });

  it('never declines, only conditions or refers', () => {
    for (const band of ['green', 'amber', 'orange', 'red'] as Band[]) {
      for (const condition of conditionsFor(band, true)) {
        expect(condition.toLowerCase()).not.toContain('decline');
        expect(condition.toLowerCase()).not.toContain('reject');
      }
    }
  });

  it('does not repeat the inundation condition when it is already present', () => {
    const conditions = conditionsFor('red', true);
    const occurrences = conditions.filter((c) => c === INUNDATION_CONDITION).length;
    expect(occurrences).toBe(1);
  });
});

describe('revalue_by_year', () => {
  const mid = { band_mid: edges.band_mid };

  it('returns the first year that reaches the mid band', () => {
    expect(
      revalueByYear(
        [
          { year: 2025, total_haircut: 0.0 },
          { year: 2030, total_haircut: 0.11 },
          { year: 2050, total_haircut: 0.19 },
        ],
        mid,
      ),
    ).toBe(2030);
  });

  it('returns 2050 where only the last horizon crosses', () => {
    expect(
      revalueByYear(
        [
          { year: 2025, total_haircut: 0.0 },
          { year: 2030, total_haircut: 0.02 },
          { year: 2050, total_haircut: 0.101 },
        ],
        mid,
      ),
    ).toBe(2050);
  });

  it('returns null where no horizon crosses', () => {
    expect(
      revalueByYear(
        [
          { year: 2025, total_haircut: 0.0 },
          { year: 2030, total_haircut: 0.02 },
          { year: 2050, total_haircut: 0.066 },
        ],
        mid,
      ),
    ).toBeNull();
  });

  it('treats the edge as reached, matching the lower-inclusive bands', () => {
    expect(revalueByYear([{ year: 2050, total_haircut: 0.1 }], mid)).toBe(2050);
    expect(revalueByYear([{ year: 2050, total_haircut: 0.0999 }], mid)).toBeNull();
  });

  it('takes the earliest crossing whatever order the years arrive in', () => {
    expect(
      revalueByYear(
        [
          { year: 2050, total_haircut: 0.2 },
          { year: 2030, total_haircut: 0.15 },
          { year: 2025, total_haircut: 0.0 },
        ],
        mid,
      ),
    ).toBe(2030);
  });

  it('cannot return the origination year under the seeded rules', () => {
    /*
      The ceiling at origination, proved rather than assumed: flood carries
      p_today = 0.00 and heat is zero because today IS the reference window, so
      only wind and PM2.5 remain, at 6 and 2 percent.
    */
    const originationCeiling = 0.06 + 0.02;
    expect(RULE_SET_SEED_DEFAULTS.p_today).toBe(0);
    expect(originationCeiling).toBeLessThan(edges.band_mid);
    expect(revalueByYear([{ year: 2025, total_haircut: originationCeiling }], mid)).toBeNull();
  });

  it('would return the origination year if the risk manager lowered the mid band', () => {
    /* The general form is kept for exactly this: the editor permits it. */
    expect(revalueByYear([{ year: 2025, total_haircut: 0.08 }], { band_mid: 0.05 })).toBe(2025);
  });
});

describe('the whole recommendation', () => {
  it('assembles band, conditions, revaluation and referral together', () => {
    const recommendation = recommendationFor({
      totalHaircut: 0.101,
      edges,
      haircutByYear: [
        { year: 2025, total_haircut: 0.0 },
        { year: 2030, total_haircut: 0.04 },
        { year: 2050, total_haircut: 0.101 },
      ],
    });

    expect(recommendation.band).toBe('orange');
    expect(recommendation.revalue_by_year).toBe(2050);
    expect(recommendation.refer_to_risk).toBe(false);
    expect(recommendation.conditions).toHaveLength(2);
  });

  it('refers a flagged coastal case even where the haircut is green', () => {
    const recommendation = recommendationFor({
      totalHaircut: 0.0,
      edges,
      haircutByYear: [{ year: 2050, total_haircut: 0.0 }],
      inundationFlag: true,
    });

    expect(recommendation.band).toBe('green');
    expect(recommendation.refer_to_risk).toBe(true);
    expect(recommendation.revalue_by_year).toBeNull();
    expect(recommendation.conditions).toEqual([INUNDATION_CONDITION]);
  });
});

describe('threshold editor validation (AC-9)', () => {
  const valid: RuleSetEdit = {
    base_ltv_personal: 0.75,
    base_ltv_corporate: 0.6,
    band_low: 0.03,
    band_mid: 0.1,
    band_high: 0.2,
    total_cap: 0.25,
    chronic_cap: 0.05,
    p_today: 0,
    p_2030: 0.05,
    p_2050: 0.22,
    inundation_threshold_m: 0.5,
    adaptation_enabled: true,
  };

  it('accepts the seeded rule set unchanged', () => {
    expect(validateRuleSetEdit(valid)).toBeNull();
  });

  it('accepts the edit the demo makes, raising the mid band to 12 percent', () => {
    expect(validateRuleSetEdit({ ...valid, band_mid: 0.12 })).toBeNull();
  });

  it('rejects bands that do not increase', () => {
    expect(validateRuleSetEdit({ ...valid, band_mid: 0.01 })).toMatch(/must increase/);
    expect(validateRuleSetEdit({ ...valid, band_high: 0.05 })).toMatch(/must increase/);
  });

  it('rejects a percentage typed as a whole number, the likeliest mistake', () => {
    expect(validateRuleSetEdit({ ...valid, band_mid: 12 })).toMatch(/between 0 and 1/);
  });

  it('rejects a top band above the total cap, which no case could reach', () => {
    expect(validateRuleSetEdit({ ...valid, band_high: 0.3 })).toMatch(/total cap/);
  });

  it('rejects a chronic cap above the total cap', () => {
    expect(validateRuleSetEdit({ ...valid, chronic_cap: 0.3, band_high: 0.2 })).toMatch(
      /chronic cap/,
    );
  });

  it('rejects horizon probabilities that decrease with n', () => {
    expect(validateRuleSetEdit({ ...valid, p_2050: 0.01 })).toMatch(/must not decrease/);
  });

  it('rejects a non-finite threshold rather than storing NaN', () => {
    expect(validateRuleSetEdit({ ...valid, band_mid: Number.NaN })).toMatch(/between 0 and 1/);
  });

  it('rejects an implausible inundation threshold', () => {
    expect(validateRuleSetEdit({ ...valid, inundation_threshold_m: 25 })).toMatch(/metres/);
    expect(validateRuleSetEdit({ ...valid, inundation_threshold_m: -1 })).toMatch(/metres/);
  });
});
