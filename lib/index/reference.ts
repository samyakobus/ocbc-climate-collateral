/**
 * The deterministic reference index (plan 4.4, ADR-3, AC-17).
 *
 * One number per hotspot, 1 to 100, computed from the same record the model is
 * shown a subset of. It is NEVER put in the prompt: ADR-3 reversed the earlier
 * anchoring design precisely so that `divergence_flag` measures something. An
 * anchored model cannot express a deliberate departure, so a badge over an
 * anchored score would measure neither agreement nor disagreement.
 *
 * Nothing here reads a database, a clock or an environment variable. It takes a
 * stored `HotspotScoreInputs` record and one rule constant, `total_cap`, which
 * the caller reads from the active rule set. That is what lets
 * `tests/unit/reference-index.test.ts` recompute the index in the no-database
 * unit project, and `tests/db/reference-index.test.ts` recompute it from what is
 * actually stored.
 */

import type { HotspotScoreInputs } from '@/lib/index/inputs';

/**
 * Event-type weights for the V term (plan 4.4, verbatim).
 *
 * Earthquakes carry 0.3, so a geophysical event moves a number labelled climate
 * risk. Plan 4.4 states that this is deliberate and that `docs/sources.md` says
 * so out loud. It is a different question from whether an earthquake is priced
 * into a haircut, which it never is: the `hazard` enum has no earthquake member,
 * so the valuation engine has no way to score one.
 *
 * This table is the single definition of the weights. `lib/index/inputs.ts`
 * imports it to build `recent_event_severity_90d`, so a change here moves the
 * stored severity and the index together and cannot make them disagree.
 */
export const EVENT_TYPE_WEIGHTS = {
  fire: 1.0,
  flood: 1.0,
  storm: 1.0,
  haze: 0.8,
  pollution: 0.8,
  earthquake: 0.3,
} as const;

export type EventType = keyof typeof EVENT_TYPE_WEIGHTS;

/** The severity sum at which the V term saturates (plan 4.4: `min(sum / 10, 1)`). */
export const SEVERITY_SATURATION = 10;

/** The 90-day window the V term counts over (plan 4.4). */
export const RECENT_WINDOW_DAYS = 90;

/** The three term weights (plan 4.4: `0.45*H + 0.30*E + 0.25*V`). */
export const TERM_WEIGHTS = { H: 0.45, E: 0.3, V: 0.25 } as const;

/** The weight of one event, or 0 for a type the table does not name. */
export function eventWeight(eventType: string): number {
  return EVENT_TYPE_WEIGHTS[eventType as EventType] ?? 0;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export type ReferenceTerms = {
  /** Hazard severity, the 2050 p90 total haircut normalised by the total cap. */
  H: number;
  /** Exposure share of the current hotspot snapshot, 0 to 1. */
  E: number;
  /** Recent-event pressure over the 90-day window, 0 to 1. */
  V: number;
  /** The weighted sum before clamping, kept so a test can show which term saturated. */
  weighted: number;
};

/**
 * H, E and V from a stored record.
 *
 * H is deliberately NOT clamped on its own: plan 4.4 clamps the weighted sum,
 * not the individual terms, and a haircut above the cap would be a bug in the
 * engine that this index should not quietly hide. V is the one term with its own
 * bound, because `min(severity / 10, 1)` is how the plan writes it.
 */
export function referenceTerms(inputs: HotspotScoreInputs, totalCap: number): ReferenceTerms {
  const H = totalCap > 0 ? inputs.worst_haircut_2050 / totalCap : 0;
  const E =
    inputs.snapshot_max_exposure_sgd > 0
      ? inputs.exposure_sgd / inputs.snapshot_max_exposure_sgd
      : 0;
  const V = Math.min(inputs.recent_event_severity_90d / SEVERITY_SATURATION, 1);

  const weighted = TERM_WEIGHTS.H * H + TERM_WEIGHTS.E * E + TERM_WEIGHTS.V * V;

  return { H, E, V, weighted };
}

/**
 * `clamp(round(1 + 99 * clamp01(0.45*H + 0.30*E + 0.25*V)), 1, 100)`.
 *
 * The empty hotspot, with no members, no exposure and no events, gives H = E =
 * V = 0 and an index of 1 rather than 0, which is why the range starts at 1.
 */
export function referenceIndex(inputs: HotspotScoreInputs, totalCap: number): number {
  const { weighted } = referenceTerms(inputs, totalCap);
  const raw = Math.round(1 + 99 * clamp01(weighted));
  return Math.min(100, Math.max(1, raw));
}
