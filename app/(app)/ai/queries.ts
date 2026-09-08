/**
 * Server-side reads for the AI Dashboard (S23, AC-14 to AC-17).
 *
 * Exposure comes from `v_hotspot_exposure` and nowhere else. ADR-7 makes the
 * view the single writer of that figure: `hotspots` carries no
 * `loan_exposure_sgd` and no `exposure_share` column, so the popup and the
 * snapshot inside `score_inputs` cannot drift apart by construction.
 *
 * Nothing here computes a score, an index or a divergence. `divergence_flag` is
 * a generated column, `reference_index` is written by `npm run prep:reference`
 * and the model fields by `npm run prep:scores`. The dashboard renders what is
 * stored and says plainly when nothing is.
 */

import { pool } from '@/lib/db/client';

export type HotspotDriver = {
  input_field: string;
  direction: string;
  note: string;
};

export type Hotspot = {
  id: string;
  name: string;
  country: string;
  hazard_type: string;
  summary: string | null;
  lon: number;
  lat: number;
  /** Exactly one of these is set: the CHECK constraint makes them disjoint. */
  radius_m: number | null;
  has_polygon: boolean;

  /** From `v_hotspot_exposure`, the one definition of both figures. */
  loan_exposure_sgd: number;
  exposure_share: number;

  reference_index: number | null;
  llm_score: number | null;
  llm_drivers: HotspotDriver[];
  llm_rationale: string | null;
  model: string | null;
  scored_at: string | null;
  score_source: string | null;
  score_validated: boolean;
  score_fallback: boolean;
  divergence_flag: boolean;
  /** The stored input record, shown in the popup verbatim. */
  score_inputs: Record<string, unknown> | null;
};

export type EnvironmentalEvent = {
  id: string;
  title: string;
  event_type: string;
  occurred_on: string;
  source_feed: string;
  source_url: string;
  hotspot_id: string | null;
  hotspot_name: string | null;
};

export type SatelliteTile = {
  id: string;
  region: string;
  cached_path: string;
  capture_date: string | null;
  fetched_at: string | null;
  provider: string;
};

function isoDay(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  return null;
}

/** Every hotspot with its exposure, ordered by exposure so the map reads top-down. */
export async function loadHotspots(): Promise<Hotspot[]> {
  const { rows } = await pool().query<Record<string, unknown>>(`
    SELECT h.id, h.name, h.country, h.hazard_type, h.summary,
           ST_X(h.centroid::geometry) AS lon,
           ST_Y(h.centroid::geometry) AS lat,
           h.radius_m::float8 AS radius_m,
           (h.area IS NOT NULL) AS has_polygon,
           e.loan_exposure_sgd::float8 AS loan_exposure_sgd,
           COALESCE(e.exposure_share, 0)::float8 AS exposure_share,
           h.reference_index, h.llm_score, h.llm_drivers, h.llm_rationale,
           h.model, h.scored_at, h.score_source, h.score_validated,
           h.score_fallback, h.divergence_flag, h.score_inputs
      FROM hotspots h
      JOIN v_hotspot_exposure e ON e.hotspot_id = h.id
     ORDER BY e.loan_exposure_sgd DESC, h.id
  `);

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    country: String(r.country),
    hazard_type: String(r.hazard_type),
    summary: r.summary === null ? null : String(r.summary),
    lon: Number(r.lon),
    lat: Number(r.lat),
    radius_m: r.radius_m === null ? null : Number(r.radius_m),
    has_polygon: Boolean(r.has_polygon),
    loan_exposure_sgd: Number(r.loan_exposure_sgd),
    exposure_share: Number(r.exposure_share),
    reference_index: r.reference_index === null ? null : Number(r.reference_index),
    llm_score: r.llm_score === null ? null : Number(r.llm_score),
    llm_drivers: Array.isArray(r.llm_drivers) ? (r.llm_drivers as HotspotDriver[]) : [],
    llm_rationale: r.llm_rationale === null ? null : String(r.llm_rationale),
    model: r.model === null ? null : String(r.model),
    scored_at: r.scored_at instanceof Date ? r.scored_at.toISOString() : null,
    score_source: r.score_source === null ? null : String(r.score_source),
    score_validated: Boolean(r.score_validated),
    score_fallback: Boolean(r.score_fallback),
    divergence_flag: Boolean(r.divergence_flag),
    score_inputs:
      r.score_inputs && typeof r.score_inputs === 'object'
        ? (r.score_inputs as Record<string, unknown>)
        : null,
  }));
}

/**
 * Environmental events, newest first (AC-16).
 *
 * Earthquakes are included. They are shown as environmental context and are
 * never scored into a haircut: the `hazard` enum has no landslide or earthquake
 * member, so the engine has no way to price one.
 */
export async function loadEvents(limit = 40): Promise<EnvironmentalEvent[]> {
  const { rows } = await pool().query<Record<string, unknown>>(
    `SELECT e.id, e.title, e.event_type, e.occurred_on, e.source_feed, e.source_url,
            e.hotspot_id, h.name AS hotspot_name
       FROM environmental_events e
       LEFT JOIN hotspots h ON h.id = e.hotspot_id
      ORDER BY e.occurred_on DESC, e.id
      LIMIT $1`,
    [limit],
  );

  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    event_type: String(r.event_type),
    occurred_on: isoDay(r.occurred_on) ?? '',
    source_feed: String(r.source_feed),
    source_url: String(r.source_url),
    hotspot_id: r.hotspot_id === null ? null : String(r.hotspot_id),
    hotspot_name: r.hotspot_name === null ? null : String(r.hotspot_name),
  }));
}

/** The satellite strip. It always renders from `cached_path` (plan 4.9). */
export async function loadTiles(): Promise<SatelliteTile[]> {
  const { rows } = await pool().query<Record<string, unknown>>(
    `SELECT id, region, cached_path, capture_date, fetched_at, provider
       FROM satellite_tiles ORDER BY region`,
  );

  return rows.map((r) => ({
    id: String(r.id),
    region: String(r.region),
    cached_path: String(r.cached_path),
    capture_date: isoDay(r.capture_date),
    fetched_at: r.fetched_at instanceof Date ? r.fetched_at.toISOString() : null,
    provider: String(r.provider),
  }));
}
