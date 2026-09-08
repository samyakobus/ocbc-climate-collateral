/**
 * Rendering helpers for the case screen (S14).
 *
 * Formatting only. Not one of these functions derives a credit figure: they
 * take a stored number and decide how it reads on screen. The distinction
 * matters because a director will ask where 6.6% comes from, and the answer has
 * to be "the stored column", not "the renderer".
 */

import type { Band } from '@/lib/rules/bands';

/** A stored fraction as a percentage, e.g. 0.066 -> "6.6%". */
export function percent(fraction: number, dp = 1): string {
  return `${(fraction * 100).toFixed(dp)}%`;
}

/** Percentage POINTS, the unit adaptation credits are stored in. */
export function points(pp: number, dp = 2): string {
  return `${pp.toFixed(dp)} pp`;
}

/** S$ with thousands separators and no cents. */
export function money(value: number): string {
  return `S$${Math.round(value).toLocaleString('en-SG')}`;
}

/** Enum-ish database values read badly on screen: `flood_riverine` -> "Flood riverine". */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const HAZARD_LABEL: Record<string, string> = {
  flood_riverine: 'Flood, riverine',
  flood_coastal: 'Flood, coastal',
  wind: 'Typhoon wind',
  heat_days35: 'Extreme heat',
  pm25: 'Chronic PM2.5',
};

export const BAND_TEXT: Record<Band, string> = {
  green: 'text-green-700 dark:text-green-400',
  amber: 'text-amber-700 dark:text-amber-400',
  orange: 'text-orange-700 dark:text-orange-400',
  red: 'text-red-700 dark:text-red-400',
};

export const BAND_CHIP: Record<Band, string> = {
  green: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  orange: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  red: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};

/**
 * What each coverage state means in one line.
 *
 * "Measured at 41 micrograms and not scored in Indonesia" is a different
 * statement from "no data here", and the schema keeps them apart (plan
 * principle 3). The screen has to keep them apart too.
 */
export const COVERAGE_LABEL: Record<string, string> = {
  scored: 'Scored',
  measured_not_scored: 'Measured, not scored',
  absent: 'No coverage',
};
