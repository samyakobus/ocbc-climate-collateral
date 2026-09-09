/**
 * Server-side reads for the case list and the case screen (S14).
 *
 * Every number these return is a STORED column. Nothing here recomputes a
 * haircut, a credit, an LTV or a band: `lib/valuation` owns that arithmetic and
 * `npm run db:recompute` has already written the answer. A screen that
 * re-derived even one figure could disagree with the map and the dashboard, and
 * that is the one failure this plan is organised to prevent.
 */

import type { Band } from '@/lib/rules/bands';
import type { Scenario } from '@/components/map/scenario';
import { pool } from '@/lib/db/client';

export type Segment = 'personal' | 'corporate';

/** One row of the case list. */
export type CaseListItem = {
  loan_application_id: string;
  collateral_id: string;
  address_line: string;
  cluster_name: string;
  country: string;
  segment: Segment;
  applicant_name: string;
  appraised_value_sgd: number;
  requested_amount: number;
  status: string;
  band: Band | null;
  total_haircut: number | null;
  adjusted_value_sgd: number | null;
  max_loan_sgd: number | null;
  refer_to_risk: boolean;
};

/**
 * The case list at one scenario, optionally filtered to a segment.
 *
 * The two officer roles land here with their own segment already applied, so the
 * filter is part of the query rather than a client-side hide.
 */
export async function listCases(
  scenario: Scenario,
  segment: Segment | null,
): Promise<CaseListItem[]> {
  const { rows } = await pool().query<Record<string, string | boolean | null>>(
    `
    SELECT la.id                          AS loan_application_id,
           c.id                           AS collateral_id,
           c.address_line,
           c.cluster_name,
           c.country,
           la.segment,
           a.name                         AS applicant_name,
           c.appraised_value_sgd::float8  AS appraised_value_sgd,
           la.requested_amount::float8    AS requested_amount,
           la.status,
           v.band,
           v.total_haircut::float8        AS total_haircut,
           v.adjusted_value_sgd::float8   AS adjusted_value_sgd,
           av.max_loan_sgd::float8        AS max_loan_sgd,
           COALESCE(r.refer_to_risk, false) AS refer_to_risk
      FROM loan_applications la
      JOIN collateral c ON c.id = la.collateral_id
      JOIN applicants  a ON a.id = la.applicant_id
      LEFT JOIN valuations v
             ON v.collateral_id = c.id AND v.scenario = $1
            AND v.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)
      LEFT JOIN application_valuations av
             ON av.loan_application_id = la.id AND av.scenario = $1
            AND av.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)
      LEFT JOIN recommendations r
             ON r.loan_application_id = la.id AND r.scenario = $1
            AND r.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)
     WHERE ($2::text IS NULL OR la.segment = $2::loan_segment)
     ORDER BY v.total_haircut DESC NULLS LAST, c.id
    `,
    [scenario, segment],
  );

  return rows.map((r) => ({
    loan_application_id: String(r.loan_application_id),
    collateral_id: String(r.collateral_id),
    address_line: String(r.address_line),
    cluster_name: String(r.cluster_name),
    country: String(r.country),
    segment: r.segment as Segment,
    applicant_name: String(r.applicant_name),
    appraised_value_sgd: Number(r.appraised_value_sgd),
    requested_amount: Number(r.requested_amount),
    status: String(r.status),
    band: (r.band as Band) ?? null,
    total_haircut: r.total_haircut === null ? null : Number(r.total_haircut),
    adjusted_value_sgd: r.adjusted_value_sgd === null ? null : Number(r.adjusted_value_sgd),
    max_loan_sgd: r.max_loan_sgd === null ? null : Number(r.max_loan_sgd),
    refer_to_risk: Boolean(r.refer_to_risk),
  }));
}

// ---------------------------------------------------------------------------
// The case screen
// ---------------------------------------------------------------------------

export type CaseCollateral = {
  id: string;
  address_line: string;
  cluster_name: string;
  country: string;
  building_type: string;
  occupancy_class: string;
  appraised_value_sgd: number;
  floor_level: number | null;
  elevation_m: number | null;
  dist_to_coast_km: number | null;
  landslide_flag: boolean;
  slope_deg: number | null;
  /**
   * A same-origin path under `public/cache/thumbs/`, or null where the
   * thumbnail step has never run. Never an external URL: the case screen
   * renders it directly, and worker A's offline spec asserts every `<img>` on
   * the fixture case screens is same-origin.
   */
  satellite_thumb_path: string | null;
  adaptation_project_id: string | null;
  damage_class: string | null;
  curve_label: string | null;
  curve_source_name: string | null;
  curve_source_url: string | null;
};

export type CaseLoan = {
  id: string;
  segment: Segment;
  requested_amount: number;
  originated_year: number;
  status: string;
  base_ltv_override: number | null;
  applicant_name: string;
  applicant_kind: string;
};

export type CaseValuation = {
  scenario: Scenario;
  winning_peril: 'flood_riverine' | 'flood_coastal' | null;
  depth_m: number | null;
  damage_fraction: number | null;
  flood_haircut_gross: number;
  adaptation_credit_documented_pp: number;
  adaptation_credit_effective_pp: number;
  flood_haircut: number;
  wind_haircut: number;
  heat_haircut: number;
  pm25_haircut: number;
  chronic_haircut: number;
  total_haircut: number;
  adjusted_value_sgd: number;
  band: Band;
  ltv_applied: number | null;
  max_loan_sgd: number | null;
};

export type CaseRecommendation = {
  band: Band;
  conditions: string[];
  revalue_by_year: number | null;
  refer_to_risk: boolean;
};

export type CaseSample = {
  hazard: string;
  value: number | null;
  coverage: 'scored' | 'measured_not_scored' | 'absent';
  unit: string;
  dataset_name: string;
  dataset_version: string;
  pathway: string | null;
  return_period_yrs: number | null;
  sampled_at: string;
  scenario_invariant: boolean;
  /** From `hazard_applicability`, for the rows policy excludes. */
  applicability_reason: string | null;
  applicability_url: string | null;
};

export type CaseModifiers = {
  suhi_tertile: number;
  ndvi_tertile: number;
  dataset_name: string;
  dataset_version: string;
  sampled_at: string;
} | null;

export type CaseAdaptation = {
  id: string;
  name: string;
  haircut_credit_pp: number;
  protection_return_period: number | null;
  source_name: string;
  source_url: string;
} | null;

export type CaseContextFactor = {
  factor: string;
  value: number | null;
  unit: string;
  direction_2030: string | null;
  direction_2050: string | null;
  dataset_name: string;
  source_url: string;
  sampled_at: string;
};

export type CaseDetail = {
  collateral: CaseCollateral;
  loan: CaseLoan;
  valuation: CaseValuation | null;
  recommendation: CaseRecommendation | null;
  samples: CaseSample[];
  modifiers: CaseModifiers;
  adaptation: CaseAdaptation;
  context: CaseContextFactor[];
};

/** Everything one case screen renders, at one scenario. Null when no such case. */
export async function loadCase(
  collateralId: string,
  scenario: Scenario,
): Promise<CaseDetail | null> {
  const client = pool();

  const head = await client.query<Record<string, string | boolean | null>>(
    `
    SELECT c.id, c.address_line, c.cluster_name, c.country, c.building_type,
           c.occupancy_class, c.appraised_value_sgd::float8 AS appraised_value_sgd,
           c.floor_level, c.elevation_m::float8 AS elevation_m,
           c.dist_to_coast_km::float8 AS dist_to_coast_km,
           c.landslide_flag, c.slope_deg::float8 AS slope_deg,
           c.satellite_thumb_path,
           c.adaptation_project_id,
           bdc.damage_class,
           ddf.curve_label, ddf.source_name AS curve_source_name,
           ddf.source_url AS curve_source_url,
           la.id AS loan_id, la.segment, la.requested_amount::float8 AS requested_amount,
           la.originated_year, la.status,
           la.base_ltv_override::float8 AS base_ltv_override,
           a.name AS applicant_name, a.kind AS applicant_kind
      FROM collateral c
      JOIN loan_applications la ON la.collateral_id = c.id
      JOIN applicants a ON a.id = la.applicant_id
      LEFT JOIN building_damage_class bdc ON bdc.building_type = c.building_type
      LEFT JOIN depth_damage_functions ddf ON ddf.damage_class = bdc.damage_class
     WHERE c.id = $1
     LIMIT 1
    `,
    [collateralId],
  );
  if (head.rowCount === 0) return null;
  const h = head.rows[0];

  const [valuation, recommendation, samples, modifiers, adaptation, context] =
    await Promise.all([
      client.query<Record<string, string | null>>(
        `SELECT v.scenario, v.winning_peril, v.depth_m::float8 AS depth_m,
                v.damage_fraction::float8 AS damage_fraction,
                v.flood_haircut_gross::float8 AS flood_haircut_gross,
                v.adaptation_credit_documented_pp::float8 AS adaptation_credit_documented_pp,
                v.adaptation_credit_effective_pp::float8 AS adaptation_credit_effective_pp,
                v.flood_haircut::float8 AS flood_haircut,
                v.wind_haircut::float8 AS wind_haircut,
                v.heat_haircut::float8 AS heat_haircut,
                v.pm25_haircut::float8 AS pm25_haircut,
                v.chronic_haircut::float8 AS chronic_haircut,
                v.total_haircut::float8 AS total_haircut,
                v.adjusted_value_sgd::float8 AS adjusted_value_sgd,
                v.band,
                av.ltv_applied::float8 AS ltv_applied,
                av.max_loan_sgd::float8 AS max_loan_sgd
           FROM valuations v
           LEFT JOIN application_valuations av
                  ON av.loan_application_id = $3
                 AND av.scenario = v.scenario
                 AND av.rule_set_id = v.rule_set_id
          WHERE v.collateral_id = $1 AND v.scenario = $2
            AND v.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)`,
        [collateralId, scenario, String(h.loan_id)],
      ),
      client.query<Record<string, unknown>>(
        `SELECT band, conditions, revalue_by_year, refer_to_risk
           FROM recommendations
          WHERE loan_application_id = $1 AND scenario = $2
            AND rule_set_id = (SELECT id FROM rule_sets WHERE is_active)`,
        [String(h.loan_id), scenario],
      ),
      client.query<Record<string, string | boolean | null>>(
        `SELECT hs.hazard, hs.value::float8 AS value, hs.coverage, hs.unit,
                hs.dataset_name, hs.dataset_version, hs.pathway,
                hs.return_period_yrs, hs.sampled_at, hs.scenario_invariant,
                ha.reason AS applicability_reason, ha.source_url AS applicability_url
           FROM hazard_samples hs
           LEFT JOIN hazard_applicability ha
                  ON ha.hazard = hs.hazard AND ha.country = $3
          WHERE hs.collateral_id = $1 AND hs.scenario = $2
          ORDER BY array_position(
            ARRAY['flood_riverine','flood_coastal','wind','heat_days35','pm25']::hazard[],
            hs.hazard)`,
        [collateralId, scenario, String(h.country)],
      ),
      client.query<Record<string, string | null>>(
        `SELECT suhi_tertile, ndvi_tertile, dataset_name, dataset_version, sampled_at
           FROM site_modifiers WHERE collateral_id = $1`,
        [collateralId],
      ),
      h.adaptation_project_id
        ? client.query<Record<string, string | null>>(
            `SELECT id, name, haircut_credit_pp::float8 AS haircut_credit_pp,
                    protection_return_period, source_name, source_url
               FROM adaptation_projects WHERE id = $1`,
            [String(h.adaptation_project_id)],
          )
        : Promise.resolve({ rows: [] as Record<string, string | null>[], rowCount: 0 }),
      client.query<Record<string, string | null>>(
        `SELECT factor, value::float8 AS value, unit, direction_2030, direction_2050,
                dataset_name, source_url, sampled_at
           FROM context_factors WHERE collateral_id = $1 ORDER BY factor`,
        [collateralId],
      ),
    ]);

  const v = valuation.rows[0];
  const rec = recommendation.rows[0];
  const mod = modifiers.rows[0];
  const adapt = adaptation.rows[0];

  return {
    collateral: {
      id: String(h.id),
      address_line: String(h.address_line),
      cluster_name: String(h.cluster_name),
      country: String(h.country),
      building_type: String(h.building_type),
      occupancy_class: String(h.occupancy_class),
      appraised_value_sgd: Number(h.appraised_value_sgd),
      floor_level: h.floor_level === null ? null : Number(h.floor_level),
      elevation_m: h.elevation_m === null ? null : Number(h.elevation_m),
      dist_to_coast_km: h.dist_to_coast_km === null ? null : Number(h.dist_to_coast_km),
      landslide_flag: Boolean(h.landslide_flag),
      slope_deg: h.slope_deg === null ? null : Number(h.slope_deg),
      satellite_thumb_path: h.satellite_thumb_path ? String(h.satellite_thumb_path) : null,
      adaptation_project_id: h.adaptation_project_id ? String(h.adaptation_project_id) : null,
      damage_class: h.damage_class ? String(h.damage_class) : null,
      curve_label: h.curve_label ? String(h.curve_label) : null,
      curve_source_name: h.curve_source_name ? String(h.curve_source_name) : null,
      curve_source_url: h.curve_source_url ? String(h.curve_source_url) : null,
    },
    loan: {
      id: String(h.loan_id),
      segment: h.segment as Segment,
      requested_amount: Number(h.requested_amount),
      originated_year: Number(h.originated_year),
      status: String(h.status),
      base_ltv_override: h.base_ltv_override === null ? null : Number(h.base_ltv_override),
      applicant_name: String(h.applicant_name),
      applicant_kind: String(h.applicant_kind),
    },
    valuation: v
      ? {
          scenario: v.scenario as Scenario,
          winning_peril: (v.winning_peril as CaseValuation['winning_peril']) ?? null,
          depth_m: v.depth_m === null ? null : Number(v.depth_m),
          damage_fraction: v.damage_fraction === null ? null : Number(v.damage_fraction),
          flood_haircut_gross: Number(v.flood_haircut_gross),
          adaptation_credit_documented_pp: Number(v.adaptation_credit_documented_pp),
          adaptation_credit_effective_pp: Number(v.adaptation_credit_effective_pp),
          flood_haircut: Number(v.flood_haircut),
          wind_haircut: Number(v.wind_haircut),
          heat_haircut: Number(v.heat_haircut),
          pm25_haircut: Number(v.pm25_haircut),
          chronic_haircut: Number(v.chronic_haircut),
          total_haircut: Number(v.total_haircut),
          adjusted_value_sgd: Number(v.adjusted_value_sgd),
          band: v.band as Band,
          ltv_applied: v.ltv_applied === null ? null : Number(v.ltv_applied),
          max_loan_sgd: v.max_loan_sgd === null ? null : Number(v.max_loan_sgd),
        }
      : null,
    recommendation: rec
      ? {
          band: rec.band as Band,
          conditions: Array.isArray(rec.conditions) ? (rec.conditions as string[]) : [],
          revalue_by_year:
            rec.revalue_by_year === null ? null : Number(rec.revalue_by_year),
          refer_to_risk: Boolean(rec.refer_to_risk),
        }
      : null,
    samples: samples.rows.map((s) => ({
      hazard: String(s.hazard),
      value: s.value === null ? null : Number(s.value),
      coverage: s.coverage as CaseSample['coverage'],
      unit: String(s.unit),
      dataset_name: String(s.dataset_name),
      dataset_version: String(s.dataset_version),
      pathway: s.pathway ? String(s.pathway) : null,
      return_period_yrs: s.return_period_yrs === null ? null : Number(s.return_period_yrs),
      sampled_at: formatDate(s.sampled_at),
      scenario_invariant: Boolean(s.scenario_invariant),
      applicability_reason: s.applicability_reason ? String(s.applicability_reason) : null,
      applicability_url: s.applicability_url ? String(s.applicability_url) : null,
    })),
    modifiers: mod
      ? {
          suhi_tertile: Number(mod.suhi_tertile),
          ndvi_tertile: Number(mod.ndvi_tertile),
          dataset_name: String(mod.dataset_name),
          dataset_version: String(mod.dataset_version),
          sampled_at: formatDate(mod.sampled_at),
        }
      : null,
    adaptation: adapt
      ? {
          id: String(adapt.id),
          name: String(adapt.name),
          haircut_credit_pp: Number(adapt.haircut_credit_pp),
          protection_return_period:
            adapt.protection_return_period === null
              ? null
              : Number(adapt.protection_return_period),
          source_name: String(adapt.source_name),
          source_url: String(adapt.source_url),
        }
      : null,
    context: context.rows.map((c) => ({
      factor: String(c.factor),
      value: c.value === null ? null : Number(c.value),
      unit: String(c.unit),
      direction_2030: c.direction_2030 ? String(c.direction_2030) : null,
      direction_2050: c.direction_2050 ? String(c.direction_2050) : null,
      dataset_name: String(c.dataset_name),
      source_url: String(c.source_url),
      sampled_at: formatDate(c.sampled_at),
    })),
  };
}

/** `pg` hands back a Date for a DATE column; the panel wants a plain ISO day. */
function formatDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}
