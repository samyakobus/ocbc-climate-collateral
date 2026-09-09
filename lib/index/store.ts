/**
 * Reading hotspots for scoring, and writing back what came of it (S22, AC-17).
 *
 * A separate module from `llm-score.ts` on purpose. That file holds prompt
 * building and answer reading and nothing else, per plan 4.9, so the vendor
 * client stays out of `lib/`. This one holds the two database statements the
 * scoring pass needs, over an INJECTED client, so the prep script and the
 * regenerate server action write a scored row exactly the same way. Two copies
 * of one UPDATE, one of them setting eight columns and the other seven, is how a
 * fallback row ends up with a stale `scored_at` from the run before.
 *
 * Not in plan section 4.1's file list; recorded in section 10.
 */

import type { HotspotScoreInputs, Queryable } from '@/lib/index/inputs';
import type { ScoreOutcome } from '@/lib/index/llm-score';

/** A hotspot with the record `prep:reference` stored for it. */
export type ScorableHotspot = {
  id: string;
  name: string;
  country: string;
  hazard_type: string;
  reference_index: number | null;
  inputs: HotspotScoreInputs;
};

/**
 * Every hotspot that can be scored, which is every hotspot with a record.
 *
 * A hotspot with no `score_inputs` is skipped rather than scored from nothing:
 * `prep:reference` has simply not run, and the message the caller prints says
 * to run it. Scoring an empty payload would produce a confident number about a
 * hotspot nobody has measured.
 */
export async function loadScorableHotspots(client: Queryable): Promise<ScorableHotspot[]> {
  const { rows } = await client.query(`
    SELECT id, name, country, hazard_type, reference_index, score_inputs
      FROM hotspots
     WHERE score_inputs IS NOT NULL
     ORDER BY id
  `);

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    country: String(row.country),
    hazard_type: String(row.hazard_type),
    reference_index: row.reference_index === null ? null : Number(row.reference_index),
    inputs: row.score_inputs as HotspotScoreInputs,
  }));
}

/**
 * Write one outcome.
 *
 * On success the row carries the score, its drivers, its rationale, the model
 * that produced it and when. On any failure every one of those is set back to
 * NULL and `score_fallback` is raised: the dashboard then shows
 * `reference_index` with a fallback badge, and no stale score from an earlier
 * run survives to be read as a fresh one. `divergence_flag` is generated, so it
 * follows from the two columns by itself.
 *
 * `score_source` is left for a `fixture` row to claim (ADR-3). Nothing here
 * writes `fixture`: a demo row is a deliberate human act, not a fallback.
 */
export async function applyScoreOutcome(
  client: Queryable,
  hotspotId: string,
  outcome: ScoreOutcome,
): Promise<void> {
  if (outcome.ok) {
    await client.query(
      `UPDATE hotspots
          SET llm_score = $2,
              llm_drivers = $3::jsonb,
              llm_rationale = $4,
              model = $5,
              scored_at = now(),
              score_source = 'model',
              score_validated = true,
              score_fallback = false
        WHERE id = $1`,
      [
        hotspotId,
        outcome.value.score,
        JSON.stringify(outcome.value.drivers),
        outcome.value.rationale,
        outcome.model,
      ],
    );
    return;
  }

  await client.query(
    `UPDATE hotspots
        SET llm_score = NULL,
            llm_drivers = NULL,
            llm_rationale = NULL,
            model = NULL,
            scored_at = NULL,
            score_source = NULL,
            score_validated = false,
            score_fallback = true
      WHERE id = $1`,
    [hotspotId],
  );
}

/** Mark every hotspot as unscored, for a run with no key at all. */
export async function markAllFallback(client: Queryable): Promise<number> {
  const { rows } = await client.query(`
    UPDATE hotspots
       SET llm_score = NULL,
           llm_drivers = NULL,
           llm_rationale = NULL,
           model = NULL,
           scored_at = NULL,
           score_source = NULL,
           score_validated = false,
           score_fallback = true
     RETURNING id
  `);

  return rows.length;
}
