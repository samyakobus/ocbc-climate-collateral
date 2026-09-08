'use client';

/**
 * The adaptation preview toggle (S14, AC-3, ADR-4).
 *
 * A per-case PREVIEW. It recomputes nothing and writes nothing: both figures it
 * switches between are already stored on the valuation row, `flood_haircut`
 * with the credit applied and `flood_haircut_gross` without. The risk manager's
 * global `adaptation_enabled` switch on /rules is the one that writes, and that
 * is AC-9's territory, not this component's.
 *
 * The panel shows the documented credit and the effective credit side by side,
 * because ADR-4's zero floor means they can differ. A shallow-flooding property
 * inside a high-credit zone cannot be given back more than it lost: `SG-EC-003`
 * has a documented 3.00 pp against a 2.64% gross haircut, so the effective
 * credit is 2.64 pp and the net is zero. Rendering only the documented figure
 * would overstate what the credit actually bought.
 */

import { useState } from 'react';

import type { CaseAdaptation, CaseValuation } from '@/app/(app)/cases/queries';
import { percent, points } from './format';

export type AdaptationToggleProps = {
  valuation: CaseValuation;
  adaptation: CaseAdaptation;
};

export function AdaptationToggle({ valuation, adaptation }: AdaptationToggleProps) {
  const [applied, setApplied] = useState(true);

  if (!adaptation) {
    return (
      <section
        data-testid="adaptation-panel"
        className="rounded-lg border border-black/10 px-4 py-3 text-sm dark:border-white/15"
      >
        <h2 className="text-sm font-semibold">Adaptation</h2>
        <p className="mt-1 text-xs opacity-70">
          No adaptation project is recorded against this collateral, so no credit
          applies. Membership is a curated foreign key, never derived from
          geometry.
        </p>
      </section>
    );
  }

  const shown = applied ? valuation.flood_haircut : valuation.flood_haircut_gross;
  const documented = valuation.adaptation_credit_documented_pp;
  const effective = valuation.adaptation_credit_effective_pp;
  const floored = effective + 1e-9 < documented;

  return (
    <section
      data-testid="adaptation-panel"
      className="rounded-lg border border-black/10 dark:border-white/15"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-4 py-2.5 dark:border-white/15">
        <h2 className="text-sm font-semibold">Adaptation</h2>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={applied}
            data-testid="adaptation-checkbox"
            aria-label="Apply adaptation credit"
            onChange={(event) => setApplied(event.target.checked)}
          />
          Apply credit
        </label>
      </header>

      <div className="px-4 py-3 text-sm">
        <p>
          <span data-testid="adaptation-name" className="font-medium">
            {adaptation.name}
          </span>{' '}
          <a
            href={adaptation.source_url}
            target="_blank"
            rel="noreferrer"
            data-testid="adaptation-source"
            className="text-xs underline opacity-70"
          >
            {adaptation.source_name}
          </a>
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          <div>
            <dt className="text-xs opacity-60">Flood haircut shown</dt>
            <dd data-testid="adaptation-flood-haircut" className="tabular-nums">
              {percent(shown, 2)}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Without the credit</dt>
            <dd data-testid="adaptation-gross" className="tabular-nums">
              {percent(valuation.flood_haircut_gross, 2)}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Documented credit</dt>
            <dd data-testid="adaptation-documented" className="tabular-nums">
              {points(documented)}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Effective credit</dt>
            <dd data-testid="adaptation-effective" className="tabular-nums">
              {points(effective)}
            </dd>
          </div>
        </dl>

        {floored ? (
          <p data-testid="adaptation-floored" className="mt-3 text-xs opacity-70">
            The zero floor binds here. The documented credit is {points(documented)},
            but the gross flood haircut is only {percent(valuation.flood_haircut_gross, 2)},
            so the credit actually bought {points(effective)} and the net flood
            haircut is {percent(valuation.flood_haircut, 2)}. A credit cannot give
            back more than the hazard took.
          </p>
        ) : null}

        <p className="mt-3 text-xs opacity-60">
          Preview only. This toggle changes nothing that is stored; the global
          adaptation switch lives on the thresholds screen.
        </p>
      </div>
    </section>
  );
}

export default AdaptationToggle;
