/**
 * lib/rules/bands.ts - SEED DEFAULTS ONLY.
 *
 * The active `rule_sets` row is the only runtime source of these constants
 * (plan section 4.2, "Rule constants, one source of truth"). This module holds
 * the seed defaults that `db/seed/02_reference.sql` is generated from, via
 * `scripts/gen-reference-sql.ts`, and that the no-database unit tests read.
 * Nothing here is read at request time.
 *
 * Authored in S8 with the rule-set constants the reference seed needs, plus the
 * band edges and their keys. S12 extends this module with the condition strings
 * and the `revalue_by_year` evaluation, which is where the plan schedules them.
 */

/**
 * Every column value of the seeded active `rule_sets` row.
 *
 * ADR-5 and ADR-6: the three horizon probabilities are stored constants with a
 * true derivation. Nothing derives them at runtime.
 *
 *   P = 1 - 0.99^n, base year 2025, n = 0 / 5 / 25 -> 0.0000 / 0.0490 / 0.2222,
 *   stored as 0.00 / 0.05 / 0.22
 *
 * Only the flood term is multiplied by P (ADR-5). `return_period` is a
 * descriptive label, read-only in the threshold editor, and does not drive P.
 */
export const RULE_SET_SEED_DEFAULTS = {
  /** Base LTV applied to the ADJUSTED value, personal segment. */
  base_ltv_personal: 0.75,
  /** Base LTV applied to the ADJUSTED value, corporate segment. */
  base_ltv_corporate: 0.6,

  /** Recommendation band edges on the 2050 total haircut. */
  band_low: 0.03,
  band_mid: 0.1,
  band_high: 0.2,

  /** Combination caps (plan 4.3). */
  total_cap: 0.25,
  chronic_cap: 0.05,

  /** ADR-5 / ADR-6 horizon probabilities, n = 0 / 5 / 25 on a 2025 base. */
  p_today: 0.0,
  p_2030: 0.05,
  p_2050: 0.22,

  /** The base year of the probability arithmetic and of `revalue_by_year`. */
  today_year: 2025,
  /** What the leftmost scenario position reads on screen (ADR-5). */
  today_label: '2025 (origination)',

  /** Descriptive only. Retained as a label; does not drive P (ADR-5). */
  return_period: 100,

  /** Coastal inundation flag: elevation below regional 2050 SLR + this. */
  inundation_threshold_m: 0.5,

  /** The risk manager's global adaptation switch (AC-9). */
  adaptation_enabled: true,
} as const;

export type RuleSetSeedDefaults = typeof RULE_SET_SEED_DEFAULTS;

/**
 * The verbatim ADR-6 derivation comment. Emitted into the generated seed above
 * the `rule_sets` insert, and into `db/migrations/0001_schema.sql`, so the
 * stored values carry a derivation a director can check by subtraction.
 */
export const HORIZON_PROBABILITY_DERIVATION =
  'P = 1 - 0.99^n, base year 2025, n = 0 / 5 / 25 -> 0.0000 / 0.0490 / 0.2222, stored as 0.00 / 0.05 / 0.22';

/**
 * The four recommendation bands on the total haircut, in ascending severity.
 *
 * The keys are the `risk_band` enum values stored in `valuations.band`, and
 * they are the map pin colours, so a pin's colour and its case band are the
 * same value rather than two things that have to be kept in step (AC-5).
 *
 * Edges come from the active rule set at runtime, not from this list; the
 * numbers in `label` are the seeded edges and are for display only.
 */
export const BANDS = [
  { key: 'green', label: 'Below 3%' },
  { key: 'amber', label: '3-10%' },
  { key: 'orange', label: '10-20%' },
  { key: 'red', label: 'Above 20%' },
] as const;

export type Band = (typeof BANDS)[number]['key'];

/** Band edges as read from the active rule set. */
export type BandEdges = {
  band_low: number;
  band_mid: number;
  band_high: number;
};

/**
 * The band a total haircut falls into. Edges are lower-inclusive, so a haircut
 * exactly at `band_mid` is `high`, which is what makes the 10.1% realistic
 * Singapore fixture read as the 10-20% band.
 */
export function bandOf(totalHaircut: number, edges: BandEdges): Band {
  if (totalHaircut < edges.band_low) return 'green';
  if (totalHaircut < edges.band_mid) return 'amber';
  if (totalHaircut < edges.band_high) return 'orange';
  return 'red';
}

/** True for every band the portfolio dashboard counts as amber-or-worse (AC-6). */
export function isAmberOrWorse(band: Band): boolean {
  return band !== 'green';
}

/* ------------------------------------------------------------------ *
 * Conditions and revaluation (S12, AC-8)
 * ------------------------------------------------------------------ */

/**
 * The loan conditions each band adds, from plan section 4.3.2.
 *
 * Conditions are CUMULATIVE: a band carries its own conditions and every
 * milder band's. An orange case therefore requires flood cover as well as the
 * LTV cap, which is how a credit policy actually reads, and it means the list
 * grows monotonically with risk rather than swapping one condition for another.
 *
 * These strings are rendered verbatim on the case screen and are the closed set
 * a narrative may cite (AC-10). Changing the wording changes what the model is
 * allowed to say, so `tests/db/narrative-assertions.test.ts` checks against
 * this list rather than against a copy.
 *
 * Never a decline. The spec is explicit: bands drive conditions, and the most
 * severe outcome is a referral to a human.
 */
export const BAND_CONDITIONS: Readonly<Record<Band, readonly string[]>> = {
  green: [],
  amber: ['Require flood insurance cover for the full climate-adjusted value, renewed annually.'],
  orange: [
    'Cap the advance at the segment LTV applied to the climate-adjusted value, not the appraised value.',
  ],
  red: ['Refer to risk management before approval: the 2050 haircut exceeds the 20% threshold.'],
} as const;

/**
 * The condition added when the coastal inundation flag fires, whatever the band.
 * Plan 4.3.2: above 20 percent **or** the inundation flag refers to risk.
 */
export const INUNDATION_CONDITION =
  'Refer to risk management before approval: the site is flagged for coastal inundation at 2050.';

/* ------------------------------------------------------------------ *
 * Threshold editor validation (S18, AC-9)
 * ------------------------------------------------------------------ */

/**
 * Every field the threshold editor may change. `return_period` is deliberately
 * absent: it is a descriptive label, read-only on screen, and does not drive P.
 */
export type RuleSetEdit = {
  base_ltv_personal: number;
  base_ltv_corporate: number;
  band_low: number;
  band_mid: number;
  band_high: number;
  total_cap: number;
  chronic_cap: number;
  p_today: number;
  p_2030: number;
  p_2050: number;
  inundation_threshold_m: number;
  adaptation_enabled: boolean;
};

const FRACTION_FIELDS: readonly (keyof RuleSetEdit)[] = [
  'base_ltv_personal',
  'base_ltv_corporate',
  'band_low',
  'band_mid',
  'band_high',
  'total_cap',
  'chronic_cap',
  'p_today',
  'p_2030',
  'p_2050',
];

/**
 * Reject an edit that would make the rule set incoherent, returning the reason
 * or null.
 *
 * Lives here rather than beside the server action for two reasons. A
 * `'use server'` module may export nothing but async functions, so a plain
 * validator cannot live there at all. And the database enforces the band
 * ordering too, but a CHECK violation surfaces as a constraint name rather than
 * as something a risk manager can act on mid-demo.
 */
export function validateRuleSetEdit(edit: RuleSetEdit): string | null {
  for (const field of FRACTION_FIELDS) {
    const value = edit[field] as number;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return `${field} must be between 0 and 1. Enter 0.10 for 10 percent, not 10.`;
    }
  }

  if (!(edit.band_low < edit.band_mid && edit.band_mid < edit.band_high)) {
    return 'The band edges must increase: low below mid, mid below high.';
  }

  if (edit.band_high > edit.total_cap) {
    return 'The top band edge cannot sit above the total cap, or no case could ever reach it.';
  }

  if (edit.chronic_cap > edit.total_cap) {
    return 'The chronic cap cannot exceed the total cap.';
  }

  if (!(edit.p_today <= edit.p_2030 && edit.p_2030 <= edit.p_2050)) {
    return 'The horizon probabilities must not decrease: n = 0, then 5, then 25.';
  }

  if (edit.inundation_threshold_m < 0 || edit.inundation_threshold_m > 10) {
    return 'The inundation threshold must be between 0 and 10 metres.';
  }

  return null;
}

/**
 * The coastal inundation flag (plan 4.3.2).
 *
 *   elevation_m < regional SLR at 2050 + inundation_threshold_m
 *
 * The `sea_level_inundation` context row stores the IPCC AR6 regional median
 * sea level rise for SSP5-8.5 at 2050, in metres, NOT a flag. Reading its mere
 * presence as the flag would fire on every coastal pin in the book, because
 * every pin has a regional figure; the flag is the comparison.
 *
 * Returns false when either figure is missing. An unmeasured pin is not a
 * flagged pin: a referral has to rest on evidence, and `provenance-panel`
 * shows the absence rather than implying a finding.
 *
 * This fires a referral on its own, whatever the haircut, so a low-haircut
 * property that will nonetheless be under water is not waved through.
 */
export function coastalInundationFlag(args: {
  elevation_m: number | null | undefined;
  regional_slr_m_2050: number | null | undefined;
  inundation_threshold_m: number;
}): boolean {
  const { elevation_m, regional_slr_m_2050, inundation_threshold_m } = args;

  if (elevation_m === null || elevation_m === undefined) return false;
  if (regional_slr_m_2050 === null || regional_slr_m_2050 === undefined) return false;

  return elevation_m < regional_slr_m_2050 + inundation_threshold_m;
}

/** Everything the `recommendations` row stores for one application and scenario. */
export type Recommendation = {
  band: Band;
  conditions: string[];
  revalue_by_year: number | null;
  refer_to_risk: boolean;
};

/** The bands in ascending severity, used to accumulate conditions. */
const BAND_ORDER: readonly Band[] = BANDS.map((entry) => entry.key);

/**
 * The conditions for a band, including every milder band's.
 *
 * `inundationFlag` comes from `context_factors.sea_level_inundation` and forces
 * a referral on its own, so a low-haircut property that will nonetheless be
 * under water is not waved through on its haircut alone.
 */
export function conditionsFor(band: Band, inundationFlag = false): string[] {
  const upTo = BAND_ORDER.indexOf(band);
  const conditions = BAND_ORDER.slice(0, upTo + 1).flatMap((key) => [...BAND_CONDITIONS[key]]);

  if (inundationFlag && !conditions.includes(INUNDATION_CONDITION)) {
    conditions.push(INUNDATION_CONDITION);
  }

  return conditions;
}

/** A referral is required above the top band, or on the inundation flag. */
export function refersToRisk(band: Band, inundationFlag = false): boolean {
  return band === 'red' || inundationFlag;
}

/**
 * The first scenario year whose total haircut reaches `band_mid`, or null.
 *
 * Evaluated over the literal years the scenarios represent, in ascending order.
 * A date in the past means OVERDUE, which is a finding rather than a clock bug,
 * and the demo script says so.
 *
 * In practice this returns 2030, 2050 or null and never the origination year,
 * and that is a property of the model rather than a special case here: heat is
 * zero at origination by definition of the metric and flood carries a zero
 * probability there, so the most a pin can reach at 2025 is 6 percent wind plus
 * 2 percent PM2.5, which is 8 percent and below the 10 percent mid band. The
 * general form is kept because it stays correct if the risk manager lowers
 * `band_mid` below 8 percent, which the threshold editor permits.
 *
 * `revalue_by_year` is a property of the APPLICATION, not of a scenario, so the
 * same value is stored on all three `recommendations` rows and the dashboard
 * tile counts it with COUNT(DISTINCT loan_application_id) and is labelled
 * scenario-invariant.
 */
export function revalueByYear(
  haircutByYear: readonly { year: number; total_haircut: number }[],
  edges: Pick<BandEdges, 'band_mid'>,
): number | null {
  const ascending = [...haircutByYear].sort((a, b) => a.year - b.year);
  const crossing = ascending.find((entry) => entry.total_haircut >= edges.band_mid);
  return crossing ? crossing.year : null;
}

/** The whole recommendation for one application at one scenario. */
export function recommendationFor(args: {
  totalHaircut: number;
  edges: BandEdges;
  haircutByYear: readonly { year: number; total_haircut: number }[];
  inundationFlag?: boolean;
}): Recommendation {
  const { totalHaircut, edges, haircutByYear, inundationFlag = false } = args;
  const band = bandOf(totalHaircut, edges);

  return {
    band,
    conditions: conditionsFor(band, inundationFlag),
    revalue_by_year: revalueByYear(haircutByYear, edges),
    refer_to_risk: refersToRisk(band, inundationFlag),
  };
}
