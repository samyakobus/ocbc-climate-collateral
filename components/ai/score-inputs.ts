/**
 * The popup's "inputs the score was formed from" list (S23, AC-17).
 *
 * Pure, and separate from the component, so the ordering and the formatting can
 * be walked by a unit test without a browser.
 *
 * Three things here are deliberate.
 *
 * **The order is explicit.** `score_inputs` is JSONB, and JSONB does not
 * preserve insertion order: Postgres stores object keys sorted by length and
 * then bytewise. Rendering `Object.entries()` therefore produced an order that
 * nobody chose and that could change when a key was renamed. The list below is
 * the reading order a risk manager wants, hazards first and denominators last.
 *
 * **`hazard_scores_by_type` is flattened.** It is a nested object of four
 * FRACTIONS, so `JSON.stringify` printed `{"flood":0.1644,...}` in a cell,
 * which is the single least readable thing on the panel and hides the fact that
 * 0.1644 means 16.44%. It becomes four labelled rows rendered as percentages.
 *
 * **Every row says whether the model saw it.** ADR-3 withholds the reference
 * index and its denominators from the prompt, and the panel is the fence around
 * the one LLM-assigned number in the product. A reader who cannot tell which
 * figures the model was shown cannot audit the score, so each row carries
 * `sentToModel`, taken from `PROMPT_PAYLOAD_KEYS` rather than written out again.
 */

import {
  HAZARD_TYPES,
  PROMPT_PAYLOAD_KEYS,
  type HazardType,
  type HotspotScoreInputs,
} from '@/lib/index/inputs';

export type ScoreInputRow = {
  /** Stable per row, and unique across the flattened hazard rows. */
  key: string;
  label: string;
  /** Already formatted for display. Never a JSON string. */
  value: string;
  /** False for the three fields ADR-3 keeps out of the prompt. */
  sentToModel: boolean;
};

const HAZARD_LABEL: Record<HazardType, string> = {
  flood: 'Flood',
  wind: 'Wind',
  heat: 'Heat',
  pm25: 'PM2.5',
};

/**
 * Friendly labels for the nine leaf names, which are also the `input_field`
 * enum a driver may name. The four hazards need these most: a driver that reads
 * "Pm25 raises" is a worse sentence than the model wrote.
 */
export const INPUT_FIELD_LABEL: Record<string, string> = {
  flood: 'Flood',
  wind: 'Wind',
  heat: 'Heat',
  pm25: 'PM2.5',
  exposure_sgd: 'Loan exposure',
  exposure_share: 'Share of the hotspot book',
  recent_event_count_90d: 'Events in the last 90 days',
  recent_event_severity_90d: 'Event severity, last 90 days',
  days_since_last_event: 'Days since the last event',
  max_event_severity: 'Highest event severity on record',
  worst_haircut_2050: 'Worst 2050 haircut in the hotspot',
  snapshot_max_exposure_sgd: 'Largest hotspot exposure in the snapshot',
  hazard_scores_by_type: 'Hazard scores',
};

export function inputFieldLabel(field: string): string {
  const known = INPUT_FIELD_LABEL[field];
  if (known) return known;
  const spaced = field.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Whole Singapore dollars, grouped. These are book figures, not chart labels. */
export function moneyExact(value: number): string {
  return `S$${Math.round(value).toLocaleString('en-SG')}`;
}

/** A stored fraction as a percentage. Two decimals, because 0.1644 is 16.44%. */
export function fractionAsPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function numberOrDash(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

const SENT = new Set<string>(PROMPT_PAYLOAD_KEYS);

/**
 * The stored record as an ordered list of display rows.
 *
 * Tolerant of a partial record on purpose: this renders whatever a row actually
 * holds, and a missing field is a dash rather than a crash. It is not the place
 * to enforce the shape; `lib/index/inputs.ts` owns that.
 */
export function scoreInputRows(inputs: Partial<HotspotScoreInputs> | null): ScoreInputRow[] {
  if (!inputs) return [];

  const rows: ScoreInputRow[] = [];
  const hazards = inputs.hazard_scores_by_type;

  for (const hazard of HAZARD_TYPES) {
    const value = hazards?.[hazard];
    rows.push({
      key: `hazard_${hazard}`,
      label: HAZARD_LABEL[hazard],
      value: typeof value === 'number' ? fractionAsPercent(value) : '-',
      sentToModel: SENT.has('hazard_scores_by_type'),
    });
  }

  rows.push({
    key: 'exposure_sgd',
    label: inputFieldLabel('exposure_sgd'),
    value: typeof inputs.exposure_sgd === 'number' ? moneyExact(inputs.exposure_sgd) : '-',
    sentToModel: SENT.has('exposure_sgd'),
  });

  rows.push({
    key: 'exposure_share',
    label: inputFieldLabel('exposure_share'),
    value:
      typeof inputs.exposure_share === 'number' ? fractionAsPercent(inputs.exposure_share) : '-',
    sentToModel: SENT.has('exposure_share'),
  });

  rows.push({
    key: 'recent_event_count_90d',
    label: inputFieldLabel('recent_event_count_90d'),
    value: numberOrDash(inputs.recent_event_count_90d ?? null, 0),
    sentToModel: SENT.has('recent_event_count_90d'),
  });

  rows.push({
    key: 'recent_event_severity_90d',
    label: inputFieldLabel('recent_event_severity_90d'),
    value: numberOrDash(inputs.recent_event_severity_90d ?? null, 2),
    sentToModel: SENT.has('recent_event_severity_90d'),
  });

  /*
    Null here is not zero and must never render as one. It means no event has
    EVER attached to this hotspot, which is the opposite reading of "0 days",
    and 400 km is a wide enough catchment that a genuinely quiet hotspot is a
    real state rather than a data gap.
  */
  rows.push({
    key: 'days_since_last_event',
    label: inputFieldLabel('days_since_last_event'),
    value:
      inputs.days_since_last_event === null || inputs.days_since_last_event === undefined
        ? 'no event on record'
        : numberOrDash(inputs.days_since_last_event, 0),
    sentToModel: SENT.has('days_since_last_event'),
  });

  rows.push({
    key: 'worst_haircut_2050',
    label: inputFieldLabel('worst_haircut_2050'),
    value:
      typeof inputs.worst_haircut_2050 === 'number'
        ? fractionAsPercent(inputs.worst_haircut_2050)
        : '-',
    sentToModel: SENT.has('worst_haircut_2050'),
  });

  rows.push({
    key: 'max_event_severity',
    label: inputFieldLabel('max_event_severity'),
    value: numberOrDash(inputs.max_event_severity ?? null, 2),
    sentToModel: SENT.has('max_event_severity'),
  });

  rows.push({
    key: 'snapshot_max_exposure_sgd',
    label: inputFieldLabel('snapshot_max_exposure_sgd'),
    value:
      typeof inputs.snapshot_max_exposure_sgd === 'number'
        ? moneyExact(inputs.snapshot_max_exposure_sgd)
        : '-',
    sentToModel: SENT.has('snapshot_max_exposure_sgd'),
  });

  return rows;
}
