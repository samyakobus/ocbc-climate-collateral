/**
 * POST /api/narrative/regenerate - S25. AC-10, and AC-11 by what it does when it fails.
 *
 * One of the four places plan 4.9 allows an outbound call, and the runtime twin
 * of `npm run prep:narratives`: the same whitelist, the same validator, the same
 * two retries and the same rule-text fallback, so a narrative regenerated on
 * stage is built exactly like one pre-generated the night before.
 *
 * POST only. A GET would make this a render path, and a render path may not call
 * out; `tests/unit/no-network-on-render.test.ts` allows this file by name, so
 * the method restriction is what keeps that allowance honest.
 *
 * A failed regeneration is not an error to the caller. With no key, an
 * unreachable API, or three answers that all break the citation rule, the rule
 * text is written and returned with `fallback_used` true, and the case screen
 * shows text either way. Nothing on this path can leave a case with no narrative.
 */

import { NextResponse } from 'next/server';

import Anthropic from '@anthropic-ai/sdk';

import { requireUser } from '@/lib/auth/session';
import { readEnv } from '@/lib/config/env';
import { transaction } from '@/lib/db/client';
import { NARRATIVE_TIMEOUT_MS, type NarrativeClient } from '@/lib/narrative/prompt';
import { loadCaseFacts, loadPortfolioFacts, saveNarrative } from '@/lib/narrative/store';
import { generateCaseNarrative, generatePortfolioNarrative } from '@/lib/narrative/validate';
import type { Scenario } from '@/lib/valuation/hazards';

export const dynamic = 'force-dynamic';

const SCENARIOS: readonly Scenario[] = ['today', 'y2030', 'y2050'];

type Body = {
  subject_type?: string;
  subject_id?: string;
  scenario?: string;
};

type Result = {
  ok: boolean;
  message: string;
  text?: string;
  validated?: boolean;
  fallback_used?: boolean;
};

/** A GET would put an outbound call on a render path. */
export async function GET(): Promise<NextResponse<Result>> {
  return NextResponse.json(
    { ok: false, message: 'POST only. A GET here would put an outbound call on a render path.' },
    { status: 405, headers: { allow: 'POST' } },
  );
}

export async function POST(request: Request): Promise<NextResponse<Result>> {
  await requireUser();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, message: 'Expected a JSON body.' }, { status: 400 });
  }

  const subjectType = body.subject_type === 'portfolio' ? 'portfolio' : 'case';
  const scenario = SCENARIOS.find((value) => value === body.scenario);
  const subjectId = typeof body.subject_id === 'string' ? body.subject_id.trim() : '';

  if (!scenario) {
    return NextResponse.json(
      { ok: false, message: `scenario must be one of ${SCENARIOS.join(', ')}.` },
      { status: 400 },
    );
  }
  if (subjectType === 'case' && subjectId === '') {
    return NextResponse.json(
      { ok: false, message: 'subject_id is required for a case narrative.' },
      { status: 400 },
    );
  }

  const apiKey = readEnv('ANTHROPIC_API_KEY');
  const client = apiKey
    ? (new Anthropic({
        apiKey,
        timeout: NARRATIVE_TIMEOUT_MS,
        maxRetries: 1,
      }) as unknown as NarrativeClient)
    : null;

  try {
    const result = await transaction(async (db) => {
      if (subjectType === 'portfolio') {
        const facts = await loadPortfolioFacts(db, scenario);
        const outcome = await generatePortfolioNarrative(client, facts);
        /* A failed LIVE attempt never replaces a stored narrative (see the case branch). */
        if (!outcome.fallback_used) {
          await saveNarrative(db, { type: 'portfolio', id: 'portfolio', scenario }, outcome);
        }
        return outcome;
      }

      const [facts] = await loadCaseFacts(db, scenario, [subjectId]);
      if (!facts) return null;

      const outcome = await generateCaseNarrative(client, facts);
      /*
        A failed LIVE attempt never replaces a stored narrative. The prep script
        may write rule text (a prep run is deliberate); a button press must not
        turn a model-written narrative into rule text because the API was
        unreachable or one answer failed the citation check. The response still
        carries the rule text so the caller can show it without storing it.
      */
      if (!outcome.fallback_used) {
        await saveNarrative(db, { type: 'case', id: facts.collateral_id, scenario }, outcome);
      }
      return outcome;
    });

    if (result === null) {
      return NextResponse.json(
        { ok: false, message: `No stored valuation for ${subjectId} at this scenario.` },
        { status: 404 },
      );
    }

    const message = result.fallback_used
      ? apiKey
        ? 'The model did not produce a narrative that passed the citation check. The stored narrative is unchanged.'
        : 'No API key on this host. The stored narrative is unchanged.'
      : 'Narrative regenerated.';

    return NextResponse.json({
      ok: !result.fallback_used,
      message,
      text: result.text,
      validated: result.validated,
      fallback_used: result.fallback_used,
    });
  } catch (cause) {
    /* The transaction rolled back, so the stored narrative is untouched. */
    return NextResponse.json(
      {
        ok: false,
        message: `Regeneration failed: ${cause instanceof Error ? cause.message : String(cause)}. The stored narrative is unchanged.`,
      },
      { status: 200 },
    );
  }
}
