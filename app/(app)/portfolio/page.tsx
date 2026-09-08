import Link from 'next/link';

import { requireRole } from '@/lib/auth/session';
import {
  hasValuations,
  portfolioHeadline,
  topExposedCases,
  type PortfolioSummaryRow,
  type TopExposedCase,
} from '@/lib/db/queries';
import { SCENARIOS, type Scenario } from '@/components/map/scenario';

/**
 * The risk-manager dashboard (S17, AC-6).
 *
 * Four headline figures and the ten most exposed cases, defaulting to 2050,
 * with the scenario selectable. It reads `v_portfolio_summary` through
 * `lib/db/queries.ts`, the same functions `npm run verify:dashboard` calls, so
 * the figures on screen and the figures a director can recompute from a
 * terminal come from one implementation rather than two.
 *
 * Offline-first (plan 4.9): no outbound call on this path, only DATABASE_URL.
 *
 * The revaluation tile is deliberately the odd one out. It does not move with
 * the scenario, because `revalue_by_year` is a property of the application
 * evaluated once over the fixed years [2025, 2030, 2050], and the tile says so
 * on screen. Without the label a figure that stays put while the others change
 * reads as a bug.
 */

export const dynamic = 'force-dynamic';

const DEFAULT_SCENARIO: Scenario = 'y2050';

function isScenario(value: string | undefined): value is Scenario {
  return SCENARIOS.some((s) => s.key === value);
}

const sgd = new Intl.NumberFormat('en-SG', {
  style: 'currency',
  currency: 'SGD',
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat('en-SG', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** S$128,400,000 reads as S$128.4m on a tile; the exact figure stays in the title. */
function compactSgd(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `S$${(value / 1_000_000_000).toFixed(2)}bn`;
  if (Math.abs(value) >= 1_000_000) return `S$${(value / 1_000_000).toFixed(1)}m`;
  return sgd.format(value);
}

const BAND_STYLE: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  orange: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  red: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};

function Tile({
  label,
  value,
  title,
  note,
  testId,
}: {
  label: string;
  value: string;
  title?: string;
  note?: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-black/10 p-4 dark:border-white/15">
      <span className="text-xs uppercase tracking-wide opacity-60">{label}</span>
      <span data-testid={testId} title={title} className="text-2xl font-semibold tabular-nums">
        {value}
      </span>
      {note ? <span className="text-xs opacity-60">{note}</span> : null}
    </div>
  );
}

function ScenarioTabs({ active }: { active: Scenario }) {
  return (
    <nav className="flex gap-1" aria-label="Scenario">
      {SCENARIOS.map((s) => (
        <Link
          key={s.key}
          href={`/portfolio?scenario=${s.key}`}
          data-testid={`scenario-${s.key}`}
          aria-current={s.key === active ? 'page' : undefined}
          className={
            'rounded px-3 py-1 text-sm ' +
            (s.key === active
              ? 'bg-black text-white dark:bg-white dark:text-black'
              : 'border border-black/15 dark:border-white/20')
          }
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

function CountryTable({ rows }: { rows: PortfolioSummaryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm" data-testid="country-table">
        <thead className="text-left text-xs uppercase tracking-wide opacity-60">
          <tr>
            <th className="py-2 pr-4">Country</th>
            <th className="py-2 pr-4 text-right">Pins</th>
            <th className="py-2 pr-4 text-right">Collateral value</th>
            <th className="py-2 pr-4 text-right">Amber or worse</th>
            <th className="py-2 pr-4 text-right">Share</th>
            <th className="py-2 text-right">Haircut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.country} className="border-t border-black/10 dark:border-white/15">
              <td className="py-2 pr-4 font-medium">{row.country.trim()}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{row.collateral_count}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {compactSgd(row.collateral_value_sgd)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {compactSgd(row.value_amber_or_worse_sgd)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {pct.format(row.share_amber_or_worse ?? 0)}
              </td>
              <td className="py-2 text-right tabular-nums">{compactSgd(row.total_haircut_sgd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopCases({ cases }: { cases: TopExposedCase[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm" data-testid="top-exposed">
        <thead className="text-left text-xs uppercase tracking-wide opacity-60">
          <tr>
            <th className="py-2 pr-4">Case</th>
            <th className="py-2 pr-4">Address</th>
            <th className="py-2 pr-4 text-right">Appraised</th>
            <th className="py-2 pr-4 text-right">Adjusted</th>
            <th className="py-2 pr-4 text-right">Haircut</th>
            <th className="py-2 text-right">Band</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((row) => (
            <tr
              key={row.collateral_id}
              className="border-t border-black/10 dark:border-white/15"
              data-testid={`top-case-${row.collateral_id}`}
            >
              <td className="py-2 pr-4">
                <Link
                  className="underline underline-offset-4"
                  href={`/cases/${row.collateral_id}`}
                >
                  {row.collateral_id}
                </Link>
              </td>
              <td className="py-2 pr-4">
                {row.address_line}
                <span className="opacity-50"> · {row.country}</span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {compactSgd(row.appraised_value_sgd)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {compactSgd(row.adjusted_value_sgd)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums" title={sgd.format(row.haircut_sgd)}>
                {compactSgd(row.haircut_sgd)}{' '}
                <span className="opacity-50">({pct.format(row.total_haircut)})</span>
              </td>
              <td className="py-2 text-right">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${BAND_STYLE[row.band] ?? ''}`}
                >
                  {row.band}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  await requireRole(['risk_manager']);

  const params = await searchParams;
  const scenario: Scenario = isScenario(params.scenario) ? params.scenario : DEFAULT_SCENARIO;

  if (!(await hasValuations())) {
    return (
      <section className="flex flex-col gap-3 p-6">
        <h1 data-testid="portfolio-heading" className="text-lg font-semibold">
          Portfolio dashboard
        </h1>
        <p className="text-sm opacity-70">
          No valuations are stored yet. Run <code>npm run db:recompute</code> to populate them.
        </p>
      </section>
    );
  }

  const [headline, cases] = await Promise.all([
    portfolioHeadline(scenario),
    topExposedCases(scenario),
  ]);

  return (
    <section className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 data-testid="portfolio-heading" className="text-lg font-semibold">
            Portfolio dashboard
          </h1>
          <p className="text-xs opacity-60">
            {headline.collateralCount} properties across five markets. Figures are illustrative.
          </p>
        </div>
        <ScenarioTabs active={scenario} />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          testId="tile-share-amber"
          label="Collateral value amber or worse"
          value={pct.format(headline.shareAmberOrWorse)}
          title={`${sgd.format(headline.valueAmberOrWorseSgd)} of ${sgd.format(headline.collateralValueSgd)}`}
          note={`${compactSgd(headline.valueAmberOrWorseSgd)} of ${compactSgd(headline.collateralValueSgd)}`}
        />
        <Tile
          testId="tile-total-haircut"
          label="Total haircut"
          value={compactSgd(headline.totalHaircutSgd)}
          title={sgd.format(headline.totalHaircutSgd)}
          note="Appraised less climate-adjusted value"
        />
        <Tile
          testId="tile-revalue-2030"
          label="Revaluation due by 2030"
          value={String(headline.revalueBy2030Count)}
          note="Scenario-invariant: does not move with the selector"
        />
        <Tile
          testId="tile-collateral-value"
          label="Collateral value"
          value={compactSgd(headline.collateralValueSgd)}
          title={sgd.format(headline.collateralValueSgd)}
          note={`${headline.collateralCount} properties`}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">By market</h2>
        <CountryTable rows={headline.byCountry} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Ten most exposed cases</h2>
        <p className="text-xs opacity-60">
          Ordered by the S$ the haircut removes, not by percentage: a small haircut on a large
          corporate property is a bigger hole in the book than a large one on a flat.
        </p>
        <TopCases cases={cases} />
      </section>
    </section>
  );
}
