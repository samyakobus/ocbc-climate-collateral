/**
 * The haircut breakdown (S14, AC-2, AC-4, AC-12).
 *
 * Every figure here is a stored column of one `valuations` row. Nothing is
 * recomputed: the engine already decided, and a screen that re-derived even one
 * line could disagree with the map and the dashboard.
 *
 * Three labels are load-bearing and are rendered rather than assumed:
 *
 *   * each factor names the dataset it came from, so the panel answers "where
 *     does this number come from" without a second click;
 *   * the heat line carries a borrowed-elasticity chip, because no SG, MY or ID
 *     hedonic study exists and the elasticity is imported from a Chinese one;
 *   * the flood line labels the curve a curated fit rather than a transcription,
 *     since the published JRC Asia residential curve sits near 0.32 at 0.5 m and
 *     the seeded table uses 0.30.
 *
 * A factor that contributes zero still gets a row. "Measured at 41 micrograms
 * and not scored in Indonesia" is a different statement from "no data here",
 * and both are different from "scored, and it came to zero".
 */

import type { Band } from '@/lib/rules/bands';
import type { CaseSample, CaseValuation } from '@/app/(app)/cases/queries';
import { BAND_CHIP, COVERAGE_LABEL, HAZARD_LABEL, money, percent } from './format';

export type HaircutBreakdownProps = {
  valuation: CaseValuation;
  samples: readonly CaseSample[];
  appraisedValueSgd: number;
  curveLabel?: string | null;
  curveSourceName?: string | null;
};

type Line = {
  key: string;
  label: string;
  haircut: number;
  sample?: CaseSample;
  note?: React.ReactNode;
};

export function HaircutBreakdown({
  valuation,
  samples,
  appraisedValueSgd,
  curveLabel,
}: HaircutBreakdownProps) {
  const sampleFor = (hazard: string) => samples.find((s) => s.hazard === hazard);

  /*
    The flood line reports the peril that won the maximum of the two water
    perils. `winning_peril` is NULL when both contribute zero, which is most
    pins at origination; the line then names no peril rather than an arbitrary
    one, and the provenance panel shows no flood row at all.
  */
  const floodSample = valuation.winning_peril ? sampleFor(valuation.winning_peril) : undefined;

  const lines: Line[] = [
    {
      key: 'flood',
      label: valuation.winning_peril
        ? `${HAZARD_LABEL[valuation.winning_peril]} (worst of the two water perils)`
        : 'Flood (neither water peril contributes)',
      haircut: valuation.flood_haircut,
      sample: floodSample,
      note: valuation.winning_peril ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>
            depth {valuation.depth_m?.toFixed(2)} m, damage{' '}
            {valuation.damage_fraction?.toFixed(2)}
          </span>
          <Chip tone="neutral" testId="curve-chip">{curveChipText(curveLabel)}</Chip>
        </span>
      ) : null,
    },
    {
      key: 'wind',
      label: HAZARD_LABEL.wind,
      haircut: valuation.wind_haircut,
      sample: sampleFor('wind'),
    },
    {
      key: 'heat',
      label: HAZARD_LABEL.heat_days35,
      haircut: valuation.heat_haircut,
      sample: sampleFor('heat_days35'),
      note: (
        <Chip tone="warn" testId="borrowed-elasticity-chip">
          borrowed elasticity (China, Kang et al. 2024)
        </Chip>
      ),
    },
    {
      key: 'pm25',
      label: HAZARD_LABEL.pm25,
      haircut: valuation.pm25_haircut,
      sample: sampleFor('pm25'),
    },
  ];

  return (
    <section
      data-testid="haircut-breakdown"
      className="rounded-lg border border-black/10 dark:border-white/15"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 px-4 py-2.5 dark:border-white/15">
        <h2 className="text-sm font-semibold">Haircut breakdown</h2>
        <span className="text-xs opacity-60">
          Every figure is a stored valuation column, not recomputed here.
        </span>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs opacity-60">
            <th scope="col" className="px-4 py-1.5 font-medium">
              Factor
            </th>
            <th scope="col" className="px-4 py-1.5 font-medium">
              Measurement
            </th>
            <th scope="col" className="px-4 py-1.5 font-medium">
              Dataset
            </th>
            <th scope="col" className="px-4 py-1.5 text-right font-medium">
              Haircut
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.key}
              data-testid={`breakdown-row-${line.key}`}
              className="border-t border-black/5 align-top dark:border-white/10"
            >
              <th scope="row" className="px-4 py-2 text-left font-normal">
                <div>{line.label}</div>
                {line.note ? <div className="mt-1">{line.note}</div> : null}
              </th>
              <td className="px-4 py-2">
                <Measurement sample={line.sample} />
              </td>
              <td className="px-4 py-2 text-xs opacity-70">
                {line.sample ? (
                  <>
                    <div>{line.sample.dataset_name}</div>
                    <div className="opacity-70">
                      {line.sample.dataset_version}
                      {line.sample.pathway ? ` / ${line.sample.pathway}` : ''}
                    </div>
                  </>
                ) : (
                  <span className="opacity-60">not applicable</span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{percent(line.haircut)}</td>
            </tr>
          ))}

          <tr className="border-t border-black/10 dark:border-white/15">
            <th scope="row" className="px-4 py-2 text-left font-normal">
              Chronic subtotal
              <div className="text-xs opacity-60">heat plus PM2.5, capped at 5%</div>
            </th>
            <td />
            <td />
            <td
              data-testid="chronic-subtotal"
              className="px-4 py-2 text-right tabular-nums"
            >
              {percent(valuation.chronic_haircut)}
            </td>
          </tr>

          <tr className="border-t-2 border-black/20 font-medium dark:border-white/25">
            <th scope="row" className="px-4 py-2.5 text-left">
              Total haircut
              <div className="text-xs font-normal opacity-60">
                worst water peril plus wind plus chronic, capped at 25%
              </div>
            </th>
            <td />
            <td className="px-4 py-2.5">
              <span
                data-testid="case-band"
                data-band={valuation.band}
                className={`rounded px-2 py-0.5 text-xs ${BAND_CHIP[valuation.band as Band]}`}
              >
                {valuation.band}
              </span>
            </td>
            <td
              data-testid="total-haircut"
              className="px-4 py-2.5 text-right tabular-nums"
            >
              {percent(valuation.total_haircut)}
            </td>
          </tr>
        </tbody>
      </table>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-black/10 px-4 py-3 text-sm sm:grid-cols-4 dark:border-white/15">
        <Figure label="Appraised value" value={money(appraisedValueSgd)} />
        <Figure
          label="Adjusted value"
          value={money(valuation.adjusted_value_sgd)}
          testId="adjusted-value"
        />
        <Figure
          label="LTV applied"
          value={valuation.ltv_applied === null ? '-' : percent(valuation.ltv_applied, 0)}
        />
        <Figure
          label="Maximum loan"
          value={valuation.max_loan_sgd === null ? '-' : money(valuation.max_loan_sgd)}
          testId="max-loan"
        />
      </dl>
    </section>
  );
}

/**
 * The curve label, said once.
 *
 * The seeded `curve_label` often already carries "curated fit", and the source
 * name carries it again, so appending both produced "curated fit ... curated fit
 * ... (curated fit)" on screen. The label is the honest disclosure; the full
 * citation belongs in the provenance panel, which is where it now lives alone.
 */
function curveChipText(curveLabel?: string | null): string {
  const label = curveLabel ?? 'seeded curve';
  return /curated fit/i.test(label) ? label : `${label}, curated fit`;
}

function Measurement({ sample }: { sample?: CaseSample }) {
  if (!sample) return <span className="text-xs opacity-60">-</span>;

  if (sample.coverage === 'absent') {
    return (
      <span className="text-xs">
        <span className="opacity-70">{COVERAGE_LABEL.absent}</span>
        <div className="opacity-60">contributes 0</div>
      </span>
    );
  }

  return (
    <span className="text-xs">
      <span className="tabular-nums">
        {sample.value === null ? '-' : `${sample.value} ${sample.unit}`}
      </span>
      {sample.coverage === 'measured_not_scored' ? (
        <div data-testid={`not-scored-${sample.hazard}`} className="mt-0.5 opacity-70">
          {COVERAGE_LABEL.measured_not_scored}: contributes 0.
          {sample.applicability_reason ? ` ${sample.applicability_reason}` : ''}
        </div>
      ) : null}
    </span>
  );
}

function Figure({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd data-testid={testId} className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function Chip({
  children,
  tone,
  testId,
}: {
  children: React.ReactNode;
  tone: 'neutral' | 'warn';
  testId?: string;
}) {
  const palette =
    tone === 'warn'
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      : 'bg-black/5 text-current dark:bg-white/10';
  return (
    <span
      data-testid={testId}
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${palette}`}
    >
      {children}
    </span>
  );
}

export default HaircutBreakdown;
