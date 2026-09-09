/**
 * The one LLM-assigned number in the product (plan 4.5, ADR-3, AC-17).
 *
 * This module builds the request and reads the answer. It holds no credentials,
 * constructs no client and makes no outbound call of its own: the client is
 * INJECTED by an entry point that plan 4.9 names, which is what keeps the
 * Anthropic package out of `lib/` and lets `no-network-on-render.test.ts` scan
 * this directory without an exception. It is also what makes AC-17's "with the
 * client stubbed to fail" testable in the no-database unit project.
 *
 * The reference index is NOT in the prompt (ADR-3). A model shown the number it
 * is being compared against cannot express a deliberate departure, so the
 * divergence badge would measure neither agreement nor disagreement.
 * `prompt-payload.test.ts` asserts the withholding on the serialised payload.
 */

import {
  INPUT_FIELD_VALUES,
  payloadLeafValues,
  promptPayload,
  type HotspotScoreInputs,
} from '@/lib/index/inputs';
import {
  DRIVER_BOUNDS,
  DRIVER_DIRECTIONS,
  RATIONALE_BOUNDS,
  SCORE_BOUNDS,
  validateScore,
  type ScoreRejection,
  type ValidatedScore,
} from '@/lib/index/validate-score';

/**
 * The model, pinned.
 *
 * Written down rather than read from configuration so the `model` column of
 * every scored row names something reproducible, and so a demo cannot silently
 * be scored by whatever the default happened to be that week.
 */
export const SCORING_MODEL = 'claude-opus-5';

/** Plan 4.9: 8 s for Anthropic, 5 s for feeds and tiles. */
export const SCORING_TIMEOUT_MS = 8_000;

export const SCORING_MAX_TOKENS = 2_000;

export const TOOL_NAME = 'assign_hotspot_score';

/**
 * The calibration rubric, a fixed constant of the prompt (plan 4.5).
 *
 * ADR-3 removed the reference index from the prompt, which removes the model's
 * only anchor. This is what replaces it: without a written scale, two hotspots
 * with similar inputs can be scored twenty points apart for no reason a reader
 * could name, and the divergence badge then measures the absence of a scale
 * rather than a judgement. Reproduced verbatim in `docs/sources.md`.
 */
export const CALIBRATION_RUBRIC = [
  '1-20 minimal: little modelled hazard at 2050, a small share of the book, and no recent events.',
  '21-40 low: modest hazard or a modest share, and at most isolated recent events.',
  '41-60 moderate: clear hazard at 2050 or a material share of the book, with some recent event pressure.',
  '61-80 elevated: high hazard at 2050 together with a material share, or sustained recent event pressure.',
  '81-100 severe: hazard at or near the total cap, a leading share of the book, and repeated recent events.',
].join('\n');

export const SYSTEM_PROMPT = [
  'You are a climate credit risk analyst at a bank, scoring geographic hotspots in a',
  'commercial property loan book across Singapore, Malaysia, Indonesia, China and Hong Kong.',
  '',
  'You are given the complete set of inputs for one hotspot. Score it from 1 to 100 by',
  'calling the assign_hotspot_score tool. Use this calibration scale:',
  '',
  CALIBRATION_RUBRIC,
  '',
  'Rules that are checked and enforced after you answer, so a breach is discarded:',
  '- Every number in your rationale must be one of the input values you were given,',
  '  written either plainly, as a percentage, or with a currency and magnitude.',
  '  Do not introduce a number that is not in the inputs, and do not estimate one.',
  '- Name between one and five drivers, each one an input field you were shown.',
  '- The haircut figures are fractions of property value at the 2050 scenario:',
  '  0.18 is an 18% haircut. exposure_share is a fraction of the whole loan book.',
  '- days_since_last_event may be null, which means no recorded event has ever been',
  '  attached to this hotspot, not that one happened today.',
  '',
  'Judge the hotspot on its inputs. Do not reason about what a deterministic formula',
  'would say, and do not aim for a round number.',
].join('\n');

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

/**
 * `assign_hotspot_score`, forced with `tool_choice`.
 *
 * `strict: true` asks the API to keep the arguments schema-valid; the bounds
 * are still enforced in `validate-score.ts`, because the schema is advisory and
 * a response with no tool block at all is a distinct path from malformed input.
 * Every bound here is imported from the validator rather than retyped, so the
 * schema and the enforcement cannot drift apart.
 */
export const ASSIGN_HOTSPOT_SCORE_TOOL = {
  name: TOOL_NAME,
  description:
    'Assign a 1-100 climate credit risk score to one hotspot, naming the input fields that drove it.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      score: {
        type: 'integer',
        minimum: SCORE_BOUNDS.min,
        maximum: SCORE_BOUNDS.max,
        description: 'The hotspot score, 1 to 100, on the calibration scale in the system prompt.',
      },
      drivers: {
        type: 'array',
        minItems: DRIVER_BOUNDS.min,
        maxItems: DRIVER_BOUNDS.max,
        items: {
          type: 'object',
          properties: {
            input_field: { type: 'string', enum: [...INPUT_FIELD_VALUES] },
            direction: { type: 'string', enum: [...DRIVER_DIRECTIONS] },
            note: { type: 'string', maxLength: DRIVER_BOUNDS.noteMaxLength },
          },
          required: ['input_field', 'direction', 'note'],
          additionalProperties: false,
        },
      },
      rationale: {
        type: 'string',
        minLength: RATIONALE_BOUNDS.min,
        maxLength: RATIONALE_BOUNDS.max,
        description:
          'Two or three sentences. Every number must be one of the input values, plainly, as a percentage, or with a currency.',
      },
    },
    required: ['score', 'drivers', 'rationale'],
    additionalProperties: false,
  },
};

/* ------------------------------------------------------------------ *
 * The injected client
 * ------------------------------------------------------------------ */

/** What the request looks like. Built here, sent by the entry point's client. */
export type ScoreRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user'; content: string }[];
  tools: (typeof ASSIGN_HOTSPOT_SCORE_TOOL)[];
  tool_choice: { type: 'tool'; name: string };
};

/** Only the fields this module reads. A real response carries far more. */
export type ScoreResponse = {
  content: unknown[];
  model?: string;
  stop_reason?: string | null;
};

/**
 * The injected client, structurally.
 *
 * Declared as a shape rather than imported as a type, because importing the
 * vendor package here is exactly what the static scan forbids inside `lib/`.
 * The real client satisfies it, and so does a three-line stub that throws,
 * which is how the fallback path is tested without a network.
 */
export type ScoringClient = {
  messages: {
    create(params: ScoreRequest, options?: { timeout?: number }): Promise<ScoreResponse>;
  };
};

/** The user turn: the payload, and nothing else. */
export function buildUserMessage(
  hotspot: { id: string; name: string; country: string; hazard_type: string },
  inputs: HotspotScoreInputs,
): string {
  return [
    `Hotspot: ${hotspot.name} (${hotspot.country}), dominant hazard type: ${hotspot.hazard_type}.`,
    '',
    'Inputs:',
    JSON.stringify(promptPayload(inputs), null, 2),
  ].join('\n');
}

export function buildScoreRequest(
  hotspot: { id: string; name: string; country: string; hazard_type: string },
  inputs: HotspotScoreInputs,
): ScoreRequest {
  return {
    model: SCORING_MODEL,
    max_tokens: SCORING_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(hotspot, inputs) }],
    tools: [ASSIGN_HOTSPOT_SCORE_TOOL],
    /* Forced, so a model that would rather answer in prose cannot. A response
       with no tool block is still possible and is its own fallback path. */
    tool_choice: { type: 'tool', name: TOOL_NAME },
  };
}

/* ------------------------------------------------------------------ *
 * Calling it
 * ------------------------------------------------------------------ */

export type ScoreOutcome =
  | { ok: true; value: ValidatedScore; model: string }
  | { ok: false; reason: 'transport'; detail: string }
  | { ok: false; reason: 'no_tool_block'; detail: string }
  | { ok: false; reason: 'invalid'; detail: string; rejection: ScoreRejection };

function toolInput(response: ScoreResponse): unknown | undefined {
  for (const block of response.content ?? []) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_use' &&
      (block as { name?: unknown }).name === TOOL_NAME
    ) {
      return (block as { input?: unknown }).input;
    }
  }
  return undefined;
}

/**
 * Score one hotspot, or say precisely why not.
 *
 * Three failure paths, deliberately distinct, because they are distinct events
 * for anyone reading a prep log: the call did not complete, it completed with no
 * tool block, or it returned a tool input that broke the contract. All three
 * end in the same place on the dashboard, the reference index with a fallback
 * badge, and none of them ever writes a score.
 */
export async function scoreHotspot(
  client: ScoringClient,
  hotspot: { id: string; name: string; country: string; hazard_type: string },
  inputs: HotspotScoreInputs,
): Promise<ScoreOutcome> {
  const request = buildScoreRequest(hotspot, inputs);

  let response: ScoreResponse;
  try {
    response = await client.messages.create(request, { timeout: SCORING_TIMEOUT_MS });
  } catch (cause) {
    return {
      ok: false,
      reason: 'transport',
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const candidate = toolInput(response);
  if (candidate === undefined) {
    return {
      ok: false,
      reason: 'no_tool_block',
      detail: `stop_reason ${response?.stop_reason ?? 'unknown'}`,
    };
  }

  const validation = validateScore(candidate, Object.values(payloadLeafValues(promptPayload(inputs))));
  if (!validation.ok) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `${validation.rejection.code}: ${validation.rejection.detail}`,
      rejection: validation.rejection,
    };
  }

  return { ok: true, value: validation.value, model: response.model ?? SCORING_MODEL };
}
