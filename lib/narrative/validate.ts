/**
 * What a narrative is allowed to say (plan 4.8, AC-10).
 *
 * Two rules, and both are decidable rather than a matter of taste:
 *   1. every number in the text cites a figure already on the screen;
 *   2. no condition outside the rule engine's own output is named.
 *
 * THE CITATION TOLERANCE IS NOT REIMPLEMENTED HERE. Plan 4.5 says the rule is
 * shared, and it is: `numericTokens`, `tokenCites` and `firstUncitedNumber` live
 * in `lib/index/validate-score.ts`, and this module imports them. A case
 * narrative quotes an LTV exactly the way a hotspot rationale quotes an exposure
 * share, and two implementations of one rule would disagree within a day.
 *
 * The generation loop lives here too: two retries, each one told which number or
 * condition broke the rule, and then the rule text (plan 4.8). Every path ends
 * in a storable narrative; none of them throws at the caller.
 */

import { firstUncitedNumber } from '@/lib/index/validate-score';
import { BAND_CONDITIONS, INUNDATION_CONDITION } from '@/lib/rules/bands';
import {
  buildCaseRequest,
  buildPortfolioRequest,
  citablePortfolioValues,
  citableValues,
  fallbackCaseNarrative,
  fallbackPortfolioNarrative,
  NARRATIVE_LENGTH,
  NARRATIVE_MODEL,
  NARRATIVE_RETRIES,
  NARRATIVE_TIMEOUT_MS,
  responseText,
  type CaseFacts,
  type NarrativeClient,
  type NarrativeRequest,
  type PortfolioFacts,
} from '@/lib/narrative/prompt';

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

/**
 * A phrase that identifies one condition, whoever paraphrases it.
 *
 * The check is a keyword test rather than a semantic one, and it is deliberately
 * narrow: each marker is a phrase that cannot appear unless the sentence is
 * about that condition. A narrative that mentions flood insurance on a case
 * whose rules never required it is naming a requirement the bank did not make,
 * which is the specific harm AC-10 exists to prevent.
 *
 * The conditions themselves come from `lib/rules/bands.ts` rather than from a
 * copy, so a reworded condition cannot leave this list pointing at text that no
 * longer exists.
 */
export const CONDITION_MARKERS: readonly { condition: string; markers: readonly string[] }[] = [
  { condition: BAND_CONDITIONS.amber[0], markers: ['flood insurance', 'flood cover'] },
  {
    condition: BAND_CONDITIONS.orange[0],
    markers: ['cap the advance', 'capped at', 'capping the advance', 'cap the loan'],
  },
  { condition: BAND_CONDITIONS.red[0], markers: ['20% threshold', '20 per cent threshold'] },
  { condition: INUNDATION_CONDITION, markers: ['coastal inundation'] },
];

/** The first condition the text names that the rules did not produce, or null. */
export function firstUnearnedCondition(
  text: string,
  conditions: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  const produced = new Set(conditions);

  for (const entry of CONDITION_MARKERS) {
    if (produced.has(entry.condition)) continue;
    if (entry.markers.some((marker) => lower.includes(marker.toLowerCase()))) {
      return entry.condition;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type NarrativeRejection =
  | { code: 'empty'; detail: string }
  | { code: 'length'; detail: string }
  | { code: 'uncited_number'; detail: string }
  | { code: 'unearned_condition'; detail: string }
  | { code: 'decision_language'; detail: string };

export type NarrativeValidation =
  | { ok: true; text: string }
  | { ok: false; rejection: NarrativeRejection };

/**
 * Phrases that state a lending decision.
 *
 * The spec is explicit that the product never declines: bands drive conditions
 * and the most severe outcome is a referral to a human. A narrative that says
 * the loan is approved or declined has invented the one thing the system is not
 * allowed to say, so it is rejected rather than trimmed.
 */
const DECISION_PHRASES = [
  'we decline',
  'is declined',
  'declining the',
  'reject the application',
  'we approve',
  'is approved',
  'approve the loan',
  'approve this loan',
  'do not lend',
];

export function validateNarrative(
  text: unknown,
  values: readonly (number | null)[],
  conditions: readonly string[],
): NarrativeValidation {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, rejection: { code: 'empty', detail: typeof text } };
  }

  const trimmed = text.trim();

  if (trimmed.length < NARRATIVE_LENGTH.min || trimmed.length > NARRATIVE_LENGTH.max) {
    return { ok: false, rejection: { code: 'length', detail: String(trimmed.length) } };
  }

  const uncited = firstUncitedNumber(trimmed, values);
  if (uncited) {
    return { ok: false, rejection: { code: 'uncited_number', detail: uncited.raw } };
  }

  const unearned = firstUnearnedCondition(trimmed, conditions);
  if (unearned) {
    return { ok: false, rejection: { code: 'unearned_condition', detail: unearned } };
  }

  const lower = trimmed.toLowerCase();
  const decision = DECISION_PHRASES.find((phrase) => lower.includes(phrase));
  if (decision) {
    return { ok: false, rejection: { code: 'decision_language', detail: decision } };
  }

  return { ok: true, text: trimmed };
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

export type NarrativeOutcome = {
  text: string;
  /** Null when the rule text was stored, which is also when `fallback_used` is true. */
  model: string | null;
  validated: boolean;
  fallback_used: boolean;
  /** What went wrong on each attempt, for the prep log. Empty on a first-try success. */
  attempts: string[];
};

function correctionFor(rejection: NarrativeRejection): string {
  switch (rejection.code) {
    case 'uncited_number':
      return `Your previous answer used the number ${rejection.detail}, which is not one of the figures given. Rewrite it using only the figures above.`;
    case 'unearned_condition':
      return 'Your previous answer named a condition the rules did not produce. Name only the conditions listed above.';
    case 'decision_language':
      return 'Your previous answer stated a lending decision. Describe the conditions instead; the system never approves or declines.';
    case 'length':
      return 'Your previous answer was the wrong length. Write three or four sentences.';
    default:
      return 'Your previous answer was empty. Write three or four sentences using only the figures above.';
  }
}

/**
 * One narrative: generate, validate, retry twice, then the rule text.
 *
 * A null client is the no-key path and goes straight to the rule text without
 * pretending to have tried. Every other failure - transport, an empty response,
 * a number that cites nothing, a condition nobody imposed - lands in the same
 * place, and `attempts` records how it got there so a prep log is readable.
 */
async function generate(
  client: NarrativeClient | null,
  build: (correction?: string) => NarrativeRequest,
  values: readonly (number | null)[],
  conditions: readonly string[],
  fallback: string,
): Promise<NarrativeOutcome> {
  const attempts: string[] = [];

  if (client === null) {
    return { text: fallback, model: null, validated: false, fallback_used: true, attempts: ['no_client'] };
  }

  let correction: string | undefined;

  for (let attempt = 0; attempt <= NARRATIVE_RETRIES; attempt += 1) {
    let text: string;
    try {
      const response = await client.messages.create(build(correction), {
        timeout: NARRATIVE_TIMEOUT_MS,
      });
      text = responseText(response);
    } catch (cause) {
      attempts.push(`transport: ${cause instanceof Error ? cause.message : String(cause)}`);
      /* A transport failure will not be fixed by rephrasing the prompt. */
      break;
    }

    const validation = validateNarrative(text, values, conditions);
    if (validation.ok) {
      return {
        text: validation.text,
        model: NARRATIVE_MODEL,
        validated: true,
        fallback_used: false,
        attempts,
      };
    }

    attempts.push(`${validation.rejection.code}: ${validation.rejection.detail}`);
    correction = correctionFor(validation.rejection);
  }

  return { text: fallback, model: null, validated: false, fallback_used: true, attempts };
}

export async function generateCaseNarrative(
  client: NarrativeClient | null,
  facts: CaseFacts,
): Promise<NarrativeOutcome> {
  return generate(
    client,
    (correction) => buildCaseRequest(facts, correction),
    citableValues(facts),
    facts.conditions,
    fallbackCaseNarrative(facts),
  );
}

export async function generatePortfolioNarrative(
  client: NarrativeClient | null,
  facts: PortfolioFacts,
): Promise<NarrativeOutcome> {
  return generate(
    client,
    (correction) => buildPortfolioRequest(facts, correction),
    citablePortfolioValues(facts),
    /* A portfolio summary is given no conditions, so naming ANY of them is
       naming one the rules did not produce here. */
    [],
    fallbackPortfolioNarrative(facts),
  );
}
