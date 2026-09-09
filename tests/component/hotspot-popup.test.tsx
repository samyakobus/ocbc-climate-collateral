/**
 * The hotspot popup's score section and input list (S23, AC-15, AC-17).
 *
 * Three things are asserted here that an end-to-end spec cannot reach cheaply,
 * because each needs a hotspot row constructed to order rather than whichever
 * one the seed produced.
 *
 * 1. The badge comes from `scoreDisplay()` and therefore agrees with the stored
 *    `divergence_flag` on every one of the 100 possible scores. The component
 *    is given rows on both sides of the 25-point boundary, and one where
 *    `score_validated` is false while `score_fallback` is not, which the
 *    previous implementation rendered as a clean model score.
 * 2. The input list is ordered explicitly and formatted, never a JSON string.
 *    `hazard_scores_by_type` arrives as four fractions and must read as four
 *    labelled percentages.
 * 3. `days_since_last_event: null` means no event has ever attached, not zero.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HotspotPopup } from '@/components/ai/HotspotPopup';
import { scoreInputRows } from '@/components/ai/score-inputs';
import type { Hotspot } from '@/app/(app)/ai/queries';
import type { HotspotScoreInputs } from '@/lib/index/inputs';

const INPUTS: HotspotScoreInputs = {
  hazard_scores_by_type: { flood: 0.1644, wind: 0.06, heat: 0.032, pm25: 0 },
  exposure_sgd: 196_200_000,
  exposure_share: 0.1661,
  recent_event_count_90d: 3,
  recent_event_severity_90d: 1.5,
  days_since_last_event: 12,
  max_event_severity: 2,
  worst_haircut_2050: 0.2137,
  snapshot_max_exposure_sgd: 196_200_000,
};

function hotspot(over: Partial<Hotspot> = {}): Hotspot {
  return {
    id: 'HS-MY-KLANG',
    name: 'Klang Valley',
    country: 'MY',
    hazard_type: 'flood',
    summary: 'Riverine flood exposure across the Klang basin.',
    lon: 101.6,
    lat: 3.1,
    radius_m: 18_000,
    has_polygon: false,
    loan_exposure_sgd: 196_200_000,
    exposure_share: 0.1661,
    reference_index: 44,
    llm_score: null,
    llm_drivers: [],
    llm_rationale: null,
    model: null,
    scored_at: null,
    score_source: null,
    score_validated: false,
    score_fallback: true,
    divergence_flag: false,
    score_inputs: INPUTS,
    ...over,
  };
}

function renderPopup(over: Partial<Hotspot> = {}) {
  const one = hotspot(over);
  render(
    <HotspotPopup hotspot={one} hotspots={[one]} onSelect={() => {}} onClose={() => {}} />,
  );
  return one;
}

describe('the score section reads from the shared decision', () => {
  it('shows the reference index with a fallback badge when no model score is stored', () => {
    renderPopup();
    expect(screen.getByTestId('score-badges')).toHaveAttribute('data-state', 'fallback');
    expect(screen.getByTestId('badge-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('score-value')).toHaveTextContent('44');
    /* This is the expected state on a machine with no API key, so the panel
       has to say that rather than leave it looking like a failure. */
    expect(screen.getByTestId('score-fallback-note')).toBeInTheDocument();
  });

  it('shows the model score with no badge when it agrees with the reference', () => {
    renderPopup({
      llm_score: 60,
      reference_index: 50,
      score_fallback: false,
      score_validated: true,
      model: 'claude-fable-5-1',
    });
    expect(screen.getByTestId('score-badges')).toHaveAttribute('data-state', 'model');
    expect(screen.queryByTestId('badge-divergence')).toBeNull();
    expect(screen.queryByTestId('badge-fallback')).toBeNull();
    expect(screen.getByTestId('score-value')).toHaveTextContent('60');
    expect(screen.getByTestId('reference-index')).toHaveTextContent('50');
  });

  it('raises nothing at a gap of exactly 25 and diverges at 26', () => {
    const base = {
      reference_index: 50,
      score_fallback: false,
      score_validated: true,
    } as const;

    const { unmount } = render(
      <HotspotPopup
        hotspot={hotspot({ ...base, llm_score: 75 })}
        hotspots={[]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('score-badges')).toHaveAttribute('data-state', 'model');
    unmount();

    renderPopup({ ...base, llm_score: 76 });
    expect(screen.getByTestId('score-badges')).toHaveAttribute('data-state', 'divergent');
    expect(screen.getByTestId('badge-divergence')).toBeInTheDocument();
    expect(screen.getByTestId('score-divergence')).toHaveTextContent('26');
  });

  it('treats a score that failed validation as a fallback, not as a model result', () => {
    /* The regression this pins: an implementation reading only `score_fallback`
       and `divergence_flag` shows this row as a clean model score. */
    renderPopup({
      llm_score: 88,
      reference_index: 44,
      score_fallback: false,
      score_validated: false,
    });
    expect(screen.getByTestId('score-badges')).toHaveAttribute('data-state', 'fallback');
    expect(screen.getByTestId('score-value')).toHaveTextContent('44');
  });

  it('says "not yet scored" rather than "fallback" when there is no reference either', () => {
    renderPopup({ llm_score: null, reference_index: null, score_inputs: null });
    expect(screen.getByTestId('score-badges')).toHaveAttribute('data-state', 'unscored');
    expect(screen.getByTestId('badge-unscored')).toBeInTheDocument();
    expect(screen.getByTestId('hotspot-inputs-empty')).toBeInTheDocument();
  });
});

describe('the input list is ordered and formatted, never a JSON string', () => {
  it('lists the four hazards first, as percentages', () => {
    renderPopup();
    const list = screen.getByTestId('hotspot-inputs');

    expect(list.textContent).not.toContain('{');
    expect(list.textContent).not.toContain('hazard_scores_by_type');

    for (const [key, label, value] of [
      ['hazard_flood', 'Flood', '16.44%'],
      ['hazard_wind', 'Wind', '6.00%'],
      ['hazard_heat', 'Heat', '3.20%'],
      ['hazard_pm25', 'PM2.5', '0.00%'],
    ] as const) {
      expect(screen.getByTestId(`hotspot-input-${key}`)).toHaveTextContent(label);
      expect(list).toHaveTextContent(value);
    }
  });

  it('renders the rows in the order the module fixes, not JSONB key order', () => {
    renderPopup();
    const expected = scoreInputRows(INPUTS).map((row) => row.key);
    const rendered = Array.from(
      screen.getByTestId('hotspot-inputs').querySelectorAll('[data-testid^="hotspot-input-"]'),
    ).map((node) => node.getAttribute('data-testid')!.replace('hotspot-input-', ''));

    expect(rendered).toEqual(expected);
    expect(rendered.slice(0, 4)).toEqual([
      'hazard_flood',
      'hazard_wind',
      'hazard_heat',
      'hazard_pm25',
    ]);
  });

  it('renders exposure in whole dollars and the two shares as percentages', () => {
    renderPopup();
    const list = screen.getByTestId('hotspot-inputs');
    expect(list).toHaveTextContent('S$196,200,000');
    expect(list).toHaveTextContent('16.61%');
    expect(list).toHaveTextContent('21.37%');
  });

  it('says no event is on record rather than printing zero days', () => {
    renderPopup({ score_inputs: { ...INPUTS, days_since_last_event: null } });
    const row = screen.getByTestId('hotspot-input-days_since_last_event').parentElement!;
    expect(within(row).getByText('no event on record')).toBeInTheDocument();
  });

  it('marks the three fields ADR-3 withholds from the prompt', () => {
    renderPopup();
    for (const key of ['worst_haircut_2050', 'max_event_severity', 'snapshot_max_exposure_sgd']) {
      expect(screen.getByTestId(`hotspot-input-${key}`)).toHaveAttribute(
        'data-sent-to-model',
        'false',
      );
    }
    for (const key of ['hazard_flood', 'exposure_sgd', 'days_since_last_event']) {
      expect(screen.getByTestId(`hotspot-input-${key}`)).toHaveAttribute(
        'data-sent-to-model',
        'true',
      );
    }
  });
});

describe('drivers read as prose', () => {
  it('gives the four hazard leaves friendly labels', () => {
    renderPopup({
      llm_score: 60,
      reference_index: 50,
      score_fallback: false,
      score_validated: true,
      llm_drivers: [
        { input_field: 'pm25', direction: 'raises', note: 'annual mean well above the regional median' },
        { input_field: 'exposure_share', direction: 'lowers', note: 'a small share of the book' },
      ],
    });
    const drivers = screen.getByTestId('hotspot-drivers');
    expect(drivers).toHaveTextContent('PM2.5');
    expect(drivers).not.toHaveTextContent('Pm25');
    expect(drivers).toHaveTextContent('Share of the hotspot book');
  });
});
