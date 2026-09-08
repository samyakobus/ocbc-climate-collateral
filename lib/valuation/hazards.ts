/**
 * lib/valuation/hazards.ts - the four hazard terms (S10, AC-2, AC-4).
 *
 * One function per scored hazard, each returning a single shape on every
 * branch, each with an explicit absent case contributing zero.
 *
 * Measurement and policy are separate axes (principle 3). A sample contributes
 * only when its `coverage` is `scored`. Both `measured_not_scored`, which means
 * the raster measured a real value that policy excludes, and `absent`, which
 * means the raster has no coverage at that point, contribute exactly zero. The
 * distinction survives into the provenance panel, which shows Jakarta's real
 * 41 micrograms beside the reason it is not priced, rather than claiming there
 * is no data there.
 *
 * There is no country anywhere in this file. Whether a hazard is scored for a
 * country is a row in `hazard_applicability`, which the sampler resolves into
 * `coverage` (principle 4).
 *
 * Only the flood term carries the horizon probability P (ADR-5). Wind and the
 * chronic perils are unconditional return-period bands, and heat is zero at
 * origination because the heat metric is defined relative to the present.
 */

import { type BuildingType } from '@/lib/rules/curves';

import { type DamageTables, damageFraction } from './damage';

/* ------------------------------------------------------------------ *
 * Domain types
 * ------------------------------------------------------------------ */

/** `scenario` enum. The leftmost position reads "2025 (origination)" on screen. */
export type Scenario = 'today' | 'y2030' | 'y2050';

/** `coverage_state` enum. Only `scored` contributes to a haircut. */
export type Coverage = 'scored' | 'measured_not_scored' | 'absent';

/** `occupancy_class` enum. Recorded per pin; the multiplier below is the rule. */
export type OccupancyClass = 'rc_highrise' | 'lowrise_industrial';

/** One row of `hazard_samples`, as the engine needs it. */
export type HazardSample = {
  value: number | null;
  coverage: Coverage;
};

/** One row of `site_modifiers`. Tertiles are 0, 1, 2. */
export type SiteModifiers = {
  suhi_tertile: number;
  ndvi_tertile: number;
};

/** One row of `adaptation_projects`, as the engine needs it. */
export type AdaptationProject = {
  /** Percentage POINTS, so 1.50 means 1.50pp (ADR-4). */
  haircut_credit_pp: number;
};

/** The constants the engine reads from the active `rule_sets` row. */
export type RuleConstants = {
  p_today: number;
  p_2030: number;
  p_2050: number;
  total_cap: number;
  chronic_cap: number;
  base_ltv_personal: number;
  base_ltv_corporate: number;
  band_low: number;
  band_mid: number;
  band_high: number;
  inundation_threshold_m: number;
  adaptation_enabled: boolean;
};

/**
 * The flood term. The same four fields on every branch, including the absent
 * one, so a caller never has to test which shape it received.
 *
 * `gross` is before adaptation, `net` is after the credit and the zero floor,
 * `documented` is the credit the project publishes and `effective` is the part
 * of it the floor actually let through. The case screen renders documented and
 * effective side by side, because where the floor binds they differ and hiding
 * that would overstate what the adaptation bought (ADR-4).
 *
 * `damage` is the depth-damage fraction before the horizon probability, carried
 * here because the provenance panel shows it as its own step. It is returned
 * rather than re-derived as `gross / P` by the caller, which would divide by
 * zero at origination where P is 0.00.
 */
export type FloodTerm = {
  net: number;
  gross: number;
  documented: number;
  effective: number;
  damage: number;
};

/* ------------------------------------------------------------------ *
 * Absent cases
 * ------------------------------------------------------------------ */

/** Wind, heat and PM2.5 contribute a scalar zero when absent. */
export const ABSENT = 0;

/** Flood contributes the same object shape it always returns. */
export const ABSENT_FLOOD: FloodTerm = Object.freeze({
  net: 0,
  gross: 0,
  documented: 0,
  effective: 0,
  damage: 0,
});

/** A sample contributes only when the raster measured it AND policy scores it. */
export function contributes(sample: HazardSample | null | undefined): sample is HazardSample {
  return !!sample && sample.coverage === 'scored' && sample.value !== null;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/* ------------------------------------------------------------------ *
 * Horizon probability (ADR-5, ADR-6)
 * ------------------------------------------------------------------ */

/**
 * Which stored probability each scenario uses.
 *
 * Written out rather than composed as `p_${scenario}`, which the plan's
 * pseudocode does: the scenario keys are `today`, `y2030` and `y2050` while the
 * columns are `p_today`, `p_2030` and `p_2050`, so string composition yields
 * `p_y2030` and reads undefined. An undefined P silently zeroes every flood
 * haircut at 2030 and 2050, which is the whole demo.
 */
const HORIZON_PROBABILITY: Readonly<Record<Scenario, keyof RuleConstants>> = {
  today: 'p_today',
  y2030: 'p_2030',
  y2050: 'p_2050',
};

/** The stored probability for a scenario: 0.00, 0.05 or 0.22. */
export function horizonProbability(rules: RuleConstants, scenario: Scenario): number {
  const value = rules[HORIZON_PROBABILITY[scenario]];
  if (typeof value !== 'number') {
    throw new Error(`No horizon probability for scenario "${scenario}" in the active rule set.`);
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * The four hazard terms
 * ------------------------------------------------------------------ */

/**
 * One water peril, as a haircut.
 *
 *   gross = damageFraction(depth) x P(scenario)
 *   net   = max(gross - adaptation credit, 0)
 *
 * The credit is in percentage points and is converted to a fraction here, which
 * is the only place that conversion happens.
 *
 * Called once for riverine and once for coastal; `combine.ts` takes the maximum
 * of the two nets, because they are correlated and adding them would double
 * count one flood.
 */
export function floodHaircut(
  sample: HazardSample | null | undefined,
  buildingType: BuildingType,
  rules: RuleConstants,
  scenario: Scenario,
  adaptation: AdaptationProject | null | undefined,
  tables: DamageTables,
): FloodTerm {
  if (!contributes(sample)) return ABSENT_FLOOD;

  const probability = horizonProbability(rules, scenario);
  const damage = damageFraction(sample.value as number, buildingType, tables);
  const gross = damage * probability;

  const documented =
    rules.adaptation_enabled && adaptation ? adaptation.haircut_credit_pp / 100 : 0;

  /* ADR-4: the credit is subtracted in haircut units and floored at zero. */
  const net = Math.max(gross - documented, 0);
  /* What the credit ACTUALLY bought. Where the floor binds this is less than
     the documented figure, and the panel renders both side by side. */
  const effective = Math.min(documented, gross);

  return { net, gross, documented, effective, damage };
}

/**
 * Typhoon wind, from the STORM 100-year return-period wind speed in m/s.
 *
 * Below 33 m/s, the threshold for a severe tropical storm, there is no haircut.
 * Two bands above it, 1 to 3 percent and 3 to 6 percent, joined continuously at
 * 45 m/s where both expressions give 3 percent.
 *
 * Occupancy modulates WITHIN a band and never outside it: reinforced-concrete
 * high-rise takes 0.8 and low-rise industrial 1.2, and the result is clamped
 * back into the band the wind speed selected. A building type cannot move a pin
 * into a different wind band.
 *
 * No horizon probability: this is an unconditional return-period band.
 */
export function windHaircut(
  sample: HazardSample | null | undefined,
  occupancy: OccupancyClass,
): number {
  if (!contributes(sample)) return ABSENT;

  const speed = sample.value as number;
  if (speed < 33) return 0;

  const withinLowerBand = speed <= 45;
  const [lo, hi] = withinLowerBand ? [0.01, 0.03] : [0.03, 0.06];
  const base = withinLowerBand
    ? 0.01 + ((speed - 33) / 12) * 0.02
    : 0.03 + Math.min((speed - 45) / 15, 1) * 0.03;

  const multiplier = occupancy === 'rc_highrise' ? 0.8 : 1.2;
  return clamp(base * multiplier, lo, hi);
}

/**
 * Extreme heat, from the increase in days above 35 C against the 2016-2035
 * reference window.
 *
 * The 0.1 percent per day elasticity is BORROWED from cooling-cost and
 * productivity literature rather than measured on this book, and the case
 * screen carries a chip saying so. The 5 percent cap applies to the elasticity
 * term alone; the urban-heat multiplier then applies on top, so heat can reach
 * 7.5 percent and the chronic cap in `combine.ts` is what binds.
 *
 * Vegetation offsets heat island: a pin in the greenest NDVI tertile is treated
 * as one urban-heat tertile cooler, floored at the lowest.
 *
 * Zero at origination is a property of the metric, not a special case: the
 * today scenario IS the reference window, so its delta is zero by definition.
 */
export function heatHaircut(
  sample: HazardSample | null | undefined,
  modifiers: SiteModifiers | null | undefined,
): number {
  if (!contributes(sample) || !modifiers) return ABSENT;

  const extraDays = sample.value as number;
  const elasticityTerm = Math.min(0.001 * extraDays, 0.05);

  const cooled = modifiers.ndvi_tertile === 2;
  const tertile = cooled ? Math.max(modifiers.suhi_tertile - 1, 0) : modifiers.suhi_tertile;

  const factors = [1.0, 1.25, 1.5];
  const factor = factors[clamp(tertile, 0, factors.length - 1)];

  return elasticityTerm * factor;
}

/**
 * Chronic air quality, from the GHAP annual mean PM2.5 in micrograms per cubic
 * metre. Two steps at the 35 and 50 thresholds.
 *
 * Scenario-invariant: the same value is stored for all three horizons, so this
 * term does not move with the slider.
 */
export function pm25Haircut(sample: HazardSample | null | undefined): number {
  if (!contributes(sample)) return ABSENT;

  const concentration = sample.value as number;
  if (concentration < 35) return 0;
  return concentration <= 50 ? 0.01 : 0.02;
}
