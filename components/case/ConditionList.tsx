/**
 * Loan conditions and the revaluation year (S14, AC-8).
 *
 * Conditions only, never a decline. That is a binding spec constraint, so this
 * component renders the stored `recommendations.conditions` array and has no
 * branch that could produce a rejection.
 *
 * `revalue_by_year` is a property of the APPLICATION, not of a scenario: it is
 * the first year whose total haircut crosses the mid band, evaluated over the
 * literal years 2025, 2030 and 2050, and it is stored identically on all three
 * scenario rows. The label says so, because a figure that does not move when
 * the slider moves otherwise reads as frozen.
 */

import type { CaseRecommendation } from '@/app/(app)/cases/queries';
import { BAND_CHIP } from './format';

export type ConditionListProps = {
  recommendation: CaseRecommendation | null;
  todayYear?: number;
};

export function ConditionList({ recommendation, todayYear = 2025 }: ConditionListProps) {
  if (!recommendation) {
    return (
      <section
        data-testid="condition-list"
        className="panel avoid-break px-4 py-3 text-sm"
      >
        <h2 className="text-sm font-semibold">Conditions</h2>
        <p className="mt-1 text-xs opacity-70">
          No recommendation is stored for this case yet. Run{' '}
          <code>npm run db:recompute</code>.
        </p>
      </section>
    );
  }

  const overdue =
    recommendation.revalue_by_year !== null && recommendation.revalue_by_year <= todayYear;

  return (
    <section
      data-testid="condition-list"
      className="panel avoid-break"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5 dark:border-rule">
        <h2 className="text-sm font-semibold">Conditions</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${BAND_CHIP[recommendation.band]}`}>
          {recommendation.band}
        </span>
        {recommendation.refer_to_risk ? (
          <span
            data-testid="refer-to-risk"
            className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900 dark:bg-red-950 dark:text-red-200"
          >
            Refer to risk
          </span>
        ) : null}
      </header>

      <div className="px-4 py-3 text-sm">
        {recommendation.conditions.length === 0 ? (
          <p data-testid="no-conditions" className="opacity-70">
            No conditions at this band.
          </p>
        ) : (
          <ul data-testid="conditions" className="list-disc space-y-1 pl-5">
            {recommendation.conditions.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs">
          <span className="opacity-60">Revalue by</span>{' '}
          <span data-testid="revalue-by-year" className="tabular-nums">
            {recommendation.revalue_by_year ?? 'not required'}
          </span>
          {overdue ? (
            <span
              data-testid="revalue-overdue"
              className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              overdue
            </span>
          ) : null}
          <span className="ml-2 opacity-60">
            scenario-invariant: a property of the application, not of the slider
            position
          </span>
        </p>

        <p className="mt-2 text-xs opacity-60">
          Conditions only. This tool never declines an application.
        </p>
      </div>
    </section>
  );
}

export default ConditionList;
