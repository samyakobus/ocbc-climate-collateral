/**
 * tests/db/rule-edit-recompute.test.ts - AC-9.
 *
 * Editing a threshold writes a NEW active rule set, recomputes every case, and
 * leaves the previous rule set in place but inactive. This is the one step of
 * the demo performed live, so what it asserts is the whole sequence, not just
 * that a row changed.
 *
 * It also pins the LTV precedence, because a per-case override has to survive a
 * global edit: the risk manager's change moves every case that has no override
 * and leaves the ones that do.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recompute } from '../../scripts/recompute';
import { dbOne, dbQuery } from '../setup/db';

const DATABASE_URL = process.env.DATABASE_URL as string;

let originalActiveId: string;
let createdIds: string[] = [];

/** The shape of the /rules save: deactivate, insert active, recompute. */
async function saveNewRuleSet(changes: Record<string, number | boolean>): Promise<string> {
  const columns = Object.keys(changes);
  const values = Object.values(changes);

  await dbQuery('UPDATE rule_sets SET is_active = false WHERE is_active');

  const inserted = await dbOne<{ id: string }>(
    `INSERT INTO rule_sets (is_active, ${columns.join(', ')}, updated_by)
     VALUES (true, ${columns.map((_, i) => `$${i + 1}`).join(', ')},
             (SELECT id FROM users WHERE email = 'risk@ocbc.demo'))
     RETURNING id`,
    values,
  );

  createdIds.push(inserted.id);
  await recompute(DATABASE_URL);
  return inserted.id;
}

async function bandCounts(ruleSetId: string) {
  const rows = await dbQuery<{ band: string; n: number }>(
    `SELECT band::text AS band, count(*)::int AS n FROM valuations
     WHERE scenario = 'y2050' AND rule_set_id = $1 GROUP BY 1 ORDER BY 1`,
    [ruleSetId],
  );
  return Object.fromEntries(rows.map((r) => [r.band, r.n])) as Record<string, number>;
}

beforeAll(async () => {
  const row = await dbOne<{ id: string }>('SELECT id FROM rule_sets WHERE is_active');
  originalActiveId = row.id;
});

afterAll(async () => {
  /* Restore the exact rule set the other db tests expect to be active, and
     remove the ones this file created so the audit trail stays clean. */
  await dbQuery('UPDATE rule_sets SET is_active = false WHERE is_active');
  for (const id of createdIds) {
    await dbQuery('DELETE FROM rule_sets WHERE id = $1', [id]);
  }
  createdIds = [];
  await dbQuery('UPDATE rule_sets SET is_active = true WHERE id = $1', [originalActiveId]);
  await recompute(DATABASE_URL);
});

describe('AC-9: editing a band edge moves cases between bands', () => {
  it('recolours pins and keeps the previous rule set inactive rather than deleted', async () => {
    const before = await bandCounts(originalActiveId);
    expect(before.orange).toBeGreaterThan(0);

    /* The demo's edit: raise the mid band from 10 percent to 12 percent. */
    const newId = await saveNewRuleSet({ band_mid: 0.12 });
    expect(newId).not.toBe(originalActiveId);

    const after = await bandCounts(newId);

    /* Cases between 10 and 12 percent move from orange down to amber. */
    expect(after.amber).toBeGreaterThan(before.amber);
    expect(after.orange).toBeLessThan(before.orange);
    /* The band edges moved, not the haircuts, so the totals are unchanged. */
    const totalBefore = Object.values(before).reduce((a, b) => a + b, 0);
    const totalAfter = Object.values(after).reduce((a, b) => a + b, 0);
    expect(totalAfter).toBe(totalBefore);

    /* The previous rule set survives, inactive, so the old figures remain. */
    const previous = await dbOne<{ is_active: boolean }>(
      'SELECT is_active FROM rule_sets WHERE id = $1',
      [originalActiveId],
    );
    expect(previous.is_active).toBe(false);

    const active = await dbOne<{ n: number }>(
      'SELECT count(*)::int AS n FROM rule_sets WHERE is_active',
    );
    expect(active.n).toBe(1);
  });

  it('moves the realistic Singapore case out of the 10-20 band at a 12 percent edge', async () => {
    /* SG-EC-002 sits at 10.1 percent, just inside the old mid band. */
    const newId = await saveNewRuleSet({ band_mid: 0.12 });

    const row = await dbOne<{ band: string; total_haircut: string }>(
      `SELECT band::text AS band, total_haircut FROM valuations
       WHERE collateral_id = 'SG-EC-002' AND scenario = 'y2050' AND rule_set_id = $1`,
      [newId],
    );

    expect(Number(row.total_haircut)).toBeCloseTo(0.101, 3);
    expect(row.band).toBe('amber');

    /* Its conditions follow the band, so the LTV cap requirement is dropped. */
    const recommendation = await dbOne<{ conditions: string[] }>(
      `SELECT conditions FROM recommendations rec
       JOIN loan_applications l ON l.id = rec.loan_application_id
       WHERE l.collateral_id = 'SG-EC-002' AND rec.scenario = 'y2050' AND rec.rule_set_id = $1`,
      [newId],
    );
    expect(recommendation.conditions).toHaveLength(1);
  });

  it('changes recommendations, not only colours', async () => {
    /* Dropping the top edge to 15 percent refers more cases to risk. */
    const beforeReferrals = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM recommendations
       WHERE scenario = 'y2050' AND refer_to_risk AND rule_set_id = $1`,
      [originalActiveId],
    );

    const newId = await saveNewRuleSet({ band_high: 0.15 });

    const afterReferrals = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM recommendations
       WHERE scenario = 'y2050' AND refer_to_risk AND rule_set_id = $1`,
      [newId],
    );

    expect(afterReferrals.n).toBeGreaterThan(beforeReferrals.n);
  });
});

describe('AC-9: LTV precedence survives a global edit', () => {
  it('moves every case with no override, and leaves an overridden one alone', async () => {
    const target = await dbOne<{ id: string }>(
      `SELECT id FROM loan_applications WHERE segment = 'personal'
         AND base_ltv_override IS NULL ORDER BY id LIMIT 1`,
    );

    await dbQuery('UPDATE loan_applications SET base_ltv_override = 0.500 WHERE id = $1', [
      target.id,
    ]);

    try {
      const newId = await saveNewRuleSet({ base_ltv_personal: 0.65 });

      const overridden = await dbOne<{ ltv_applied: string }>(
        `SELECT ltv_applied FROM application_valuations
         WHERE loan_application_id = $1 AND scenario = 'y2050' AND rule_set_id = $2`,
        [target.id, newId],
      );
      expect(Number(overridden.ltv_applied)).toBe(0.5);

      const others = await dbQuery<{ ltv_applied: string }>(
        `SELECT DISTINCT ltv_applied FROM application_valuations av
         JOIN loan_applications l ON l.id = av.loan_application_id
         WHERE l.segment = 'personal' AND l.base_ltv_override IS NULL
           AND av.scenario = 'y2050' AND av.rule_set_id = $1`,
        [newId],
      );
      expect(others).toHaveLength(1);
      expect(Number(others[0].ltv_applied)).toBe(0.65);
    } finally {
      await dbQuery('UPDATE loan_applications SET base_ltv_override = NULL WHERE id = $1', [
        target.id,
      ]);
    }
  });
});
