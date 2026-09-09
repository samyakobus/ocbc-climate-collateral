/**
 * Pinned hotspot fixtures with hand-computed reference indices (plan S21, AC-17).
 *
 * Every expected number below was computed by hand from plan 4.4 and is written
 * out term by term in the comment above it, so a failure names which of H, E or
 * V moved rather than only that a number changed. Nothing here reads the
 * database: these are the no-database half of AC-17, and
 * `tests/db/reference-index.test.ts` carries the against-what-is-stored half.
 *
 * The cap is 0.25 throughout, matching `RULE_SET_SEED_DEFAULTS.total_cap`. The
 * db test reads the cap from the active rule set instead, because a risk manager
 * can edit it.
 */

import type { HotspotAggregate, HotspotEvent, HotspotScoreInputs } from '@/lib/index/inputs';

/** The seeded `total_cap`. Held here so a fixture cannot silently use another. */
export const FIXTURE_TOTAL_CAP = 0.25;

export type ReferenceFixture = {
  name: string;
  /** What the case is for, printed by the test name. */
  about: string;
  inputs: HotspotScoreInputs;
  /** Hand-computed, term by term, in the comment above each case. */
  expected: { H: number; E: number; V: number; weighted: number; index: number };
};

export const REFERENCE_FIXTURES: readonly ReferenceFixture[] = [
  {
    name: 'worked-example',
    about: 'the ordinary case: every term contributes and nothing saturates',
    /*
      H = 0.18 / 0.25          = 0.72
      E = 128,400,000 / 214,000,000 = 0.60
      V = 4.6 / 10             = 0.46
      weighted = 0.45(0.72) + 0.30(0.60) + 0.25(0.46)
               = 0.324 + 0.180 + 0.115 = 0.619
      index = round(1 + 99(0.619)) = round(62.281) = 62
    */
    inputs: {
      hazard_scores_by_type: { flood: 0.132, wind: 0, heat: 0.035, pm25: 0.02 },
      exposure_sgd: 128_400_000,
      exposure_share: 0.18,
      recent_event_count_90d: 5,
      recent_event_severity_90d: 4.6,
      days_since_last_event: 3,
      max_event_severity: 1,
      worst_haircut_2050: 0.18,
      snapshot_max_exposure_sgd: 214_000_000,
    },
    expected: { H: 0.72, E: 0.6, V: 0.46, weighted: 0.619, index: 62 },
  },
  {
    name: 'empty-hotspot',
    about: 'the empty hotspot of plan 4.4: no members, no exposure, no events',
    /*
      H = E = V = 0, weighted = 0, index = round(1 + 0) = 1.
      The floor is 1 rather than 0, which is why the column is 1-100.
    */
    inputs: {
      hazard_scores_by_type: { flood: 0, wind: 0, heat: 0, pm25: 0 },
      exposure_sgd: 0,
      exposure_share: 0,
      recent_event_count_90d: 0,
      recent_event_severity_90d: 0,
      days_since_last_event: null,
      max_event_severity: 0,
      worst_haircut_2050: 0,
      snapshot_max_exposure_sgd: 214_000_000,
    },
    expected: { H: 0, E: 0, V: 0, weighted: 0, index: 1 },
  },
  {
    name: 'saturated',
    about: 'every term at its ceiling gives exactly 100',
    /*
      H = 0.25 / 0.25 = 1        (a pin at the total cap)
      E = 214,000,000 / 214,000,000 = 1
      V = min(12 / 10, 1) = 1    (V is the one term with its own bound)
      weighted = 0.45 + 0.30 + 0.25 = 1.00
      index = round(1 + 99) = 100
    */
    inputs: {
      hazard_scores_by_type: { flood: 0.2, wind: 0.06, heat: 0.05, pm25: 0.02 },
      exposure_sgd: 214_000_000,
      exposure_share: 0.3,
      recent_event_count_90d: 13,
      recent_event_severity_90d: 12,
      days_since_last_event: 0,
      max_event_severity: 1,
      worst_haircut_2050: 0.25,
      snapshot_max_exposure_sgd: 214_000_000,
    },
    expected: { H: 1, E: 1, V: 1, weighted: 1, index: 100 },
  },
  {
    name: 'above-the-cap',
    about: 'H above 1 is clamped by the WEIGHTED SUM, not by clamping H itself',
    /*
      A stored haircut above the total cap would be an engine defect, and plan
      4.4 clamps the sum rather than the term so the index cannot hide one: H
      stays 1.2 and is visible in the terms, while the index still reads 100.

      H = 0.30 / 0.25 = 1.2, E = 1, V = 1
      weighted = 0.54 + 0.30 + 0.25 = 1.09 -> clamp01 -> 1.00
      index = 100
    */
    inputs: {
      hazard_scores_by_type: { flood: 0.25, wind: 0.06, heat: 0.05, pm25: 0.02 },
      exposure_sgd: 214_000_000,
      exposure_share: 0.3,
      recent_event_count_90d: 20,
      recent_event_severity_90d: 18,
      days_since_last_event: 1,
      max_event_severity: 1,
      worst_haircut_2050: 0.3,
      snapshot_max_exposure_sgd: 214_000_000,
    },
    expected: { H: 1.2, E: 1, V: 1, weighted: 1.09, index: 100 },
  },
  {
    name: 'rounding-boundary',
    about: 'a weighted sum of exactly 0.5 lands on 50.5 and rounds half up to 51',
    /*
      H = 0.125 / 0.25 = 0.5
      E = 100,000,000 / 200,000,000 = 0.5
      V = 5 / 10 = 0.5
      weighted = 0.225 + 0.150 + 0.125 = 0.500
      1 + 99(0.5) = 50.5, and Math.round is half-UP, so 51.
      Pinned because a half-even rounding would give 50 and no other case here
      would notice.
    */
    inputs: {
      hazard_scores_by_type: { flood: 0.09, wind: 0.02, heat: 0.03, pm25: 0.01 },
      exposure_sgd: 100_000_000,
      exposure_share: 0.14,
      recent_event_count_90d: 5,
      recent_event_severity_90d: 5,
      days_since_last_event: 12,
      max_event_severity: 1,
      worst_haircut_2050: 0.125,
      snapshot_max_exposure_sgd: 200_000_000,
    },
    expected: { H: 0.5, E: 0.5, V: 0.5, weighted: 0.5, index: 51 },
  },
  {
    name: 'exposure-only',
    about: 'exposure with no hazard and no event: the index is small but not the floor',
    /*
      H = 0, E = 50,000,000 / 200,000,000 = 0.25, V = 0
      weighted = 0.30(0.25) = 0.075
      index = round(1 + 7.425) = round(8.425) = 8
    */
    inputs: {
      hazard_scores_by_type: { flood: 0, wind: 0, heat: 0, pm25: 0 },
      exposure_sgd: 50_000_000,
      exposure_share: 0.07,
      recent_event_count_90d: 0,
      recent_event_severity_90d: 0,
      days_since_last_event: null,
      max_event_severity: 0,
      worst_haircut_2050: 0,
      snapshot_max_exposure_sgd: 200_000_000,
    },
    expected: { H: 0, E: 0.25, V: 0, weighted: 0.075, index: 8 },
  },
  {
    name: 'stale-events',
    about: 'events that exist but fell out of the 90-day window weigh nothing',
    /*
      `days_since_last_event` is 210 and the window counters are zero, which is
      the distinction the model is shown: quiet lately, not quiet always.

      H = 0.10 / 0.25 = 0.4, E = 0.1, V = 0
      weighted = 0.18 + 0.03 = 0.21
      index = round(1 + 20.79) = round(21.79) = 22
    */
    inputs: {
      hazard_scores_by_type: { flood: 0.06, wind: 0, heat: 0.04, pm25: 0.01 },
      exposure_sgd: 20_000_000,
      exposure_share: 0.03,
      recent_event_count_90d: 0,
      recent_event_severity_90d: 0,
      days_since_last_event: 210,
      max_event_severity: 0,
      worst_haircut_2050: 0.1,
      snapshot_max_exposure_sgd: 200_000_000,
    },
    expected: { H: 0.4, E: 0.1, V: 0, weighted: 0.21, index: 22 },
  },
];

/** The fixture the prompt-payload test projects. Any of them would do. */
export const PAYLOAD_FIXTURE: HotspotScoreInputs = REFERENCE_FIXTURES[0].inputs;

/* ------------------------------------------------------------------ *
 * Assembly fixtures: aggregate + events -> stored record
 * ------------------------------------------------------------------ */

/** The day every assembly fixture measures its 90-day window from. */
export const FIXTURE_AS_OF = '2026-09-08';

export const AGGREGATE_FIXTURE: HotspotAggregate = {
  hotspot_id: 'HS-FIXTURE',
  member_count: 12,
  exposure_sgd: 128_400_000,
  exposure_share: 0.18,
  snapshot_max_exposure_sgd: 214_000_000,
  p90_total_2050: 0.18,
  p90_flood_2050: 0.132,
  p90_wind_2050: 0,
  p90_heat_2050: 0.035,
  p90_pm25_2050: 0.02,
};

/**
 * Events for `HS-FIXTURE`, chosen to pin all four window rules at once.
 *
 * In the window: a fire on the as-of day itself (1.0), a flood (1.0), a
 * pollution incident (0.8), an earthquake (0.3, per plan 4.4 deliberately not
 * zero), and a haze event exactly 90 days back, which is the last day that
 * counts. Out: one 91 days back, one dated in the future, and one belonging to
 * another hotspot.
 *
 * severity = 1.0 + 1.0 + 0.8 + 0.3 + 0.8 = 3.9, count = 5,
 * max = 1.0, days_since_last_event = 0.
 */
export const EVENTS_FIXTURE: readonly HotspotEvent[] = [
  { hotspot_id: 'HS-FIXTURE', event_type: 'fire', occurred_on: '2026-09-08' },
  { hotspot_id: 'HS-FIXTURE', event_type: 'flood', occurred_on: '2026-08-20' },
  { hotspot_id: 'HS-FIXTURE', event_type: 'pollution', occurred_on: '2026-07-30' },
  { hotspot_id: 'HS-FIXTURE', event_type: 'earthquake', occurred_on: '2026-07-01' },
  { hotspot_id: 'HS-FIXTURE', event_type: 'haze', occurred_on: '2026-06-10' },
  { hotspot_id: 'HS-FIXTURE', event_type: 'fire', occurred_on: '2026-06-09' },
  { hotspot_id: 'HS-FIXTURE', event_type: 'storm', occurred_on: '2026-09-30' },
  { hotspot_id: 'HS-OTHER', event_type: 'fire', occurred_on: '2026-09-07' },
];
