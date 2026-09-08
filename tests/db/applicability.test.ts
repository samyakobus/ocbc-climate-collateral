/**
 * tests/db/applicability.test.ts - S13. AC-4, AC-12.
 *
 * Principle 4: one method, five countries, and applicability lives in DATA.
 * Whether a hazard is scored for a country is a row in `hazard_applicability`,
 * never a branch in the engine, so this asserts the table and then asserts that
 * every sampled row agrees with it.
 *
 * Principle 3: measurement is separate from policy. The sharpest thing this file
 * pins is the partition between `absent` and `measured_not_scored`. They are not
 * two spellings of "no". Singapore wind is `absent`, because STORM has no basin
 * coverage there and there is no value to store. Kota Kinabalu wind and Jakarta
 * PM2.5 are `measured_not_scored`, because a real value exists and policy
 * excludes it. "Measured at 41 micrograms and not scored in Indonesia" is a
 * different statement from "no data here", and a director can tell the
 * difference, so the schema keeps them apart and this test keeps them apart.
 */

import { describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

const HAZARDS = ['flood_riverine', 'flood_coastal', 'wind', 'heat_days35', 'pm25'] as const;
const COUNTRIES = ['SG', 'MY', 'ID', 'CN', 'HK'] as const;

/** The six exclusions of plan 4.6: wind and PM2.5 are scored for HK and CN only. */
const NOT_SCORED = new Set([
  'wind:SG',
  'wind:MY',
  'wind:ID',
  'pm25:SG',
  'pm25:MY',
  'pm25:ID',
]);

describe('hazard_applicability', () => {
  it('holds exactly 25 rows, five hazards by five countries', async () => {
    const rows = await dbQuery<{ hazard: string; country: string; scored: boolean }>(
      'SELECT hazard, country, scored FROM hazard_applicability',
    );

    expect(rows).toHaveLength(25);

    const seen = new Set(rows.map((r) => `${r.hazard}:${r.country.trim()}`));
    for (const hazard of HAZARDS) {
      for (const country of COUNTRIES) {
        expect(seen.has(`${hazard}:${country}`), `${hazard} in ${country}`).toBe(true);
      }
    }
  });

  it('excludes wind and PM2.5 for SG, MY and ID, and nothing else', async () => {
    const rows = await dbQuery<{ hazard: string; country: string; scored: boolean }>(
      'SELECT hazard, country, scored FROM hazard_applicability',
    );

    for (const row of rows) {
      const key = `${row.hazard}:${row.country.trim()}`;
      expect(row.scored, `${key} scored`).toBe(!NOT_SCORED.has(key));
    }

    expect(rows.filter((r) => !r.scored)).toHaveLength(6);
  });

  it('gives every exclusion a reason and a source URL a director can follow', async () => {
    // An exclusion without a reason is indistinguishable from an oversight. The
    // provenance panel renders both of these next to the measured value.
    const rows = await dbQuery<{ hazard: string; country: string; reason: string; source_url: string }>(
      'SELECT hazard, country, reason, source_url FROM hazard_applicability WHERE NOT scored',
    );

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.reason.trim().length, `${row.hazard}:${row.country} reason`).toBeGreaterThan(20);
      expect(row.source_url, `${row.hazard}:${row.country} url`).toMatch(/^https?:\/\//);
    }
  });
});

describe('sampled coverage agrees with the applicability table', () => {
  it('never scores a sample the table forbids, and never withholds one it allows', async () => {
    // This is the assertion that makes "applicability lives in data" true rather
    // than aspirational: if the sampler ever grew a country branch, it would
    // disagree with the table here.
    const rows = await dbQuery<{ country: string; hazard: string; coverage: string; scored: boolean; n: number }>(
      `SELECT c.country, h.hazard, h.coverage, a.scored, count(*)::int AS n
       FROM hazard_samples h
       JOIN collateral c ON c.id = h.collateral_id
       JOIN hazard_applicability a ON a.hazard = h.hazard AND a.country = c.country
       GROUP BY 1, 2, 3, 4`,
    );

    for (const row of rows) {
      if (row.coverage === 'scored') {
        expect(row.scored, `${row.country} ${row.hazard} scored ${row.n} rows`).toBe(true);
      }
      if (row.coverage === 'measured_not_scored') {
        expect(row.scored, `${row.country} ${row.hazard} measured_not_scored ${row.n} rows`).toBe(false);
      }
    }
  });

  it('gives every SG, MY and ID pin wind and PM2.5 that cannot contribute', async () => {
    // AC-4. Nothing in these three countries may carry a scored wind or PM2.5
    // sample, whatever the raster measured.
    const rows = await dbQuery<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM hazard_samples h
       JOIN collateral c ON c.id = h.collateral_id
       WHERE c.country IN ('SG', 'MY', 'ID')
         AND h.hazard IN ('wind', 'pm25')
         AND h.coverage NOT IN ('measured_not_scored', 'absent')`,
    );
    expect(Number(rows[0].n)).toBe(0);

    // 140 pins x 2 hazards x 3 scenarios, every one of them accounted for.
    const total = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM hazard_samples h
       JOIN collateral c ON c.id = h.collateral_id
       WHERE c.country IN ('SG', 'MY', 'ID') AND h.hazard IN ('wind', 'pm25')`,
    );
    expect(Number(total.n)).toBe(140 * 2 * 3);
  });

  it('scores wind and PM2.5 for every China and Hong Kong pin', async () => {
    const rows = await dbQuery<{ coverage: string; n: number }>(
      `SELECT h.coverage, count(*)::int AS n
       FROM hazard_samples h
       JOIN collateral c ON c.id = h.collateral_id
       WHERE c.country IN ('CN', 'HK') AND h.hazard IN ('wind', 'pm25')
       GROUP BY 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].coverage).toBe('scored');
    expect(Number(rows[0].n)).toBe(60 * 2 * 3);
  });
});

describe('the absent / measured_not_scored partition', () => {
  it('keeps the two states disjoint: absent has no value, the others always do', async () => {
    // `absent` wins over `measured_not_scored` whenever both could apply, because
    // an uncovered point has no value to store. The schema's CHECK enforces the
    // same thing; asserting it here reports a bad seed as a coverage failure
    // rather than as a constraint violation with no context.
    const contradictions = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM hazard_samples
       WHERE (coverage = 'absent') <> (value IS NULL)`,
    );
    expect(Number(contradictions.n)).toBe(0);
  });

  it('leaves no sample outside the three states, and no pin without a full set', async () => {
    const states = await dbQuery<{ coverage: string }>(
      'SELECT DISTINCT coverage FROM hazard_samples ORDER BY coverage',
    );
    expect(states.map((s) => s.coverage).sort()).toEqual([
      'absent',
      'measured_not_scored',
      'scored',
    ]);

    // 200 pins x 5 hazards x 3 scenarios. No row is ever omitted: a point the
    // raster does not cover is recorded as absent, never dropped.
    const total = await dbOne<{ n: number }>('SELECT count(*)::int AS n FROM hazard_samples');
    expect(Number(total.n)).toBe(200 * 5 * 3);
  });

  it('marks Singapore wind absent, because STORM has no basin coverage there', async () => {
    const rows = await dbQuery<{ coverage: string; n: number }>(
      `SELECT h.coverage, count(*)::int AS n
       FROM hazard_samples h JOIN collateral c ON c.id = h.collateral_id
       WHERE c.country = 'SG' AND h.hazard = 'wind' GROUP BY 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].coverage).toBe('absent');
    expect(Number(rows[0].n)).toBe(60 * 3);
  });

  it('keeps a real Kota Kinabalu wind reading, measured and not scored', async () => {
    // The plan retains Kota Kinabalu deliberately: hazard_applicability is what
    // excludes its real wind reading, and that is the behaviour worth showing.
    // A country branch in the engine would have produced an absent sample here
    // and thrown the measurement away.
    const rows = await dbQuery<{ coverage: string; value: number }>(
      `SELECT h.coverage, h.value::float8 AS value
       FROM hazard_samples h JOIN collateral c ON c.id = h.collateral_id
       WHERE c.country = 'MY' AND c.cluster_name ILIKE '%kota kinabalu%' AND h.hazard = 'wind'`,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.coverage).toBe('measured_not_scored');
      expect(row.value).not.toBeNull();
      expect(row.value).toBeGreaterThan(0);
    }
  });

  it('keeps the Jakarta PM2.5 reading near 41 micrograms, measured and not scored', async () => {
    const row = await dbOne<{ n: number; lo: number; hi: number; avg: number }>(
      `SELECT count(*)::int AS n, min(h.value)::float8 AS lo, max(h.value)::float8 AS hi,
              avg(h.value)::float8 AS avg
       FROM hazard_samples h JOIN collateral c ON c.id = h.collateral_id
       WHERE c.country = 'ID' AND h.hazard = 'pm25' AND h.coverage = 'measured_not_scored'`,
    );

    expect(Number(row.n)).toBe(40 * 3);
    expect(row.lo).toBeGreaterThan(0);
    // Plan 4.6: GHAP measures roughly 41 micrograms over Jakarta. The synthetic
    // floor stands in for that, so this is a band rather than a point: the claim
    // under test is that a real, high, unscored value is stored, not thrown away.
    expect(row.avg).toBeGreaterThan(25);
    expect(row.hi).toBeGreaterThan(35);
  });

  it('marks PM2.5 scenario-invariant and stores the same value three times', async () => {
    const drift = await dbOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT collateral_id FROM hazard_samples
         WHERE hazard = 'pm25'
         GROUP BY collateral_id
         HAVING count(DISTINCT value) <> 1 OR bool_and(scenario_invariant) IS NOT TRUE
       ) drifted`,
    );
    expect(Number(drift.n)).toBe(0);
  });
});
