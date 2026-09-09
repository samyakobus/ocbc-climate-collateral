/**
 * The case narrative (S25, AC-10).
 *
 * A server component that renders STORED text. It generates nothing: the text
 * comes from `npm run prep:narratives` or from the regenerate button, both of
 * which run the same validator, so the sentence on this screen has already been
 * checked against the figures in the panels above it.
 *
 * The badge is not decoration. A narrative is either model-written and validated
 * against the whitelist, or it is the rule text, and a reader of a credit file
 * is entitled to know which one they are looking at. The rule-text case is the
 * normal state on a host with no API key, and it is labelled rather than hidden.
 *
 * The block is `avoid-break` and prints: a case file leaves the room on paper.
 */

import { RefreshButton } from '@/components/ai/RefreshButton';
import { regenerateCaseNarrativeAction } from '@/app/actions/narrative';
import type { StoredNarrative } from '@/lib/narrative/store';

export type NarrativeBlockProps = {
  collateralId: string;
  scenario: string;
  narrative: StoredNarrative | null;
};

export function NarrativeBlock({ collateralId, scenario, narrative }: NarrativeBlockProps) {
  async function regenerate() {
    'use server';
    return regenerateCaseNarrativeAction(collateralId, scenario);
  }

  return (
    <section className="panel avoid-break px-4 py-3" data-testid="narrative-block">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Assessment summary</h2>

        <span className="flex items-center gap-2">
          {narrative ? (
            <span
              data-testid="narrative-source"
              className={
                'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                (narrative.fallback_used
                  ? 'bg-black/5 text-muted dark:bg-white/10'
                  : 'bg-accent/10 text-accent')
              }
            >
              {narrative.fallback_used
                ? 'Rule text'
                : `Model-written, checked against the figures${narrative.model ? ` (${narrative.model})` : ''}`}
            </span>
          ) : null}

          <span className="print-hide">
            <RefreshButton action={regenerate} label="Regenerate" testId="narrative-regenerate" />
          </span>
        </span>
      </div>

      {narrative ? (
        <p className="mt-2 text-sm leading-relaxed" data-testid="narrative-text">
          {narrative.text}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted" data-testid="narrative-empty">
          No summary is stored for this case at this scenario. Run{' '}
          <code>npm run prep:narratives</code>.
        </p>
      )}

      <p className="mt-2 text-[11px] text-muted">
        Every figure quoted here is one of the figures above, and every condition named is one the
        rules produced. Synthetic portfolio, illustrative figures.
      </p>
    </section>
  );
}
