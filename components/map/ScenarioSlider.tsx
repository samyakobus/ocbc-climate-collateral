'use client';

/**
 * The scenario slider (S16, AC-5).
 *
 * A controlled component: it owns no state, so the map and the slider cannot
 * disagree about which scenario is showing. The parent holds the value.
 *
 * Two ways to move it, because both are needed. The range input is the slider
 * the demo script asks for and it is what a keyboard reaches. The three tick
 * labels are buttons, so a presenter can jump straight to 2050 in one click
 * rather than dragging past 2030.
 */

import { SCENARIOS, indexOfScenario, labelOfScenario, type Scenario } from './scenario';

export type ScenarioSliderProps = {
  value: Scenario;
  onChange: (next: Scenario) => void;
  disabled?: boolean;
};

export function ScenarioSlider({ value, onChange, disabled = false }: ScenarioSliderProps) {
  const index = indexOfScenario(value);

  return (
    <div
      data-testid="scenario-slider"
      className="flex flex-col gap-1.5 rounded-md border border-black/10 bg-white/70 px-3 py-2 dark:border-white/15 dark:bg-black/50"
    >
      <label htmlFor="scenario-range" className="text-xs font-medium opacity-70">
        Scenario
      </label>

      <input
        id="scenario-range"
        type="range"
        min={0}
        max={SCENARIOS.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        aria-label="Scenario"
        aria-valuetext={labelOfScenario(value)}
        onChange={(event) => onChange(SCENARIOS[Number(event.target.value)].key)}
        className="w-56 accent-sky-600"
      />

      <div className="flex w-56 justify-between">
        {SCENARIOS.map((scenario) => {
          const selected = scenario.key === value;
          return (
            <button
              key={scenario.key}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              data-testid={`scenario-tick-${scenario.key}`}
              onClick={() => onChange(scenario.key)}
              className={
                'whitespace-nowrap rounded px-1 text-[11px] transition-opacity ' +
                (selected ? 'font-semibold opacity-100' : 'opacity-55 hover:opacity-90')
              }
            >
              {scenario.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ScenarioSlider;
