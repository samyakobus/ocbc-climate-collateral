/**
 * /cases - the case list (S14, AC-1, AC-7).
 *
 * The two officer roles land here with their own segment already applied, so the
 * filter is part of the query rather than a client-side hide: a loan officer
 * never receives a corporate row over the wire.
 *
 * Ordered by stored total haircut, worst first, so the list opens on the cases
 * that need attention. Every figure is a stored column.
 */

import Link from 'next/link';

import { requireUser, segmentFor } from '@/lib/auth/session';
import { SCENARIOS, labelOfScenario, type Scenario } from '@/components/map/scenario';
import { BAND_CHIP, money, percent } from '@/components/case/format';
import { listCases, type Segment } from './queries';

export const dynamic = 'force-dynamic';

/** The list opens at 2050, the same position the case screen opens at. */
const DEFAULT_SCENARIO: Scenario = 'y2050';

function parseScenario(value: string | undefined): Scenario {
  const match = SCENARIOS.find((s) => s.key === value);
  return match ? match.key : DEFAULT_SCENARIO;
}

function parseSegment(value: string | undefined): Segment | null {
  return value === 'personal' || value === 'corporate' ? value : null;
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string; scenario?: string }>;
}) {
  const user = await requireUser();
  const { segment: rawSegment, scenario: rawScenario } = await searchParams;

  /*
    A role that owns a segment cannot widen its own view by editing the query
    string: the role's segment wins over the parameter. The risk manager has no
    segment of its own and sees everything, and may filter with the parameter.
  */
  const roleSegment = segmentFor(user.role) as Segment | null;
  const requested = parseSegment(rawSegment);
  const segment: Segment | null = roleSegment ?? requested;

  const scenario = parseScenario(rawScenario);
  const cases = await listCases(scenario, segment);

  return (
    <section className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Cases</h1>
          {/*
            `cases-segment` carries the segment and nothing else. It is the
            element tests/e2e/auth.spec.ts asserts AC-1's landing routes against,
            with an exact-text match, so the count and the scenario go in their
            own line rather than widening this one.
          */}
          <p data-testid="cases-segment" className="text-sm opacity-70">
            Segment: {segment ?? 'all'}
          </p>
          <p data-testid="cases-summary" className="text-xs opacity-60">
            {cases.length} applications &middot; figures at {labelOfScenario(scenario)}
          </p>
        </div>

        <nav aria-label="Scenario" className="flex items-center gap-1 text-xs">
          {SCENARIOS.map((option) => {
            const params = new URLSearchParams();
            if (requested && !roleSegment) params.set('segment', requested);
            params.set('scenario', option.key);
            const selected = option.key === scenario;
            return (
              <Link
                key={option.key}
                href={`/cases?${params.toString()}`}
                data-testid={`cases-scenario-${option.key}`}
                aria-current={selected ? 'page' : undefined}
                className={
                  'rounded border px-2 py-1 ' +
                  (selected
                    ? 'border-black/30 font-semibold dark:border-white/40'
                    : 'border-transparent opacity-60 hover:opacity-100')
                }
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="text-left text-xs opacity-60">
              <th scope="col" className="px-4 py-2 font-medium">Collateral</th>
              <th scope="col" className="px-4 py-2 font-medium">Applicant</th>
              <th scope="col" className="px-4 py-2 font-medium">Segment</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Appraised</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Haircut</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Adjusted</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Max loan</th>
              <th scope="col" className="px-4 py-2 font-medium">Band</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => (
              <tr
                key={item.loan_application_id}
                data-testid={`case-row-${item.collateral_id}`}
                className="border-t border-black/5 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.04]"
              >
                <td className="px-4 py-2">
                  <Link
                    href={`/cases/${item.collateral_id}?scenario=${scenario}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {item.collateral_id}
                  </Link>
                  <div className="text-xs opacity-60">{item.address_line}</div>
                </td>
                <td className="px-4 py-2">{item.applicant_name}</td>
                <td className="px-4 py-2 text-xs">{item.segment}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {money(item.appraised_value_sgd)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {item.total_haircut === null ? '-' : percent(item.total_haircut)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {item.adjusted_value_sgd === null ? '-' : money(item.adjusted_value_sgd)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {item.max_loan_sgd === null ? '-' : money(item.max_loan_sgd)}
                </td>
                <td className="px-4 py-2">
                  {item.band ? (
                    <span className={`rounded px-2 py-0.5 text-xs ${BAND_CHIP[item.band]}`}>
                      {item.band}
                    </span>
                  ) : (
                    <span className="text-xs opacity-60">unscored</span>
                  )}
                  {item.refer_to_risk ? (
                    <span className="ml-1.5 text-xs text-red-700 dark:text-red-400">refer</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
