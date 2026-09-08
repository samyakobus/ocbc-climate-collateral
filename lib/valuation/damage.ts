/**
 * lib/valuation/damage.ts - the flood depth-damage step (S10, AC-2, AC-4).
 *
 * `damageFraction(depth_m, buildingType)` is the fraction of a building's value
 * destroyed by standing water of a given depth. It is the first factor of the
 * flood haircut, the second being the horizon probability P (ADR-5).
 *
 * Two sources, one rule. At runtime the curve and the six-to-three
 * classification are read from the seeded `depth_damage_functions` and
 * `building_damage_class` tables, which the risk manager can inspect. In the
 * no-database unit project they are read from `lib/rules/curves.ts`, which
 * generated those tables in the first place. Both paths share the single
 * interpolation primitive in that module, so there is one implementation of the
 * curve rule and no copy to drift (ADR-2, principle 5).
 */

import {
  type BuildingType,
  type CurvePoint,
  type DamageClass,
  curveFor,
  damageClassOf,
  interpolateCurve,
} from '@/lib/rules/curves';

/**
 * The seeded curve and classification, as read from the database.
 *
 * `lib/valuation/recompute.ts` loads this once per pass rather than per pin, so
 * a 200-pin recompute is two queries rather than four hundred.
 */
export type DamageTables = {
  /** One entry per damage class, from `depth_damage_functions.points`. */
  curves: Readonly<Partial<Record<DamageClass, readonly CurvePoint[]>>>;
  /** The six-to-three rule, from `building_damage_class`. */
  classOf: Readonly<Partial<Record<BuildingType, DamageClass>>>;
};

/**
 * The damage fraction at a depth, for a building type, from the seeded tables.
 *
 * Throws rather than defaulting when a building type or a curve is missing: a
 * silent zero here would understate a haircut, which is the direction of error
 * that matters for a credit decision.
 */
export function damageFraction(
  depth_m: number,
  buildingType: BuildingType,
  tables: DamageTables,
): number {
  const damageClass = tables.classOf[buildingType];
  if (damageClass === undefined) {
    throw new Error(
      `No damage class seeded for building_type "${buildingType}". ` +
        'building_damage_class must cover every building type.',
    );
  }

  const points = tables.curves[damageClass];
  if (points === undefined || points.length === 0) {
    throw new Error(
      `No depth-damage curve seeded for damage_class "${damageClass}". ` +
        'depth_damage_functions must cover every damage class.',
    );
  }

  return interpolateCurve(points, depth_m);
}

/**
 * The same calculation against the seed defaults in `lib/rules/curves.ts`,
 * with no database.
 *
 * This is what `tests/unit/worked-example.test.ts` and
 * `tests/unit/curve-fixtures.test.ts` assert on, and what makes AC-2 bind to
 * the formula first and the stored row second.
 */
export function damageFractionFromRules(depth_m: number, buildingType: BuildingType): number {
  return interpolateCurve(curveFor(damageClassOf(buildingType)), depth_m);
}
