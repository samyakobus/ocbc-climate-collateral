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
import { PrintButton } from '@/components/case/PrintButton';
import { SatelliteThumb } from '@/components/case/SatelliteThumb';
import { refreshThumbAction } from '@/app/actions/refresh-thumb';
import { HaircutBreakdown } from '@/components/case/HaircutBreakdown';
import { AdaptationToggle } from '@/components/case/AdaptationToggle';
import { ConditionList } from '@/components/case/ConditionList';
import { ProvenancePanel } from '@/components/case/ProvenancePanel';
import { ContextPanel } from '@/components/case/ContextPanel';
import { NarrativeBlock } from '@/components/case/NarrativeBlock';
import { pool } from '@/lib/db/client';
import { loadNarrative } from '@/lib/narrative/store';
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

  /* Stored text only (S25). This screen generates nothing: `prep:narratives`
     and the regenerate button both run the citation validator before a word of
     it is written. */
  const narrative = await loadNarrative(pool(), {
    type: 'case',
    id: collateral.id,
    scenario,
  });

  const backSegment = segmentFor(user.role);
  const backHref = backSegment ? `/cases?segment=${backSegment}` : '/cases';

  return (
    <section className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={backHref}
          className="print-hide text-xs text-muted underline underline-offset-2 hover:text-accent"
        >
          Back to cases
        </Link>
        <PrintButton />
      </div>

      {/*
        Paper only (S27). On screen this is all in the chrome and the header;
        on paper the sheet has to identify itself, because a case file leaves
        the room without the application around it. `print-only` is display:none
        until the `@media print` block in globals.css turns it on.
      */}
      <div className="print-only avoid-break border-b pb-2">
        <p className="text-[10pt] font-semibold">
          OCBC Climate Collateral - climate-adjusted collateral assessment
        </p>
        <p className="text-[8.5pt]">
          Collateral {collateral.id} - {collateral.address_line} - scenario{' '}
          {labelOfScenario(scenario)}
        </p>
        <p className="text-[8.5pt]">
          Synthetic portfolio, illustrative figures. Not a credit decision. Every figure is
          computed by the stored active rule set; no figure on this sheet is model-assigned.
        </p>
      </div>

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
        <p className="panel avoid-break px-4 py-3 text-sm text-muted">
          No valuation is stored for this collateral at {labelOfScenario(scenario)}. Run{' '}
          <code>npm run db:recompute</code>.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <ConditionList recommendation={recommendation} />
          {valuation ? (
            <AdaptationToggle valuation={valuation} adaptation={adaptation} />
          ) : null}
        </div>

        {/*
          The one live fetch the spec allows, and only on a click. The image
          itself is a committed same-origin file, so this panel renders with the
          interface disabled (AC-11) and prints with the case file.
        */}
        <SatelliteThumb
          collateralId={collateral.id}
          path={collateral.satellite_thumb_path}
          refresh={refreshThumbAction}
        />
      </div>

      <NarrativeBlock collateralId={collateral.id} scenario={scenario} narrative={narrative} />

      {/* `print-urls` prints each source URL beside its link, which is what
          makes the paper copy answerable on AC-12. It wraps the context panel
          too: those dataset links are sources as well, and an underline with no
          target is a dead end on paper. `contents` keeps the flex column. */}
      <div className="print-urls contents">
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
      </div>
    </section>
  );
}
