/**
 * /cases/[id] - the case screen (S14, AC-2, AC-3, AC-7, AC-12).
 *
 * A server component. It reads one stored valuation row per scenario and hands
 * the figures to the panels; nothing on this screen recomputes a haircut, a
 * credit, an LTV or a band. `lib/valuation` owns that arithmetic and
 * `npm run db:recompute` has already run it, so the case screen, the map and
 * the portfolio dashboard cannot disagree.
 *
 * The scenario is a search param and defaults to 2050, which is where the
 * headline figures the demo walks through live.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireUser, segmentFor } from '@/lib/auth/session';
import { SCENARIOS, labelOfScenario, type Scenario } from '@/components/map/scenario';
import { CaseHeader } from '@/components/case/CaseHeader';
import { HaircutBreakdown } from '@/components/case/HaircutBreakdown';
import { AdaptationToggle } from '@/components/case/AdaptationToggle';
import { ConditionList } from '@/components/case/ConditionList';
import { ProvenancePanel } from '@/components/case/ProvenancePanel';
import { ContextPanel } from '@/components/case/ContextPanel';
import { loadCase } from '../queries';

export const dynamic = 'force-dynamic';

/** The case screen opens at 2050: that is where the demo's headline figures live. */
const DEFAULT_SCENARIO: Scenario = 'y2050';

function parseScenario(value: string | undefined): Scenario {
  const match = SCENARIOS.find((s) => s.key === value);
  return match ? match.key : DEFAULT_SCENARIO;
}

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, { scenario: raw }] = [await params, await searchParams];
  const scenario = parseScenario(raw);

  const detail = await loadCase(id, scenario);
  if (!detail) notFound();

  const { collateral, loan, valuation, recommendation, samples, modifiers, adaptation, context } =
    detail;

  const backSegment = segmentFor(user.role);
  const backHref = backSegment ? `/cases?segment=${backSegment}` : '/cases';

  return (
    <section className="flex flex-col gap-4 p-6">
      <Link href={backHref} className="text-xs underline opacity-60 hover:opacity-100">
        Back to cases
      </Link>

      <CaseHeader
        collateral={collateral}
        loan={loan}
        valuation={valuation}
        scenario={scenario}
      />

      {valuation ? (
        <HaircutBreakdown
          valuation={valuation}
          samples={samples}
          appraisedValueSgd={collateral.appraised_value_sgd}
          curveLabel={collateral.curve_label}
          curveSourceName={collateral.curve_source_name}
        />
      ) : (
        <p className="rounded-lg border border-black/10 px-4 py-3 text-sm opacity-70 dark:border-white/15">
          No valuation is stored for this collateral at {labelOfScenario(scenario)}. Run{' '}
          <code>npm run db:recompute</code>.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ConditionList recommendation={recommendation} />
        {valuation ? (
          <AdaptationToggle valuation={valuation} adaptation={adaptation} />
        ) : null}
      </div>

      <ProvenancePanel
        samples={samples}
        valuation={valuation}
        modifiers={modifiers}
        scenarioLabel={labelOfScenario(scenario)}
        curveLabel={collateral.curve_label}
        curveSourceName={collateral.curve_source_name}
        curveSourceUrl={collateral.curve_source_url}
      />

      <ContextPanel factors={context} />
    </section>
  );
}
