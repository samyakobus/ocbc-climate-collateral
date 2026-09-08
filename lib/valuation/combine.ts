/**
 * lib/valuation/combine.ts - the combination rule (S11, AC-2, AC-3, AC-4).
 *
 * Turns the four hazard terms into one haircut, one adjusted value and one
 * maximum loan. This is the file a director is shown when they ask where 6.6
 * percent comes from, so every step is a named intermediate rather than one
 * expression.
 *
 * The rule, from the spec:
 *
 *   water   = max(riverine, coastal)          correlated, so a maximum
 *   chronic = min(heat + pm25, chronic_cap)   capped at 5 percent
 *   total   = min(water + wind + chronic, total_cap)   capped at 25 percent
 *
 * The two water perils are the maximum rather than the sum because they are
 * correlated: one flood event drives both, and adding them would price the same
 * water twice. Heat and PM2.5 are independent chronic pressures, so they sum,
 * under their own cap.
 */

import { type Band, type BandEdges, bandOf } from '@/lib/rules/bands';
import { type BuildingType } from '@/lib/rules/curves';

import { type DamageTables } from './damage';
import {
  ABSENT_FLOOD,
  type AdaptationProject,
  type FloodTerm,
  type HazardSample,
  type OccupancyClass,
  type RuleConstants,
  type Scenario,
  type SiteModifiers,
  floodHaircut,
  heatHaircut,
  pm25Haircut,
  windHaircut,
} from './hazards';

/** The two correlated water perils, named so the winner can be recorded. */
export type FloodPeril = 'flood_riverine' | 'flood_coastal';

/** The collateral fields the engine needs. */
export type CollateralInput = {
  building_type: BuildingType;
  occupancy_class: OccupancyClass;
  appraised_value_sgd: number;
};

/** The loan fields the engine needs. */
export type LoanInput = {
  segment: 'personal' | 'corporate';
  /** Per-case override of the rule set's base LTV. Null means use the rule set. */
  base_ltv_override?: number | null;
};

/** The samples for one collateral at one scenario. */
export type SampleSet = {
  flood_riverine?: HazardSample | null;
  flood_coastal?: HazardSample | null;
  wind?: HazardSample | null;
  heat_days35?: HazardSample | null;
  pm25?: HazardSample | null;
};

/**
 * One valuation. Every field the `valuations` row stores, plus the loan figures
 * `application_valuations` stores, so a caller writes both from one result.
 */
export type Valuation = {
  /**
   * Which water peril won the maximum, and therefore whose depth, damage
   * fraction and credits are reported. NULL when both contribute zero, which is
   * most pins at origination: the provenance panel then shows no flood line at
   * all rather than an arbitrary one.
   */
  winning_peril: FloodPeril | null;
  depth_m: number | null;
  damage_fraction: number | null;

  flood_haircut_gross: number;
  adaptation_credit_documented_pp: number;
  adaptation_credit_effective_pp: number;
  flood_haircut: number;

  wind_haircut: number;
  heat_haircut: number;
  pm25_haircut: number;
  chronic_haircut: number;
  total_haircut: number;

  adjusted_value_sgd: number;
  band: Band;

  ltv_applied: number;
  max_loan_sgd: number;
};

/**
 * The base LTV for a loan: the per-case override when present, otherwise the
 * segment's rate from the active rule set.
 *
 * The precedence matters for AC-9. `rule_sets` is authoritative, so a risk
 * manager's edit moves every case that has no override, while a case with an
 * override keeps it. `tests/db/rule-edit-recompute.test.ts` pins this.
 */
export function baseLtvFor(loan: LoanInput, rules: RuleConstants): number {
  if (loan.base_ltv_override !== null && loan.base_ltv_override !== undefined) {
    return loan.base_ltv_override;
  }
  return loan.segment === 'personal' ? rules.base_ltv_personal : rules.base_ltv_corporate;
}

/**
 * The winner of the two water perils, selected on GROSS rather than net.
 *
 * Plan 4.2 says `winning_peril` is NULL "where both perils contribute zero",
 * which read alone suggests the floored case names no peril. Plan 4.3.2
 * requires the opposite for the ADR-4 fixture SG-EC-003: the case screen has to
 * say the 3.00 point Long Island credit was fully absorbed on COASTAL flood
 * against a gross of 2.64 percent, and it cannot say that without the peril
 * name, the depth and the damage fraction.
 *
 * Selecting on gross reconciles the two. A peril is named whenever either peril
 * measured anything, so a fully absorbed credit is still attributable, and the
 * name is NULL only when both perils are absent or both gross are exactly zero,
 * which is every pin at origination where the horizon probability is 0.00. That
 * is the case plan 4.2 was describing.
 *
 * Ties go to riverine.
 */
function winningFlood(
  riverine: FloodTerm,
  coastal: FloodTerm,
): { peril: FloodPeril | null; term: FloodTerm } {
  if (riverine.gross <= 0 && coastal.gross <= 0) {
    return { peril: null, term: ABSENT_FLOOD };
  }

  return riverine.gross >= coastal.gross
    ? { peril: 'flood_riverine', term: riverine }
    : { peril: 'flood_coastal', term: coastal };
}

/**
 * Value one collateral at one scenario.
 *
 * `adaptationOverride` supports the case screen's per-case preview (AC-3): pass
 * null to see the same pin without its adaptation credit. The preview recomputes
 * in memory and writes nothing; the risk manager's global switch on `/rules` is
 * a different thing and goes through `rules.adaptation_enabled`.
 */
export function valuate(args: {
  collateral: CollateralInput;
  loan: LoanInput;
  scenario: Scenario;
  rules: RuleConstants;
  samples: SampleSet;
  modifiers?: SiteModifiers | null;
  adaptation?: AdaptationProject | null;
  tables: DamageTables;
}): Valuation {
  const { collateral, loan, scenario, rules, samples, modifiers, adaptation, tables } = args;

  const riverine = floodHaircut(
    samples.flood_riverine,
    collateral.building_type,
    rules,
    scenario,
    adaptation,
    tables,
  );
  const coastal = floodHaircut(
    samples.flood_coastal,
    collateral.building_type,
    rules,
    scenario,
    adaptation,
    tables,
  );

  const { peril, term } = winningFlood(riverine, coastal);

  /*
    Correlated perils: the maximum, never the sum. Taken from the winning
    peril's own net so that every flood column on the row comes from one peril,
    and the panel can never pair a riverine depth with a coastal haircut. The
    documented credit is the same for both perils, since it belongs to the
    property, so the larger gross always carries the larger net and this equals
    max(riverine.net, coastal.net).
  */
  const water = term.net;

  const wind = windHaircut(samples.wind, collateral.occupancy_class);
  const heat = heatHaircut(samples.heat_days35, modifiers);
  const pm25 = pm25Haircut(samples.pm25);

  /* Independent chronic pressures: they sum, under their own cap. */
  const chronic = Math.min(heat + pm25, rules.chronic_cap);

  const total = Math.min(water + wind + chronic, rules.total_cap);

  const adjusted = collateral.appraised_value_sgd * (1 - total);
  const ltv = baseLtvFor(loan, rules);

  const winningSample =
    peril === 'flood_coastal'
      ? samples.flood_coastal
      : peril === 'flood_riverine'
        ? samples.flood_riverine
        : null;

  const edges: BandEdges = {
    band_low: rules.band_low,
    band_mid: rules.band_mid,
    band_high: rules.band_high,
  };

  return {
    winning_peril: peril,
    depth_m: winningSample?.value ?? null,
    damage_fraction: peril === null ? null : term.damage,

    flood_haircut_gross: term.gross,
    adaptation_credit_documented_pp: term.documented * 100,
    adaptation_credit_effective_pp: term.effective * 100,
    flood_haircut: water,

    wind_haircut: wind,
    heat_haircut: heat,
    pm25_haircut: pm25,
    chronic_haircut: chronic,
    total_haircut: total,

    adjusted_value_sgd: adjusted,
    band: bandOf(total, edges),

    ltv_applied: ltv,
    max_loan_sgd: adjusted * ltv,
  };
}
