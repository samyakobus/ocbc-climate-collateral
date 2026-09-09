/**
 * The prompt payload is exactly what plan 4.5 declares, and nothing else (AC-17).
 *
 * This is the guardrail the spec's closed input list rests on. It asserts SET
 * EQUALITY rather than a count, in both directions: an added field fails here
 * before it can reach a model, and a removed one fails too. That is why a future
 * field is excluded by default instead of by anyone remembering to add it to a
 * list of forbidden names.
 *
 * Two set equalities, per plan 4.5:
 *   six top-level keys  <-> `HotspotPromptPayload`
 *   nine flattened leaves <-> the `input_field` enum of `assign_hotspot_score`
 *
 * And one negative: `reference_index`, `max_event_severity`, `worst_haircut_2050`
 * and `snapshot_max_exposure_sgd` are absent from the payload and from its
 * serialisation. The first is the whole of ADR-3: a model shown the reference
 * cannot diverge from it in any way a badge could measure.
 */

import { describe, expect, it } from 'vitest';

import {
  HAZARD_TYPES,
  INPUT_FIELD_VALUES,
  payloadLeafNames,
  payloadLeafValues,
  PROMPT_PAYLOAD_KEYS,
  promptPayload,
  type HotspotPromptPayload,
} from '@/lib/index/inputs';
import { PAYLOAD_FIXTURE, REFERENCE_FIXTURES } from '../fixtures/hotspots';

/** Set equality, reported as two sorted lists so a failure names the offender. */
function expectSameSet(actual: readonly string[], expected: readonly string[]): void {
  expect([...new Set(actual)].sort()).toEqual([...new Set(expected)].sort());
  expect(actual.length).toBe(new Set(actual).size);
}

describe('prompt payload', () => {
  const payload = promptPayload(PAYLOAD_FIXTURE);

  it('emits exactly the six top-level keys of HotspotPromptPayload', () => {
    expectSameSet(Object.keys(payload), PROMPT_PAYLOAD_KEYS);
    expect(PROMPT_PAYLOAD_KEYS).toHaveLength(6);
  });

  it('pins the declared key list to the type itself', () => {
    /* A compile-time check as much as a runtime one: PROMPT_PAYLOAD_KEYS is
       declared `satisfies readonly (keyof HotspotPromptPayload)[]`, so a key
       that leaves the type fails `npm run typecheck`, and this assertion
       catches the other direction, a key added to the type and not to the
       list. */
    const fromType: Record<keyof HotspotPromptPayload, true> = {
      hazard_scores_by_type: true,
      exposure_sgd: true,
      exposure_share: true,
      recent_event_count_90d: true,
      recent_event_severity_90d: true,
      days_since_last_event: true,
    };

    expectSameSet(Object.keys(fromType), PROMPT_PAYLOAD_KEYS);
  });

  it('flattens to exactly the nine input_field enum values', () => {
    expectSameSet(payloadLeafNames(payload), INPUT_FIELD_VALUES);
    expect(INPUT_FIELD_VALUES).toHaveLength(9);
  });

  it('expands hazard_scores_by_type into the four hazards the engine prices', () => {
    expectSameSet(Object.keys(payload.hazard_scores_by_type), HAZARD_TYPES);
    expect(HAZARD_TYPES).toHaveLength(4);
    /* Six top-level keys, nine leaves: five scalars plus four hazards. */
    expect(PROMPT_PAYLOAD_KEYS.length - 1 + HAZARD_TYPES.length).toBe(INPUT_FIELD_VALUES.length);
  });

  it('withholds the reference index and every reference-only term', () => {
    const withheld = [
      'reference_index',
      'max_event_severity',
      'worst_haircut_2050',
      'snapshot_max_exposure_sgd',
    ];

    for (const key of withheld) {
      expect(Object.keys(payload)).not.toContain(key);
      expect(payloadLeafNames(payload)).not.toContain(key);
      expect(INPUT_FIELD_VALUES as readonly string[]).not.toContain(key);
      /* The serialisation is what actually reaches the model, so assert on it
         rather than only on the object. */
      expect(JSON.stringify(payload)).not.toContain(key);
    }
  });

  it('withholds the reference-only VALUES, not merely their names', () => {
    const serialised = JSON.stringify(payload);

    /* `worst_haircut_2050` is 0.18 on this fixture and `exposure_share` is also
       0.18, so a value check alone would be ambiguous. The two that cannot
       collide are asserted directly. */
    expect(serialised).not.toContain('214000000');
    expect(PAYLOAD_FIXTURE.snapshot_max_exposure_sgd).toBe(214_000_000);
  });

  it('carries no key the stored record has and the payload should not', () => {
    const storedKeys = Object.keys(PAYLOAD_FIXTURE);
    const extra = storedKeys.filter((key) => !(PROMPT_PAYLOAD_KEYS as readonly string[]).includes(key));

    expect(extra.sort()).toEqual([
      'max_event_severity',
      'snapshot_max_exposure_sgd',
      'worst_haircut_2050',
    ]);
    for (const key of extra) {
      expect(Object.keys(payload)).not.toContain(key);
    }
  });

  it('is a projection, not a reference: mutating the payload cannot reach the record', () => {
    const mutable = promptPayload(PAYLOAD_FIXTURE);
    mutable.hazard_scores_by_type.flood = 0.99;

    expect(PAYLOAD_FIXTURE.hazard_scores_by_type.flood).toBe(0.132);
  });

  it('names every leaf value, which is the citation validator whitelist', () => {
    const values = payloadLeafValues(payload);

    expectSameSet(Object.keys(values), INPUT_FIELD_VALUES);
    expect(values.exposure_share).toBe(0.18);
    expect(values.flood).toBe(0.132);
  });

  it('projects every fixture to the same key set', () => {
    for (const fixture of REFERENCE_FIXTURES) {
      expectSameSet(Object.keys(promptPayload(fixture.inputs)), PROMPT_PAYLOAD_KEYS);
      expectSameSet(payloadLeafNames(promptPayload(fixture.inputs)), INPUT_FIELD_VALUES);
    }
  });
});
