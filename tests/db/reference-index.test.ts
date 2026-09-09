/**
 * tests/db/reference-index.test.ts - AC-17, second clause, against what is stored.
 *
 * AC-17 asks that the reference "recomputes H, E and V from `score_inputs` plus
 * one constant, `rules.total_cap`, which it reads from the active rule set, and
 * matches `reference_index` for every hotspot including the empty-hotspot case".
 * The clause names `tests/unit/reference-index.test.ts`, and the hand-computed
 * half of it does live there. This half cannot: the unit project has no
 * DATABASE_URL, deliberately, so "for every hotspot" is only checkable here.
 *
 * The empty-hotspot case is SYNTHESISED. All sixteen seeded hotspots have
 * members, so an empty one is inserted in the middle of the South China Sea,
 * read back through the ordinary loader, and deleted again. It is read-only:
 * nothing rewrites a stored row, so the seeded indices this file asserts against
 * are the same ones the next file sees.
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  loadScoreInputs,
  loadTotalCap,
  PROMPT_PAYLOAD_KEYS,
  type HotspotScoreInputs,
} from '@/lib/index/inputs';
import { referenceIndex, referenceTerms } from '@/lib/index/reference';

import { dbOne, dbPool, dbQuery } from '../setup/db';

/** The record's keys: the six the model sees plus the three it never does. */
const STORED_KEYS = [...PROMPT_PAYLOAD_KEYS, 'max_event_severity', 'worst_haircut_2050', 'snapshot_max_exposure_sgd'];

const EMPTY_HOTSPOT_ID = 'HS-TEST-EMPTY';

type StoredRow = {
  id: string;
  reference_index: number | null;
  score_inputs: HotspotScoreInputs | null;
  exposure: string;
  share: string | null;
};

async function storedHotspots(): Promise<StoredRow[]> {
  return dbQuery<StoredRow>(
    `SELECT h.id, h.reference_index, h.score_inputs,
            e.loan_exposure_sgd AS exposure, e.exposure_share AS share
       FROM hotspots h
       JOIN v_hotspot_exposure e ON e.hotspot_id = h.id
      WHERE h.id <> $1
      ORDER BY h.id`,
    [EMPTY_HOTSPOT_ID],
  );
}

afterAll(async () => {
  await dbQuery('DELETE FROM hotspots WHERE id = $1', [EMPTY_HOTSPOT_ID]);
});

describe('stored reference index', () => {
  it('is written for all sixteen hotspots by the chained prep step', async () => {
    const rows = await storedHotspots();

    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(row.score_inputs, `${row.id} has no score_inputs`).not.toBeNull();
      expect(row.reference_index, `${row.id} has no reference_index`).not.toBeNull();
    }
  });

  it('recomputes from score_inputs alone, for every hotspot', async () => {
    const totalCap = await loadTotalCap(dbPool());
    const rows = await storedHotspots();

    for (const row of rows) {
      const recomputed = referenceIndex(row.score_inputs!, totalCap);
      const terms = referenceTerms(row.score_inputs!, totalCap);

      expect(
        recomputed,
        `${row.id}: H=${terms.H} E=${terms.E} V=${terms.V} weighted=${terms.weighted}`,
      ).toBe(row.reference_index);
    }
  });

  it('stores exactly the nine documented fields, and never the index itself', async () => {
    const rows = await storedHotspots();

    for (const row of rows) {
      expect(Object.keys(row.score_inputs!).sort()).toEqual([...STORED_KEYS].sort());
      expect(Object.keys(row.score_inputs!)).not.toContain('reference_index');
    }
  });

  it('snapshots the exposure the view computes live (AC-15)', async () => {
    const rows = await storedHotspots();

    for (const row of rows) {
      expect(row.score_inputs!.exposure_sgd, `${row.id} exposure`).toBeCloseTo(Number(row.exposure), 2);
      expect(row.score_inputs!.exposure_share, `${row.id} share`).toBeCloseTo(Number(row.share ?? 0), 6);
    }
  });

  it('keeps every stored index an integer inside 1 to 100', async () => {
    const rows = await storedHotspots();

    for (const row of rows) {
      expect(Number.isInteger(row.reference_index)).toBe(true);
      expect(row.reference_index!).toBeGreaterThanOrEqual(1);
      expect(row.reference_index!).toBeLessThanOrEqual(100);
    }
  });

  it('reads total_cap from the active rule set rather than a constant', async () => {
    const active = await dbOne<{ total_cap: string }>(
      'SELECT total_cap FROM rule_sets WHERE is_active',
    );

    expect(await loadTotalCap(dbPool())).toBeCloseTo(Number(active.total_cap), 6);
  });
});

describe('the empty hotspot', () => {
  it('scores 1, not 0, and carries a record of zeros', async () => {
    /* A radius hotspot 700 km off Palawan: no collateral, and far enough from
       every seeded event that the 400 km attachment in 05_regional.sql cannot
       reach it either. Read-only, and removed in afterAll. */
    await dbQuery(
      `INSERT INTO hotspots (id, name, country, centroid, radius_m, hazard_type, summary)
       VALUES ($1, 'Synthetic empty hotspot', 'SG',
               ST_SetSRID(ST_MakePoint(114.0, 12.0), 4326)::geography,
               5000, 'flood', 'Inserted by reference-index.test.ts')`,
      [EMPTY_HOTSPOT_ID],
    );

    const totalCap = await loadTotalCap(dbPool());
    const inputs = await loadScoreInputs(dbPool());
    const empty = inputs.get(EMPTY_HOTSPOT_ID);

    expect(empty, 'the loader skipped the empty hotspot').toBeDefined();
    expect(empty!.exposure_sgd).toBe(0);
    expect(empty!.exposure_share).toBe(0);
    expect(empty!.worst_haircut_2050).toBe(0);
    expect(empty!.recent_event_count_90d).toBe(0);
    expect(empty!.days_since_last_event).toBeNull();
    expect(empty!.hazard_scores_by_type).toEqual({ flood: 0, wind: 0, heat: 0, pm25: 0 });

    const terms = referenceTerms(empty!, totalCap);
    expect(terms.weighted).toBe(0);
    expect(referenceIndex(empty!, totalCap)).toBe(1);
  });

  it('does not disturb the sixteen seeded records while it exists', async () => {
    /* An exposure of zero adds nothing to the window sum behind
       `exposure_share`, so the other sixteen snapshots stay exactly where the
       prep step left them. Asserted rather than assumed, because a share that
       moved would break AC-15 for a reason no dashboard change caused. */
    const rows = await storedHotspots();
    const inputs = await loadScoreInputs(dbPool());

    for (const row of rows) {
      expect(inputs.get(row.id)!.exposure_share, `${row.id} share`).toBeCloseTo(
        row.score_inputs!.exposure_share,
        6,
      );
    }
  });
});
