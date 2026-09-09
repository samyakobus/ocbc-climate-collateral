/**
 * The narrative fallback, with the client stubbed to fail (AC-10).
 *
 * AC-10 names this file and one assertion: with the client stubbed to fail, a
 * narrative is still produced. Everything else here is what makes that
 * assertion worth anything - that the fallback is the RULE TEXT, that the rule
 * text passes the same validator a generated narrative must pass, and that a
 * model answer quoting a number nobody rendered is rejected rather than stored.
 *
 * Pure: no database, no network, no key.
 */

import { describe, expect, it, vi } from 'vitest';

import { BAND_CONDITIONS, INUNDATION_CONDITION } from '@/lib/rules/bands';
import {
  citableValues,
  fallbackCaseNarrative,
  fallbackPortfolioNarrative,
  NARRATIVE_RETRIES,
  NARRATIVE_TIMEOUT_MS,
  type CaseFacts,
  type NarrativeClient,
  type NarrativeRequest,
  type NarrativeResponse,
  type PortfolioFacts,
} from '@/lib/narrative/prompt';
import {
  firstUnearnedCondition,
  generateCaseNarrative,
  generatePortfolioNarrative,
  validateNarrative,
} from '@/lib/narrative/validate';

/**
 * SG-KB-003 with the adaptation credit applied: 7.74% total, a 1.50 pp credit.
 * The figures follow `tests/fixtures/cases.ts`, and the point of the fixture is
 * that every number below is one a reader can see on the case screen.
 */
const FACTS: CaseFacts = {
  loan_application_id: 'LA-039',
  collateral_id: 'SG-KB-003',
  address_line: '3 Kallang Bahru',
  cluster_name: 'Kallang',
  country: 'SG',
  building_type: 'industrial_warehouse',
  scenario: 'y2050',
  scenario_label: '2050',

  appraised_value_sgd: 4_200_000,
  adjusted_value_sgd: 3_874_920,
  requested_amount: 2_500_000,

  flood_haircut: 0.0424,
  wind_haircut: 0,
  heat_haircut: 0.035,
  pm25_haircut: 0,
  chronic_haircut: 0.035,
  total_haircut: 0.0774,
  adaptation_credit_documented_pp: 1.5,
  adaptation_credit_effective_pp: 1.5,

  ltv_applied: 0.7,
  max_loan_sgd: 2_712_444,

  band: 'amber',
  conditions: [...BAND_CONDITIONS.amber],
  revalue_by_year: 2050,
  refer_to_risk: false,
  landslide_flag: false,
};

const PORTFOLIO: PortfolioFacts = {
  scenario: 'y2050',
  scenario_label: '2050',
  collateral_count: 200,
  collateral_value_sgd: 1_500_000_000,
  value_amber_or_worse_sgd: 945_000_000,
  share_amber_or_worse: 0.63,
  total_haircut_sgd: 128_400_000,
  revaluation_count: 3,
};

const VALUES = citableValues(FACTS);

const throwingClient: NarrativeClient = {
  messages: {
    create: async () => {
      throw new Error('socket hang up');
    },
  },
};

function answering(text: string): NarrativeClient {
  return {
    messages: {
      create: async (): Promise<NarrativeResponse> => ({
        content: [{ type: 'text', text }],
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
      }),
    },
  };
}

describe('the rule text', () => {
  it('passes the validator it will be stored under', () => {
    /* A fallback its own validator would reject is a fallback nobody can
       store, and it would be found on the one screen the demo opens. */
    const result = validateNarrative(fallbackCaseNarrative(FACTS), VALUES, FACTS.conditions);

    expect(result.ok, !result.ok ? `${result.rejection.code}: ${result.rejection.detail}` : '').toBe(
      true,
    );
  });

  it('quotes the haircut, both values and the conditions verbatim', () => {
    const text = fallbackCaseNarrative(FACTS);

    expect(text).toContain('7.7%');
    expect(text).toContain('S$4,200,000');
    expect(text).toContain('S$3,874,920');
    expect(text).toContain('amber');
    expect(text).toContain(BAND_CONDITIONS.amber[0]);
  });

  it('passes the validator for a portfolio summary too', () => {
    const text = fallbackPortfolioNarrative(PORTFOLIO);
    const result = validateNarrative(
      text,
      [
        PORTFOLIO.collateral_count,
        PORTFOLIO.collateral_value_sgd,
        PORTFOLIO.value_amber_or_worse_sgd,
        PORTFOLIO.share_amber_or_worse,
        PORTFOLIO.total_haircut_sgd,
        PORTFOLIO.revaluation_count,
      ],
      [],
    );

    expect(result.ok, !result.ok ? result.rejection.detail : '').toBe(true);
  });

  it('says nothing about a credit that was not applied', () => {
    const noCredit = fallbackCaseNarrative({
      ...FACTS,
      adaptation_credit_effective_pp: 0,
      adaptation_credit_documented_pp: 0,
    });

    expect(noCredit).not.toContain('percentage points');
  });
});

describe('with the client stubbed to fail', () => {
  it('still produces a narrative, and it is the rule text', async () => {
    const outcome = await generateCaseNarrative(throwingClient, FACTS);

    expect(outcome.text).toBe(fallbackCaseNarrative(FACTS));
    expect(outcome.fallback_used).toBe(true);
    expect(outcome.validated).toBe(false);
    expect(outcome.model).toBeNull();
    expect(outcome.attempts[0]).toContain('socket hang up');
  });

  it('does not retry a transport failure, which rephrasing cannot fix', async () => {
    const create = vi.fn(async () => {
      throw new Error('socket hang up');
    });

    await generateCaseNarrative({ messages: { create } }, FACTS);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('writes the rule text without calling anything when there is no client', async () => {
    const outcome = await generateCaseNarrative(null, FACTS);

    expect(outcome.fallback_used).toBe(true);
    expect(outcome.attempts).toEqual(['no_client']);
  });

  it('falls back for the portfolio summary the same way', async () => {
    const outcome = await generatePortfolioNarrative(throwingClient, PORTFOLIO);

    expect(outcome.text).toBe(fallbackPortfolioNarrative(PORTFOLIO));
    expect(outcome.fallback_used).toBe(true);
  });
});

describe('with the client answering', () => {
  it('stores a narrative that cites only the figures on the screen', async () => {
    const text =
      'At 2050 the total haircut on this warehouse is 7.7%, taking the appraised S$4,200,000 ' +
      'to S$3,874,920 after a 1.5 percentage point adaptation credit. The band is amber and ' +
      'flood insurance cover is required for the full climate-adjusted value.';

    const outcome = await generateCaseNarrative(answering(text), FACTS);

    expect(outcome.validated).toBe(true);
    expect(outcome.fallback_used).toBe(false);
    expect(outcome.model).toBe('claude-opus-5');
    expect(outcome.text).toBe(text);
  });

  it('retries twice on an uncited number, then writes the rule text', async () => {
    const invented =
      'At 2050 the haircut is 7.7% and the property sits 12 metres from the canal, which is ' +
      'what drives the flood term on this case and nothing else does.';
    const create = vi.fn(async (): Promise<NarrativeResponse> => ({
      content: [{ type: 'text', text: invented }],
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
    }));

    const outcome = await generateCaseNarrative({ messages: { create } }, FACTS);

    /* One attempt plus two retries, exactly as plan 4.8 writes it. */
    expect(create).toHaveBeenCalledTimes(NARRATIVE_RETRIES + 1);
    expect(outcome.fallback_used).toBe(true);
    expect(outcome.text).toBe(fallbackCaseNarrative(FACTS));
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.attempts[0]).toContain('uncited_number: 12');
  });

  it('tells the model which number broke the rule on the retry', async () => {
    const create = vi.fn<
      (params: NarrativeRequest, options?: { timeout?: number }) => Promise<NarrativeResponse>
    >(async () => ({
      content: [
        {
            type: 'text',
          text:
            'At 2050 the haircut is 7.7% and there are 12 similar warehouses in the cluster, ' +
            'which is the comparison this assessment rests on for the value shown.',
        },
      ],
      stop_reason: 'end_turn',
    }));

    await generateCaseNarrative({ messages: { create } }, FACTS);

    const retry = create.mock.calls[1][0];
    expect(retry.messages[0].content).toContain('12');
    expect(retry.messages[0].content).toContain('not one of the figures given');
  });

  it('passes the 8 second timeout through on every attempt', async () => {
    const create = vi.fn<
      (params: NarrativeRequest, options?: { timeout?: number }) => Promise<NarrativeResponse>
    >(async () => ({
      content: [{ type: 'text', text: 'too short' }],
      stop_reason: 'end_turn',
    }));

    await generateCaseNarrative({ messages: { create } }, FACTS);

    for (const call of create.mock.calls) {
      expect(call[1]).toEqual({ timeout: NARRATIVE_TIMEOUT_MS });
    }
  });
});

describe('conditions outside the rule output', () => {
  it('rejects a narrative naming a condition the rules did not produce', () => {
    const text =
      'At 2050 the haircut is 7.7% and the advance must be capped at the segment LTV applied ' +
      'to the climate-adjusted value rather than the appraised value of S$4,200,000.';

    const result = validateNarrative(text, VALUES, FACTS.conditions);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.rejection.code).toBe('unearned_condition');
    expect(!result.ok && result.rejection.detail).toBe(BAND_CONDITIONS.orange[0]);
  });

  it('accepts the condition the rules DID produce, paraphrased', () => {
    const text =
      'At 2050 the haircut is 7.7%, and flood insurance cover is required for the full ' +
      'climate-adjusted value of S$3,874,920, renewed each year.';

    expect(validateNarrative(text, VALUES, FACTS.conditions).ok).toBe(true);
  });

  it('names the coastal inundation referral only where the flag fired', () => {
    const text =
      'At 2050 the haircut is 7.7% and the site is flagged for coastal inundation, so it goes ' +
      'to risk management before any advance is made against the S$4,200,000 appraisal.';

    expect(firstUnearnedCondition(text, FACTS.conditions)).toBe(INUNDATION_CONDITION);
    expect(firstUnearnedCondition(text, [...FACTS.conditions, INUNDATION_CONDITION])).toBeNull();
  });

  it('rejects a lending decision, which the product never makes', () => {
    const text =
      'At 2050 the haircut is 7.7% on an appraised S$4,200,000, and on that basis we decline ' +
      'the facility rather than attaching conditions to it.';

    const result = validateNarrative(text, VALUES, FACTS.conditions);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.rejection.code).toBe('decision_language');
  });

  it('accepts percent and currency renderings of the same figures', () => {
    /* The AC-10 tolerance, shared with the score validator: 18%, 18 %, 18.0%
       and S$ with separators all cite the same stored value. */
    const renderings = [
      'The total haircut is 7.74% at 2050 on an appraised value of S$4,200,000 for this site.',
      'The total haircut is 7.7 % at 2050 on an appraised value of S$4.2m for this site here.',
      'The total haircut is 7.740% at 2050 on an appraised value of 4,200,000 for this site.',
    ];

    for (const text of renderings) {
      expect(validateNarrative(text, VALUES, FACTS.conditions).ok, text).toBe(true);
    }
  });
});
