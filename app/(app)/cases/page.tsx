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
                  'rounded border px-2 py-1 transition-colors ' +
                  (selected
                    ? 'border-accent font-semibold text-accent'
                    : 'border-transparent text-muted hover:text-accent')
                }
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="panel overflow-x-auto">
        <table className="data-table min-w-[52rem]">
          <thead>
            <tr>
              <th scope="col">Collateral</th>
              <th scope="col">Applicant</th>
              <th scope="col">Segment</th>
              <th scope="col" className="num">Appraised</th>
              <th scope="col" className="num">Haircut</th>
              <th scope="col" className="num">Adjusted</th>
              <th scope="col" className="num">Max loan</th>
              <th scope="col">Band</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => (
              <tr
                key={item.loan_application_id}
                data-testid={`case-row-${item.collateral_id}`}
              >
                <td>
                  <Link
                    href={`/cases/${item.collateral_id}?scenario=${scenario}`}
                    className="font-medium underline-offset-2 hover:text-accent hover:underline"
                  >
                    {item.collateral_id}
                  </Link>
                  <div className="text-[11px] text-faint">{item.address_line}</div>
                </td>
                <td>{item.applicant_name}</td>
                <td className="text-[11px] text-muted">{item.segment}</td>
                <td className="num">{money(item.appraised_value_sgd)}</td>
                <td className="num">
                  {item.total_haircut === null ? '-' : percent(item.total_haircut)}
                </td>
                <td className="num">
                  {item.adjusted_value_sgd === null ? '-' : money(item.adjusted_value_sgd)}
                </td>
                <td className="num">
                  {item.max_loan_sgd === null ? '-' : money(item.max_loan_sgd)}
                </td>
                <td>
                  {item.band ? (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${BAND_CHIP[item.band]}`}>
                      {item.band}
                    </span>
                  ) : (
                    <span className="text-[11px] text-faint">unscored</span>
                  )}
                  {item.refer_to_risk ? (
                    <span className="ml-1.5 text-[11px] font-semibold text-accent">refer</span>
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
