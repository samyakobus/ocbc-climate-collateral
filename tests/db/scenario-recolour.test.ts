/**
 * tests/db/scenario-recolour.test.ts - AC-5.
 *
 * The map colours a pin from `valuations.band` at the selected scenario, so the
 * pin colour and the case band are the same stored value rather than two things
 * kept in step. This file pins the data that colouring rests on:
 *
 *   1. every pin has a row at all three scenarios, so no pin falls back to grey;
 *   2. every stored band is what `bandOf` returns for its own stored total, so
 *      the colour cannot drift from the number the case screen shows;
 *   3. the haircut never improves as the horizon extends, which is what makes
 *      "move the slider and watch exposure grow" true rather than a slogan;
 *   4. the origination column is exactly the split ADR-5 promises.
 *
 * It deliberately does not re-derive a haircut. `lib/valuation` owns that, and
 * `worked-example-row.test.ts` pins the arithmetic itself.
 */

import { describe, expect, it } from 'vitest';

import { bandOf, type Band, type BandEdges } from '@/lib/rules/bands';
import { dbOne, dbQuery } from '../setup/db';

type Scenario = 'today' | 'y2030' | 'y2050';

type ValuationRow = {
  collateral_id: string;
  country: string;
  scenario: Scenario;
  total_haircut: string;
  band: Band;
};

async function activeEdges(): Promise<BandEdges> {
  const row = await dbOne<{ band_low: string; band_mid: string; band_high: string }>(
    `SELECT band_low, band_mid, band_high FROM rule_sets WHERE is_active`,
  );
  return {
    band_low: Number(row.band_low),
    band_mid: Number(row.band_mid),
    band_high: Number(row.band_high),
  };
}

async function valuations(): Promise<ValuationRow[]> {
  return dbQuery<ValuationRow>(
    `SELECT v.collateral_id, c.country, v.scenario, v.total_haircut, v.band
       FROM valuations v
       JOIN collateral c ON c.id = v.collateral_id
      WHERE v.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)
      ORDER BY v.collateral_id, v.scenario`,
  );
}

function tally(rows: readonly ValuationRow[], scenario: Scenario): Record<Band, number> {
  const counts: Record<Band, number> = { green: 0, amber: 0, orange: 0, red: 0 };
  for (const row of rows) {
    if (row.scenario === scenario) counts[row.band] += 1;
  }
  return counts;
}

describe('every pin is colourable at every scenario', () => {
  it('stores 600 valuations, 200 collateral across three scenarios', async () => {
    const rows = await valuations();
    expect(rows).toHaveLength(600);
    expect(new Set(rows.map((r) => r.collateral_id)).size).toBe(200);
  });

  it('leaves no collateral without a row at any scenario', async () => {
    const missing = await dbQuery<{ id: string; scenario: string }>(
      `SELECT c.id, s.scenario
         FROM collateral c
         CROSS JOIN (SELECT unnest(enum_range(NULL::scenario)) AS scenario) s
         LEFT JOIN valuations v
                ON v.collateral_id = c.id
               AND v.scenario = s.scenario
               AND v.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)
        WHERE v.id IS NULL`,
    );
    /* A missing row is what the map draws grey. On a recomputed database there
       should be none, so a grey pin on the demo means a real gap, not a default. */
    expect(missing).toEqual([]);
  });

  it('uses only the four band values', async () => {
    const rows = await valuations();
    for (const row of rows) {
      expect(['green', 'amber', 'orange', 'red']).toContain(row.band);
    }
  });
});

describe('the stored band matches the stored total', () => {
  it('agrees with bandOf for all 600 rows', async () => {
    const [edges, rows] = [await activeEdges(), await valuations()];

    const drifted = rows.filter(
      (row) => bandOf(Number(row.total_haircut), edges) !== row.band,
    );

    expect(
      drifted.map((r) => `${r.collateral_id}/${r.scenario}: ${r.total_haircut} -> ${r.band}`),
    ).toEqual([]);
  });
});

describe('the slider tells a coherent story', () => {
  it('never lets the haircut improve as the horizon extends', async () => {
    const rows = await valuations();
    const byPin = new Map<string, Partial<Record<Scenario, number>>>();
    for (const row of rows) {
      const entry = byPin.get(row.collateral_id) ?? {};
      entry[row.scenario] = Number(row.total_haircut);
      byPin.set(row.collateral_id, entry);
    }

    const regressions: string[] = [];
    for (const [id, totals] of byPin) {
      const today = totals.today ?? 0;
      const y2030 = totals.y2030 ?? 0;
      const y2050 = totals.y2050 ?? 0;
      if (!(today <= y2030 + 1e-9 && y2030 <= y2050 + 1e-9)) {
        regressions.push(`${id}: ${today} -> ${y2030} -> ${y2050}`);
      }
    }
    expect(regressions).toEqual([]);
  });

  it('moves at least a quarter of the pins between origination and 2050', async () => {
    const rows = await valuations();
    const today = new Map(
      rows.filter((r) => r.scenario === 'today').map((r) => [r.collateral_id, r.band]),
    );
    const moved = rows.filter(
      (r) => r.scenario === 'y2050' && today.get(r.collateral_id) !== r.band,
    );
    /* If the slider changed almost nothing, AC-5 would be untestable on stage. */
    expect(moved.length).toBeGreaterThanOrEqual(50);
  });
});

describe('the origination column is the split ADR-5 promises', () => {
  it('is green across SG, MY and ID and amber across CN and HK', async () => {
    const rows = (await valuations()).filter((r) => r.scenario === 'today');

    const byCountry = new Map<string, Set<Band>>();
    for (const row of rows) {
      const set = byCountry.get(row.country) ?? new Set<Band>();
      set.add(row.band);
      byCountry.set(row.country, set);
    }

    /* Flood and heat are both zero at the reference window, so SG, MY and ID
       carry nothing: they score neither wind nor PM2.5. CN and HK carry their
       full present-climate wind plus chronic PM2.5, which clears the 3% edge.
       The applicability table is what separates them, not a country branch. */
    for (const country of ['SG', 'MY', 'ID']) {
      expect([...(byCountry.get(country) ?? [])]).toEqual(['green']);
    }
    for (const country of ['CN', 'HK']) {
      expect([...(byCountry.get(country) ?? [])]).toEqual(['amber']);
    }
  });

  it('puts no pin above amber at origination', async () => {
    const counts = tally(await valuations(), 'today');
    expect(counts.orange).toBe(0);
    expect(counts.red).toBe(0);
    expect(counts.green + counts.amber).toBe(200);
  });
});

describe('the 2050 column is a usable map', () => {
  it('spreads across all four bands within the calibrated ranges', async () => {
    const counts = tally(await valuations(), 'y2050');

    /* Ranges, not exact counts. The synthetic hazard floor was calibrated to
       these shares and docs/sources.md records why; pinning exact numbers here
       would turn every legitimate recalibration into a failing test, while a
       degenerate column, everything one colour, still fails loudly. */
    expect(counts.green).toBeGreaterThanOrEqual(60);
    expect(counts.green).toBeLessThanOrEqual(80);
    expect(counts.amber).toBeGreaterThanOrEqual(55);
    expect(counts.amber).toBeLessThanOrEqual(75);
    expect(counts.orange).toBeGreaterThanOrEqual(40);
    expect(counts.orange).toBeLessThanOrEqual(55);
    expect(counts.red).toBeGreaterThanOrEqual(8);
    expect(counts.red).toBeLessThanOrEqual(20);
    expect(counts.green + counts.amber + counts.orange + counts.red).toBe(200);
  });

  it('confines the red band to the lowest-lying coastal clusters', async () => {
    const rows = await dbQuery<{ cluster_name: string }>(
      `SELECT DISTINCT c.cluster_name
         FROM valuations v
         JOIN collateral c ON c.id = v.collateral_id
        WHERE v.scenario = 'y2050'
          AND v.band = 'red'
          AND v.rule_set_id = (SELECT id FROM rule_sets WHERE is_active)
        ORDER BY 1`,
    );

    const allowed = [
      'Pluit / Muara Baru / Ancol',
      'Semarang north coast',
      'Marina Bay / Marina South',
      'Nansha, Guangzhou',
      'Ningbo',
      'Heng Fa Chuen / Chai Wan',
      'Tseung Kwan O',
    ];
    for (const row of rows) {
      expect(allowed).toContain(row.cluster_name);
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});
