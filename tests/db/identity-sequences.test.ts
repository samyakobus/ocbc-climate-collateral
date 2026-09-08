/**
 * tests/db/identity-sequences.test.ts - the seeded identity trap.
 *
 * Curated tables carry explicit TEXT ids; machine tables use BIGINT identity
 * columns. Seeding a machine table with explicit ids leaves its sequence at 1,
 * so the next id-less insert collides on the primary key.
 *
 * That failure would not appear at seed time. It would appear the first time
 * the risk manager saves on `/rules`, which writes a new active `rule_sets` row
 * with no id, which is AC-9, performed live in front of the board. This test
 * makes it a red test on Day 1 instead.
 *
 * `scripts/seed.ts` calls `syncIdentitySequences` after applying every seed
 * file, and this asserts that it worked.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

let inserted: string[] = [];
let originalActiveId: string | undefined;

beforeAll(async () => {
  const row = await dbOne<{ id: string }>('SELECT id FROM rule_sets WHERE is_active');
  originalActiveId = row.id;
});

afterEach(async () => {
  /*
    Restore the EXACT rule set that was active before, not merely the highest
    id. Every valuation row references the rule set it was computed against, so
    activating a different one silently orphans all 600 of them and the fixture
    tests then find no active-rule-set row at all.
  */
  for (const id of inserted) {
    await dbQuery('DELETE FROM rule_sets WHERE id = $1', [id]);
  }
  inserted = [];

  await dbQuery('UPDATE rule_sets SET is_active = false WHERE is_active');
  await dbQuery('UPDATE rule_sets SET is_active = true WHERE id = $1', [originalActiveId]);
});

describe('identity sequences after seeding', () => {
  it('accepts an id-less insert into rule_sets, which is what AC-9 does on save', async () => {
    /* Exactly the shape of the threshold editor's save: deactivate, insert new. */
    await dbQuery('UPDATE rule_sets SET is_active = false WHERE is_active');

    const row = await dbOne<{ id: string }>(
      `INSERT INTO rule_sets (is_active, band_mid, updated_by)
       VALUES (true, 0.1200, (SELECT id FROM users WHERE email = 'risk@ocbc.demo'))
       RETURNING id`,
    );

    expect(row.id).toBeTruthy();
    inserted.push(row.id);

    const active = await dbOne<{ id: string; band_mid: string }>(
      'SELECT id, band_mid FROM rule_sets WHERE is_active',
    );
    expect(active.id).toBe(row.id);
    expect(Number(active.band_mid)).toBe(0.12);
  });

  it('has advanced every identity sequence past its seeded rows', async () => {
    const columns = await dbQuery<{ table_name: string; column_name: string }>(`
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.is_identity = 'YES'
      ORDER BY c.table_name
    `);

    expect(columns.length).toBeGreaterThan(0);

    for (const { table_name, column_name } of columns) {
      const bounds = await dbOne<{ sequence_name: string | null; max_id: string | null }>(
        `SELECT pg_get_serial_sequence($1, $2) AS sequence_name,
                (SELECT max(${column_name}) FROM ${table_name})::text AS max_id`,
        [table_name, column_name],
      );

      if (bounds.max_id === null) continue; /* Empty table: nothing to outrun yet. */
      expect(bounds.sequence_name).toBeTruthy();

      /*
        Read the sequence relation directly rather than pg_sequences, whose
        last_value is NULL until the sequence has actually been read. A freshly
        setval'd sequence with is_called false is exactly the state seeding
        leaves behind, so the catalogue view reports nothing for precisely the
        sequences this test exists to check. The next value nextval() will hand
        out is last_value plus one when is_called, and last_value otherwise.
      */
      const sequence = await dbOne<{ last_value: string; is_called: boolean }>(
        `SELECT last_value, is_called FROM ${bounds.sequence_name}`,
      );
      const nextValue = Number(sequence.last_value) + (sequence.is_called ? 1 : 0);

      expect(
        nextValue,
        `${table_name}.${column_name} would reissue an id already in the table`,
      ).toBeGreaterThan(Number(bounds.max_id));
    }
  });
});
