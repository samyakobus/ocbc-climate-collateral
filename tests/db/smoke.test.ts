/**
 * Smoke assertion for the `db` Vitest project (S4).
 *
 * Proves the project reaches a real Postgres server over the wire protocol and
 * that PostGIS is present, which ADR-7 depends on: `v_hotspot_membership` is
 * the single definition of hotspot containment and it is evaluated by
 * `ST_Intersects` and `ST_DWithin`, not by application code.
 */

import { describe, expect, it } from 'vitest';

import { dbOne } from '../setup/db';

describe('db project harness', () => {
  it('reaches the database', async () => {
    const row = await dbOne<{ one: number }>('SELECT 1 AS one');
    expect(row.one).toBe(1);
  });

  it('reports a PostgreSQL server version', async () => {
    const row = await dbOne<{ version: string }>('SELECT version() AS version');
    expect(row.version).toMatch(/PostgreSQL/i);
  });

  it('has PostGIS available, which ADR-7 requires', async () => {
    const row = await dbOne<{ postgis: string }>('SELECT postgis_version() AS postgis');
    expect(row.postgis).toBeTruthy();
  });

  it('evaluates the two spatial predicates v_hotspot_membership is built on', async () => {
    const row = await dbOne<{ intersects: boolean; within: boolean }>(
      `SELECT
         ST_Intersects(
           'SRID=4326;POINT(103.9 1.30)'::geography,
           ST_Buffer('SRID=4326;POINT(103.9 1.30)'::geography, 100)
         ) AS intersects,
         ST_DWithin(
           'SRID=4326;POINT(103.9 1.30)'::geography,
           'SRID=4326;POINT(103.9 1.31)'::geography,
           2000
         ) AS within`,
    );
    expect(row.intersects).toBe(true);
    expect(row.within).toBe(true);
  });
});
