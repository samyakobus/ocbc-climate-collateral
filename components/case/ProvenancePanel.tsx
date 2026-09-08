/**
 * Provenance panel (S14, AC-12).
 *
 * A number without a dataset name, version, scenario and sampled-at date does
 * not ship. This panel is where that promise is kept: one row per hazard sample
 * behind the breakdown, plus the site modifiers the heat term indexes and the
 * curve the flood term interpolates.
 *
 * Two behaviours are deliberate.
 *
 * There is NO flood row when `winning_peril` is null. Both water perils
 * contributed zero, which is every pin at origination, and showing a riverine
 * depth next to a coastal haircut would be worse than showing nothing.
 *
 * A `measured_not_scored` row renders its measured value AND the reason policy
 * excludes it, with the source. "Measured at 41 micrograms and not scored in
 * Indonesia" is a stronger answer to a director than "not applicable", and it
 * keeps the real value available.
 */

import type { CaseModifiers, CaseSample, CaseValuation } from '@/app/(app)/cases/queries';
import { COVERAGE_LABEL, HAZARD_LABEL } from './format';

export type ProvenancePanelProps = {
  samples: readonly CaseSample[];
  valuation: CaseValuation | null;
  modifiers: CaseModifiers;
  scenarioLabel: string;
  curveLabel?: string | null;
  curveSourceName?: string | null;
  curveSourceUrl?: string | null;
};

const WATER_PERILS = new Set(['flood_riverine', 'flood_coastal']);

export function ProvenancePanel({
  samples,
  valuation,
  modifiers,
  scenarioLabel,
  curveLabel,
  curveSourceName,
  curveSourceUrl,
}: ProvenancePanelProps) {
  /*
    Which flood rows to show. When a peril won, show that one: its depth is the
    depth the haircut used. When neither did, show neither.
  */
  const visible = samples.filter((sample) => {
    if (!WATER_PERILS.has(sample.hazard)) return true;
    if (!valuation || valuation.winning_peril === null) return false;
    return sample.hazard === valuation.winning_peril;
  });

  const floodSuppressed =
    samples.some((s) => WATER_PERILS.has(s.hazard)) &&
    (!valuation || valuation.winning_peril === null);

  return (
    <section
      data-testid="provenance-panel"
      className="rounded-lg border border-black/10 dark:border-white/15"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 px-4 py-2.5 dark:border-white/15">
        <h2 className="text-sm font-semibold">Provenance</h2>
        <span className="text-xs opacity-60">Scenario: {scenarioLabel}</span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-xs">
          <thead>
            <tr className="text-left opacity-60">
              <th scope="col" className="px-4 py-1.5 font-medium">Factor</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Value</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Coverage</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Dataset</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Version / pathway</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Sampled</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((sample) => (
              <tr
                key={sample.hazard}
                data-testid={`provenance-row-${sample.hazard}`}
                className="border-t border-black/5 align-top dark:border-white/10"
              >
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {HAZARD_LABEL[sample.hazard] ?? sample.hazard}
                  {sample.scenario_invariant ? (
                    <div className="opacity-60">scenario-invariant</div>
                  ) : null}
                </th>
                <td className="px-4 py-2 tabular-nums">
                  {sample.value === null ? '-' : `${sample.value} ${sample.unit}`}
                </td>
                <td className="px-4 py-2">
                  <div>{COVERAGE_LABEL[sample.coverage] ?? sample.coverage}</div>
                  {sample.coverage === 'measured_not_scored' && sample.applicability_reason ? (
                    <div className="mt-0.5 max-w-64 opacity-70">
                      {sample.applicability_reason}{' '}
                      {sample.applicability_url ? (
                        <a
                          href={sample.applicability_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          source
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2">{sample.dataset_name}</td>
                <td className="px-4 py-2">
                  {sample.dataset_version}
                  {sample.pathway ? ` / ${sample.pathway}` : ''}
                  {sample.return_period_yrs ? ` / ${sample.return_period_yrs}-yr` : ''}
                </td>
                <td className="px-4 py-2 tabular-nums">{sample.sampled_at}</td>
              </tr>
            ))}

            {modifiers ? (
              <tr
                data-testid="provenance-row-modifiers"
                className="border-t border-black/5 dark:border-white/10"
              >
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  Site modifiers
                </th>
                <td className="px-4 py-2 tabular-nums">
                  SUHI {modifiers.suhi_tertile}, NDVI {modifiers.ndvi_tertile}
                </td>
                <td className="px-4 py-2">indexes the heat multiplier</td>
                <td className="px-4 py-2">{modifiers.dataset_name}</td>
                <td className="px-4 py-2">{modifiers.dataset_version}</td>
                <td className="px-4 py-2 tabular-nums">{modifiers.sampled_at}</td>
              </tr>
            ) : null}

            {curveLabel ? (
              <tr
                data-testid="provenance-row-curve"
                className="border-t border-black/5 dark:border-white/10"
              >
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  Depth-damage curve
                </th>
                <td className="px-4 py-2">{curveLabel}</td>
                <td className="px-4 py-2">seeded curve, curated fit</td>
                <td className="px-4 py-2">
                  {curveSourceUrl ? (
                    <a href={curveSourceUrl} target="_blank" rel="noreferrer" className="underline">
                      {curveSourceName}
                    </a>
                  ) : (
                    curveSourceName
                  )}
                </td>
                <td className="px-4 py-2">adapted, not transcribed</td>
                <td className="px-4 py-2">-</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {floodSuppressed ? (
        <p data-testid="no-flood-line" className="border-t border-black/10 px-4 py-2 text-xs opacity-70 dark:border-white/15">
          No flood row at this scenario: neither water peril contributes, so there
          is no winning peril and no depth to attribute. At the 2025 origination
          position the horizon probability is zero, so this is expected.
        </p>
      ) : null}
    </section>
  );
}

export default ProvenancePanel;
