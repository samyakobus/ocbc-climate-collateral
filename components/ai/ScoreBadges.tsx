/**
 * The score states of ADR-3 and section 4.5 (S23, AC-17).
 *
 * | Condition                                                   | Shown           | Badge            |
 * |-------------------------------------------------------------|-----------------|------------------|
 * | Valid score, within 25 points of the reference               | llm_score       | none             |
 * | Valid score, more than 25 points from the reference          | llm_score       | model divergence |
 * | Unreachable, timed out, no tool block, or validation failed  | reference_index | fallback         |
 *
 * THIS COMPONENT DECIDES NOTHING. Every one of those rows is decided by
 * `scoreDisplay()` in `lib/index/validate-score.ts`, which is the same function
 * `tests/unit/score-badges.test.ts` walks across all 100 scores against a
 * reference of 50, and which uses the same `> 25` comparison the
 * `divergence_flag` GENERATED column makes in SQL. An earlier version of this
 * file recomputed the state from `divergence_flag` and `score_fallback`
 * separately, which is a second implementation of a rule that already had one:
 * the badge is the fence around the one LLM-assigned number in the product, and
 * a fence with its own opinion can disagree with the row it fences. It also
 * missed `score_validated`, which `scoreDisplay` treats as a fallback.
 *
 * There is one state the table does not list, because it is not a runtime state
 * of the model path: nothing scored at all. Before `npm run prep:reference` has
 * run there is no reference index either, so `scoreDisplay` reports a fallback
 * to nothing. Saying "fallback" there would claim a model was tried and failed.
 * That is the only distinction this file draws on top of the shared function,
 * and it is a presentation one.
 */

import { scoreDisplay, type ScoreDisplay } from '@/lib/index/validate-score';

export type ScoreRow = {
  llmScore: number | null;
  referenceIndex: number | null;
  scoreFallback: boolean;
  scoreValidated?: boolean;
};

export type ScoreBadgesProps = ScoreRow & {
  scoreSource?: string | null;
  model?: string | null;
};

export type ScoreState = 'model' | 'divergent' | 'fallback' | 'unscored';

/** The shared decision, called with the component's prop names. */
export function displayFor(row: ScoreRow): ScoreDisplay {
  return scoreDisplay({
    llm_score: row.llmScore,
    reference_index: row.referenceIndex,
    score_fallback: row.scoreFallback,
    score_validated: row.scoreValidated,
  });
}

/**
 * The presentation state.
 *
 * A thin reading of `scoreDisplay`'s badge, with the one extra distinction
 * described above. Nothing here re-decides divergence or fallback.
 */
export function scoreStateOf(row: ScoreRow): ScoreState {
  const display = displayFor(row);
  if (display.badge === 'divergence') return 'divergent';
  if (display.badge === 'none') return 'model';
  return display.reference === null ? 'unscored' : 'fallback';
}

export function ScoreBadges({
  llmScore,
  referenceIndex,
  scoreFallback,
  scoreValidated,
  scoreSource,
  model,
}: ScoreBadgesProps) {
  const state = scoreStateOf({ llmScore, referenceIndex, scoreFallback, scoreValidated });

  return (
    <div
      data-testid="score-badges"
      data-state={state}
      className="flex flex-wrap items-center gap-1.5"
    >
      {state === 'divergent' ? (
        <Badge testId="badge-divergence" tone="warn">
          model divergence
        </Badge>
      ) : null}

      {state === 'fallback' ? (
        <Badge testId="badge-fallback" tone="warn">
          fallback
        </Badge>
      ) : null}

      {state === 'unscored' ? (
        <Badge testId="badge-unscored" tone="quiet">
          not yet scored
        </Badge>
      ) : null}

      {scoreSource === 'fixture' ? (
        <Badge testId="badge-fixture" tone="quiet">
          worked example, not a model result
        </Badge>
      ) : null}

      {state !== 'unscored' && model ? (
        <span className="text-[11px] text-faint">{model}</span>
      ) : null}
    </div>
  );
}

function Badge({
  children,
  tone,
  testId,
}: {
  children: React.ReactNode;
  tone: 'warn' | 'quiet';
  testId: string;
}) {
  const palette =
    tone === 'warn'
      ? 'border border-caution-rule bg-caution-bg text-caution-fg'
      : 'border border-rule bg-surface-sunken text-muted';
  return (
    <span data-testid={testId} className={`rounded px-1.5 py-0.5 text-[11px] ${palette}`}>
      {children}
    </span>
  );
}

export default ScoreBadges;
