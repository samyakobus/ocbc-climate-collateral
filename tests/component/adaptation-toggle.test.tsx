/**
 * AdaptationToggle (S14, AC-3, ADR-4).
 *
 * The toggle is a per-case preview over two figures the valuation row already
 * stores, so this file pins that it switches between them, names the project and
 * links its source, and shows the documented and effective credits side by side.
 *
 * The zero floor is the case that matters most. `SG-EC-003` carries a documented
 * 3.00 pp against a 2.64% gross haircut, so the credit actually bought 2.64 pp
 * and the net is zero. Showing only the documented figure would overstate what
 * the credit did, which is exactly the misreading ADR-4 was written to prevent.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AdaptationToggle } from '@/components/case/AdaptationToggle';
import type { CaseAdaptation, CaseValuation } from '@/app/(app)/cases/queries';

function valuation(over: Partial<CaseValuation> = {}): CaseValuation {
  return {
    scenario: 'y2050',
    winning_peril: 'flood_coastal',
    depth_m: 0.8,
    damage_fraction: 0.42,
    flood_haircut_gross: 0.0924,
    adaptation_credit_documented_pp: 1.5,
    adaptation_credit_effective_pp: 1.5,
    flood_haircut: 0.0774,
    wind_haircut: 0,
    heat_haircut: 0,
    pm25_haircut: 0,
    chronic_haircut: 0,
    total_haircut: 0.0774,
    adjusted_value_sgd: 1_107_120,
    band: 'amber',
    ltv_applied: 0.75,
    max_loan_sgd: 830_340,
    ...over,
  };
}

const MARINA_BARRAGE: CaseAdaptation = {
  id: 'sg-marina-barrage',
  name: 'Marina Barrage catchment',
  haircut_credit_pp: 1.5,
  protection_return_period: 100,
  source_name: 'PUB',
  source_url: 'https://www.pub.gov.sg/marinabarrage',
};

describe('the AC-3 preview', () => {
  it('names the project and links its source', () => {
    render(<AdaptationToggle valuation={valuation()} adaptation={MARINA_BARRAGE} />);
    expect(screen.getByTestId('adaptation-name')).toHaveTextContent('Marina Barrage catchment');
    const link = screen.getByTestId('adaptation-source');
    expect(link).toHaveTextContent('PUB');
    expect(link).toHaveAttribute('href', 'https://www.pub.gov.sg/marinabarrage');
  });

  it('starts with the credit applied and shows the net flood haircut', () => {
    render(<AdaptationToggle valuation={valuation()} adaptation={MARINA_BARRAGE} />);
    expect(screen.getByTestId('adaptation-checkbox')).toBeChecked();
    expect(screen.getByTestId('adaptation-flood-haircut')).toHaveTextContent('7.74%');
  });

  it('switches to the gross haircut when the credit is turned off', async () => {
    const user = userEvent.setup();
    render(<AdaptationToggle valuation={valuation()} adaptation={MARINA_BARRAGE} />);

    await user.click(screen.getByTestId('adaptation-checkbox'));

    expect(screen.getByTestId('adaptation-flood-haircut')).toHaveTextContent('9.24%');
  });

  it('shows the documented and effective credits side by side', () => {
    render(<AdaptationToggle valuation={valuation()} adaptation={MARINA_BARRAGE} />);
    expect(screen.getByTestId('adaptation-documented')).toHaveTextContent('1.50 pp');
    expect(screen.getByTestId('adaptation-effective')).toHaveTextContent('1.50 pp');
  });

  it('says that it writes nothing', () => {
    render(<AdaptationToggle valuation={valuation()} adaptation={MARINA_BARRAGE} />);
    expect(screen.getByTestId('adaptation-panel')).toHaveTextContent(/preview only/i);
  });
});

describe('the ADR-4 zero floor, SG-EC-003', () => {
  const LONG_ISLAND: CaseAdaptation = {
    id: 'sg-long-island',
    name: 'Long Island / City-East Coast coastal protection',
    haircut_credit_pp: 3,
    protection_return_period: 100,
    source_name: 'PUB / NCCS Coastal Protection',
    source_url: 'https://www.nccs.gov.sg/coastal-protection',
  };

  /* Gross 2.64%, documented 3.00 pp, effective 2.64 pp, net 0. */
  const floored = valuation({
    depth_m: 0.2,
    damage_fraction: 0.12,
    flood_haircut_gross: 0.0264,
    adaptation_credit_documented_pp: 3,
    adaptation_credit_effective_pp: 2.64,
    flood_haircut: 0,
    total_haircut: 0,
    band: 'green',
  });

  it('renders a net flood haircut of zero with the credit applied', () => {
    render(<AdaptationToggle valuation={floored} adaptation={LONG_ISLAND} />);
    expect(screen.getByTestId('adaptation-flood-haircut')).toHaveTextContent('0.00%');
  });

  it('keeps the documented and effective credits distinct', () => {
    render(<AdaptationToggle valuation={floored} adaptation={LONG_ISLAND} />);
    expect(screen.getByTestId('adaptation-documented')).toHaveTextContent('3.00 pp');
    expect(screen.getByTestId('adaptation-effective')).toHaveTextContent('2.64 pp');
  });

  it('explains that a credit cannot give back more than the hazard took', () => {
    render(<AdaptationToggle valuation={floored} adaptation={LONG_ISLAND} />);
    const note = screen.getByTestId('adaptation-floored');
    expect(note).toHaveTextContent(/zero floor/i);
    expect(note).toHaveTextContent('2.64');
    expect(note).toHaveTextContent('3.00');
  });

  it('still reveals the gross haircut when the credit is turned off', async () => {
    const user = userEvent.setup();
    render(<AdaptationToggle valuation={floored} adaptation={LONG_ISLAND} />);

    await user.click(screen.getByTestId('adaptation-checkbox'));

    expect(screen.getByTestId('adaptation-flood-haircut')).toHaveTextContent('2.64%');
  });
});

describe('a case with no adaptation project', () => {
  it('says so, and offers no toggle', () => {
    render(<AdaptationToggle valuation={valuation()} adaptation={null} />);
    expect(screen.getByTestId('adaptation-panel')).toHaveTextContent(
      /no adaptation project is recorded/i,
    );
    expect(screen.queryByTestId('adaptation-checkbox')).toBeNull();
  });

  it('does not show the floored explanation', () => {
    render(<AdaptationToggle valuation={valuation()} adaptation={null} />);
    expect(screen.queryByTestId('adaptation-floored')).toBeNull();
  });
});
