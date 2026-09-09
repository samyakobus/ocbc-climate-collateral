/**
 * Case and portfolio narratives (plan 4.8, AC-10).
 *
 * The model is given a WHITELIST: the figures already rendered on the screen,
 * the band, and the exact condition strings the rule engine produced. It is
 * told to introduce neither a number nor a condition outside that list, and
 * `lib/narrative/validate.ts` then checks that it did not. Nothing here
 * computes a haircut, a credit or an LTV: every figure arrives already computed
 * by `lib/valuation`, which is what keeps a narrative from disagreeing with the
 * panel above it.
 *
 * The client is INJECTED, exactly as in `lib/index/llm-score.ts` and for the
 * same reason (plan 4.9): the vendor package may not appear anywhere under
 * `lib/`, and a stubbed client is how the fallback is tested with no network.
 *
 * The fallback is not an error state. With no key, an unreachable API or a
 * failed validation, `fallbackCaseNarrative` writes the rule text verbatim, and
 * that text is itself built only from the whitelist, so it passes the same
 * validator every generated narrative must pass.
 */

import { numericTokens } from '@/lib/index/validate-score';
import type { Band } from '@/lib/rules/bands';
import type { Scenario } from '@/lib/valuation/hazards';

export const NARRATIVE_MODEL = 'claude-opus-5';

/** Plan 4.9: 8 s for Anthropic. */
export const NARRATIVE_TIMEOUT_MS = 8_000;

export const NARRATIVE_MAX_TOKENS = 1_000;

/** Plan 4.8: two retries, then the rule text. */
export const NARRATIVE_RETRIES = 2;

export const NARRATIVE_LENGTH = { min: 80, max: 900 } as const;

/* ------------------------------------------------------------------ *
 * The whitelist
 * ------------------------------------------------------------------ */

/**
 * Everything a case narrative may mention.
 *
 * Fractions are fractions (`total_haircut` 0.101 is a 10.1% haircut) and the
 * two adaptation credits are in percentage POINTS, which is how the case screen
 * renders them. `citableValues` resolves that difference so a sentence may
 * write either rendering.
 */
export type CaseFacts = {
  loan_application_id: string;
  collateral_id: string;
  address_line: string;
  cluster_name: string;
  country: string;
  building_type: string;
  scenario: Scenario;
  scenario_label: string;

  appraised_value_sgd: number;
  adjusted_value_sgd: number;
  requested_amount: number;

  flood_haircut: number;
  wind_haircut: number;
  heat_haircut: number;
  pm25_haircut: number;
  chronic_haircut: number;
  total_haircut: number;
  adaptation_credit_documented_pp: number;
  adaptation_credit_effective_pp: number;

  ltv_applied: number | null;
  max_loan_sgd: number | null;

  band: Band;
  conditions: string[];
  revalue_by_year: number | null;
  refer_to_risk: boolean;
  landslide_flag: boolean;
};

export type PortfolioFacts = {
  scenario: Scenario;
  scenario_label: string;
  collateral_count: number;
  collateral_value_sgd: number;
  value_amber_or_worse_sgd: number;
  share_amber_or_worse: number;
  total_haircut_sgd: number;
  revaluation_count: number;
};

/**
 * Every number a narrative may quote.
 *
 * The percentage-point credits are listed BOTH as stored and divided by 100.
 * The case screen renders a 1.50 pp credit as "1.50 pp", and a sentence may
 * reasonably call the same thing "1.5%"; without both, one of those two natural
 * renderings is rejected and the case falls to the rule text for a difference of
 * units rather than of substance.
 */
export function citableValues(facts: CaseFacts): number[] {
  const points = [facts.adaptation_credit_documented_pp, facts.adaptation_credit_effective_pp];

  /*
    The address is on the screen, and a street number is part of it. "3 Kallang
    Bahru" would otherwise be an uncited 3, which rejects the rule text itself
    for naming the property it is about. AC-10's standard is numbers on the
    screen, and this is one.
  */
  const inText = numericTokens(`${facts.address_line} ${facts.cluster_name}`).map(
    (token) => token.value,
  );

  return [
    ...inText,
    facts.appraised_value_sgd,
    facts.adjusted_value_sgd,
    facts.requested_amount,
    facts.flood_haircut,
    facts.wind_haircut,
    facts.heat_haircut,
    facts.pm25_haircut,
    facts.chronic_haircut,
    facts.total_haircut,
    ...points,
    ...points.map((value) => value / 100),
    ...(facts.ltv_applied === null ? [] : [facts.ltv_applied]),
    ...(facts.max_loan_sgd === null ? [] : [facts.max_loan_sgd]),
  ];
}

export function citablePortfolioValues(facts: PortfolioFacts): number[] {
  return [
    facts.collateral_count,
    facts.collateral_value_sgd,
    facts.value_amber_or_worse_sgd,
    facts.share_amber_or_worse,
    facts.total_haircut_sgd,
    facts.revaluation_count,
  ];
}

/* ------------------------------------------------------------------ *
 * Rendering the facts
 * ------------------------------------------------------------------ */

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function money(value: number): string {
  return `S$${Math.round(value).toLocaleString('en-SG')}`;
}

/**
 * The rule text.
 *
 * Stored verbatim whenever generation is unavailable or rejected (plan 4.8),
 * and built only from the whitelist, so it satisfies the citation validator
 * like any generated narrative. `narrative-fallback.test.ts` asserts that,
 * because a fallback that its own validator would reject is a fallback nobody
 * can store.
 */
export function fallbackCaseNarrative(facts: CaseFacts): string {
  const lines = [
    `At ${facts.scenario_label}, the climate-adjusted assessment of ${facts.collateral_id}, ` +
      `${facts.address_line}, carries a total haircut of ${percent(facts.total_haircut)}, ` +
      `taking the appraised value of ${money(facts.appraised_value_sgd)} to ` +
      `${money(facts.adjusted_value_sgd)}. The risk band is ${facts.band}.`,
  ];

  if (facts.adaptation_credit_effective_pp > 0) {
    lines.push(
      `An adaptation credit of ${facts.adaptation_credit_effective_pp} percentage points was applied.`,
    );
  }

  if (facts.max_loan_sgd !== null) {
    lines.push(`The maximum advance against this collateral is ${money(facts.max_loan_sgd)}.`);
  }

  lines.push(
    facts.conditions.length > 0
      ? `Conditions: ${facts.conditions.join(' ')}`
      : 'No conditions are attached at this band.',
  );

  if (facts.revalue_by_year !== null) {
    lines.push(`Revalue by ${facts.revalue_by_year}.`);
  }

  return lines.join(' ');
}

export function fallbackPortfolioNarrative(facts: PortfolioFacts): string {
  return (
    `At ${facts.scenario_label}, ${percent(facts.share_amber_or_worse)} of collateral value ` +
    `across ${facts.collateral_count} properties is amber or worse, ` +
    `${money(facts.value_amber_or_worse_sgd)} of ${money(facts.collateral_value_sgd)}. ` +
    `The total haircut is ${money(facts.total_haircut_sgd)}, and ${facts.revaluation_count} ` +
    'applications are due for revaluation before 2030.'
  );
}

/* ------------------------------------------------------------------ *
 * The prompt
 * ------------------------------------------------------------------ */

export const CASE_SYSTEM_PROMPT = [
  'You write one short paragraph for a bank credit file, explaining a climate-adjusted',
  'collateral assessment to a loan officer who can already see the figures.',
  '',
  'You are given every figure that appears on the screen, the risk band, and the exact',
  'condition strings the rule engine produced. These rules are checked after you answer,',
  'and a breach is discarded in favour of plain rule text:',
  '- Use only the numbers you are given. Do not introduce, estimate, total or derive one.',
  '  A haircut given as 0.101 may be written as 10.1%; a value may carry S$ and separators.',
  '- Name only the conditions you are given, in your own words or theirs. Do not mention a',
  '  condition that is not in the list, and do not invent a requirement.',
  '- Never state or imply a lending decision. The conditions are the outcome.',
  '- Three or four sentences. Say what drives the haircut, what it does to the value, and',
  '  what the conditions require. No headings, no bullet points, no preamble.',
].join('\n');

export const PORTFOLIO_SYSTEM_PROMPT = [
  'You write one short paragraph summarising a property loan book under a climate scenario,',
  'for a risk manager who can already see the figures.',
  '',
  'Rules, checked after you answer:',
  '- Use only the numbers you are given. Do not introduce, estimate or derive one.',
  '- Do not name an individual property, a country or a condition; you have not been given any.',
  '- Two or three sentences, no headings and no bullet points.',
].join('\n');

export function caseUserMessage(facts: CaseFacts): string {
  return [
    `Collateral ${facts.collateral_id}, ${facts.address_line}, ${facts.cluster_name}, ${facts.country}.`,
    `Building type ${facts.building_type}. Scenario ${facts.scenario_label}.`,
    '',
    'Figures on the screen:',
    `- appraised value ${money(facts.appraised_value_sgd)}`,
    `- climate-adjusted value ${money(facts.adjusted_value_sgd)}`,
    `- total haircut ${percent(facts.total_haircut)}`,
    `- flood ${percent(facts.flood_haircut)}, wind ${percent(facts.wind_haircut)}, ` +
      `heat ${percent(facts.heat_haircut)}, PM2.5 ${percent(facts.pm25_haircut)}, ` +
      `chronic ${percent(facts.chronic_haircut)}`,
    `- adaptation credit applied ${facts.adaptation_credit_effective_pp} percentage points ` +
      `(documented ${facts.adaptation_credit_documented_pp})`,
    facts.ltv_applied === null ? '- LTV: none stored' : `- LTV applied ${percent(facts.ltv_applied)}`,
    facts.max_loan_sgd === null
      ? '- maximum advance: none stored'
      : `- maximum advance ${money(facts.max_loan_sgd)}`,
    `- risk band ${facts.band}`,
    facts.landslide_flag ? '- the site carries a landslide flag' : '',
    '',
    facts.conditions.length > 0
      ? `Conditions produced by the rules, verbatim:\n${facts.conditions.map((c) => `- ${c}`).join('\n')}`
      : 'The rules produced no conditions at this band.',
    facts.revalue_by_year === null ? '' : `Revaluation is due by ${facts.revalue_by_year}.`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function portfolioUserMessage(facts: PortfolioFacts): string {
  return [
    `Scenario ${facts.scenario_label}.`,
    '',
    'Figures on the dashboard:',
    `- ${facts.collateral_count} properties`,
    `- collateral value ${money(facts.collateral_value_sgd)}`,
    `- value amber or worse ${money(facts.value_amber_or_worse_sgd)}, ` +
      `which is ${percent(facts.share_amber_or_worse)} of the book`,
    `- total haircut ${money(facts.total_haircut_sgd)}`,
    `- ${facts.revaluation_count} applications due for revaluation before 2030`,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * The injected client
 * ------------------------------------------------------------------ */

export type NarrativeRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
};

export type NarrativeResponse = {
  content: unknown[];
  model?: string;
  stop_reason?: string | null;
};

/** Structural, so the vendor package stays out of `lib/` (plan 4.9). */
export type NarrativeClient = {
  messages: {
    create(params: NarrativeRequest, options?: { timeout?: number }): Promise<NarrativeResponse>;
  };
};

export function buildCaseRequest(facts: CaseFacts, correction?: string): NarrativeRequest {
  const content = correction
    ? `${caseUserMessage(facts)}\n\n${correction}`
    : caseUserMessage(facts);

  return {
    model: NARRATIVE_MODEL,
    max_tokens: NARRATIVE_MAX_TOKENS,
    system: CASE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  };
}

export function buildPortfolioRequest(
  facts: PortfolioFacts,
  correction?: string,
): NarrativeRequest {
  const content = correction
    ? `${portfolioUserMessage(facts)}\n\n${correction}`
    : portfolioUserMessage(facts);

  return {
    model: NARRATIVE_MODEL,
    max_tokens: NARRATIVE_MAX_TOKENS,
    system: PORTFOLIO_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  };
}

/** Join the text blocks of a response, ignoring anything else in it. */
export function responseText(response: NarrativeResponse): string {
  const parts: string[] = [];

  for (const block of response.content ?? []) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }

  return parts.join('\n').trim();
}
