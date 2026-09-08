/**
 * ScenarioSlider (S16, AC-5).
 *
 * The slider is the control the demo script drives on stage, so the two things
 * pinned hardest here are the leftmost label and the value it emits. ADR-5 fixes
 * the label as "2025 (origination)" rather than "today": the stored enum value
 * is `today`, the rendered text is not, and a regression that leaks the enum
 * onto the screen would put a position labelled "today" on a past year in front
 * of the room.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

import { ScenarioSlider } from '@/components/map/ScenarioSlider';
import { SCENARIOS, indexOfScenario, labelOfScenario } from '@/components/map/scenario';

describe('ScenarioSlider', () => {
  it('offers exactly the three scenario positions', () => {
    render(<ScenarioSlider value="today" onChange={() => {}} />);

    const slider = screen.getByRole('slider', { name: 'Scenario' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '2');
    expect(SCENARIOS).toHaveLength(3);
  });

  it('labels the leftmost position "2025 (origination)", never "today"', () => {
    render(<ScenarioSlider value="today" onChange={() => {}} />);

    expect(screen.getByTestId('scenario-tick-today')).toHaveTextContent('2025 (origination)');
    expect(screen.getByTestId('scenario-slider')).not.toHaveTextContent(/\btoday\b/i);
  });

  it('renders the 2030 and 2050 labels', () => {
    render(<ScenarioSlider value="today" onChange={() => {}} />);

    expect(screen.getByTestId('scenario-tick-y2030')).toHaveTextContent('2030');
    expect(screen.getByTestId('scenario-tick-y2050')).toHaveTextContent('2050');
  });

  it('reflects the current value on the range input and in aria-valuetext', () => {
    const { rerender } = render(<ScenarioSlider value="today" onChange={() => {}} />);
    const slider = () => screen.getByRole('slider', { name: 'Scenario' });

    expect(slider()).toHaveValue('0');
    expect(slider()).toHaveAttribute('aria-valuetext', '2025 (origination)');

    rerender(<ScenarioSlider value="y2050" onChange={() => {}} />);
    expect(slider()).toHaveValue('2');
    expect(slider()).toHaveAttribute('aria-valuetext', '2050');
  });

  it('emits the stored enum value when the range moves', () => {
    const onChange = vi.fn();
    render(<ScenarioSlider value="today" onChange={onChange} />);

    fireEvent.change(screen.getByRole('slider', { name: 'Scenario' }), {
      target: { value: '1' },
    });
    expect(onChange).toHaveBeenCalledWith('y2030');

    fireEvent.change(screen.getByRole('slider', { name: 'Scenario' }), {
      target: { value: '2' },
    });
    expect(onChange).toHaveBeenCalledWith('y2050');
  });

  it('jumps straight to a scenario when its tick label is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScenarioSlider value="today" onChange={onChange} />);

    await user.click(screen.getByTestId('scenario-tick-y2050'));
    expect(onChange).toHaveBeenCalledWith('y2050');
  });

  it('marks only the selected tick as pressed', () => {
    render(<ScenarioSlider value="y2030" onChange={() => {}} />);

    expect(screen.getByTestId('scenario-tick-today')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('scenario-tick-y2030')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scenario-tick-y2050')).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits nothing while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ScenarioSlider value="today" onChange={onChange} disabled />);

    await user.click(screen.getByTestId('scenario-tick-y2050'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('slider', { name: 'Scenario' })).toBeDisabled();
  });
});

describe('scenario helpers', () => {
  it('maps every key to its index and back', () => {
    for (const [index, scenario] of SCENARIOS.entries()) {
      expect(indexOfScenario(scenario.key)).toBe(index);
      expect(labelOfScenario(scenario.key)).toBe(scenario.label);
    }
  });

  it('uses the scenario enum values the database stores', () => {
    expect(SCENARIOS.map((s) => s.key)).toEqual(['today', 'y2030', 'y2050']);
  });
});
