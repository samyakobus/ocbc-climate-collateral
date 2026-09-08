/**
 * tests/unit/curve-fixtures.test.ts - AC-2, AC-3. No database.
 *
 * Pins the two depth-damage values every headline figure in the demo rests on,
 * read from `lib/rules/curves.ts` (plan section 4.3.1):
 *
 *   f(0.50) = 0.30  a published point, and the AC-2 worked example's damage
 *                   fraction: 0.30 x p_2050 0.22 = 6.6%
 *   f(0.80) = 0.42  interpolated between the 0.5 m and 1.0 m points, and the
 *                   AC-3 adaptation fixture's damage fraction:
 *                   0.42 x 0.22 = 9.24% gross, 7.74% after the 1.50 pp credit
 *
 * Any change to the 1.0 m residential point breaks AC-3, so that point is
 * pinned directly as well.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILDING_DAMAGE_CLASS,
  BUILDING_TYPES,
  DAMAGE_CLASSES,
  DEPTH_DAMAGE_CURVES,
  curveFor,
  damageClassOf,
  damageFractionFromSeed,
  interpolateCurve,
} from '../../lib/rules/curves';

const RESIDENTIAL = curveFor('residential');

describe('seeded depth-damage curves: the two pinned fixtures', () => {
  it('interpolates to 0.30 at 0.50 m on the residential curve', () => {
    expect(interpolateCurve(RESIDENTIAL, 0.5)).toBeCloseTo(0.3, 10);
  });

  it('interpolates to 0.42 at 0.80 m on the residential curve', () => {
    expect(interpolateCurve(RESIDENTIAL, 0.8)).toBeCloseTo(0.42, 10);
  });

  it('reaches both fixtures through damageFraction for a highrise RC residence', () => {
    expect(damageFractionFromSeed(0.5, 'residential_highrise_rc')).toBeCloseTo(0.3, 10);
    expect(damageFractionFromSeed(0.8, 'residential_highrise_rc')).toBeCloseTo(0.42, 10);
  });

  it('pins the 1.0 m residential point, which the 0.80 m interpolation depends on', () => {
    expect(interpolateCurve(RESIDENTIAL, 1.0)).toBeCloseTo(0.5, 10);
    /* 0.30 + (0.30 / 0.50) x (0.50 - 0.30) = 0.42 */
    expect(0.3 + (0.3 / 0.5) * (0.5 - 0.3)).toBeCloseTo(0.42, 10);
  });

  it('pins the 0.20 m residential value the ADR-4 zero-floor fixture rests on', () => {
    /* SG-EC-003: damage 0.12, gross 0.12 x 0.22 = 2.64%, floored to zero
       against a documented 3.00 pp credit. */
    expect(interpolateCurve(RESIDENTIAL, 0.2)).toBeCloseTo(0.12, 10);
  });
});

describe('curve interpolation behaviour', () => {
  it('returns every published point exactly, on all three curves', () => {
    for (const cls of DAMAGE_CLASSES) {
      for (const point of DEPTH_DAMAGE_CURVES[cls]) {
        expect(interpolateCurve(curveFor(cls), point.depth_m)).toBeCloseTo(
          point.damage_fraction,
          10,
        );
      }
    }
  });

  it('clamps negative depth to zero damage rather than extrapolating', () => {
    expect(interpolateCurve(RESIDENTIAL, -1)).toBe(0);
    expect(interpolateCurve(RESIDENTIAL, -0.001)).toBe(0);
  });

  it('is flat at 1.0 above the deepest published point', () => {
    expect(interpolateCurve(RESIDENTIAL, 6)).toBe(1);
    expect(interpolateCurve(RESIDENTIAL, 25)).toBe(1);
  });

  it('stays inside [0, 1] and rises monotonically across the sampled range', () => {
    let previous = -1;
    for (let depth = 0; depth <= 8; depth += 0.05) {
      const value = interpolateCurve(RESIDENTIAL, depth);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('rejects a non-finite depth rather than returning a silent zero', () => {
    expect(() => interpolateCurve(RESIDENTIAL, Number.NaN)).toThrow();
    expect(() => interpolateCurve(RESIDENTIAL, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('orders the three curves residential >= commercial >= industrial at every depth', () => {
    for (let depth = 0; depth <= 6; depth += 0.25) {
      const residential = interpolateCurve(curveFor('residential'), depth);
      const commercial = interpolateCurve(curveFor('commercial'), depth);
      const industrial = interpolateCurve(curveFor('industrial'), depth);
      expect(residential).toBeGreaterThanOrEqual(commercial);
      expect(commercial).toBeGreaterThanOrEqual(industrial);
    }
  });
});

describe('building_damage_class: the six-to-three classification rule', () => {
  it('maps exactly six building types onto exactly three damage classes', () => {
    expect(BUILDING_TYPES).toHaveLength(6);
    expect(DAMAGE_CLASSES).toHaveLength(3);
    expect(Object.keys(BUILDING_DAMAGE_CLASS)).toHaveLength(6);
    expect(new Set(Object.values(BUILDING_DAMAGE_CLASS))).toEqual(new Set(DAMAGE_CLASSES));
  });

  it('classifies every building type, with a curve behind each class', () => {
    for (const buildingType of BUILDING_TYPES) {
      const cls = damageClassOf(buildingType);
      expect(DAMAGE_CLASSES).toContain(cls);
      expect(curveFor(cls).length).toBeGreaterThan(1);
    }
  });

  it('classifies the fixture building type as residential', () => {
    expect(damageClassOf('residential_highrise_rc')).toBe('residential');
  });
});
