/**
 * Case header (S14, AC-2, AC-7).
 *
 * Identity, the applicant, the loan and the headline figures at the selected
 * scenario. The scenario positions are links rather than a slider, so the whole
 * screen is server-rendered per scenario and every figure on it comes from the
 * row stored for that scenario.
 */

import Link from 'next/link';

import type { CaseCollateral, CaseLoan, CaseValuation } from '@/app/(app)/cases/queries';
import { SCENARIOS, type Scenario } from '@/components/map/scenario';
import { LandslideBadge } from './LandslideBadge';
import { BAND_CHIP, humanise, money, percent } from './format';

export type CaseHeaderProps = {
  collateral: CaseCollateral;
  loan: CaseLoan;
  valuation: CaseValuation | null;
  scenario: Scenario;
};

export function CaseHeader({ collateral, loan, valuation, scenario }: CaseHeaderProps) {
  return (
    <header data-testid="case-header" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">
              <span data-testid="case-id">{collateral.id}</span>
            </h1>
            {valuation ? (
              <span
                data-testid="case-band-chip"
                data-band={valuation.band}
                className={`rounded px-2 py-0.5 text-xs ${BAND_CHIP[valuation.band]}`}
              >
                {valuation.band}
              </span>
            ) : null}
            <LandslideBadge flagged={collateral.landslide_flag} slopeDeg={collateral.slope_deg} />
          </div>
          <p className="text-sm opacity-70">{collateral.address_line}</p>
          <p className="text-xs opacity-60">
            {collateral.cluster_name} &middot; {collateral.country} &middot;{' '}
            {humanise(collateral.building_type)} &middot; {humanise(collateral.occupancy_class)}
            {collateral.floor_level ? ` · floor ${collateral.floor_level}` : ''}
          </p>
        </div>

        <nav aria-label="Scenario" className="print-hide flex items-center gap-1 text-xs">
          {SCENARIOS.map((option) => {
            const selected = option.key === scenario;
            return (
              <Link
                key={option.key}
                href={`/cases/${collateral.id}?scenario=${option.key}`}
                data-testid={`case-scenario-${option.key}`}
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
      </div>

      <dl className="panel avoid-break grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-5">
        <Figure label="Applicant" value={loan.applicant_name} sub={humanise(loan.applicant_kind)} />
        <Figure
          label="Segment"
          value={humanise(loan.segment)}
          sub={`originated ${loan.originated_year}`}
        />
        <Figure label="Requested" value={money(loan.requested_amount)} sub={humanise(loan.status)} />
        <Figure
          label="Total haircut"
          value={valuation ? percent(valuation.total_haircut) : '-'}
          sub="at the selected scenario"
          testId="header-total-haircut"
        />
        <Figure
          label="Maximum loan"
          value={valuation?.max_loan_sgd != null ? money(valuation.max_loan_sgd) : '-'}
          sub={
            valuation?.ltv_applied != null
              ? `LTV ${percent(valuation.ltv_applied, 0)}${loan.base_ltv_override !== null ? ', case override' : ''}`
              : undefined
          }
          testId="header-max-loan"
        />
      </dl>
    </header>
  );
}

function Figure({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd data-testid={testId} className="tabular-nums">
        {value}
      </dd>
      {sub ? <dd className="text-xs opacity-60">{sub}</dd> : null}
    </div>
  );
}

export default CaseHeader;
