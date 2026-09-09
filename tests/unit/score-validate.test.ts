/**
 * The score contract is enforced in code, not by the tool schema (AC-17).
 *
 * AC-17's fourth clause: with the client stubbed to fail, with the base URL at a
 * closed port, and with a response carrying no tool block, the outcome is the
 * fallback path. Malformed tool input (score 0, 101, 42.5, empty rationale, six
 * drivers, an `input_field` outside the enum, an uncited number) is rejected
 * into that same path and never written.
 *
 * The citation cases the plan names are here too: `18%`, `18 %`, `18.0%` and
 * `S$128.4m` are accepted against the fixture's values, and a bare `18` with no
 * percent marker is rejected.
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { payloadLeafValues, promptPayload } from '@/lib/index/inputs';
import {
  ASSIGN_HOTSPOT_SCORE_TOOL,
  buildScoreRequest,
  scoreHotspot,
  SCORING_MODEL,
  SCORING_TIMEOUT_MS,
  TOOL_NAME,
  type ScoreResponse,
  type ScoringClient,
} from '@/lib/index/llm-score';
import {
  firstUncitedNumber,
  numericTokens,
  tokenCites,
  validateScore,
  type ScoreRejection,
} from '@/lib/index/validate-score';
import { INPUT_FIELD_VALUES } from '@/lib/index/inputs';
import { PAYLOAD_FIXTURE } from '../fixtures/hotspots';

const HOTSPOT = {
  id: 'HS-SG-MARINA',
  name: 'Marina Bay and Kallang',
  country: 'SG',
  hazard_type: 'flood',
};

/** The whitelist the validator is given: the nine prompt-visible values. */
const VALUES = Object.values(payloadLeafValues(promptPayload(PAYLOAD_FIXTURE)));

/** A rationale that cites only fixture values, long enough to pass the length bound. */
const GOOD_RATIONALE =
  'Exposure is 18% of the book at S$128.4m, and the 2050 flood haircut reaches 13.2%, ' +
  'with 5 events in the window and the last one 3 days ago.';

function good(overrides: Record<string, unknown> = {}) {
  return {
    score: 62,
    drivers: [
      { input_field: 'exposure_share', direction: 'raises', note: 'A sixth of the book.' },
      { input_field: 'flood', direction: 'raises', note: 'Flood dominates at 2050.' },
    ],
    rationale: GOOD_RATIONALE,
    ...overrides,
  };
}

function rejectionOf(candidate: unknown): ScoreRejection {
  const result = validateScore(candidate, VALUES);
  if (result.ok) throw new Error('expected a rejection, got a valid score');
  return result.rejection;
}

describe('the tool schema and the validator agree', () => {
  it('declares the nine input fields as the driver enum', () => {
    const schema = ASSIGN_HOTSPOT_SCORE_TOOL.input_schema;
    const drivers = schema.properties.drivers as {
      items: { properties: { input_field: { enum: string[] } } };
    };

    expect([...drivers.items.properties.input_field.enum].sort()).toEqual(
      [...INPUT_FIELD_VALUES].sort(),
    );
  });

  it('is strict, closed, and requires all three fields', () => {
    const schema = ASSIGN_HOTSPOT_SCORE_TOOL.input_schema;

    expect(ASSIGN_HOTSPOT_SCORE_TOOL.strict).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(['drivers', 'rationale', 'score']);
  });

  it('forces the tool and pins the model', () => {
    const request = buildScoreRequest(HOTSPOT, PAYLOAD_FIXTURE);

    expect(request.tool_choice).toEqual({ type: 'tool', name: TOOL_NAME });
    expect(request.model).toBe(SCORING_MODEL);
    expect(request.tools).toHaveLength(1);
  });

  it('never puts the reference index or a withheld term in the request', () => {
    const serialised = JSON.stringify(buildScoreRequest(HOTSPOT, PAYLOAD_FIXTURE));

    for (const withheld of [
      'reference_index',
      'max_event_severity',
      'worst_haircut_2050',
      'snapshot_max_exposure_sgd',
    ]) {
      expect(serialised).not.toContain(withheld);
    }
  });
});

describe('malformed tool input is rejected', () => {
  it('accepts the well-formed case, so the negatives mean something', () => {
    const result = validateScore(good(), VALUES);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.score).toBe(62);
  });

  it('rejects a score of 0, 101 or 42.5', () => {
    expect(rejectionOf(good({ score: 0 })).code).toBe('score_out_of_range');
    expect(rejectionOf(good({ score: 101 })).code).toBe('score_out_of_range');
    expect(rejectionOf(good({ score: 42.5 })).code).toBe('score_not_integer');
    expect(rejectionOf(good({ score: '62' })).code).toBe('score_not_integer');
  });

  it('accepts the boundary scores 1 and 100', () => {
    expect(validateScore(good({ score: 1 }), VALUES).ok).toBe(true);
    expect(validateScore(good({ score: 100 }), VALUES).ok).toBe(true);
  });

  it('rejects no drivers and six drivers', () => {
    const one = good().drivers[0];

    expect(rejectionOf(good({ drivers: [] })).code).toBe('drivers_count');
    expect(rejectionOf(good({ drivers: Array(6).fill(one) })).code).toBe('drivers_count');
    expect(validateScore(good({ drivers: Array(5).fill(one) }), VALUES).ok).toBe(true);
  });

  it('rejects an input_field outside the enum', () => {
    const rejection = rejectionOf(
      good({
        drivers: [{ input_field: 'reference_index', direction: 'raises', note: 'no' }],
      }),
    );

    expect(rejection.code).toBe('unknown_input_field');
    expect(rejection.detail).toBe('reference_index');
  });

  it('rejects a direction outside raises and lowers', () => {
    expect(
      rejectionOf(good({ drivers: [{ input_field: 'flood', direction: 'up', note: 'no' }] })).code,
    ).toBe('driver_shape');
  });

  it('rejects an empty rationale and one that is too short or too long', () => {
    expect(rejectionOf(good({ rationale: '' })).code).toBe('rationale_empty');
    expect(rejectionOf(good({ rationale: '   ' })).code).toBe('rationale_empty');
    expect(rejectionOf(good({ rationale: 'Too short to say anything.' })).code).toBe(
      'rationale_length',
    );
    expect(rejectionOf(good({ rationale: `${'a'.repeat(601)}` })).code).toBe('rationale_length');
  });

  it('rejects anything that is not an object', () => {
    expect(rejectionOf(null).code).toBe('not_an_object');
    expect(rejectionOf('62').code).toBe('not_an_object');
    expect(rejectionOf([good()]).code).toBe('not_an_object');
  });
});

describe('citation tolerance', () => {
  /* exposure_share is 0.18 and exposure_sgd is 128,400,000 on the fixture. */
  const accepted = [
    'Exposure is 18% of the loan book, which is the second largest share on the map here.',
    'Exposure is 18 % of the loan book, which is the second largest share on the map here.',
    'Exposure is 18.0% of the loan book, which is the second largest share on the map.',
    'Exposure of S$128.4m sits behind this hotspot, a material concentration for one area.',
    'Exposure of S$128 million sits behind this hotspot, a material concentration here.',
    'Exposure of 128,400,000 Singapore dollars sits behind this hotspot, a concentration.',
    'Exposure is 18 percent of the book, and the flood haircut at 2050 reaches 13.2%.',
  ];

  for (const rationale of accepted) {
    it(`accepts "${rationale.slice(0, 44)}..."`, () => {
      expect(firstUncitedNumber(rationale, VALUES)).toBeNull();
      expect(validateScore(good({ rationale }), VALUES).ok).toBe(true);
    });
  }

  it('rejects a bare 18 with no percent marker', () => {
    const rationale =
      'Exposure is 18 of the loan book here, which is the second largest share on this map.';

    expect(firstUncitedNumber(rationale, VALUES)?.raw).toBe('18');
    expect(rejectionOf(good({ rationale })).code).toBe('uncited_number');
  });

  it('rejects a number that appears nowhere in the inputs', () => {
    const rationale =
      'The hotspot has 47 outstanding facilities and exposure of 18% of the book, so it matters.';

    expect(rejectionOf(good({ rationale })).detail).toBe('47');
  });

  it('exempts four-digit years and the scenario labels', () => {
    const rationale =
      'By 2050 the modelled flood haircut reaches 13.2% here, well above the 2030 position.';

    expect(firstUncitedNumber(rationale, VALUES)).toBeNull();
  });

  it('exempts a bare 1-100 only next to score, index, band or out of 100', () => {
    expect(firstUncitedNumber('A score of 62 reflects the exposure share of 18%.', VALUES)).toBeNull();
    expect(firstUncitedNumber('It scores 62 out of 100 on the exposure share of 18%.', VALUES)).toBeNull();
    expect(firstUncitedNumber('The band 3 position follows from an 18% share.', VALUES)).toBeNull();
    /* The same integer with none of those markers must cite. */
    expect(firstUncitedNumber('There are 62 properties inside it.', VALUES)?.raw).toBe('62');
  });

  it('exempts the window length that is part of a field name', () => {
    /* `recent_event_count_90d` is on the screen, so "the last 90 days" quotes a
       label rather than inventing a figure. */
    expect(firstUncitedNumber('No events in the last 90 days, and 5 in the window.', VALUES)).toBeNull();
  });

  it('does not read the m of a word as a million', () => {
    const tokens = numericTokens('3 months of quiet');

    expect(tokens).toHaveLength(1);
    expect(tokens[0].value).toBe(3);
  });

  it('reads magnitude suffixes and thousands separators', () => {
    const [millions] = numericTokens('S$128.4m');
    const [separated] = numericTokens('128,400,000');

    expect(millions.value).toBe(128_400_000);
    expect(separated.value).toBe(128_400_000);
  });
});

describe('the fallback paths', () => {
  it('falls back when the client throws', async () => {
    const client: ScoringClient = {
      messages: {
        create: vi.fn(async () => {
          throw new Error('socket hang up');
        }),
      },
    };

    const outcome = await scoreHotspot(client, HOTSPOT, PAYLOAD_FIXTURE);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('transport');
    expect(!outcome.ok && outcome.detail).toContain('socket hang up');
  });

  it('falls back when the real client points at a closed port', async () => {
    /* A genuine SDK client, a genuine connection attempt, and nothing
       listening: the shape of an unreachable API without needing one. */
    const client = new Anthropic({
      apiKey: 'not-a-real-key',
      baseURL: 'http://127.0.0.1:1',
      timeout: 2_000,
      maxRetries: 0,
    }) as unknown as ScoringClient;

    const outcome = await scoreHotspot(client, HOTSPOT, PAYLOAD_FIXTURE);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('transport');
  }, 15_000);

  it('falls back on a response with no tool block, distinctly from a transport failure', async () => {
    const client: ScoringClient = {
      messages: {
        create: async (): Promise<ScoreResponse> => ({
          content: [{ type: 'text', text: 'I would rather explain in prose.' }],
          model: SCORING_MODEL,
          stop_reason: 'end_turn',
        }),
      },
    };

    const outcome = await scoreHotspot(client, HOTSPOT, PAYLOAD_FIXTURE);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('no_tool_block');
    expect(!outcome.ok && outcome.detail).toContain('end_turn');
  });

  it('falls back on malformed tool input, and says which rule broke', async () => {
    const client: ScoringClient = {
      messages: {
        create: async (): Promise<ScoreResponse> => ({
          content: [{ type: 'tool_use', name: TOOL_NAME, id: 'toolu_1', input: good({ score: 101 }) }],
          model: SCORING_MODEL,
          stop_reason: 'tool_use',
        }),
      },
    };

    const outcome = await scoreHotspot(client, HOTSPOT, PAYLOAD_FIXTURE);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('invalid');
    expect(!outcome.ok && outcome.detail).toContain('score_out_of_range');
  });

  it('accepts a well-formed tool block and passes the timeout through', async () => {
    const create = vi.fn(
      async (): Promise<ScoreResponse> => ({
        content: [{ type: 'tool_use', name: TOOL_NAME, id: 'toolu_1', input: good() }],
        model: 'claude-opus-5',
        stop_reason: 'tool_use',
      }),
    );

    const outcome = await scoreHotspot({ messages: { create } }, HOTSPOT, PAYLOAD_FIXTURE);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.value.score).toBe(62);
    expect(create).toHaveBeenCalledWith(expect.anything(), { timeout: SCORING_TIMEOUT_MS });
  });
});

/*
  Added 2026-09-09 after the first live scoring run against the real API.
  Two defects surfaced only with a key present: the API rejects numeric range
  keywords under strict tool schemas, and the citation rule rejected money
  abbreviated the way every analyst writes it.
*/
describe('live-run regressions (2026-09-09)', () => {
  it('the strict tool schema carries no numeric range keywords the API rejects', () => {
    // 400 "tools.0.custom: For 'integer' type, properties maximum, minimum are not supported"
    const serialised = JSON.stringify(ASSIGN_HOTSPOT_SCORE_TOOL.input_schema);
    for (const keyword of ['"minimum"', '"maximum"', '"minItems"', '"maxItems"', '"minLength"', '"maxLength"']) {
      expect(serialised).not.toContain(keyword);
    }
  });

  it('accepts money abbreviated at the model\'s own magnitude and precision', () => {
    const [million] = numericTokens('exposure of SGD 17.87 million');
    expect(tokenCites(million, 17_866_000)).toBe(true);

    const [short] = numericTokens('S$196.2m of the book');
    expect(tokenCites(short, 196_223_000)).toBe(true);

    const [onePlace] = numericTokens('about S$17.9 million');
    expect(tokenCites(onePlace, 17_866_000)).toBe(true);
  });

  it('still rejects an abbreviated figure that is not the value at that precision', () => {
    const [wrong] = numericTokens('SGD 18.2 million');
    expect(tokenCites(wrong, 17_866_000)).toBe(false);

    const [wrongShort] = numericTokens('S$197.0m');
    expect(tokenCites(wrongShort, 196_223_000)).toBe(false);
  });
});
