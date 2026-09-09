/**
 * The hotspot score gauge (S23, AC-17).
 *
 * The number on the dial is whichever one `scoreDisplay()` says to show: the
 * model's score when there is a valid one, the deterministic reference index
 * when the model path fell back. The gauge does not choose; `displayed` comes
 * straight from the shared decision in `lib/index/validate-score.ts`, so the
 * dial, the badge and the stored `divergence_flag` cannot disagree.
 *
 * The reference index is ALWAYS present, never only in the fallback case,
 * because the whole fence around the one LLM-assigned number in the product is
 * that a director can see the deterministic figure sitting next to it and read
 * the gap for themselves.
 *
 * On a machine with no `ANTHROPIC_API_KEY` every hotspot is a fallback row, so
 * the dial shows the reference index with a fallback badge. That is the
 * expected demo state, not a defect, and the caption under the dial says so.
 */

import { ScoreBadges, displayFor, scoreStateOf, type ScoreRow } from './ScoreBadges';

export type ScoreGaugeProps = ScoreRow & {
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
  if (score === null) return 'text-faint';
  if (score <= 40) return 'text-green-700 dark:text-green-400';
  if (score <= 60) return 'text-amber-700 dark:text-amber-400';
  if (score <= 80) return 'text-orange-700 dark:text-orange-400';
  return 'text-red-700 dark:text-red-400';
}

export function ScoreGauge({
  llmScore,
  referenceIndex,
  scoreFallback,
  scoreValidated,
  scoreSource,
  model,
}: ScoreGaugeProps) {
  const row: ScoreRow = { llmScore, referenceIndex, scoreFallback, scoreValidated };
  const display = displayFor(row);
  const state = scoreStateOf(row);
  const showingModel = state === 'model' || state === 'divergent';
  const rubric = rubricFor(display.displayed);

  return (
    <div data-testid="score-gauge" className="flex flex-col gap-1.5">
      <div className="flex items-end gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">
            {showingModel ? 'Model score' : 'Reference index'}
          </div>
          <div
            data-testid="score-value"
            className={`text-3xl font-semibold tabular-nums ${toneFor(display.displayed)}`}
          >
            {display.displayed ?? '-'}
            <span className="ml-1 text-sm font-normal text-faint">/ 100</span>
          </div>
          {rubric ? (
            <div data-testid="score-rubric" className="text-xs text-muted">
              {rubric}
            </div>
          ) : null}
        </div>

        {/*
          The deterministic figure, beside the model's whenever both exist. That
          pairing is the fence around the one LLM-assigned number in the product:
          a director reads the gap without being told what it is, and the gap
          itself is printed when the badge says it matters.

          When the gauge is already showing the reference, whether through the
          fallback path or because nothing has scored yet, repeating it here
          would print the same value twice, or two dashes. The dial is the
          reference in that case and the label above already says so.
        */}
        {showingModel ? (
          <div className="pb-1">
            <div className="text-[11px] uppercase tracking-wide text-muted">Reference</div>
            <div data-testid="reference-index" className="text-lg tabular-nums">
              {display.reference ?? '-'}
            </div>
            {display.divergence !== null ? (
              <div data-testid="score-divergence" className="text-[11px] text-faint">
                gap {display.divergence}
              </div>
            ) : null}
          </div>
        ) : (
          <span data-testid="reference-index" className="sr-only">
            {display.reference ?? 'none'}
          </span>
        )}
      </div>

      <ScoreBadges
        llmScore={llmScore}
        referenceIndex={referenceIndex}
        scoreFallback={scoreFallback}
        scoreValidated={scoreValidated}
        scoreSource={scoreSource}
        model={model}
      />

      {state === 'fallback' ? (
        <p data-testid="score-fallback-note" className="text-xs text-muted">
          The deterministic reference index is shown because no valid model score
          is stored. With no <code>ANTHROPIC_API_KEY</code> present,{' '}
          <code>npm run prep:scores</code> writes this state deliberately rather
          than inventing a number.
        </p>
      ) : null}

      {state === 'unscored' ? (
        <p data-testid="score-unscored-note" className="text-xs text-muted">
          No score is stored yet. Run <code>npm run prep:reference</code> for the
          deterministic index, then <code>npm run prep:scores</code> for the model
          score.
        </p>
      ) : null}
    </div>
  );
}

export default ScoreGauge;
