/**
 * The hotspot score input record (plan 4.5, AC-17).
 *
 * One `HotspotScoreInputs` per hotspot, stored verbatim in
 * `hotspots.score_inputs`. It carries both the fields the model is shown and the
 * three terms only the reference index needs, so `reference-index.test.ts` can
 * recompute H, E and V from the stored record alone and the popup can list the
 * inputs a score was formed from without a second query.
 *
 * THE PAYLOAD KEY SET IS DECLARED ONCE, HERE. `HotspotPromptPayload` is the
 * single source of truth for what the model sees; `PROMPT_PAYLOAD_KEYS` and
 * `INPUT_FIELD_VALUES` are pinned to it by `satisfies` below and by
 * `tests/unit/prompt-payload.test.ts`, which asserts set equality rather than a
 * count. A future field is therefore excluded by default rather than by anyone
 * remembering to add it to a list of forbidden names.
 *
 * Offline-first (plan 4.9): the only I/O here is a query over an injected
 * client. Nothing in this module constructs a database pool, reads an
 * environment variable or makes an outbound call, which is what lets
 * `no-network-on-render.test.ts` scan `lib/` without an exception for it.
 */

import { eventWeight, RECENT_WINDOW_DAYS, referenceIndex } from '@/lib/index/reference';

/* ------------------------------------------------------------------ *
 * The prompt payload: six top-level keys, nine leaves
 * ------------------------------------------------------------------ */

/** The four hazard types the engine prices, in the order the popup lists them. */
export const HAZARD_TYPES = ['flood', 'wind', 'heat', 'pm25'] as const;

export type HazardType = (typeof HAZARD_TYPES)[number];

export type HazardScoresByType = Record<HazardType, number>;

/**
 * Everything the model sees, and nothing else (plan 4.5).
 *
 * `reference_index`, `max_event_severity`, `worst_haircut_2050` and
 * `snapshot_max_exposure_sgd` are all absent by construction: they live on
 * `HotspotScoreInputs`, and `promptPayload()` is the only projection.
 */
export type HotspotPromptPayload = {
  hazard_scores_by_type: HazardScoresByType;
  exposure_sgd: number;
  exposure_share: number;
  recent_event_count_90d: number;
  recent_event_severity_90d: number;
  days_since_last_event: number | null;
};

/** The six top-level payload keys. `satisfies` keeps this exact, not merely valid. */
export const PROMPT_PAYLOAD_KEYS = [
  'hazard_scores_by_type',
  'exposure_sgd',
  'exposure_share',
  'recent_event_count_90d',
  'recent_event_severity_90d',
  'days_since_last_event',
] as const satisfies readonly (keyof HotspotPromptPayload)[];

/**
 * The nine prompt-visible LEAVES, which are also the `input_field` enum of the
 * `assign_hotspot_score` tool (plan 4.5). Declaring them here rather than in
 * `llm-score.ts` is what makes "drivers name only input fields" decidable by set
 * membership against the payload type itself.
 */
export const INPUT_FIELD_VALUES = [
  'flood',
  'wind',
  'heat',
  'pm25',
  'exposure_sgd',
  'exposure_share',
  'recent_event_count_90d',
  'recent_event_severity_90d',
  'days_since_last_event',
] as const;

export type InputField = (typeof INPUT_FIELD_VALUES)[number];

/**
 * The stored record: the payload plus three fields that are never sent.
 *
 * `max_event_severity` is shown in the popup's input list and is not scored;
 * the other two are the reference index's H and E denominators.
 */
export type HotspotScoreInputs = HotspotPromptPayload & {
  max_event_severity: number;
  worst_haircut_2050: number;
  snapshot_max_exposure_sgd: number;
};

/**
 * The only projection from the stored record to the prompt.
 *
 * Written as an explicit object literal rather than a key filter over
 * `PROMPT_PAYLOAD_KEYS`: a filter typed as `Pick<...>` would still carry any
 * extra runtime key a caller had put on the record, and the whole point of
 * AC-17's guardrail is that the payload cannot carry one.
 */
export function promptPayload(inputs: HotspotScoreInputs): HotspotPromptPayload {
  return {
    hazard_scores_by_type: {
      flood: inputs.hazard_scores_by_type.flood,
      wind: inputs.hazard_scores_by_type.wind,
      heat: inputs.hazard_scores_by_type.heat,
      pm25: inputs.hazard_scores_by_type.pm25,
    },
    exposure_sgd: inputs.exposure_sgd,
    exposure_share: inputs.exposure_share,
    recent_event_count_90d: inputs.recent_event_count_90d,
    recent_event_severity_90d: inputs.recent_event_severity_90d,
    days_since_last_event: inputs.days_since_last_event,
  };
}

/**
 * The payload's leaf names, flattened.
 *
 * `hazard_scores_by_type` expands to its four hazard keys; every other key is
 * its own leaf. `prompt-payload.test.ts` asserts this equals `INPUT_FIELD_VALUES`
 * as a set, which is what pins the tool enum to the payload type.
 */
export function payloadLeafNames(payload: HotspotPromptPayload): string[] {
  return Object.entries(payload).flatMap(([key, value]) =>
    key === 'hazard_scores_by_type' ? Object.keys(value as HazardScoresByType) : [key],
  );
}

/** Every prompt-visible value, by leaf name. The citation validator's whitelist. */
export function payloadLeafValues(payload: HotspotPromptPayload): Record<string, number | null> {
  const { hazard_scores_by_type: hazards, ...rest } = payload;
  return { ...hazards, ...rest };
}

/* ------------------------------------------------------------------ *
 * Building the record
 * ------------------------------------------------------------------ */

/**
 * One row of per-hotspot aggregates, as SQL returns them.
 *
 * The four hazard figures and the total are p90s over the hotspot's members at
 * the 2050 scenario. p90 of the TOTAL is not the sum of the four p90s, and plan
 * 4.5 says so explicitly: different pins can be at the 90th percentile of
 * different perils, so the four are read as a shape rather than as addends.
 */
export type HotspotAggregate = {
  hotspot_id: string;
  member_count: number;
  exposure_sgd: number;
  exposure_share: number;
  snapshot_max_exposure_sgd: number;
  p90_total_2050: number;
  p90_flood_2050: number;
  p90_wind_2050: number;
  p90_heat_2050: number;
  p90_pm25_2050: number;
};

/** One attached event. `hotspot_id` is written by PostGIS in `05_regional.sql`. */
export type HotspotEvent = {
  hotspot_id: string;
  event_type: string;
  /** `YYYY-MM-DD`. */
  occurred_on: string;
};

/** Six decimals: enough for a haircut fraction, short enough to read in the popup. */
function round6(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0;
}

/** Money, to the cent. Loan amounts are whole SGD, so this only removes float dust. */
function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** `YYYY-MM-DD` to a UTC day number, so date arithmetic cannot pick up a timezone. */
function utcDay(iso: string): number {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Today as `YYYY-MM-DD`, in UTC. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Assemble one stored record.
 *
 * Every number is rounded HERE, before the reference index is computed from the
 * record, so the index the script writes is the index a test recomputes from
 * what was stored. Rounding afterwards would leave the two a hair apart on a
 * hotspot whose weighted sum sat on a rounding boundary, and that failure would
 * appear in one seed out of many.
 */
export function buildScoreInputs(
  aggregate: HotspotAggregate,
  events: readonly HotspotEvent[],
  asOf: string,
): HotspotScoreInputs {
  const asOfDay = utcDay(asOf);
  const mine = events.filter((event) => event.hotspot_id === aggregate.hotspot_id);

  /* The window is [asOf - 90 days, asOf]: a future-dated feed row is not
     "recent pressure", it is a clock disagreement, and counting it would make
     the index depend on which machine ran the prep. */
  const recent = mine.filter((event) => {
    const day = utcDay(event.occurred_on);
    return day <= asOfDay && asOfDay - day <= RECENT_WINDOW_DAYS;
  });

  const weights = recent.map((event) => eventWeight(event.event_type));
  const severity = weights.reduce((sum, weight) => sum + weight, 0);

  /* Days since the last event looks at EVERY attached event, not only the
     window: "none in 90 days, and the last one was 200 days ago" is a different
     reading from "none ever", and the model is shown which it is. */
  const lastDay = mine
    .map((event) => utcDay(event.occurred_on))
    .filter((day) => day <= asOfDay)
    .reduce<number | null>((latest, day) => (latest === null || day > latest ? day : latest), null);

  return {
    hazard_scores_by_type: {
      flood: round6(aggregate.p90_flood_2050),
      wind: round6(aggregate.p90_wind_2050),
      heat: round6(aggregate.p90_heat_2050),
      pm25: round6(aggregate.p90_pm25_2050),
    },
    exposure_sgd: round2(aggregate.exposure_sgd),
    exposure_share: round6(aggregate.exposure_share),
    recent_event_count_90d: recent.length,
    recent_event_severity_90d: round6(severity),
    days_since_last_event: lastDay === null ? null : asOfDay - lastDay,
    max_event_severity: weights.length > 0 ? round6(Math.max(...weights)) : 0,
    worst_haircut_2050: round6(aggregate.p90_total_2050),
    snapshot_max_exposure_sgd: round2(aggregate.snapshot_max_exposure_sgd),
  };
}

/* ------------------------------------------------------------------ *
 * Loading, over an injected client
 * ------------------------------------------------------------------ */

/** Anything that can run a query: a `pg` Pool, a PoolClient, or a test stub. */
export type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A DATE column arrives as a Date from `pg` and as a string from some drivers. */
function isoDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Per-hotspot aggregates, read from the views and the active rule set's
 * valuations.
 *
 * Membership and exposure come from `v_hotspot_membership` and
 * `v_hotspot_exposure` and from nowhere else (ADR-7), so the exposure snapshotted
 * into `score_inputs` is the same figure the popup reads live. AC-15 asserts
 * that equality directly.
 */
export async function loadHotspotAggregates(client: Queryable): Promise<HotspotAggregate[]> {
  const { rows } = await client.query(`
    WITH haircuts AS (
      SELECT m.hotspot_id,
             COUNT(*)::int AS member_count,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY v.total_haircut)::float8 AS p90_total,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY v.flood_haircut)::float8 AS p90_flood,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY v.wind_haircut)::float8  AS p90_wind,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY v.heat_haircut)::float8  AS p90_heat,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY v.pm25_haircut)::float8  AS p90_pm25
        FROM v_hotspot_membership m
        JOIN valuations v ON v.collateral_id = m.collateral_id AND v.scenario = 'y2050'
        JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
       GROUP BY m.hotspot_id
    )
    SELECT h.id AS hotspot_id,
           COALESCE(hc.member_count, 0) AS member_count,
           COALESCE(e.loan_exposure_sgd, 0)::float8 AS exposure_sgd,
           COALESCE(e.exposure_share, 0)::float8 AS exposure_share,
           COALESCE(MAX(e.loan_exposure_sgd) OVER (), 0)::float8 AS snapshot_max_exposure_sgd,
           COALESCE(hc.p90_total, 0) AS p90_total_2050,
           COALESCE(hc.p90_flood, 0) AS p90_flood_2050,
           COALESCE(hc.p90_wind, 0)  AS p90_wind_2050,
           COALESCE(hc.p90_heat, 0)  AS p90_heat_2050,
           COALESCE(hc.p90_pm25, 0)  AS p90_pm25_2050
      FROM hotspots h
      LEFT JOIN v_hotspot_exposure e ON e.hotspot_id = h.id
      LEFT JOIN haircuts hc ON hc.hotspot_id = h.id
     ORDER BY h.id
  `);

  return rows.map((row) => ({
    hotspot_id: String(row.hotspot_id),
    member_count: num(row.member_count),
    exposure_sgd: num(row.exposure_sgd),
    exposure_share: num(row.exposure_share),
    snapshot_max_exposure_sgd: num(row.snapshot_max_exposure_sgd),
    p90_total_2050: num(row.p90_total_2050),
    p90_flood_2050: num(row.p90_flood_2050),
    p90_wind_2050: num(row.p90_wind_2050),
    p90_heat_2050: num(row.p90_heat_2050),
    p90_pm25_2050: num(row.p90_pm25_2050),
  }));
}

/**
 * Every event already attached to a hotspot.
 *
 * The attachment is a PostGIS decision taken once in `05_regional.sql` (nearest
 * hotspot within 400 km), for the same one-owner reason ADR-7 gives collateral
 * containment. Nothing here re-decides it.
 */
export async function loadHotspotEvents(client: Queryable): Promise<HotspotEvent[]> {
  const { rows } = await client.query(`
    SELECT hotspot_id, event_type::text AS event_type, occurred_on
      FROM environmental_events
     WHERE hotspot_id IS NOT NULL
     ORDER BY occurred_on DESC, id
  `);

  return rows.map((row) => ({
    hotspot_id: String(row.hotspot_id),
    event_type: String(row.event_type),
    occurred_on: isoDay(row.occurred_on),
  }));
}

/** The active rule set's `total_cap`, the one constant the index needs. */
export async function loadTotalCap(client: Queryable): Promise<number> {
  const { rows } = await client.query('SELECT total_cap FROM rule_sets WHERE is_active');
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one active rule set, found ${rows.length}.`);
  }
  return num(rows[0].total_cap);
}

/** One record per hotspot, keyed by hotspot id, ready to store. */
export async function loadScoreInputs(
  client: Queryable,
  asOf: string = todayIso(),
): Promise<Map<string, HotspotScoreInputs>> {
  const [aggregates, events] = await Promise.all([
    loadHotspotAggregates(client),
    loadHotspotEvents(client),
  ]);

  return new Map(
    aggregates.map((aggregate) => [
      aggregate.hotspot_id,
      buildScoreInputs(aggregate, events, asOf),
    ]),
  );
}

export type ReferenceResult = {
  as_of: string;
  total_cap: number;
  hotspots: number;
  /** Hotspots whose index is 1 because nothing at all bears on them. */
  empty: number;
  min_index: number;
  max_index: number;
};

/**
 * Write `score_inputs` and `reference_index` for every hotspot, on a caller's
 * client.
 *
 * It lives beside the builder rather than in `reference.ts` for one reason:
 * this module is already the only writer of the record, the index goes into the
 * same UPDATE, and putting a runtime import of the loaders into `reference.ts`
 * would make the two modules import each other. `reference.ts` stays a pure
 * formula that a test can call with no client at all.
 *
 * The caller owns the transaction, which is what lets `/rules` save new
 * thresholds, recompute every valuation and refresh every index as one atomic
 * step (AC-9), and lets the prep script do the same from the command line.
 */
export async function refreshReferenceIndex(
  client: Queryable,
  asOf: string = todayIso(),
): Promise<ReferenceResult> {
  const totalCap = await loadTotalCap(client);
  const inputs = await loadScoreInputs(client, asOf);

  const indices: number[] = [];
  let empty = 0;

  for (const [hotspotId, record] of inputs) {
    const index = referenceIndex(record, totalCap);
    indices.push(index);
    if (index === 1) empty += 1;

    await client.query(
      `UPDATE hotspots
          SET score_inputs = $2::jsonb,
              reference_index = $3,
              computed_at = now()
        WHERE id = $1`,
      [hotspotId, JSON.stringify(record), index],
    );
  }

  return {
    as_of: asOf,
    total_cap: totalCap,
    hotspots: inputs.size,
    empty,
    min_index: indices.length > 0 ? Math.min(...indices) : 0,
    max_index: indices.length > 0 ? Math.max(...indices) : 0,
  };
}
