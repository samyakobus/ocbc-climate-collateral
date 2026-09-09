/**
 * Plan 4.5's UI state table, pinned on both sides of the 25-point boundary (AC-17).
 *
 * | Condition | Displayed | Badge |
 * |---|---|---|
 * | valid score, gap <= 25 | `llm_score` | none |
 * | valid score, gap  > 25 | `llm_score`, reference beside it | model divergence |
 * | unreachable, timed out, no tool block, or validation failed | `reference_index` | fallback |
 *
 * AC-17 names the four cases: reference 50 with scores 25, 24, 75 and 76 gives
 * no badge, divergence, no badge, divergence. `scoreDisplay` must also agree
 * with the `divergence_flag` GENERATED column, which compares `> 25` in SQL; if
 * the two disagree the badge and the stored flag differ on one hotspot and
 * nobody can tell which is right from the screen.
 */

import { describe, expect, it } from 'vitest';

import { DIVERGENCE_THRESHOLD, scoreDisplay, type ScoreBadge } from '@/lib/index/validate-score';

type Case = {
  about: string;
  row: {
    llm_score: number | null;
    reference_index: number | null;
    score_fallback?: boolean;
    score_validated?: boolean;
  };
  displayed: number | null;
  badge: ScoreBadge;
};

const CASES: readonly Case[] = [
  {
    about: 'reference 50, score 25: a gap of exactly 25 raises nothing',
    row: { llm_score: 25, reference_index: 50 },
    displayed: 25,
    badge: 'none',
  },
  {
    about: 'reference 50, score 24: a gap of 26 diverges',
    row: { llm_score: 24, reference_index: 50 },
    displayed: 24,
    badge: 'divergence',
  },
  {
    about: 'reference 50, score 75: the same boundary from above',
    row: { llm_score: 75, reference_index: 50 },
    displayed: 75,
    badge: 'none',
  },
  {
    about: 'reference 50, score 76: a gap of 26 diverges from above too',
    row: { llm_score: 76, reference_index: 50 },
    displayed: 76,
    badge: 'divergence',
  },
  {
    about: 'agreement to the point',
    row: { llm_score: 50, reference_index: 50 },
    displayed: 50,
    badge: 'none',
  },
  {
    about: 'no score at all: the reference carries the gauge',
    row: { llm_score: null, reference_index: 41 },
    displayed: 41,
    badge: 'fallback',
  },
  {
    about: 'score_fallback raised by a failed run, whatever is in the column',
    row: { llm_score: 62, reference_index: 41, score_fallback: true },
    displayed: 41,
    badge: 'fallback',
  },
  {
    about: 'a score that was never validated is not shown',
    row: { llm_score: 62, reference_index: 41, score_validated: false },
    displayed: 41,
    badge: 'fallback',
  },
  {
    about: 'an out-of-range score that reached the column anyway',
    row: { llm_score: 101, reference_index: 41 },
    displayed: 41,
    badge: 'fallback',
  },
  {
    about: 'a non-integer score that reached the column anyway',
    row: { llm_score: 42.5, reference_index: 41 },
    displayed: 41,
    badge: 'fallback',
  },
  {
    about: 'neither number: nothing to show, and the fallback badge says so',
    row: { llm_score: null, reference_index: null },
    displayed: null,
    badge: 'fallback',
  },
  {
    about: 'a score with no reference is shown, and claims no agreement',
    row: { llm_score: 62, reference_index: null },
    displayed: 62,
    badge: 'none',
  },
];

describe('score badges', () => {
  for (const testCase of CASES) {
    it(testCase.about, () => {
      const display = scoreDisplay(testCase.row);

      expect(display.displayed).toBe(testCase.displayed);
      expect(display.badge).toBe(testCase.badge);
    });
  }

  it('shows the reference beside a divergent score, and not otherwise', () => {
    expect(scoreDisplay({ llm_score: 76, reference_index: 50 })).toMatchObject({
      reference: 50,
      divergence: 26,
    });
    expect(scoreDisplay({ llm_score: 75, reference_index: 50 }).divergence).toBe(25);
  });

  it('compares against 25 exactly, the same number the GENERATED column uses', () => {
    expect(DIVERGENCE_THRESHOLD).toBe(25);

    /* The SQL is abs(llm_score - reference_index) > 25. Walked here so a change
       to either side fails a test rather than only showing up on one row of a
       seeded dashboard. */
    for (let score = 1; score <= 100; score += 1) {
      const sql = Math.abs(score - 50) > DIVERGENCE_THRESHOLD;
      const badge = scoreDisplay({ llm_score: score, reference_index: 50 }).badge;

      expect(badge === 'divergence', `score ${score}`).toBe(sql);
    }
  });
});
