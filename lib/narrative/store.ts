/**
 * Reading the facts a narrative may use, and storing what came back (S25, AC-10).
 *
 * The facts are READ FROM THE STORED ROWS, never recomputed: the whitelist a
 * narrative is checked against has to be the same figures the case screen
 * renders, or a sentence can be rejected for quoting a number that is visibly on
 * the page. `lib/valuation` computed them, `npm run db:recompute` stored them,
 * and this reads them back.
 *
 * Both functions take an injected client, so the prep script and the regenerate
 * route write a narrative row exactly the same way, and the db tests can drive
 * the whole pass with a stubbed model client.
 *
 * Not in plan section 4.1's file list, for the same reason `lib/index/store.ts`
 * is not; recorded in section 10.
 */

import { labelOfScenario } from '@/components/map/scenario';
import type { Queryable } from '@/lib/index/inputs';
import type { Band } from '@/lib/rules/bands';
import type { Scenario } from '@/lib/valuation/hazards';
import type { CaseFacts, PortfolioFacts } from '@/lib/narrative/prompt';
import type { NarrativeOutcome } from '@/lib/narrative/validate';

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One `CaseFacts` per collateral, for one scenario.
 *
 * `collateralIds` narrows it to the demo's pinned fixtures; without it the pass
 * covers the whole seeded book. The join is on the ACTIVE rule set, so a
 * narrative can never describe figures from a rule set the risk manager has
 * already replaced.
 */
export async function loadCaseFacts(
  client: Queryable,
  scenario: Scenario,
  collateralIds?: readonly string[],
): Promise<CaseFacts[]> {
  const { rows } = await client.query(
    `SELECT c.id AS collateral_id, la.id AS loan_application_id,
            c.address_line, c.cluster_name, c.country,
            c.building_type::text AS building_type, c.landslide_flag,
            c.appraised_value_sgd::float8 AS appraised_value_sgd,
            la.requested_amount::float8 AS requested_amount,
            v.flood_haircut::float8 AS flood_haircut,
            v.wind_haircut::float8 AS wind_haircut,
            v.heat_haircut::float8 AS heat_haircut,
            v.pm25_haircut::float8 AS pm25_haircut,
            v.chronic_haircut::float8 AS chronic_haircut,
            v.total_haircut::float8 AS total_haircut,
            v.adjusted_value_sgd::float8 AS adjusted_value_sgd,
            v.adaptation_credit_documented_pp::float8 AS adaptation_credit_documented_pp,
            v.adaptation_credit_effective_pp::float8 AS adaptation_credit_effective_pp,
            v.band::text AS band,
            av.ltv_applied::float8 AS ltv_applied,
            av.max_loan_sgd::float8 AS max_loan_sgd,
            r.conditions, r.revalue_by_year, r.refer_to_risk
       FROM collateral c
       JOIN loan_applications la ON la.collateral_id = c.id
       JOIN valuations v ON v.collateral_id = c.id AND v.scenario = $1
       JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
       LEFT JOIN application_valuations av
              ON av.loan_application_id = la.id AND av.scenario = $1
             AND av.rule_set_id = v.rule_set_id
       LEFT JOIN recommendations r
              ON r.loan_application_id = la.id AND r.scenario = $1
             AND r.rule_set_id = v.rule_set_id
      WHERE $2::text[] IS NULL OR c.id = ANY($2::text[])
      ORDER BY c.id`,
    [scenario, collateralIds ? [...collateralIds] : null],
  );

  return rows.map((row) => ({
    loan_application_id: String(row.loan_application_id),
    collateral_id: String(row.collateral_id),
    address_line: String(row.address_line),
    cluster_name: String(row.cluster_name),
    country: String(row.country),
    building_type: String(row.building_type),
    scenario,
    scenario_label: labelOfScenario(scenario),

    appraised_value_sgd: num(row.appraised_value_sgd),
    adjusted_value_sgd: num(row.adjusted_value_sgd),
    requested_amount: num(row.requested_amount),

    flood_haircut: num(row.flood_haircut),
    wind_haircut: num(row.wind_haircut),
    heat_haircut: num(row.heat_haircut),
    pm25_haircut: num(row.pm25_haircut),
    chronic_haircut: num(row.chronic_haircut),
    total_haircut: num(row.total_haircut),
    adaptation_credit_documented_pp: num(row.adaptation_credit_documented_pp),
    adaptation_credit_effective_pp: num(row.adaptation_credit_effective_pp),

    ltv_applied: nullableNum(row.ltv_applied),
    max_loan_sgd: nullableNum(row.max_loan_sgd),

    band: String(row.band) as Band,
    conditions: Array.isArray(row.conditions) ? (row.conditions as string[]) : [],
    revalue_by_year: nullableNum(row.revalue_by_year),
    refer_to_risk: Boolean(row.refer_to_risk),
    landslide_flag: Boolean(row.landslide_flag),
  }));
}

/**
 * The dashboard's own figures, for one scenario.
 *
 * Summed from `v_portfolio_summary`, which is grouped by (scenario, country),
 * so the portfolio narrative quotes the same four headline numbers AC-6 checks
 * rather than a second count of its own.
 */
export async function loadPortfolioFacts(
  client: Queryable,
  scenario: Scenario,
): Promise<PortfolioFacts> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(collateral_count), 0)::int AS collateral_count,
            COALESCE(SUM(collateral_value_sgd), 0)::float8 AS collateral_value_sgd,
            COALESCE(SUM(value_amber_or_worse_sgd), 0)::float8 AS value_amber_or_worse_sgd,
            COALESCE(SUM(total_haircut_sgd), 0)::float8 AS total_haircut_sgd
       FROM v_portfolio_summary
      WHERE scenario = $1`,
    [scenario],
  );

  const revaluation = await client.query(
    `SELECT COUNT(DISTINCT r.loan_application_id)::int AS n
       FROM recommendations r
       JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
      WHERE r.revalue_by_year IS NOT NULL AND r.revalue_by_year <= 2030`,
  );

  const row = rows[0] ?? {};
  const value = num(row.collateral_value_sgd);
  const amber = num(row.value_amber_or_worse_sgd);

  return {
    scenario,
    scenario_label: labelOfScenario(scenario),
    collateral_count: num(row.collateral_count),
    collateral_value_sgd: value,
    value_amber_or_worse_sgd: amber,
    share_amber_or_worse: value > 0 ? amber / value : 0,
    total_haircut_sgd: num(row.total_haircut_sgd),
    revaluation_count: num(revaluation.rows[0]?.n),
  };
}

export type NarrativeSubject = 'case' | 'portfolio' | 'hotspot';

/**
 * Replace the narrative for one subject and scenario.
 *
 * Delete then insert, rather than append. `narratives` carries no unique key on
 * (subject_type, subject_id, scenario), so a second prep run would otherwise
 * leave two rows for one case and the case screen would show whichever the
 * planner happened to return first.
 */
export async function saveNarrative(
  client: Queryable,
  subject: { type: NarrativeSubject; id: string; scenario: Scenario },
  outcome: NarrativeOutcome,
  promptHash: string | null = null,
): Promise<void> {
  await client.query(
    `DELETE FROM narratives
      WHERE subject_type = $1::narrative_subject AND subject_id = $2 AND scenario = $3::scenario`,
    [subject.type, subject.id, subject.scenario],
  );

  await client.query(
    `INSERT INTO narratives
       (subject_type, subject_id, scenario, text, model, prompt_hash, validated, fallback_used)
     VALUES ($1::narrative_subject, $2, $3::scenario, $4, $5, $6, $7, $8)`,
    [
      subject.type,
      subject.id,
      subject.scenario,
      outcome.text,
      outcome.model,
      promptHash,
      outcome.validated,
      outcome.fallback_used,
    ],
  );
}

export type StoredNarrative = {
  text: string;
  model: string | null;
  validated: boolean;
  fallback_used: boolean;
  generated_at: string | null;
};

/** The stored narrative for one subject, or null. Read on the case screen. */
export async function loadNarrative(
  client: Queryable,
  subject: { type: NarrativeSubject; id: string; scenario: Scenario },
): Promise<StoredNarrative | null> {
  const { rows } = await client.query(
    `SELECT text, model, validated, fallback_used, generated_at
       FROM narratives
      WHERE subject_type = $1::narrative_subject AND subject_id = $2 AND scenario = $3::scenario
      ORDER BY generated_at DESC
      LIMIT 1`,
    [subject.type, subject.id, subject.scenario],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    text: String(row.text),
    model: row.model === null ? null : String(row.model),
    validated: Boolean(row.validated),
    fallback_used: Boolean(row.fallback_used),
    generated_at: row.generated_at instanceof Date ? row.generated_at.toISOString() : null,
  };
}
