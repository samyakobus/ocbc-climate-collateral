/**
 * lib/valuation/recompute.ts - the whole-portfolio pass (S12, AC-5, AC-6, AC-8, AC-9).
 *
 * Values every collateral at every scenario against the active rule set and
 * writes `valuations`, `application_valuations` and `recommendations`.
 *
 * This is the function AC-9 runs live in front of the board: the risk manager
 * saves a threshold on `/rules`, a new active rule set is written, this runs,
 * and the map recolours with no restart. So it is one in-process pass in one
 * transaction (ADR-1), and it reads everything it needs up front rather than
 * querying per pin: 200 collateral times 3 scenarios is 600 valuations from
 * roughly six queries, not from twelve hundred.
 *
 * All arithmetic is `combine.ts`. Nothing here computes a haircut; it loads,
 * loops and writes.
 */

import type { PoolClient } from 'pg';

import {
  type Band,
  type BandEdges,
  coastalInundationFlag,
  recommendationFor,
} from '@/lib/rules/bands';
import { type BuildingType, type DamageClass, type CurvePoint } from '@/lib/rules/curves';

import {
  type CollateralInput,
  type LoanInput,
  type SampleSet,
  type Valuation,
  valuate,
} from './combine';
import { type DamageTables } from './damage';
import {
  type AdaptationProject,
  type Coverage,
  type RuleConstants,
  type Scenario,
  type SiteModifiers,
} from './hazards';

/** The three scenarios, and the literal year each represents (ADR-5). */
export const SCENARIOS: readonly Scenario[] = ['today', 'y2030', 'y2050'];

/** Scenario to calendar year. `today` resolves to `rule_sets.today_year`. */
export function scenarioYears(todayYear: number): Record<Scenario, number> {
  return { today: todayYear, y2030: 2030, y2050: 2050 };
}

type RuleSetRow = RuleConstants & { id: string; today_year: number };

type CollateralRow = CollateralInput & {
  id: string;
  adaptation_project_id: string | null;
  elevation_m: number | null;
};

type LoanRow = LoanInput & {
  id: string;
  collateral_id: string;
};

type SampleRow = {
  collateral_id: string;
  hazard: keyof SampleSet;
  scenario: Scenario;
  value: string | null;
  coverage: Coverage;
};

/** Postgres returns NUMERIC as a string, to avoid silent float truncation. */
function toNumber(value: string | number | null): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNullableNumber(value: string | number | null): number | null {
  return value === null ? null : toNumber(value);
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function loadActiveRuleSet(client: PoolClient): Promise<RuleSetRow> {
  const { rows } = await client.query(
    `SELECT id, base_ltv_personal, base_ltv_corporate, band_low, band_mid, band_high,
            total_cap, chronic_cap, p_today, p_2030, p_2050, today_year,
            inundation_threshold_m, adaptation_enabled
     FROM rule_sets WHERE is_active`,
  );

  if (rows.length !== 1) {
    throw new Error(`Expected exactly one active rule set, found ${rows.length}.`);
  }

  const row = rows[0];
  return {
    id: String(row.id),
    base_ltv_personal: toNumber(row.base_ltv_personal),
    base_ltv_corporate: toNumber(row.base_ltv_corporate),
    band_low: toNumber(row.band_low),
    band_mid: toNumber(row.band_mid),
    band_high: toNumber(row.band_high),
    total_cap: toNumber(row.total_cap),
    chronic_cap: toNumber(row.chronic_cap),
    p_today: toNumber(row.p_today),
    p_2030: toNumber(row.p_2030),
    p_2050: toNumber(row.p_2050),
    today_year: Number(row.today_year),
    inundation_threshold_m: toNumber(row.inundation_threshold_m),
    adaptation_enabled: Boolean(row.adaptation_enabled),
  };
}

async function loadDamageTables(client: PoolClient): Promise<DamageTables> {
  const curves = await client.query(
    'SELECT damage_class::text AS damage_class, points FROM depth_damage_functions',
  );
  const classes = await client.query(
    'SELECT building_type::text AS building_type, damage_class::text AS damage_class FROM building_damage_class',
  );

  const curveMap: Partial<Record<DamageClass, readonly CurvePoint[]>> = {};
  for (const row of curves.rows) {
    curveMap[row.damage_class as DamageClass] = row.points as CurvePoint[];
  }

  const classOf: Partial<Record<BuildingType, DamageClass>> = {};
  for (const row of classes.rows) {
    classOf[row.building_type as BuildingType] = row.damage_class as DamageClass;
  }

  return { curves: curveMap, classOf };
}

/* ------------------------------------------------------------------ *
 * The pass
 * ------------------------------------------------------------------ */

export type RecomputeResult = {
  rule_set_id: string;
  collateral: number;
  valuations: number;
  application_valuations: number;
  recommendations: number;
};

/**
 * Recompute every valuation against the active rule set.
 *
 * The caller owns the transaction, so `/rules` can save the new rule set and
 * recompute atomically: either the board sees the new thresholds everywhere or
 * it sees the old ones everywhere, never a half-recoloured map.
 *
 * Existing computed rows are deleted first rather than upserted, for every rule
 * set rather than only the active one. The unique keys are (collateral,
 * scenario, rule_set) and (application, scenario, rule_set), so a
 * delete-then-insert is the same shape as an upsert, it clears rows for
 * collateral that no longer exists, and it keeps the three computed tables at
 * exactly one rule set's worth of rows however many times the thresholds are
 * edited. See the comment at the delete for why the history is not kept.
 */
export async function recomputeAll(client: PoolClient): Promise<RecomputeResult> {
  const rules = await loadActiveRuleSet(client);
  const tables = await loadDamageTables(client);

  const collateralRows = await client.query(
    `SELECT id, building_type::text AS building_type, occupancy_class::text AS occupancy_class,
            appraised_value_sgd, adaptation_project_id, elevation_m
     FROM collateral ORDER BY id`,
  );

  const loanRows = await client.query(
    `SELECT id, collateral_id, segment::text AS segment, base_ltv_override
     FROM loan_applications ORDER BY id`,
  );

  const sampleRows = await client.query(
    `SELECT collateral_id, hazard::text AS hazard, scenario::text AS scenario, value, coverage::text AS coverage
     FROM hazard_samples`,
  );

  const modifierRows = await client.query(
    'SELECT collateral_id, suhi_tertile, ndvi_tertile FROM site_modifiers',
  );

  const adaptationRows = await client.query(
    'SELECT id, haircut_credit_pp FROM adaptation_projects',
  );

  /*
    The regional sea level rise at 2050, in metres, for the coastal inundation
    flag (plan 4.3.2). This row is a MEASUREMENT, not a flag: every pin has one,
    so the flag is the comparison against elevation in `coastalInundationFlag`,
    never the presence of the row.
  */
  const inundationRows = await client.query(
    `SELECT collateral_id, value FROM context_factors WHERE factor = 'sea_level_inundation'`,
  );

  const adaptation = new Map<string, AdaptationProject>();
  for (const row of adaptationRows.rows) {
    adaptation.set(String(row.id), { haircut_credit_pp: toNumber(row.haircut_credit_pp) });
  }

  const modifiers = new Map<string, SiteModifiers>();
  for (const row of modifierRows.rows) {
    modifiers.set(String(row.collateral_id), {
      suhi_tertile: Number(row.suhi_tertile),
      ndvi_tertile: Number(row.ndvi_tertile),
    });
  }

  const regionalSlr = new Map<string, number | null>();
  for (const row of inundationRows.rows) {
    regionalSlr.set(String(row.collateral_id), toNullableNumber(row.value));
  }

  /* collateral -> scenario -> hazard -> sample */
  const samples = new Map<string, Map<Scenario, SampleSet>>();
  for (const raw of sampleRows.rows as SampleRow[]) {
    const byScenario = samples.get(raw.collateral_id) ?? new Map<Scenario, SampleSet>();
    const set = byScenario.get(raw.scenario) ?? {};
    set[raw.hazard] = { value: toNullableNumber(raw.value), coverage: raw.coverage };
    byScenario.set(raw.scenario, set);
    samples.set(raw.collateral_id, byScenario);
  }

  const loansByCollateral = new Map<string, LoanRow[]>();
  for (const row of loanRows.rows) {
    const loan: LoanRow = {
      id: String(row.id),
      collateral_id: String(row.collateral_id),
      segment: row.segment,
      base_ltv_override: toNullableNumber(row.base_ltv_override),
    };
    const list = loansByCollateral.get(loan.collateral_id) ?? [];
    list.push(loan);
    loansByCollateral.set(loan.collateral_id, list);
  }

  const edges: BandEdges = {
    band_low: rules.band_low,
    band_mid: rules.band_mid,
    band_high: rules.band_high,
  };
  const years = scenarioYears(rules.today_year);

  /*
    Clear the computed tables for EVERY rule set, not just this one.

    The rule_sets rows themselves are an audit trail and are kept, but their
    computed outputs are not: each save used to leave 600 valuations, 600
    application valuations and 600 recommendations behind, so the tables grew by
    1,800 rows on every threshold edit. A rehearsal with a hundred edits reached
    60,000 rows, which slowed every dashboard and map query and eventually made
    the live AC-9 step time out.

    Nothing is lost. The figures for a superseded rule set are reproducible by
    running the recompute against it, which is the whole point of determinism,
    and every screen reads the ACTIVE rule set. This also removes a trap for any
    query that forgets to filter by rule_set_id: with one rule set's rows in the
    table, such a query reads the right numbers rather than a hundred copies.
  */
  await client.query('DELETE FROM valuations');
  await client.query('DELETE FROM application_valuations');
  await client.query('DELETE FROM recommendations');

  let valuationCount = 0;
  let applicationCount = 0;
  let recommendationCount = 0;

  for (const raw of collateralRows.rows) {
    const collateral: CollateralRow = {
      id: String(raw.id),
      building_type: raw.building_type as BuildingType,
      occupancy_class: raw.occupancy_class,
      appraised_value_sgd: toNumber(raw.appraised_value_sgd),
      adaptation_project_id: raw.adaptation_project_id ? String(raw.adaptation_project_id) : null,
      elevation_m: toNullableNumber(raw.elevation_m),
    };

    const project = collateral.adaptation_project_id
      ? (adaptation.get(collateral.adaptation_project_id) ?? null)
      : null;
    const byScenario = samples.get(collateral.id) ?? new Map<Scenario, SampleSet>();
    const loans = loansByCollateral.get(collateral.id) ?? [];
    const inundationFlag = coastalInundationFlag({
      elevation_m: collateral.elevation_m,
      regional_slr_m_2050: regionalSlr.get(collateral.id) ?? null,
      inundation_threshold_m: rules.inundation_threshold_m,
    });

    /* Value the collateral once per scenario, then reuse across its loans. */
    const valuationsByScenario = new Map<Scenario, Valuation>();

    for (const scenario of SCENARIOS) {
      const valuation = valuate({
        collateral,
        /* Collateral-level figures do not depend on the loan; the LTV does, and
           is recomputed per loan below. */
        loan: { segment: 'personal' },
        scenario,
        rules,
        samples: byScenario.get(scenario) ?? {},
        modifiers: modifiers.get(collateral.id) ?? null,
        adaptation: project,
        tables,
      });

      valuationsByScenario.set(scenario, valuation);

      await client.query(
        `INSERT INTO valuations (
           collateral_id, scenario, rule_set_id, winning_peril, depth_m, damage_fraction,
           flood_haircut_gross, adaptation_credit_documented_pp, adaptation_credit_effective_pp,
           flood_haircut, wind_haircut, heat_haircut, pm25_haircut, chronic_haircut,
           total_haircut, adjusted_value_sgd, band
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          collateral.id,
          scenario,
          rules.id,
          valuation.winning_peril,
          valuation.depth_m,
          valuation.damage_fraction,
          valuation.flood_haircut_gross,
          valuation.adaptation_credit_documented_pp,
          valuation.adaptation_credit_effective_pp,
          valuation.flood_haircut,
          valuation.wind_haircut,
          valuation.heat_haircut,
          valuation.pm25_haircut,
          valuation.chronic_haircut,
          valuation.total_haircut,
          valuation.adjusted_value_sgd,
          valuation.band,
        ],
      );
      valuationCount += 1;
    }

    /*
      revalue_by_year is a property of the APPLICATION, evaluated over the
      literal years, and stored identically on all three scenario rows.
    */
    const haircutByYear = SCENARIOS.map((scenario) => ({
      year: years[scenario],
      total_haircut: valuationsByScenario.get(scenario)?.total_haircut ?? 0,
    }));

    for (const loan of loans) {
      for (const scenario of SCENARIOS) {
        const collateralValuation = valuationsByScenario.get(scenario) as Valuation;

        /* Re-value only the loan-dependent part: the LTV and the max loan. */
        const withLoan = valuate({
          collateral,
          loan,
          scenario,
          rules,
          samples: byScenario.get(scenario) ?? {},
          modifiers: modifiers.get(collateral.id) ?? null,
          adaptation: project,
          tables,
        });

        await client.query(
          `INSERT INTO application_valuations
             (loan_application_id, scenario, rule_set_id, segment, ltv_applied, max_loan_sgd)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [loan.id, scenario, rules.id, loan.segment, withLoan.ltv_applied, withLoan.max_loan_sgd],
        );
        applicationCount += 1;

        const recommendation = recommendationFor({
          totalHaircut: collateralValuation.total_haircut,
          edges,
          haircutByYear,
          inundationFlag,
        });

        await client.query(
          `INSERT INTO recommendations
             (loan_application_id, scenario, band, conditions, revalue_by_year, refer_to_risk, rule_set_id)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
          [
            loan.id,
            scenario,
            recommendation.band satisfies Band,
            JSON.stringify(recommendation.conditions),
            recommendation.revalue_by_year,
            recommendation.refer_to_risk,
            rules.id,
          ],
        );
        recommendationCount += 1;
      }
    }
  }

  return {
    rule_set_id: rules.id,
    collateral: collateralRows.rowCount ?? 0,
    valuations: valuationCount,
    application_valuations: applicationCount,
    recommendations: recommendationCount,
  };
}
