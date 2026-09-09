/**
 * tests/db/narrative-assertions.test.ts - AC-10.
 *
 * "Every stored narrative cites only on-screen numbers and no condition outside
 * its rule output." Asserted against the rows the prep pass actually wrote, and
 * against the figures those rows describe, read back from `valuations`,
 * `application_valuations` and `recommendations` rather than recomputed. A test
 * that recomputed them would be checking the engine, not the narrative.
 *
 * The pass is driven here with an injected client, so both states are covered on
 * a host with no key: the rule text that a no-client run stores, and a
 * model-written narrative from a stub that answers.
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  citablePortfolioValues,
  citableValues,
  fallbackCaseNarrative,
  type NarrativeClient,
  type NarrativeResponse,
} from '@/lib/narrative/prompt';
import { loadCaseFacts, loadNarrative, loadPortfolioFacts } from '@/lib/narrative/store';
import { firstUnearnedCondition, validateNarrative } from '@/lib/narrative/validate';
import { firstUncitedNumber } from '@/lib/index/validate-score';
import type { Scenario } from '@/lib/valuation/hazards';
import { generateAllNarratives, PINNED_CASE_IDS } from '../../scripts/gen-narratives';

import { dbPool, dbQuery } from '../setup/db';

type NarrativeRow = {
  subject_type: string;
  subject_id: string;
  scenario: Scenario;
  text: string;
  model: string | null;
  validated: boolean;
  fallback_used: boolean;
};

async function storedNarratives(): Promise<NarrativeRow[]> {
  return dbQuery<NarrativeRow>(
    `SELECT subject_type::text AS subject_type, subject_id, scenario::text AS scenario,
            text, model, validated, fallback_used
       FROM narratives ORDER BY subject_type, subject_id, scenario`,
  );
}

/** The db project's other files do not expect narrative rows to exist. */
afterAll(async () => {
  await dbQuery('DELETE FROM narratives');
});

describe('the pre-generation pass', () => {
  it('writes one narrative per pinned case per scenario, plus a portfolio summary', async () => {
    const db = await dbPool().connect();
    try {
      const result = await generateAllNarratives(db, null);

      expect(result.cases).toBe(PINNED_CASE_IDS.length * 3);
      expect(result.portfolios).toBe(3);
      expect(result.key_present).toBe(false);
      /* No client, so every one of them is the rule text. */
      expect(result.fallback).toBe(result.cases + result.portfolios);
      expect(result.validated).toBe(0);
    } finally {
      db.release();
    }

    const rows = await storedNarratives();
    expect(rows).toHaveLength(PINNED_CASE_IDS.length * 3 + 3);
  });

  it('replaces rather than appends, so a second run leaves one row per subject', async () => {
    const db = await dbPool().connect();
    try {
      await generateAllNarratives(db, null, { scenarios: ['y2050'] });
      await generateAllNarratives(db, null, { scenarios: ['y2050'] });
    } finally {
      db.release();
    }

    const seen = new Map<string, number>();
    for (const row of await storedNarratives()) {
      const key = `${row.subject_type}:${row.subject_id}:${row.scenario}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    for (const [key, count] of seen) {
      expect(count, `${key} has ${count} rows`).toBe(1);
    }
  });
});

describe('every stored narrative', () => {
  it('cites only numbers that are on the screen', async () => {
    const factsByKey = new Map<string, ReturnType<typeof citableValues>>();

    for (const scenario of ['today', 'y2030', 'y2050'] as Scenario[]) {
      for (const facts of await loadCaseFacts(dbPool(), scenario, PINNED_CASE_IDS)) {
        factsByKey.set(`${facts.collateral_id}:${scenario}`, citableValues(facts));
      }
      const portfolio = await loadPortfolioFacts(dbPool(), scenario);
      factsByKey.set(`portfolio:${scenario}`, citablePortfolioValues(portfolio));
    }

    for (const row of await storedNarratives()) {
      const values = factsByKey.get(`${row.subject_id}:${row.scenario}`);
      expect(values, `no figures loaded for ${row.subject_id} ${row.scenario}`).toBeDefined();

      const uncited = firstUncitedNumber(row.text, values!);
      expect(
        uncited?.raw,
        `${row.subject_id} ${row.scenario} quotes ${uncited?.raw}, which is on no screen`,
      ).toBeUndefined();
    }
  });

  it('names no condition outside its own rule output', async () => {
    const conditionsByKey = new Map<string, string[]>();

    for (const scenario of ['today', 'y2030', 'y2050'] as Scenario[]) {
      for (const facts of await loadCaseFacts(dbPool(), scenario, PINNED_CASE_IDS)) {
        conditionsByKey.set(`${facts.collateral_id}:${scenario}`, facts.conditions);
      }
    }

    for (const row of await storedNarratives()) {
      /* A portfolio summary is given no conditions at all, so any it named
         would be one the rules did not produce for it. */
      const conditions = conditionsByKey.get(`${row.subject_id}:${row.scenario}`) ?? [];
      const unearned = firstUnearnedCondition(row.text, conditions);

      expect(unearned, `${row.subject_id} ${row.scenario} names "${unearned}"`).toBeNull();
    }
  });

  it('is stored as the rule text with fallback_used true when there is no key', async () => {
    for (const row of await storedNarratives()) {
      expect(row.fallback_used, `${row.subject_id}`).toBe(true);
      expect(row.validated).toBe(false);
      expect(row.model).toBeNull();
      expect(row.text.trim()).not.toBe('');
    }
  });

  it('is the exact rule text the fallback builds, for a case', async () => {
    const [facts] = await loadCaseFacts(dbPool(), 'y2050', [PINNED_CASE_IDS[0]]);
    const stored = await loadNarrative(dbPool(), {
      type: 'case',
      id: facts.collateral_id,
      scenario: 'y2050',
    });

    expect(stored?.text).toBe(fallbackCaseNarrative(facts));
  });
});

describe('a model-written narrative', () => {
  it('is stored validated, and passes the same assertions', async () => {
    const [facts] = await loadCaseFacts(dbPool(), 'y2050', ['SG-EC-001']);
    const written =
      `At 2050 the assessment of ${facts.collateral_id} carries a total haircut of ` +
      `${(facts.total_haircut * 100).toFixed(1)}%, taking the appraised value to ` +
      `S$${Math.round(facts.adjusted_value_sgd).toLocaleString('en-SG')}. ` +
      `The risk band is ${facts.band}.`;

    const client: NarrativeClient = {
      messages: {
        create: async (): Promise<NarrativeResponse> => ({
          content: [{ type: 'text', text: written }],
          model: 'claude-opus-5',
          stop_reason: 'end_turn',
        }),
      },
    };

    const db = await dbPool().connect();
    try {
      const result = await generateAllNarratives(db, client, {
        scenarios: ['y2050'],
        collateralIds: ['SG-EC-001'],
      });

      expect(result.validated).toBeGreaterThanOrEqual(1);
    } finally {
      db.release();
    }

    const stored = await loadNarrative(dbPool(), {
      type: 'case',
      id: 'SG-EC-001',
      scenario: 'y2050',
    });

    expect(stored?.text).toBe(written);
    expect(stored?.validated).toBe(true);
    expect(stored?.fallback_used).toBe(false);
    expect(stored?.model).toBe('claude-opus-5');

    /* And it satisfies the AC-10 assertions the stored rows are held to. */
    expect(validateNarrative(stored!.text, citableValues(facts), facts.conditions).ok).toBe(true);
  });

  it('is not stored when it quotes a number nobody rendered', async () => {
    const [facts] = await loadCaseFacts(dbPool(), 'y2050', ['SG-EC-002']);
    const invented =
      'At 2050 the property sits 12 metres from the shoreline, which is what drives the flood ' +
      'term here and is the whole of the judgement on this collateral at this horizon.';

    const client: NarrativeClient = {
      messages: {
        create: async (): Promise<NarrativeResponse> => ({
          content: [{ type: 'text', text: invented }],
          model: 'claude-opus-5',
          stop_reason: 'end_turn',
        }),
      },
    };

    const db = await dbPool().connect();
    try {
      await generateAllNarratives(db, client, {
        scenarios: ['y2050'],
        collateralIds: ['SG-EC-002'],
      });
    } finally {
      db.release();
    }

    const stored = await loadNarrative(dbPool(), {
      type: 'case',
      id: 'SG-EC-002',
      scenario: 'y2050',
    });

    expect(stored?.text).not.toBe(invented);
    expect(stored?.text).toBe(fallbackCaseNarrative(facts));
    expect(stored?.fallback_used).toBe(true);
  });
});
