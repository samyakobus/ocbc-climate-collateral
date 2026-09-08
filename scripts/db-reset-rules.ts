/**
 * npm run db:reset-rules
 *
 * Puts the shared development database back to the seeded rule set.
 *
 * Why this exists. `/rules` writes a NEW active `rule_sets` row on every save,
 * which is exactly what AC-9 requires, and `tests/e2e/rule-edit.spec.ts` saves
 * on every Playwright run. After a day of runs the shared instance held **114**
 * rule-set rows, none of them the seeded one, with the active flag on a row a
 * test had created and `band_mid` left at whatever that test last set. Every
 * figure on the dashboard then describes a rule set nobody chose.
 *
 * That is not a defect in the editor. It is what a shared database looks like
 * after a test suite has used it, and the fix is a command that undoes it rather
 * than a rule telling people not to run tests.
 *
 * What it does, in order:
 *
 *   1. keeps the OLDEST rule set, which is the one `02_reference.sql` seeded,
 *      and deletes every other row;
 *   2. resets that row's constants to `RULE_SET_SEED_DEFAULTS` and reactivates
 *      it, so a test that edited the seeded row in place is undone too;
 *   3. recomputes every valuation against it;
 *   4. reports the four headline figures so the caller can see it worked.
 *
 * Deleting a rule set cascades to its `valuations`, `application_valuations` and
 * `recommendations`, which is why the recompute comes after rather than before.
 *
 *   npm run db:reset-rules              reset, recompute, report
 *   npm run db:reset-rules -- --dry-run report what it would do and change nothing
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { Pool } from 'pg';
import 'dotenv/config';

import { RULE_SET_SEED_DEFAULTS } from '../lib/rules/bands';
import { recomputeAll } from '../lib/valuation/recompute';

type Survey = {
  total: number;
  active: number;
  seededId: string | null;
  seededDrifted: boolean;
};

async function survey(pool: Pool): Promise<Survey> {
  const { rows } = await pool.query<{
    id: string;
    is_active: boolean;
    band_mid: string;
    band_low: string;
    band_high: string;
    total_cap: string;
    chronic_cap: string;
    p_2050: string;
    base_ltv_personal: string;
    base_ltv_corporate: string;
    adaptation_enabled: boolean;
  }>(
    `SELECT id, is_active, band_low::text, band_mid::text, band_high::text,
            total_cap::text, chronic_cap::text, p_2050::text,
            base_ltv_personal::text, base_ltv_corporate::text, adaptation_enabled
     FROM rule_sets ORDER BY id`,
  );

  const seeded = rows[0];
  const drifted =
    seeded !== undefined &&
    (Number(seeded.band_low) !== RULE_SET_SEED_DEFAULTS.band_low ||
      Number(seeded.band_mid) !== RULE_SET_SEED_DEFAULTS.band_mid ||
      Number(seeded.band_high) !== RULE_SET_SEED_DEFAULTS.band_high ||
      Number(seeded.total_cap) !== RULE_SET_SEED_DEFAULTS.total_cap ||
      Number(seeded.chronic_cap) !== RULE_SET_SEED_DEFAULTS.chronic_cap ||
      Number(seeded.p_2050) !== RULE_SET_SEED_DEFAULTS.p_2050 ||
      Number(seeded.base_ltv_personal) !== RULE_SET_SEED_DEFAULTS.base_ltv_personal ||
      Number(seeded.base_ltv_corporate) !== RULE_SET_SEED_DEFAULTS.base_ltv_corporate ||
      seeded.adaptation_enabled !== RULE_SET_SEED_DEFAULTS.adaptation_enabled);

  return {
    total: rows.length,
    active: rows.filter((r) => r.is_active).length,
    seededId: seeded?.id ?? null,
    seededDrifted: drifted,
  };
}

export async function resetRules(
  connectionString: string,
  options: { dryRun?: boolean; log?: (msg: string) => void } = {},
): Promise<{ removed: number; seededId: string; recomputed: number }> {
  const log = options.log ?? ((msg: string) => console.log(msg));
  const pool = new Pool({ connectionString, max: 2 });

  try {
    const before = await survey(pool);
    if (before.seededId === null) {
      throw new Error('rule_sets is empty. Run `npm run db:seed` first.');
    }

    log(`[reset-rules] ${before.total} rule set(s), ${before.active} active`);
    log(`[reset-rules] seeded rule set is id ${before.seededId}` +
      (before.seededDrifted ? ', and its constants have drifted from the seed defaults' : ''));

    const removable = before.total - 1;
    if (options.dryRun) {
      log(`[reset-rules] --dry-run: would delete ${removable} test-created rule set(s),`);
      log(`[reset-rules] --dry-run: reset id ${before.seededId} to the seed defaults, reactivate it,`);
      log('[reset-rules] --dry-run: and recompute. Nothing changed.');
      return { removed: 0, seededId: before.seededId, recomputed: 0 };
    }

    const client = await pool.connect();
    let removed = 0;

    try {
      await client.query('BEGIN');

      // Clear the flag first. The partial unique index allows exactly one active
      // row, so reactivating the seeded one while another is still active fails.
      await client.query('UPDATE rule_sets SET is_active = false WHERE is_active');

      const deleted = await client.query(
        'DELETE FROM rule_sets WHERE id <> $1',
        [before.seededId],
      );
      removed = deleted.rowCount ?? 0;

      // Reset in place, so a test that edited the seeded row rather than adding
      // one is undone as well.
      await client.query(
        `UPDATE rule_sets SET
           is_active = true,
           base_ltv_personal = $2, base_ltv_corporate = $3,
           band_low = $4, band_mid = $5, band_high = $6,
           total_cap = $7, chronic_cap = $8,
           p_today = $9, p_2030 = $10, p_2050 = $11,
           today_year = $12, today_label = $13, return_period = $14,
           inundation_threshold_m = $15, adaptation_enabled = $16,
           updated_at = now()
         WHERE id = $1`,
        [
          before.seededId,
          RULE_SET_SEED_DEFAULTS.base_ltv_personal,
          RULE_SET_SEED_DEFAULTS.base_ltv_corporate,
          RULE_SET_SEED_DEFAULTS.band_low,
          RULE_SET_SEED_DEFAULTS.band_mid,
          RULE_SET_SEED_DEFAULTS.band_high,
          RULE_SET_SEED_DEFAULTS.total_cap,
          RULE_SET_SEED_DEFAULTS.chronic_cap,
          RULE_SET_SEED_DEFAULTS.p_today,
          RULE_SET_SEED_DEFAULTS.p_2030,
          RULE_SET_SEED_DEFAULTS.p_2050,
          RULE_SET_SEED_DEFAULTS.today_year,
          RULE_SET_SEED_DEFAULTS.today_label,
          RULE_SET_SEED_DEFAULTS.return_period,
          RULE_SET_SEED_DEFAULTS.inundation_threshold_m,
          RULE_SET_SEED_DEFAULTS.adaptation_enabled,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    log(`[reset-rules] deleted ${removed} test-created rule set(s)`);
    log(`[reset-rules] id ${before.seededId} reset to the seed defaults and reactivated`);

    // Deleting a rule set cascaded its valuations away, so recompute now.
    const recomputeClient = await pool.connect();
    let recomputed = 0;
    try {
      await recomputeClient.query('BEGIN');
      const result = await recomputeAll(recomputeClient);
      await recomputeClient.query('COMMIT');
      recomputed = result.valuations ?? 0;
    } catch (error) {
      await recomputeClient.query('ROLLBACK');
      throw error;
    } finally {
      recomputeClient.release();
    }

    log(`[reset-rules] recomputed ${recomputed} valuations`);

    const after = await survey(pool);
    if (after.total !== 1 || after.active !== 1 || after.seededDrifted) {
      throw new Error(
        `reset did not settle: ${after.total} rule set(s), ${after.active} active, ` +
          `drifted=${after.seededDrifted}`,
      );
    }

    return { removed, seededId: before.seededId, recomputed };
  } finally {
    await pool.end();
  }
}

async function report(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const { rows } = await pool.query<{
      scenario: string;
      value_amber: string;
      value_total: string;
      haircut: string;
      revalue: string;
    }>(
      `SELECT scenario::text AS scenario,
              sum(value_amber_or_worse_sgd)::text AS value_amber,
              sum(collateral_value_sgd)::text AS value_total,
              sum(total_haircut_sgd)::text AS haircut,
              max(revalue_by_2030_count)::text AS revalue
       FROM v_portfolio_summary GROUP BY scenario ORDER BY scenario`,
    );

    console.log('\n[reset-rules] headline figures against the seeded rule set:');
    for (const row of rows) {
      const share = (Number(row.value_amber) / Number(row.value_total)) * 100;
      console.log(
        `  ${row.scenario.padEnd(6)} amber-or-worse ${share.toFixed(2).padStart(6)}%   ` +
          `haircut S$${Number(row.haircut).toLocaleString('en-SG', { maximumFractionDigits: 0 }).padStart(13)}   ` +
          `revaluation by 2030: ${row.revalue}`,
      );
    }
    console.log('\n[reset-rules] run `npm run verify:dashboard` to check these against the base tables.\n');
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[reset-rules] DATABASE_URL is not set. Copy .env.example to .env.');
    process.exit(1);
  }

  const dryRun = process.argv.slice(2).includes('--dry-run');
  await resetRules(connectionString, { dryRun });

  if (!dryRun) await report(connectionString);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[reset-rules] ${(err as Error).message}`);
    process.exit(1);
  });
}
