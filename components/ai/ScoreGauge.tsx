/**
 * The hotspot score gauge (S23, AC-17).
 *
 * The number on the dial is whichever one the state says to show: the model's
 * score when there is a valid one, the deterministic reference index when the
 * model path fell back. The reference index is ALWAYS rendered beside it, never
 * only in the fallback case, because the whole fence around the one
 * LLM-assigned number in the product is that a director can see the
 * deterministic figure sitting next to it and read the gap for themselves.
 *
 * The calibration rubric is reproduced under the dial for the same reason: a
 * score of 63 means nothing without the band it sits in.
 */

import { ScoreBadges, scoreStateOf } from './ScoreBadges';

export type ScoreGaugeProps = {
  llmScore: number | null;
  referenceIndex: number | null;
  divergenceFlag: boolean;
  scoreFallback: boolean;
  scoreSource?: string | null;
  model?: string | null;
};

/** Section 4.5's rubric, reproduced so a score reads as a band, not a bare number. */
const RUBRIC = [
  { upTo: 20, label: 'minimal' },
  { upTo: 40, label: 'low' },
  { upTo: 60, label: 'moderate' },
  { upTo: 80, label: 'elevated' },
  { upTo: 100, label: 'severe' },
] as const;

export function rubricFor(score: number | null): string | null {
  if (score === null) return null;
  return RUBRIC.find((band) => score <= band.upTo)?.label ?? null;
}

function toneFor(score: number | null): string {
  if (score === null) return 'text-current opacity-40';
  if (score <= 40) return 'text-green-700 dark:text-green-400';
  if (score <= 60) return 'text-amber-700 dark:text-amber-400';
  if (score <= 80) return 'text-orange-700 dark:text-orange-400';
  return 'text-red-700 dark:text-red-400';
}

export function ScoreGauge({
  llmScore,
  referenceIndex,
  divergenceFlag,
  scoreFallback,
  scoreSource,
  model,
}: ScoreGaugeProps) {
  const state = scoreStateOf({ llmScore, referenceIndex, divergenceFlag, scoreFallback });
  const shown = state === 'model' || state === 'divergent' ? llmScore : referenceIndex;
  const rubric = rubricFor(shown);

  return (
    <div data-testid="score-gauge" className="flex flex-col gap-1.5">
      <div className="flex items-end gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide opacity-60">
            {state === 'model' || state === 'divergent' ? 'Model score' : 'Reference index'}
          </div>
          <div
            data-testid="score-value"
            className={`text-3xl font-semibold tabular-nums ${toneFor(shown)}`}
          >
            {shown ?? '-'}
            <span className="ml-1 text-sm font-normal opacity-50">/ 100</span>
          </div>
          {rubric ? (
            <div data-testid="score-rubric" className="text-xs opacity-70">
              {rubric}
            </div>
          ) : null}
        </div>

        {/*
          The deterministic figure, beside the model's whenever both exist. That
          pairing is the fence around the one LLM-assigned number in the product:
          a director reads the gap without being told what it is.

          When the gauge is already showing the reference, whether through the
          fallback path or because nothing has scored yet, repeating it here
          would print the same value twice, or two dashes. The dial is the
          reference in that case and the label above already says so.
        */}
        {state === 'model' || state === 'divergent' ? (
          <div className="pb-1">
            <div className="text-[11px] uppercase tracking-wide opacity-60">Reference</div>
            <div data-testid="reference-index" className="text-lg tabular-nums opacity-80">
              {referenceIndex ?? '-'}
            </div>
          </div>
        ) : (
          <span data-testid="reference-index" className="sr-only">
            {referenceIndex ?? 'none'}
          </span>
        )}
      </div>

      <ScoreBadges
        llmScore={llmScore}
        referenceIndex={referenceIndex}
        divergenceFlag={divergenceFlag}
        scoreFallback={scoreFallback}
        scoreSource={scoreSource}
        model={model}
      />

      {state === 'unscored' ? (
        <p data-testid="score-unscored-note" className="text-xs opacity-70">
          No score is stored yet. Run <code>npm run prep:reference</code> for the
          deterministic index, then <code>npm run prep:scores</code> for the model
          score.
        </p>
      ) : null}
    </div>
  );
}

export default ScoreGauge;
