/**
 * Typed query helpers (plan 4.1, `lib/db/queries.ts`).
 *
 * S17 and AC-6 live here. `v_portfolio_summary` returns three of the four
 * headline figures grouped by `(scenario, country)`; the fourth, the top ten
 * exposed cases, is a separate ordered query, because it is a row list rather
 * than an aggregate and the plan says so explicitly.
 *
 * The queries are here rather than in the page so `scripts/verify-dashboard.ts`
 * can recompute the same four figures with no browser and no React, which is
 * what makes AC-6 checkable from a terminal in front of a director.
 */

import { query, queryOne } from './client';
import type { Band } from '@/lib/rules/bands';
import type { Scenario } from '@/components/map/scenario';

/** One row of `v_portfolio_summary`: one country at one scenario. */
export type PortfolioSummaryRow = {
  scenario: Scenario;
  country: string;
  collateral_count: number;
  collateral_value_sgd: number;
  value_amber_or_worse_sgd: number;
  share_amber_or_worse: number | null;
  total_haircut_sgd: number;
  revalue_by_2030_count: number;
};

/** The four AC-6 headline figures for one scenario, plus the per-country breakdown. */
export type PortfolioHeadline = {
  scenario: Scenario;
  collateralCount: number;
  collateralValueSgd: number;
  valueAmberOrWorseSgd: number;
  /** Portfolio-wide share, computed from the two sums. Never an average of shares. */
  shareAmberOrWorse: number;
  totalHaircutSgd: number;
  /** Scenario-invariant by construction. See `revaluationCount`. */
  revalueBy2030Count: number;
  byCountry: PortfolioSummaryRow[];
};

/** One of the ten most exposed cases. */
export type TopExposedCase = {
  collateral_id: string;
  loan_application_id: string | null;
  address_line: string;
  cluster_name: string;
  country: string;
  appraised_value_sgd: number;
  adjusted_value_sgd: number;
  total_haircut: number;
  haircut_sgd: number;
  band: Band;
};

const NUMERIC_FIELDS = [
  'collateral_count',
  'collateral_value_sgd',
  'value_amber_or_worse_sgd',
  'share_amber_or_worse',
  'total_haircut_sgd',
  'revalue_by_2030_count',
] as const;

/**
 * `pg` returns NUMERIC and BIGINT as strings, deliberately, because they can
 * exceed what a double represents exactly. Every figure here is well inside
 * that range, so coercing once at the boundary is safe and keeps `number`
 * arithmetic out of the page.
 */
function toNumbers(row: Record<string, unknown>): PortfolioSummaryRow {
  const out = { ...row } as Record<string, unknown>;
  for (const field of NUMERIC_FIELDS) {
    const value = out[field];
    out[field] = value === null || value === undefined ? null : Number(value);
  }
  return out as PortfolioSummaryRow;
}

/** Every row of `v_portfolio_summary` for one scenario, ordered by country. */
export async function portfolioSummary(scenario: Scenario): Promise<PortfolioSummaryRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT scenario::text AS scenario, country, collateral_count, collateral_value_sgd,
            value_amber_or_worse_sgd, share_amber_or_worse, total_haircut_sgd,
            revalue_by_2030_count
     FROM v_portfolio_summary
     WHERE scenario = $1::scenario
     ORDER BY country`,
    [scenario],
  );
  return rows.map(toNumbers);
}

/**
 * The four headline figures for one scenario.
 *
 * The portfolio share is the sum of the amber-or-worse values over the sum of
 * all values. Averaging the five per-country shares would weight Hong Kong's
 * 25 pins the same as Singapore's 60 and give a different, wrong number.
 */
export async function portfolioHeadline(scenario: Scenario): Promise<PortfolioHeadline> {
  const byCountry = await portfolioSummary(scenario);

  const collateralCount = byCountry.reduce((a, r) => a + r.collateral_count, 0);
  const collateralValueSgd = byCountry.reduce((a, r) => a + r.collateral_value_sgd, 0);
  const valueAmberOrWorseSgd = byCountry.reduce((a, r) => a + r.value_amber_or_worse_sgd, 0);
  const totalHaircutSgd = byCountry.reduce((a, r) => a + r.total_haircut_sgd, 0);

  return {
    scenario,
    collateralCount,
    collateralValueSgd,
    valueAmberOrWorseSgd,
    shareAmberOrWorse: collateralValueSgd === 0 ? 0 : valueAmberOrWorseSgd / collateralValueSgd,
    totalHaircutSgd,
    revalueBy2030Count: await revaluationCount(),
    byCountry,
  };
}

/**
 * Applications whose revaluation year is 2030 or earlier.
 *
 * `revalue_by_year` is a property of the APPLICATION, evaluated once over the
 * fixed list [2025, 2030, 2050] and stored identically on all three
 * `recommendations` rows. Counting rows would treble it, so this counts distinct
 * applications and takes no scenario argument at all: the figure genuinely does
 * not move with the slider, and the tile says so on screen rather than leaving
 * it to look frozen.
 */
export async function revaluationCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(DISTINCT r.loan_application_id)::int AS n
     FROM recommendations r
     JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
     WHERE r.revalue_by_year <= 2030`,
  );
  return Number(row.n);
}

/**
 * The fourth headline figure: the ten most exposed cases at one scenario.
 *
 * Ordered by the S$ the haircut removes, not by the percentage, because a 4%
 * haircut on a S$120m warehouse is a bigger hole in the book than 20% on a
 * S$800k flat, and the dashboard is a risk manager's triage list.
 */
export async function topExposedCases(
  scenario: Scenario,
  limit = 10,
): Promise<TopExposedCase[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT c.id                        AS collateral_id,
            la.id                       AS loan_application_id,
            c.address_line,
            c.cluster_name,
            c.country,
            c.appraised_value_sgd,
            v.adjusted_value_sgd,
            v.total_haircut,
            (c.appraised_value_sgd - v.adjusted_value_sgd) AS haircut_sgd,
            v.band::text                AS band
     FROM valuations v
     JOIN collateral c ON c.id = v.collateral_id
     JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
     LEFT JOIN loan_applications la ON la.collateral_id = c.id
     WHERE v.scenario = $1::scenario
     ORDER BY (c.appraised_value_sgd - v.adjusted_value_sgd) DESC, c.id
     LIMIT $2`,
    [scenario, limit],
  );

  return rows.map((row) => ({
    collateral_id: String(row.collateral_id),
    loan_application_id: row.loan_application_id === null ? null : String(row.loan_application_id),
    address_line: String(row.address_line),
    cluster_name: String(row.cluster_name),
    country: String(row.country).trim(),
    appraised_value_sgd: Number(row.appraised_value_sgd),
    adjusted_value_sgd: Number(row.adjusted_value_sgd),
    total_haircut: Number(row.total_haircut),
    haircut_sgd: Number(row.haircut_sgd),
    band: row.band as Band,
  }));
}

/** True once `db:recompute` has written valuations, so the page can say so instead of rendering zeros. */
export async function hasValuations(): Promise<boolean> {
  const row = await queryOne<{ n: string }>('SELECT count(*)::int AS n FROM valuations');
  return Number(row.n) > 0;
}
