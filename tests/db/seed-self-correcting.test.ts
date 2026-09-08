/**
 * tests/db/seed-self-correcting.test.ts
 *
 * The reference seed is authoritative for the four curated tables, not merely
 * additive: re-running it removes rows it no longer claims.
 *
 * This exists because the additive version failed in a way nothing caught.
 * Seven adaptation projects seeded under the old uppercase ids survived the
 * switch to lowercase slugs, because an upsert keyed on id has no reason to
 * look for rows the seed has stopped claiming. The database would have carried
 * fourteen adaptation projects where the plan says seven, and the first symptom
 * would have been a wrong figure rather than a red test.
 *
 * Each case plants a stray row, re-seeds, and asserts the stray is gone and the
 * real rows are untouched.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedDatabase } from '../../scripts/seed';
import { dbOne, dbQuery } from '../setup/db';

const DATABASE_URL = process.env.DATABASE_URL as string;

async function reseed(): Promise<void> {
  await seedDatabase(DATABASE_URL, { log: () => {} });
}

async function countOf(table: string): Promise<number> {
  const row = await dbOne<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return row.n;
}

let originalActiveId: string | undefined;

beforeAll(async () => {
  const row = await dbOne<{ id: string }>('SELECT id FROM rule_sets WHERE is_active');
  originalActiveId = row.id;
});

afterAll(async () => {
  /*
    Re-seeding writes a NEW active rule set each time and deactivates the old
    one, which is correct behaviour and an audit trail. But every valuation row
    references the rule set it was computed against, so leaving a newer one
    active would orphan all 600 of them and the fixture tests would find no
    active-rule-set row. Restore the original, and delete the rule sets this
    file created so the audit trail is not littered with test artefacts.
  */
  await reseed();
  await dbQuery('UPDATE rule_sets SET is_active = false WHERE is_active');
  await dbQuery('DELETE FROM rule_sets WHERE id > $1', [originalActiveId]);
  await dbQuery('UPDATE rule_sets SET is_active = true WHERE id = $1', [originalActiveId]);
});

describe('re-seeding removes curated rows the seed no longer claims', () => {
  it('removes a stray adaptation project, the case that actually happened', async () => {
    await dbQuery(
      `INSERT INTO adaptation_projects
         (id, name, country, haircut_credit_pp, source_name, source_url)
       VALUES ('SG-MARINA-BARRAGE', 'Stale uppercase id', 'SG', 1.50, 'stale', 'https://example.invalid')`,
    );
    expect(await countOf('adaptation_projects')).toBe(8);

    await reseed();

    const rows = await dbQuery<{ id: string }>('SELECT id FROM adaptation_projects ORDER BY id');
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.id === r.id.toLowerCase())).toBe(true);
  });

  it('removes a stray hazard_applicability row for an unlisted country', async () => {
    await dbQuery(
      `INSERT INTO hazard_applicability (hazard, country, scored, reason, source_url)
       VALUES ('wind', 'TH', false, 'not a market', 'https://example.invalid')`,
    );
    expect(await countOf('hazard_applicability')).toBe(26);

    await reseed();

    expect(await countOf('hazard_applicability')).toBe(25);
    const stray = await dbQuery("SELECT 1 FROM hazard_applicability WHERE country = 'TH'");
    expect(stray).toHaveLength(0);
  });

  it('removes a stray depth-damage curve', async () => {
    /* damage_class is UNIQUE, so a stray needs a class the seed does not claim.
       All three are claimed, which is itself the assertion worth making. */
    const classes = await dbQuery<{ damage_class: string }>(
      'SELECT damage_class::text FROM depth_damage_functions',
    );
    expect(classes).toHaveLength(3);

    await reseed();
    expect(await countOf('depth_damage_functions')).toBe(3);
  });

  it('leaves the seeded rows themselves untouched across a re-seed', async () => {
    const before = await dbQuery<{ id: string; haircut_credit_pp: string }>(
      'SELECT id, haircut_credit_pp FROM adaptation_projects ORDER BY id',
    );

    await reseed();

    const after = await dbQuery<{ id: string; haircut_credit_pp: string }>(
      'SELECT id, haircut_credit_pp FROM adaptation_projects ORDER BY id',
    );
    expect(after).toEqual(before);
    expect(await countOf('building_damage_class')).toBe(6);
    expect(await countOf('users')).toBe(3);
  });

  it('keeps exactly one active rule set, however many times it is seeded', async () => {
    await reseed();
    const row = await dbOne<{ n: number }>(
      'SELECT count(*)::int AS n FROM rule_sets WHERE is_active',
    );
    expect(row.n).toBe(1);
  });
});
