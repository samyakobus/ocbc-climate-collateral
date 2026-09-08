/**
 * lib/rules/curves.ts - SEED DEFAULTS ONLY.
 *
 * Holds the section 4.3.1 depth-damage curve points and the six-to-three
 * `building_damage_class` mapping as typed constants.
 *
 * Ownership (plan section 4.2, "Rule constants, one source of truth"):
 *   - The active `rule_sets` row and the seeded `depth_damage_functions` /
 *     `building_damage_class` tables are the ONLY runtime source. Nothing in
 *     this module is read at request time.
 *   - This module is the authoring source for `db/seed/02_reference.sql`,
 *     which `scripts/gen-reference-sql.ts` derives from it. The SQL is
 *     generated, never hand-edited, so the two cannot drift (ADR-2).
 *   - It also lets the no-database unit tests
 *     (`tests/unit/curve-fixtures.test.ts`, `tests/unit/worked-example.test.ts`)
 *     evaluate `damageFraction` without Postgres, which is the project the
 *     Vitest workspace assigns them to.
 *
 * `lib/valuation/damage.ts` (S10) composes `damageClassOf`, `curveFor` and
 * `interpolateCurve` into `damageFraction(depth_m, buildingType)`. The
 * interpolation primitive lives here, beside the points it interpolates, so
 * there is exactly one implementation of the curve rule (principle 5).
 */

/** The three curve families of `depth_damage_functions.damage_class`. */
export type DamageClass = 'residential' | 'commercial' | 'industrial';

/**
 * The six values of `collateral.building_type`.
 *
 * The spec and plan section 4.2 say only "ENUM(6 values)" without naming them.
 * This list is the same six as the `building_type` enum in
 * `db/migrations/0001_schema.sql`, and `prep/gen_portfolio.py` writes from the
 * same set. `residential_highrise_rc` is fixed by the section 4.3.2 fixtures.
 */
export type BuildingType =
  | 'residential_highrise_rc'
  | 'residential_landed'
  | 'shophouse_mixed'
  | 'office_tower'
  | 'retail_podium'
  | 'industrial_warehouse';

/** One published point on a depth-damage curve. */
export type CurvePoint = {
  readonly depth_m: number;
  readonly damage_fraction: number;
};

export const DAMAGE_CLASSES: readonly DamageClass[] = [
  'residential',
  'commercial',
  'industrial',
] as const;

export const BUILDING_TYPES: readonly BuildingType[] = [
  'residential_highrise_rc',
  'residential_landed',
  'shophouse_mixed',
  'office_tower',
  'retail_podium',
  'industrial_warehouse',
] as const;

/**
 * Provenance for all three curves. Plan section 4.3.1: these are a curated fit
 * adapted from the JRC Asia curves, not a direct transcription (the published
 * Asia residential curve sits near 0.32 at 0.5 m, ours at 0.30). The case
 * screen renders CURVE_LABEL and `docs/sources.md` records the deviation.
 */
export const CURVE_LABEL = 'seeded curve, curated fit (JRC Asia)';
export const CURVE_SOURCE_NAME =
  'Huizinga, De Moel & Szewczyk 2017, JRC EUR 28552, Asia depth-damage curves (curated fit)';
export const CURVE_SOURCE_URL =
  'https://publications.jrc.ec.europa.eu/repository/handle/JRC105688';

/**
 * Section 4.3.1, verbatim. Linear interpolation between these points, clamped
 * to [0, 1].
 *
 * The two AC-2 / AC-3 fixtures fall out of the residential row:
 *   f(0.50) = 0.30  (a published point)
 *   f(0.80) = 0.30 + (0.30 / 0.50) x 0.20 = 0.42  (interpolated 0.5 -> 1.0)
 * Any change to the 1.0 m residential point breaks AC-3, which is why
 * `tests/unit/curve-fixtures.test.ts` pins both values.
 */
export const DEPTH_DAMAGE_CURVES: Readonly<Record<DamageClass, readonly CurvePoint[]>> = {
  residential: [
    { depth_m: 0.0, damage_fraction: 0.0 },
    { depth_m: 0.5, damage_fraction: 0.3 },
    { depth_m: 1.0, damage_fraction: 0.5 },
    { depth_m: 1.5, damage_fraction: 0.62 },
    { depth_m: 2.0, damage_fraction: 0.72 },
    { depth_m: 3.0, damage_fraction: 0.87 },
    { depth_m: 4.0, damage_fraction: 0.95 },
    { depth_m: 6.0, damage_fraction: 1.0 },
  ],
  commercial: [
    { depth_m: 0.0, damage_fraction: 0.0 },
    { depth_m: 0.5, damage_fraction: 0.22 },
    { depth_m: 1.0, damage_fraction: 0.4 },
    { depth_m: 1.5, damage_fraction: 0.53 },
    { depth_m: 2.0, damage_fraction: 0.65 },
    { depth_m: 3.0, damage_fraction: 0.82 },
    { depth_m: 4.0, damage_fraction: 0.92 },
    { depth_m: 6.0, damage_fraction: 1.0 },
  ],
  industrial: [
    { depth_m: 0.0, damage_fraction: 0.0 },
    { depth_m: 0.5, damage_fraction: 0.18 },
    { depth_m: 1.0, damage_fraction: 0.34 },
    { depth_m: 1.5, damage_fraction: 0.47 },
    { depth_m: 2.0, damage_fraction: 0.58 },
    { depth_m: 3.0, damage_fraction: 0.76 },
    { depth_m: 4.0, damage_fraction: 0.88 },
    { depth_m: 6.0, damage_fraction: 1.0 },
  ],
} as const;

/**
 * The six-to-three classification rule, seeded into `building_damage_class`
 * and read by `lib/valuation/damage.ts`. It decides which curve applies to
 * every flood haircut, so per ADR-2 it is a rule and does not live in
 * `prep/gen_portfolio.py`.
 */
export const BUILDING_DAMAGE_CLASS: Readonly<Record<BuildingType, DamageClass>> = {
  residential_highrise_rc: 'residential',
  residential_landed: 'residential',
  shophouse_mixed: 'commercial',
  office_tower: 'commercial',
  retail_podium: 'commercial',
  industrial_warehouse: 'industrial',
} as const;

/** The curve family that applies to a building type. */
export function damageClassOf(buildingType: BuildingType): DamageClass {
  const cls = BUILDING_DAMAGE_CLASS[buildingType];
  if (cls === undefined) {
    throw new Error(`Unknown building_type: ${String(buildingType)}`);
  }
  return cls;
}

/** The seeded curve points for a damage class. */
export function curveFor(damageClass: DamageClass): readonly CurvePoint[] {
  const points = DEPTH_DAMAGE_CURVES[damageClass];
  if (points === undefined) {
    throw new Error(`Unknown damage_class: ${String(damageClass)}`);
  }
  return points;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Linear interpolation over a depth-damage curve, clamped to [0, 1].
 *
 * Negative depths are clamped to 0 (plan 4.3: `max(depth_m, 0)`). Depths below
 * the first point or above the last return that endpoint's fraction, so the
 * curve is flat outside its published range rather than extrapolating.
 * `points` must be sorted ascending by `depth_m`, which the seeded curves are.
 */
export function interpolateCurve(points: readonly CurvePoint[], depth_m: number): number {
  if (points.length === 0) {
    throw new Error('interpolateCurve: empty curve');
  }
  if (!Number.isFinite(depth_m)) {
    throw new Error(`interpolateCurve: non-finite depth_m: ${String(depth_m)}`);
  }

  const depth = Math.max(depth_m, 0);

  const first = points[0];
  if (depth <= first.depth_m) {
    return clamp(first.damage_fraction, 0, 1);
  }

  const last = points[points.length - 1];
  if (depth >= last.depth_m) {
    return clamp(last.damage_fraction, 0, 1);
  }

  for (let i = 1; i < points.length; i += 1) {
    const hi = points[i];
    if (depth <= hi.depth_m) {
      const lo = points[i - 1];
      const span = hi.depth_m - lo.depth_m;
      const t = span === 0 ? 0 : (depth - lo.depth_m) / span;
      const value = lo.damage_fraction + t * (hi.damage_fraction - lo.damage_fraction);
      return clamp(value, 0, 1);
    }
  }

  /* Unreachable: the depth >= last.depth_m branch above covers the tail. */
  return clamp(last.damage_fraction, 0, 1);
}

/**
 * Database-free `damageFraction`, evaluated from the seed defaults.
 *
 * `lib/valuation/damage.ts` (S10) is the runtime implementation and reads the
 * seeded tables; this is the same composition over the constants in this file,
 * and it is what the no-database unit tests assert against.
 */
export function damageFractionFromSeed(depth_m: number, buildingType: BuildingType): number {
  return interpolateCurve(curveFor(damageClassOf(buildingType)), depth_m);
}
