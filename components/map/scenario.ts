/**
 * The three scenario positions of the portfolio map slider (S16, AC-5).
 *
 * The keys are the `scenario` enum values stored in `hazard_samples.scenario`
 * and `valuations.scenario`, so the slider position and the stored row are the
 * same value rather than two things that have to be kept in step.
 *
 * The leftmost label is **"2025 (origination)"**, not "today" (ADR-5). The base
 * year is the origination year of every seeded loan, which is what makes the
 * horizon probability arithmetic clean, but the demo runs in September 2026, so
 * a position labelled "today" resolving to a past year invites the wrong
 * question from the room.
 */

export const SCENARIOS = [
  { key: 'today', label: '2025 (origination)', short: '2025' },
  { key: 'y2030', label: '2030', short: '2030' },
  { key: 'y2050', label: '2050', short: '2050' },
] as const;

export type Scenario = (typeof SCENARIOS)[number]['key'];

export const DEFAULT_SCENARIO: Scenario = 'today';

export function scenarioAt(index: number): Scenario {
  const clamped = Math.min(Math.max(index, 0), SCENARIOS.length - 1);
  return SCENARIOS[clamped].key;
}

export function indexOfScenario(scenario: Scenario): number {
  const index = SCENARIOS.findIndex((s) => s.key === scenario);
  return index === -1 ? 0 : index;
}

export function labelOfScenario(scenario: Scenario): string {
  return SCENARIOS[indexOfScenario(scenario)].label;
}
