/**
 * The deterministic reference index (plan 4.4, AC-17).
 *
 * Pure: no database, no clock, no client. Every expectation is hand-computed in
 * `tests/fixtures/hotspots.ts` with its three terms written out, so a failure
 * names which of H, E or V moved.
 *
 * The against-what-is-stored half of the AC-17 clause lives in
 * `tests/db/reference-index.test.ts`, which recomputes the index for all sixteen
 * seeded hotspots from `score_inputs` alone. It cannot live here: the unit
 * project has no DATABASE_URL by design.
 */

import { describe, expect, it } from 'vitest';

import { buildScoreInputs } from '@/lib/index/inputs';
import {
  clamp01,
  EVENT_TYPE_WEIGHTS,
  eventWeight,
  RECENT_WINDOW_DAYS,
  referenceIndex,
  referenceTerms,
  SEVERITY_SATURATION,
  TERM_WEIGHTS,
} from '@/lib/index/reference';
import {
  AGGREGATE_FIXTURE,
  EVENTS_FIXTURE,
  FIXTURE_AS_OF,
  FIXTURE_TOTAL_CAP,
  REFERENCE_FIXTURES,
} from '../fixtures/hotspots';

describe('reference index', () => {
  for (const fixture of REFERENCE_FIXTURES) {
    describe(`${fixture.name}: ${fixture.about}`, () => {
      it('computes H, E and V from the stored record alone', () => {
        const terms = referenceTerms(fixture.inputs, FIXTURE_TOTAL_CAP);

        expect(terms.H).toBeCloseTo(fixture.expected.H, 10);
        expect(terms.E).toBeCloseTo(fixture.expected.E, 10);
        expect(terms.V).toBeCloseTo(fixture.expected.V, 10);
        expect(terms.weighted).toBeCloseTo(fixture.expected.weighted, 10);
      });

      it('rounds and clamps to the hand-computed index', () => {
        expect(referenceIndex(fixture.inputs, FIXTURE_TOTAL_CAP)).toBe(fixture.expected.index);
      });

      it('stays inside 1 to 100 and is an integer', () => {
        const index = referenceIndex(fixture.inputs, FIXTURE_TOTAL_CAP);

        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(1);
        expect(index).toBeLessThanOrEqual(100);
      });
    });
  }

  it('is the formula plan 4.4 writes, not a re-derivation of it', () => {
    expect(TERM_WEIGHTS).toEqual({ H: 0.45, E: 0.3, V: 0.25 });
    expect(TERM_WEIGHTS.H + TERM_WEIGHTS.E + TERM_WEIGHTS.V).toBeCloseTo(1, 10);
    expect(SEVERITY_SATURATION).toBe(10);
    expect(RECENT_WINDOW_DAYS).toBe(90);
  });

  it('weighs earthquakes at 0.3, deliberately, and unknown types at 0', () => {
    /* Plan 4.4: a geophysical event moves a number labelled climate risk, and
       docs/sources.md says so out loud. That is a separate question from the
       haircut, which can never price an earthquake: the hazard enum has no
       member for one. */
    expect(EVENT_TYPE_WEIGHTS).toEqual({
      fire: 1,
      flood: 1,
      storm: 1,
      haze: 0.8,
      pollution: 0.8,
      earthquake: 0.3,
    });
    expect(eventWeight('earthquake')).toBe(0.3);
    expect(eventWeight('volcano')).toBe(0);
  });

  it('clamps the weighted sum, and only the weighted sum', () => {
    expect(clamp01(-0.4)).toBe(0);
    expect(clamp01(1.09)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(Number.NaN)).toBe(0);

    /* H is left unclamped so a haircut above the cap stays visible in the
       terms rather than being quietly absorbed. */
    const aboveCap = REFERENCE_FIXTURES.find((fixture) => fixture.name === 'above-the-cap');
    expect(referenceTerms(aboveCap!.inputs, FIXTURE_TOTAL_CAP).H).toBeGreaterThan(1);
  });

  it('gives every term a zero denominator rather than a NaN', () => {
    const empty = REFERENCE_FIXTURES.find((fixture) => fixture.name === 'empty-hotspot')!;
    const terms = referenceTerms(
      { ...empty.inputs, snapshot_max_exposure_sgd: 0 },
      /* total_cap of 0 would be a rule set nobody can save, but the index must
         not answer NaN if one ever exists. */
      0,
    );

    expect(terms.H).toBe(0);
    expect(terms.E).toBe(0);
    expect(referenceIndex({ ...empty.inputs, snapshot_max_exposure_sgd: 0 }, 0)).toBe(1);
  });
});

describe('score_inputs assembly', () => {
  const record = buildScoreInputs(AGGREGATE_FIXTURE, EVENTS_FIXTURE, FIXTURE_AS_OF);

  it('counts the 90-day window inclusively and stops at 91 days', () => {
    /* Five in: the as-of day itself, and one exactly 90 days back. Out: one at
       91 days, one dated in the future, and one belonging to another hotspot. */
    expect(record.recent_event_count_90d).toBe(5);
  });

  it('sums the event weights rather than counting the events', () => {
    /* fire 1.0 + flood 1.0 + pollution 0.8 + earthquake 0.3 + haze 0.8 */
    expect(record.recent_event_severity_90d).toBeCloseTo(3.9, 10);
    expect(record.max_event_severity).toBe(1);
  });

  it('measures days since the last event over EVERY attached event', () => {
    expect(record.days_since_last_event).toBe(0);

    const stale = buildScoreInputs(
      AGGREGATE_FIXTURE,
      [{ hotspot_id: 'HS-FIXTURE', event_type: 'fire', occurred_on: '2026-01-08' }],
      FIXTURE_AS_OF,
    );

    /* Nothing in the window, but the hotspot is not one that has never had an
       event: 243 days, and the model is shown the difference. */
    expect(stale.recent_event_count_90d).toBe(0);
    expect(stale.recent_event_severity_90d).toBe(0);
    expect(stale.days_since_last_event).toBe(243);
  });

  it('reports null days rather than 0 when no event has ever attached', () => {
    const none = buildScoreInputs(AGGREGATE_FIXTURE, [], FIXTURE_AS_OF);

    expect(none.days_since_last_event).toBeNull();
    expect(none.recent_event_count_90d).toBe(0);
    expect(none.max_event_severity).toBe(0);
  });

  it('carries the reference-only terms the payload never sees', () => {
    expect(record.worst_haircut_2050).toBe(0.18);
    expect(record.snapshot_max_exposure_sgd).toBe(214_000_000);
    expect(record.hazard_scores_by_type).toEqual({
      flood: 0.132,
      wind: 0,
      heat: 0.035,
      pm25: 0.02,
    });
  });

  it('is the record the worked-example fixture pins, term for term', () => {
    /* The assembly and the hand-computed fixture must describe the same
       hotspot, or the index test proves nothing about the builder. */
    const worked = REFERENCE_FIXTURES[0].inputs;

    expect(record.exposure_sgd).toBe(worked.exposure_sgd);
    expect(record.snapshot_max_exposure_sgd).toBe(worked.snapshot_max_exposure_sgd);
    expect(record.worst_haircut_2050).toBe(worked.worst_haircut_2050);
  });
});
