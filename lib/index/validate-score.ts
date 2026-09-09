/**
 * The only enforcement of the hotspot score contract (plan 4.5, AC-17).
 *
 * THE TOOL SCHEMA IS ADVISORY. The Messages API does not reject a tool input
 * that violates `minimum`, `maxItems` or `additionalProperties`; it is a
 * statement of intent to the model, not a gate. Everything that must hold about
 * a stored score is checked here, and a score that fails is never written: the
 * row falls back to `reference_index` with a fallback badge.
 *
 * Pure. No client, no database, no environment, no clock. `score-validate.test.ts`
 * runs the whole of it in the no-database unit project.
 *
 * THE CITATION TOLERANCE LIVES HERE and is shared, per plan 4.5, with
 * `lib/narrative/validate.ts`: case narratives quote LTVs and haircuts exactly
 * the way a rationale quotes an exposure share, and two implementations of one
 * rule would drift within a day.
 */

import { INPUT_FIELD_VALUES, type InputField } from '@/lib/index/inputs';

/* ------------------------------------------------------------------ *
 * The validated shape
 * ------------------------------------------------------------------ */

export const DRIVER_DIRECTIONS = ['raises', 'lowers'] as const;

export type DriverDirection = (typeof DRIVER_DIRECTIONS)[number];

export type ScoreDriver = {
  input_field: InputField;
  direction: DriverDirection;
  note: string;
};

export type ValidatedScore = {
  score: number;
  drivers: ScoreDriver[];
  rationale: string;
};

/** Bounds, written once and reused by the tool schema so the two cannot drift. */
export const SCORE_BOUNDS = { min: 1, max: 100 } as const;
export const DRIVER_BOUNDS = { min: 1, max: 5, noteMaxLength: 120 } as const;
export const RATIONALE_BOUNDS = { min: 40, max: 600 } as const;

/** Why a candidate was refused. The reason is stored nowhere but is logged and tested. */
export type ScoreRejection =
  | { code: 'not_an_object'; detail: string }
  | { code: 'score_not_integer'; detail: string }
  | { code: 'score_out_of_range'; detail: string }
  | { code: 'drivers_not_array'; detail: string }
  | { code: 'drivers_count'; detail: string }
  | { code: 'driver_shape'; detail: string }
  | { code: 'unknown_input_field'; detail: string }
  | { code: 'rationale_empty'; detail: string }
  | { code: 'rationale_length'; detail: string }
  | { code: 'uncited_number'; detail: string };

export type ScoreValidation =
  | { ok: true; value: ValidatedScore }
  | { ok: false; rejection: ScoreRejection };

/* ------------------------------------------------------------------ *
 * Citation tolerance (plan 4.5)
 * ------------------------------------------------------------------ */

/**
 * A numeric token, as written.
 *
 * `value` is the token read as a number with its magnitude suffix applied, so
 * `128.4m` arrives as 128,400,000 and matching never has to know how a model
 * chose to abbreviate.
 */
export type NumericToken = {
  raw: string;
  value: number;
  isPercent: boolean;
  /** The suffix multiplier the model used (1 when none): `17.87 million` -> 1e6. */
  magnitude: number;
  /** Decimal places written on the number itself: `17.87` -> 2, `196` -> 0. */
  decimals: number;
  /** Up to 24 characters before the token, for the bare-integer exemptions. */
  before: string;
  /** Up to 16 characters after it. */
  after: string;
};

const MAGNITUDES: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
};

/*
  A currency prefix, a number with optional thousands separators, and an
  optional unit. The unit alternatives are guarded by a letter lookahead so the
  `m` of "3 months" is not read as a million, which would turn a perfectly
  cited sentence into a rejection nobody could explain.
*/
const NUMERIC_TOKEN =
  /(?:S\$|SGD\s*|\$)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|percent|per cent|thousand|million|billion|bn|m|k)?(?![a-z])/gi;

/** Every number written in a piece of prose, with the context around it. */
export function numericTokens(text: string): NumericToken[] {
  const normalised = text.replace(/ /g, ' ');
  const tokens: NumericToken[] = [];

  for (const match of normalised.matchAll(NUMERIC_TOKEN)) {
    const digits = match[1].replace(/,/g, '');
    const unit = (match[2] ?? '').toLowerCase();
    const base = Number(digits);
    if (!Number.isFinite(base)) continue;

    /*
      Digits inside an IDENTIFIER are not a figure. `SG-KB-003`, `LA-039` and
      `PM2.5` all carry digits that cite nothing and never could, and reading
      them as numbers rejects the rule text itself, which names the collateral
      it is about. The test is positional: a digit run touching a letter, or
      hanging off a hyphen that touches one, belongs to a name.
    */
    const digitStart = (match.index ?? 0) + match[0].indexOf(match[1]);
    const previous = normalised[digitStart - 1] ?? '';
    const beforeThat = normalised[digitStart - 2] ?? '';
    if (/[A-Za-z]/.test(previous)) continue;
    if (previous === '-' && /[A-Za-z0-9]/.test(beforeThat)) continue;

    const isPercent = unit === '%' || unit === 'percent' || unit === 'per cent';
    const magnitude = MAGNITUDES[unit] ?? 1;
    const start = match.index ?? 0;

    tokens.push({
      raw: match[0].trim(),
      value: base * magnitude,
      isPercent,
      magnitude,
      decimals: digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0,
      before: normalised.slice(Math.max(0, start - 24), start),
      after: normalised.slice(start + match[0].length, start + match[0].length + 16),
    });
  }

  return tokens;
}

/** `v` rounded to `digits` significant figures. */
function roundSignificant(value: number, digits: number): number {
  if (value === 0) return 0;
  return Number(value.toPrecision(digits));
}

function nearlyEqual(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-9;
}

/**
 * Does `token` cite `value`?
 *
 * Three renderings are accepted, exactly as plan 4.5 defines them:
 *   - the value itself, or the value rounded to 1, 2 or 3 significant figures;
 *   - a PERCENT rendering, where the token carries a percent sign or the word
 *     "percent" and reads 100 times the value, so `18%`, `18 %`, `18.0%` and
 *     `18 percent` all cite an `exposure_share` of 0.18. Without this rule the
 *     most natural sentence a model can write about a share is rejected, both
 *     retries fail the same way, and every hotspot on the dashboard that opens
 *     the demo falls to fallback;
 *   - a MAGNITUDE rendering, so `S$128.4m`, `S$128 million` and `128,400,000`
 *     all cite 128,400,000. The suffix is applied during tokenisation, and the
 *     significant-figure rule then absorbs `S$128 million`.
 */
export function tokenCites(token: NumericToken, value: number): boolean {
  const target = token.isPercent ? value * 100 : value;

  if (nearlyEqual(token.value, target)) return true;

  for (const digits of [1, 2, 3]) {
    if (nearlyEqual(token.value, roundSignificant(target, digits))) return true;
  }

  /*
    A rendering at a fixed number of DECIMAL places, which is what every screen
    in this application actually does: money to the nearest dollar, a percentage
    to one place. S$1,117,968.75 renders as "S$1,117,969", and significant
    figures alone reject that, because three of them is S$1,120,000. The stored
    value is the same value; only the presentation rounded it.
  */
  for (const places of [0, 1, 2, 3]) {
    if (nearlyEqual(token.value, Number(target.toFixed(places)))) return true;
  }

  /*
    A rendering at the model's OWN magnitude and precision. "SGD 17.87 million"
    is 17,866,000 shown in millions to two places, and "S$196.2m" is
    196,223,000 in millions to one place. Neither is 1, 2 or 3 significant
    figures of the value, and neither is a fixed-decimal rendering of the full
    figure, so both were rejected on the first live run (2026-09-09) and two
    hotspots fell back for abbreviating a number the way every analyst does.
    The check is exact for the digits the model wrote: the value scaled to the
    suffix and rounded to the written decimals must read back as the token.
  */
  if (token.magnitude > 1) {
    const scaled = Number((target / token.magnitude).toFixed(token.decimals));
    if (nearlyEqual(token.value, scaled * token.magnitude)) return true;
  }

  return false;
}

/**
 * Numbers a rationale may use without citing an input.
 *
 * Exempt, per plan 4.5: four-digit years 1900-2100; a bare integer 1-100 when
 * it is immediately preceded by "score", "index" or "band" or immediately
 * followed by "out of 100"; and the window length that is part of a field's own
 * NAME.
 *
 * That last one is an addition to the plan's list, and it is deliberate. The
 * model is shown a field called `recent_event_count_90d`, so the natural
 * sentence is "no events in the last 90 days"; without the exemption that
 * sentence is rejected as an uncited 90 and the hotspot falls to fallback for
 * quoting its own field name back. The number is on the screen, which is the
 * standard AC-10 and AC-17 actually set. Ordinals written as words are exempt by
 * construction: they carry no digits and are never tokenised.
 */
const FIELD_NAME_NUMBERS: readonly number[] = [90];

const SCORE_WORD_BEFORE = /(?:score|index|band)s?\s*(?:of|is|at|was|=|:|-)?\s*$/i;
const OUT_OF_HUNDRED_AFTER = /^\s*(?:out of 100|\/\s*100)/i;
/* The denominator of the phrase above. "62 out of 100" exempts the 62 by the
   rule the plan writes, and then the 100 is itself a bare integer standing next
   to nothing; without this the exemption rejects the sentence it exists to
   allow. */
const OUT_OF_BEFORE = /\bout of\s*$/i;

export function isExemptToken(token: NumericToken): boolean {
  const isInteger = Number.isInteger(token.value) && !token.isPercent;

  /* Years. `2050` and `2030` are the two scenario labels and appear constantly. */
  if (isInteger && token.value >= 1900 && token.value <= 2100 && /^\d{4}$/.test(token.raw)) {
    return true;
  }

  if (isInteger && FIELD_NAME_NUMBERS.includes(token.value)) return true;

  if (isInteger && token.value >= 1 && token.value <= 100) {
    if (SCORE_WORD_BEFORE.test(token.before)) return true;
    if (OUT_OF_HUNDRED_AFTER.test(token.after)) return true;
  }

  if (isInteger && token.value === 100 && OUT_OF_BEFORE.test(token.before)) return true;

  return false;
}

/**
 * The first number in `text` that cites nothing, or null when every number does.
 *
 * `values` is the whitelist: the prompt-visible leaf values for a hotspot, or
 * the rendered figures of a case screen when `lib/narrative/validate.ts` calls
 * this. A null value is skipped rather than matched, because "no event has ever
 * attached" is not a number a sentence can quote.
 */
export function firstUncitedNumber(
  text: string,
  values: readonly (number | null)[],
): NumericToken | null {
  const citable = values.filter((value): value is number => value !== null);

  for (const token of numericTokens(text)) {
    if (isExemptToken(token)) continue;
    if (citable.some((value) => tokenCites(token, value))) continue;
    return token;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate one candidate tool input against the contract.
 *
 * `values` is the prompt-visible whitelist, from `payloadLeafValues`. Nothing
 * outside it may be quoted, which is the whole of the AC-17 clause: a rationale
 * that reaches for a number the model was never shown is a number the model
 * invented.
 */
export function validateScore(
  candidate: unknown,
  values: readonly (number | null)[],
): ScoreValidation {
  if (!isRecord(candidate)) {
    return { ok: false, rejection: { code: 'not_an_object', detail: typeof candidate } };
  }

  const { score, drivers, rationale } = candidate;

  if (typeof score !== 'number' || !Number.isInteger(score)) {
    return { ok: false, rejection: { code: 'score_not_integer', detail: String(score) } };
  }
  if (score < SCORE_BOUNDS.min || score > SCORE_BOUNDS.max) {
    return { ok: false, rejection: { code: 'score_out_of_range', detail: String(score) } };
  }

  if (!Array.isArray(drivers)) {
    return { ok: false, rejection: { code: 'drivers_not_array', detail: typeof drivers } };
  }
  if (drivers.length < DRIVER_BOUNDS.min || drivers.length > DRIVER_BOUNDS.max) {
    return { ok: false, rejection: { code: 'drivers_count', detail: String(drivers.length) } };
  }

  const checked: ScoreDriver[] = [];
  for (const driver of drivers) {
    if (!isRecord(driver)) {
      return { ok: false, rejection: { code: 'driver_shape', detail: typeof driver } };
    }

    const { input_field: field, direction, note } = driver;

    if (typeof field !== 'string' || !(INPUT_FIELD_VALUES as readonly string[]).includes(field)) {
      return { ok: false, rejection: { code: 'unknown_input_field', detail: String(field) } };
    }
    if (
      typeof direction !== 'string' ||
      !(DRIVER_DIRECTIONS as readonly string[]).includes(direction)
    ) {
      return { ok: false, rejection: { code: 'driver_shape', detail: String(direction) } };
    }
    if (typeof note !== 'string' || note.trim() === '') {
      return { ok: false, rejection: { code: 'driver_shape', detail: 'empty note' } };
    }

    checked.push({
      input_field: field as InputField,
      direction: direction as DriverDirection,
      /* Trimmed to the schema's stated maximum rather than rejected: an
         over-long note is a formatting slip, not a fabricated number. */
      note: note.trim().slice(0, DRIVER_BOUNDS.noteMaxLength),
    });
  }

  if (typeof rationale !== 'string' || rationale.trim() === '') {
    return { ok: false, rejection: { code: 'rationale_empty', detail: typeof rationale } };
  }

  const text = rationale.trim();
  if (text.length < RATIONALE_BOUNDS.min || text.length > RATIONALE_BOUNDS.max) {
    return { ok: false, rejection: { code: 'rationale_length', detail: String(text.length) } };
  }

  const uncited = firstUncitedNumber(text, values);
  if (uncited) {
    return { ok: false, rejection: { code: 'uncited_number', detail: uncited.raw } };
  }

  return { ok: true, value: { score, drivers: checked, rationale: text } };
}

/* ------------------------------------------------------------------ *
 * What the dashboard shows (plan 4.5, the UI state table)
 * ------------------------------------------------------------------ */

export const DIVERGENCE_THRESHOLD = 25;

export type ScoreBadge = 'none' | 'divergence' | 'fallback';

export type ScoreDisplay = {
  /** The number on the gauge. Null only when the reference is missing too. */
  displayed: number | null;
  badge: ScoreBadge;
  /** Shown beside the score when the badge is `divergence`. */
  reference: number | null;
  divergence: number | null;
};

/**
 * The one implementation of plan 4.5's state table.
 *
 * | valid score, gap <= 25 | `llm_score`   | no badge   |
 * | valid score, gap  > 25 | `llm_score`   | divergence |
 * | unreachable, no tool block, or invalid | `reference_index` | fallback |
 *
 * The comparison is `> 25`, so a gap of exactly 25 raises nothing. That
 * boundary is pinned on both sides in `score-badges.test.ts` and it is the same
 * comparison the `divergence_flag` GENERATED column makes in SQL; the two must
 * agree or the badge and the stored flag disagree on one hotspot.
 */
export function scoreDisplay(row: {
  llm_score: number | null;
  reference_index: number | null;
  score_fallback?: boolean;
  score_validated?: boolean;
}): ScoreDisplay {
  const usable =
    row.llm_score !== null &&
    Number.isInteger(row.llm_score) &&
    row.llm_score >= SCORE_BOUNDS.min &&
    row.llm_score <= SCORE_BOUNDS.max &&
    row.score_fallback !== true &&
    row.score_validated !== false;

  if (!usable) {
    return {
      displayed: row.reference_index,
      badge: 'fallback',
      reference: row.reference_index,
      divergence: null,
    };
  }

  if (row.reference_index === null) {
    /* A score with no reference to compare it to. It is shown, and no badge
       claims agreement or disagreement that nothing was measured. */
    return { displayed: row.llm_score, badge: 'none', reference: null, divergence: null };
  }

  const divergence = Math.abs(row.llm_score! - row.reference_index);

  return {
    displayed: row.llm_score,
    badge: divergence > DIVERGENCE_THRESHOLD ? 'divergence' : 'none',
    reference: row.reference_index,
    divergence,
  };
}
