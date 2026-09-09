/**
 * tests/db/hotspot-score.test.ts - AC-17, first clause.
 *
 * Every stored `llm_score` is an integer in [1,100] with a non-empty rationale,
 * or `score_fallback` is true. Every rationale cites only prompt-visible values
 * under the section 4.5 tolerance. Every `llm_drivers` entry names an
 * `input_field` in the enum, and there are between one and five of them.
 *
 * On this machine there is no `ANTHROPIC_API_KEY`, so the seeded state is the
 * fallback state and the first group asserts the invariant that holds either
 * way. The second group drives the real pass with a client that throws and with
 * a client pointed at a closed port, and asserts the rows that result: that is
 * the AC-17 clause "with the client stubbed to fail ... the page renders
 * `reference_index` with the fallback badge", checked at the row rather than
 * only at the function.
 */

import Anthropic from '@anthropic-ai/sdk';
import { afterAll, describe, expect, it } from 'vitest';

import { payloadLeafValues, promptPayload, type HotspotScoreInputs } from '@/lib/index/inputs';
import { TOOL_NAME, type ScoreResponse, type ScoringClient } from '@/lib/index/llm-score';
import { firstUncitedNumber, scoreDisplay, validateScore } from '@/lib/index/validate-score';
import { scoreAllHotspots } from '../../scripts/gen-hotspot-scores';

import { dbPool, dbQuery } from '../setup/db';

type ScoreRow = {
  id: string;
  llm_score: number | null;
  llm_drivers: unknown;
  llm_rationale: string | null;
  model: string | null;
  scored_at: Date | null;
  score_source: string | null;
  score_validated: boolean;
  score_fallback: boolean;
  divergence_flag: boolean;
  reference_index: number | null;
  score_inputs: HotspotScoreInputs | null;
};

async function scoreRows(): Promise<ScoreRow[]> {
  return dbQuery<ScoreRow>(
    `SELECT id, llm_score, llm_drivers, llm_rationale, model, scored_at,
            score_source::text AS score_source, score_validated, score_fallback,
            divergence_flag, reference_index, score_inputs
       FROM hotspots ORDER BY id`,
  );
}

/** Restore the untouched state the rest of the db project expects. */
afterAll(async () => {
  await dbQuery(`
    UPDATE hotspots
       SET llm_score = NULL, llm_drivers = NULL, llm_rationale = NULL,
           model = NULL, scored_at = NULL, score_source = NULL,
           score_validated = false, score_fallback = false
  `);
});

describe('every stored score honours the contract', () => {
  it('is either a validated integer score or a fallback row', async () => {
    for (const row of await scoreRows()) {
      if (row.llm_score === null) {
        expect(row.llm_rationale, `${row.id} has a rationale with no score`).toBeNull();
        continue;
      }

      expect(Number.isInteger(row.llm_score), `${row.id} score is not an integer`).toBe(true);
      expect(row.llm_score).toBeGreaterThanOrEqual(1);
      expect(row.llm_score).toBeLessThanOrEqual(100);
      expect(row.llm_rationale?.trim() ?? '', `${row.id} rationale`).not.toBe('');
      expect(row.score_fallback, `${row.id} carries a score and a fallback flag`).toBe(false);
    }
  });

  it('cites only prompt-visible values in every stored rationale', async () => {
    for (const row of await scoreRows()) {
      if (row.llm_rationale === null || row.score_inputs === null) continue;

      const values = Object.values(payloadLeafValues(promptPayload(row.score_inputs)));
      const uncited = firstUncitedNumber(row.llm_rationale, values);

      expect(uncited?.raw, `${row.id} quotes ${uncited?.raw}, which is in no input`).toBeUndefined();
    }
  });

  it('names one to five drivers, each an input field, on every scored row', async () => {
    for (const row of await scoreRows()) {
      if (row.llm_score === null || row.score_inputs === null) continue;

      const values = Object.values(payloadLeafValues(promptPayload(row.score_inputs)));
      const revalidated = validateScore(
        {
          score: row.llm_score,
          drivers: row.llm_drivers,
          rationale: row.llm_rationale,
        },
        values,
      );

      expect(revalidated.ok, `${row.id}: ${!revalidated.ok && revalidated.rejection.code}`).toBe(true);
    }
  });

  it('keeps divergence_flag in step with the badge the UI computes', async () => {
    for (const row of await scoreRows()) {
      const display = scoreDisplay(row);
      const badgeSaysDiverged = display.badge === 'divergence';

      expect(row.divergence_flag, `${row.id}`).toBe(badgeSaysDiverged);
    }
  });

  it('leaves model and scored_at empty on a row with no score', async () => {
    for (const row of await scoreRows()) {
      if (row.llm_score !== null) continue;

      expect(row.model, `${row.id} model`).toBeNull();
      expect(row.scored_at, `${row.id} scored_at`).toBeNull();
      expect(row.score_source, `${row.id} score_source`).toBeNull();
    }
  });
});

describe('the fallback path, at the row', () => {
  it('marks every hotspot a fallback when there is no key', async () => {
    const db = await dbPool().connect();
    try {
      const result = await scoreAllHotspots(db, null);

      expect(result.key_present).toBe(false);
      expect(result.scored).toBe(0);
      expect(result.fallback).toBe(16);
    } finally {
      db.release();
    }

    for (const row of await scoreRows()) {
      expect(row.score_fallback, `${row.id}`).toBe(true);
      expect(row.llm_score).toBeNull();
      expect(row.divergence_flag, 'a fallback row cannot diverge from anything').toBe(false);
      /* What the dashboard renders instead: the reference, with a badge. */
      expect(scoreDisplay(row).badge).toBe('fallback');
      expect(scoreDisplay(row).displayed).toBe(row.reference_index);
    }
  });

  it('falls back with the client stubbed to fail, and writes no score', async () => {
    const throwing: ScoringClient = {
      messages: {
        create: async () => {
          throw new Error('stubbed transport failure');
        },
      },
    };

    const db = await dbPool().connect();
    try {
      const result = await scoreAllHotspots(db, throwing, { limit: 3 });

      expect(result.scored).toBe(0);
      expect(result.reasons.transport).toBe(3);
    } finally {
      db.release();
    }

    const rows = (await scoreRows()).slice(0, 3);
    for (const row of rows) {
      expect(row.score_fallback).toBe(true);
      expect(row.llm_score).toBeNull();
      expect(row.llm_rationale).toBeNull();
      expect(scoreDisplay(row).displayed).toBe(row.reference_index);
    }
  });

  it('falls back with a real client pointed at a closed port', async () => {
    const closedPort = new Anthropic({
      apiKey: 'not-a-real-key',
      baseURL: 'http://127.0.0.1:1',
      timeout: 2_000,
      maxRetries: 0,
    }) as unknown as ScoringClient;

    const db = await dbPool().connect();
    try {
      const result = await scoreAllHotspots(db, closedPort, { limit: 2 });

      expect(result.scored).toBe(0);
      expect(result.reasons.transport).toBe(2);
    } finally {
      db.release();
    }

    for (const row of (await scoreRows()).slice(0, 2)) {
      expect(row.score_fallback).toBe(true);
      expect(scoreDisplay(row).badge).toBe('fallback');
    }
  }, 30_000);

  it('writes a validated score, and a divergent one raises the generated flag', async () => {
    /* A stub that answers correctly, so the success path is proven at the row
       and not only in the unit project. The score is placed 30 points from the
       first hotspot's reference so the GENERATED column has to fire. */
    const rows = await scoreRows();
    const target = rows.find((row) => row.score_inputs !== null && row.reference_index !== null)!;
    const reference = target.reference_index!;
    const divergent = reference > 50 ? reference - 30 : reference + 30;

    const share = target.score_inputs!.exposure_share;
    const rationale =
      `Exposure is ${(share * 100).toFixed(1)}% of the loan book, and the modelled 2050 ` +
      'position carries the rest of the judgement for this area.';

    const answering: ScoringClient = {
      messages: {
        create: async (): Promise<ScoreResponse> => ({
          content: [
            {
              type: 'tool_use',
              name: TOOL_NAME,
              id: 'toolu_test',
              input: {
                score: divergent,
                drivers: [
                  { input_field: 'exposure_share', direction: 'raises', note: 'Share of book.' },
                ],
                rationale,
              },
            },
          ],
          model: 'claude-opus-5',
          stop_reason: 'tool_use',
        }),
      },
    };

    const db = await dbPool().connect();
    try {
      const result = await scoreAllHotspots(db, answering, { limit: 1 });
      expect(result.scored).toBe(1);
    } finally {
      db.release();
    }

    const [written] = await scoreRows();

    expect(written.llm_score).toBe(divergent);
    expect(written.score_validated).toBe(true);
    expect(written.score_fallback).toBe(false);
    expect(written.score_source).toBe('model');
    expect(written.model).toBe('claude-opus-5');
    expect(written.scored_at).not.toBeNull();
    expect(written.divergence_flag, 'a 30-point gap must raise the generated flag').toBe(true);
    expect(scoreDisplay(written).badge).toBe('divergence');
  });
});
