'use server';

/**
 * The live regenerate button behind one hotspot's score (S22, AC-17).
 *
 * One of the four places plan 4.9 allows an outbound call, and the runtime twin
 * of `npm run prep:scores`: the same prompt, the same forced tool, the same
 * validator and the same UPDATE, so a score regenerated on stage is
 * indistinguishable from one pre-generated the night before.
 *
 * The client is constructed HERE. `lib/index/llm-score.ts` takes it injected and
 * never imports the vendor package, which is what lets
 * `no-network-on-render.test.ts` scan `lib/` with no exception.
 *
 * With no API key, an unreachable API, a response with no tool block, or a
 * validation failure, the row is set back to `score_fallback` and the dashboard
 * shows `reference_index` with a fallback badge. The action returns a message
 * saying which of those happened; it never throws at the button.
 */

import { revalidatePath } from 'next/cache';

import Anthropic from '@anthropic-ai/sdk';

import { requireRole } from '@/lib/auth/session';
import { readEnv } from '@/lib/config/env';
import { transaction } from '@/lib/db/client';
import {
  scoreHotspot,
  SCORING_MODEL,
  SCORING_TIMEOUT_MS,
  type ScoringClient,
} from '@/lib/index/llm-score';
import { applyScoreOutcome, loadScorableHotspots } from '@/lib/index/store';

export type RescoreState = {
  ok: boolean;
  message: string;
  /** The score now on the row, or null when it fell back to the reference. */
  score: number | null;
};

export async function rescoreHotspotAction(hotspotId: string): Promise<RescoreState> {
  /* Every role may look at the AI dashboard, and regenerating writes a row, so
     the action checks a session rather than trusting the page guard. A server
     action is a public endpoint. */
  await requireRole(['risk_manager', 'corporate_credit_officer', 'loan_officer']);

  const apiKey = readEnv('ANTHROPIC_API_KEY');

  const state = await transaction(async (db) => {
    const hotspot = (await loadScorableHotspots(db)).find((row) => row.id === hotspotId);

    if (!hotspot) {
      return {
        ok: false,
        message: `No stored inputs for ${hotspotId}. Run npm run prep:reference first.`,
        score: null,
      };
    }

    if (!apiKey) {
      await applyScoreOutcome(db, hotspot.id, {
        ok: false,
        reason: 'transport',
        detail: 'ANTHROPIC_API_KEY is not set',
      });
      return {
        ok: false,
        message: 'No API key on this host. Showing the reference index with a fallback badge.',
        score: null,
      };
    }

    const client = new Anthropic({
      apiKey,
      timeout: SCORING_TIMEOUT_MS,
      maxRetries: 1,
    }) as unknown as ScoringClient;

    const outcome = await scoreHotspot(client, hotspot, hotspot.inputs);
    await applyScoreOutcome(db, hotspot.id, outcome);

    if (outcome.ok) {
      return {
        ok: true,
        message: `Scored ${outcome.value.score} by ${SCORING_MODEL}.`,
        score: outcome.value.score,
      };
    }

    const said = {
      transport: 'The scoring API could not be reached.',
      no_tool_block: 'The model answered without calling the scoring tool.',
      invalid: `The model's answer failed validation (${outcome.detail}).`,
    }[outcome.reason];

    return {
      ok: false,
      message: `${said} Showing the reference index with a fallback badge.`,
      score: null,
    };
  });

  revalidatePath('/ai');
  return state;
}
