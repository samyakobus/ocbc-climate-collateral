/**
 * tests/db/hotspot-exposure.test.ts - AC-15.
 *
 * ADR-7 makes `v_hotspot_membership` the single definition of which collateral
 * belongs to which hotspot, and `v_hotspot_exposure` the single writer of the
 * exposure figure. This file holds that from four directions:
 *
 *   1. for one POLYGON hotspot, the view's exposure equals a hand-written sum
 *      over the collateral the polygon contains;
 *   2. for one RADIUS hotspot, the same, using the distance predicate;
 *   3. where `score_inputs` has been snapshotted, the figure inside it equals
 *      the view, so the prompt and the popup cannot disagree;
 *   4. the CHECK constraint rejects a hotspot carrying both shapes, which is
 *      what makes the membership UNION incapable of double counting.
 *
 * The hand-written sums are deliberately not the view's own SQL. A test that
 * reruns the definition it is checking proves only that the database is
 * deterministic.
 */

import { describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

type Shape = { id: string; name: string; exposure: string; share: string };

async function aPolygonHotspot(): Promise<Shape> {
  return dbOne<Shape>(
    `SELECT h.id, h.name, e.loan_exposure_sgd AS exposure, e.exposure_share AS share
       FROM hotspots h JOIN v_hotspot_exposure e ON e.hotspot_id = h.id
      WHERE h.area IS NOT NULL
      ORDER BY e.loan_exposure_sgd DESC LIMIT 1`,
  );
}

async function aRadiusHotspot(): Promise<Shape> {
  return dbOne<Shape>(
    `SELECT h.id, h.name, e.loan_exposure_sgd AS exposure, e.exposure_share AS share
       FROM hotspots h JOIN v_hotspot_exposure e ON e.hotspot_id = h.id
      WHERE h.radius_m IS NOT NULL
      ORDER BY e.loan_exposure_sgd DESC LIMIT 1`,
  );
}

describe('every hotspot has exactly one shape', () => {
  it('splits the 16 hotspots between polygons and radii, with none carrying both', async () => {
    const row = await dbOne<{ total: string; polygons: string; radii: string; both: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE area IS NOT NULL) AS polygons,
              count(*) FILTER (WHERE radius_m IS NOT NULL) AS radii,
              count(*) FILTER (WHERE area IS NOT NULL AND radius_m IS NOT NULL) AS both
         FROM hotspots`,
    );

    expect(Number(row.both)).toBe(0);
    expect(Number(row.polygons) + Number(row.radii)).toBe(Number(row.total));
    expect(Number(row.polygons)).toBeGreaterThan(0);
    expect(Number(row.radii)).toBeGreaterThan(0);
  });

  it('rejects a hotspot carrying both shapes, so the UNION cannot double count', async () => {
    await expect(
      dbQuery(
        `INSERT INTO hotspots (id, name, country, centroid, area, radius_m, hazard_type)
         VALUES ('HS-INVALID', 'both shapes', 'SG',
                 ST_SetSRID(ST_MakePoint(103.85, 1.29), 4326)::geography,
                 ST_SetSRID(ST_Buffer(ST_MakePoint(103.85, 1.29)::geography, 1000)::geometry, 4326)::geography,
                 1000, 'flood_coastal')`,
      ),
    ).rejects.toThrow(/hotspots_exactly_one_shape/);
  });
});

describe('a polygon hotspot exposure equals a direct sum over what it contains', () => {
  it('matches a hand-written ST_Intersects sum', async () => {
    const hotspot = await aPolygonHotspot();

    const direct = await dbOne<{ total: string; pins: string }>(
      `SELECT COALESCE(SUM(la.requested_amount), 0) AS total, count(DISTINCT c.id) AS pins
         FROM hotspots h
         JOIN collateral c ON ST_Intersects(c.geom, h.area)
         JOIN loan_applications la ON la.collateral_id = c.id
        WHERE h.id = $1`,
      [hotspot.id],
    );

    expect(Number(direct.pins)).toBeGreaterThan(0);
    expect(Number(direct.total)).toBeCloseTo(Number(hotspot.exposure), 2);
  });
});

describe('a radius hotspot exposure equals a direct sum over what it contains', () => {
  it('matches a hand-written ST_DWithin sum', async () => {
    const hotspot = await aRadiusHotspot();

    const direct = await dbOne<{ total: string; pins: string }>(
      `SELECT COALESCE(SUM(la.requested_amount), 0) AS total, count(DISTINCT c.id) AS pins
         FROM hotspots h
         JOIN collateral c ON ST_DWithin(c.geom, h.centroid, h.radius_m)
         JOIN loan_applications la ON la.collateral_id = c.id
        WHERE h.id = $1`,
      [hotspot.id],
    );

    expect(Number(direct.pins)).toBeGreaterThan(0);
    expect(Number(direct.total)).toBeCloseTo(Number(hotspot.exposure), 2);
  });
});

describe('the view is the only definition of the figure', () => {
  it('gives every hotspot a row, including one that contains no collateral', async () => {
    const rows = await dbQuery<{ hotspot_id: string; loan_exposure_sgd: string }>(
      `SELECT hotspot_id, loan_exposure_sgd FROM v_hotspot_exposure`,
    );
    const hotspots = await dbQuery<{ n: string }>(`SELECT count(*) AS n FROM hotspots`);

    expect(rows).toHaveLength(Number(hotspots[0].n));
    for (const row of rows) {
      expect(Number(row.loan_exposure_sgd)).toBeGreaterThanOrEqual(0);
    }
  });

  it('has no exposure column on the hotspots table for it to drift from', async () => {
    const columns = await dbQuery<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'hotspots'
          AND column_name IN ('loan_exposure_sgd', 'exposure_share')`,
    );
    expect(columns).toEqual([]);
  });

  it('makes the shares sum to one across the snapshot', async () => {
    const row = await dbOne<{ total: string }>(
      `SELECT COALESCE(SUM(exposure_share), 0) AS total FROM v_hotspot_exposure`,
    );
    expect(Number(row.total)).toBeCloseTo(1, 6);
  });

  it('agrees with the exposure snapshotted into score_inputs, once one exists', async () => {
    const snapshots = await dbQuery<{ id: string; snapshot: string; view: string }>(
      `SELECT h.id,
              (h.score_inputs ->> 'exposure_sgd') AS snapshot,
              e.loan_exposure_sgd::text          AS view
         FROM hotspots h
         JOIN v_hotspot_exposure e ON e.hotspot_id = h.id
        WHERE h.score_inputs ? 'exposure_sgd'`,
    );

    /* Before `npm run prep:reference` has run there is no snapshot to compare,
       and asserting on an empty set would be asserting nothing. The clause is
       written now so it starts holding the moment the snapshot lands. */
    for (const row of snapshots) {
      expect(Number(row.snapshot), `${row.id} snapshot vs view`).toBeCloseTo(
        Number(row.view),
        2,
      );
    }
  });
});
