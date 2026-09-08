/**
 * The three score states of ADR-3 and section 4.5 (S23, AC-17).
 *
 * | Condition                                                     | Shown           | Badge            |
 * |---------------------------------------------------------------|-----------------|------------------|
 * | Valid score, within 25 points of the reference                 | llm_score       | none             |
 * | Valid score, more than 25 points from the reference            | llm_score       | model divergence |
 * | Unreachable, timed out, no tool block, or validation failed    | reference_index | fallback         |
 *
 * `divergence_flag` is a generated column, so this component never compares two
 * numbers itself; it reads the flag the database computed. That matters because
 * the badge is the fence around the one LLM-assigned number in the product, and
 * a fence that recomputes its own condition can disagree with the row it fences.
 *
 * There is a fourth state the table does not list, because it is not a runtime
 * state: nothing scored yet. Before `npm run prep:reference` and
 * `npm run prep:scores` have run there is no reference index either, and saying
 * "fallback" then would claim a model was tried and failed. It says the truth
 * instead.
 */

export type ScoreBadgesProps = {
  llmScore: number | null;
  referenceIndex: number | null;
  divergenceFlag: boolean;
  scoreFallback: boolean;
  scoreSource?: string | null;
  model?: string | null;
};

export type ScoreState = 'model' | 'divergent' | 'fallback' | 'unscored';

/** Which of the four states a hotspot is in. */
export function scoreStateOf(props: {
  llmScore: number | null;
  referenceIndex: number | null;
  divergenceFlag: boolean;
  scoreFallback: boolean;
}): ScoreState {
  const { llmScore, referenceIndex, divergenceFlag, scoreFallback } = props;
  if (llmScore === null || scoreFallback) {
    return referenceIndex === null ? 'unscored' : 'fallback';
  }
  return divergenceFlag ? 'divergent' : 'model';
}

export function ScoreBadges({
  llmScore,
  referenceIndex,
  divergenceFlag,
  scoreFallback,
  scoreSource,
  model,
}: ScoreBadgesProps) {
  const state = scoreStateOf({ llmScore, referenceIndex, divergenceFlag, scoreFallback });

  return (
    <div data-testid="score-badges" data-state={state} className="flex flex-wrap items-center gap-1.5">
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
        <span className="text-[11px] opacity-60">{model}</span>
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
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      : 'bg-black/5 text-current dark:bg-white/10';
  return (
    <span data-testid={testId} className={`rounded px-1.5 py-0.5 text-[11px] ${palette}`}>
      {children}
    </span>
  );
}

export default ScoreBadges;
