/**
 * HaircutBreakdown (S14, AC-4, AC-12).
 *
 * Three things this file holds:
 *
 *   * every factor names the dataset it came from, so the panel answers "where
 *     does this number come from" on the screen rather than in a document;
 *   * the heat line carries its borrowed-elasticity chip and the flood line its
 *     curated-fit label, because both are honesty labels the plan requires;
 *   * a sample that policy excludes renders its measured value AND the reason,
 *     while contributing zero. "Measured at 41 micrograms and not scored in
 *     Indonesia" is a different statement from "no data here".
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HaircutBreakdown } from '@/components/case/HaircutBreakdown';
import type { CaseSample, CaseValuation } from '@/app/(app)/cases/queries';

function sample(over: Partial<CaseSample> & { hazard: string }): CaseSample {
  return {
    value: 0,
    coverage: 'scored',
    unit: 'm',
    dataset_name: 'dataset',
    dataset_version: 'v1',
    pathway: null,
    return_period_yrs: null,
    sampled_at: '2026-09-07',
    scenario_invariant: false,
    applicability_reason: null,
    applicability_url: null,
    ...over,
  };
}

/** The realistic Singapore case of plan 4.3.2 at 2050: flood 6.6% plus heat 3.5%. */
const REALISTIC: CaseValuation = {
  scenario: 'y2050',
  winning_peril: 'flood_coastal',
  depth_m: 0.5,
  damage_fraction: 0.3,
  flood_haircut_gross: 0.066,
  adaptation_credit_documented_pp: 0,
  adaptation_credit_effective_pp: 0,
  flood_haircut: 0.066,
  wind_haircut: 0,
  heat_haircut: 0.035,
  pm25_haircut: 0,
  chronic_haircut: 0.035,
  total_haircut: 0.101,
  adjusted_value_sgd: 899_000,
  band: 'orange',
  ltv_applied: 0.75,
  max_loan_sgd: 674_250,
};

const SAMPLES: CaseSample[] = [
  sample({
    hazard: 'flood_coastal',
    value: 0.5,
    dataset_name: 'Aqueduct Floods v2 coastal-wtsub',
    dataset_version: 'v2 / ens-mean / slr-p50',
    pathway: 'rcp8p5',
    return_period_yrs: 100,
  }),
  sample({ hazard: 'wind', value: null, coverage: 'absent', unit: 'm/s', dataset_name: 'STORM v4' }),
  sample({
    hazard: 'heat_days35',
    value: 28,
    unit: 'days/yr',
    dataset_name: 'NEX-GDDP-CMIP6 vs ERA5-Land',
    pathway: 'ssp585',
  }),
  sample({
    hazard: 'pm25',
    value: 16.6,
    coverage: 'measured_not_scored',
    unit: 'ug/m3',
    dataset_name: 'GHAP PM2.5 annual mean',
    scenario_invariant: true,
    applicability_reason: 'Not scored in Singapore: no local hedonic evidence.',
    applicability_url: 'https://example.org/applicability',
  }),
];

function renderBreakdown(valuation: CaseValuation = REALISTIC, samples = SAMPLES) {
  return render(
    <HaircutBreakdown
      valuation={valuation}
      samples={samples}
      appraisedValueSgd={1_000_000}
      curveLabel="JRC Asia residential"
      curveSourceName="Huizinga et al. 2017"
    />,
  );
}

describe('every factor names its dataset', () => {
  it('renders one row per scored and measured factor', () => {
    renderBreakdown();
    for (const key of ['flood', 'wind', 'heat', 'pm25']) {
      expect(screen.getByTestId(`breakdown-row-${key}`)).toBeInTheDocument();
    }
  });

  it('shows the dataset name on the flood, heat and PM2.5 rows', () => {
    renderBreakdown();
    expect(screen.getByTestId('breakdown-row-flood')).toHaveTextContent('Aqueduct Floods v2');
    expect(screen.getByTestId('breakdown-row-heat')).toHaveTextContent('NEX-GDDP-CMIP6');
    expect(screen.getByTestId('breakdown-row-pm25')).toHaveTextContent('GHAP PM2.5');
  });
});

describe('the honesty labels are on screen, not in a document', () => {
  it('chips the heat line as a borrowed elasticity', () => {
    renderBreakdown();
    const chip = screen.getByTestId('borrowed-elasticity-chip');
    expect(chip).toHaveTextContent(/borrowed elasticity/i);
    expect(chip).toHaveTextContent(/Kang et al\. 2024/);
    expect(within(screen.getByTestId('breakdown-row-heat')).getByTestId('borrowed-elasticity-chip'))
      .toBeInTheDocument();
  });

  it('labels the curve a curated fit rather than a transcription', () => {
    renderBreakdown();
    const chip = screen.getByTestId('curve-chip');
    expect(chip).toHaveTextContent(/curated fit/i);
    expect(chip).toHaveTextContent('JRC Asia residential');
  });
});

describe('coverage states are kept apart', () => {
  it('renders a measured-but-not-scored value with its reason', () => {
    renderBreakdown();
    const row = screen.getByTestId('breakdown-row-pm25');
    expect(row).toHaveTextContent('16.6');
    expect(row).toHaveTextContent(/measured, not scored/i);
    expect(row).toHaveTextContent(/no local hedonic evidence/i);
    expect(row).toHaveTextContent(/contributes 0/i);
  });

  it('renders an absent factor as no coverage, never as a zero measurement', () => {
    renderBreakdown();
    const row = screen.getByTestId('breakdown-row-wind');
    expect(row).toHaveTextContent(/no coverage/i);
    expect(row).not.toHaveTextContent(/0 m\/s/);
  });

  it('gives both excluded factors a zero haircut', () => {
    renderBreakdown();
    expect(screen.getByTestId('breakdown-row-wind')).toHaveTextContent('0.0%');
    expect(screen.getByTestId('breakdown-row-pm25')).toHaveTextContent('0.0%');
  });
});

describe('the totals are the stored ones', () => {
  it('renders the stored total, band, adjusted value and maximum loan', () => {
    renderBreakdown();
    expect(screen.getByTestId('total-haircut')).toHaveTextContent('10.1%');
    expect(screen.getByTestId('case-band')).toHaveAttribute('data-band', 'orange');
    expect(screen.getByTestId('adjusted-value')).toHaveTextContent('899,000');
    expect(screen.getByTestId('max-loan')).toHaveTextContent('674,250');
  });

  it('renders the stored chronic subtotal rather than adding the parts', () => {
    /* heat 3.5 plus pm25 0.0 happens to be 3.5 here, but the row must come from
       chronic_haircut: the 5% cap means the sum and the stored value diverge. */
    renderBreakdown({ ...REALISTIC, heat_haircut: 0.075, pm25_haircut: 0.02, chronic_haircut: 0.05 });
    expect(screen.getByTestId('chronic-subtotal')).toHaveTextContent('5.0%');
  });
});

describe('when neither water peril contributes', () => {
  const noFlood: CaseValuation = {
    ...REALISTIC,
    winning_peril: null,
    depth_m: null,
    damage_fraction: null,
    flood_haircut_gross: 0,
    flood_haircut: 0,
    heat_haircut: 0,
    chronic_haircut: 0,
    total_haircut: 0,
    band: 'green',
  };

  it('names no peril and shows no depth', () => {
    renderBreakdown(noFlood);
    const row = screen.getByTestId('breakdown-row-flood');
    expect(row).toHaveTextContent(/neither water peril contributes/i);
    expect(row).not.toHaveTextContent(/depth/i);
  });

  it('drops the curve chip, since no curve was evaluated', () => {
    renderBreakdown(noFlood);
    expect(screen.queryByTestId('curve-chip')).toBeNull();
  });
});
