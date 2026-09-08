/**
 * The six pinned fixtures' INPUTS, transcribed from plan section 4.3.2.
 *
 * This file is a deliberate second copy. `prep/sample_hazards.py` generates the
 * pinned rows; this restates what they are supposed to be, read off the plan
 * rather than off the generator. A fixture test whose expectations are imported
 * from the thing under test asserts nothing, so the duplication here is the
 * point: if the generator drifts from the plan, `fixture-pinning.test.ts` fails.
 *
 * These are INPUTS only: depths, heat deltas, coverage states, tertiles,
 * elevations and the pinned sea-level value. The hand-computed expected haircuts,
 * bands, conditions and revalue-by years are OUTPUTS and belong in
 * `tests/fixtures/cases.ts` (S15, worker B). That file should import from here
 * rather than restate these inputs a third time.
 */

export const FIXTURE_IDS = [
  'SG-EC-001',
  'SG-EC-002',
  'SG-EC-003',
  'SG-KB-003',
  'SG-MS-002',
  'SG-MS-003',
] as const;

export type FixtureId = (typeof FIXTURE_IDS)[number];

/** Every pinned row carries this, so the provenance panel discloses it on screen. */
export const FIXTURE_DATASET_VERSION = 'fixture: pinned';

/**
 * Coastal inundation depth in metres, by scenario.
 *
 * The 2050 figures are the load-bearing ones. 0.50 m gives damage 0.30 and the
 * AC-2 worked example; 0.80 m gives 0.42 and the AC-3 adaptation case; 0.20 m
 * gives 0.12 and the ADR-4 zero floor. The today and 2030 figures are pinned as
 * well so no source mode can move those columns under the demo.
 */
export const PINNED_DEPTHS_M: Record<FixtureId, { today: number; y2030: number; y2050: number }> = {
  'SG-EC-001': { today: 0.1, y2030: 0.3, y2050: 0.5 },
  'SG-EC-002': { today: 0.1, y2030: 0.3, y2050: 0.5 },
  'SG-EC-003': { today: 0.05, y2030: 0.12, y2050: 0.2 },
  'SG-KB-003': { today: 0.2, y2030: 0.45, y2050: 0.8 },
  'SG-MS-002': { today: 0.6, y2030: 1.1, y2050: 1.8 },
  'SG-MS-003': { today: 0.15, y2030: 0.4, y2050: 0.7 },
};

/**
 * Days above 35 C, as a delta against the 2016-2035 reference window.
 *
 * Zero at `today` on every fixture, because today IS the reference window. That
 * is zero by definition of the metric, not by an accident of labelling.
 * SG-EC-001 is held at zero throughout: it is the isolation exhibit, the flood
 * term with nothing else on top. SG-EC-002 carries 28 days at 2050, which is
 * what makes it the realistic case at a 10.1% total.
 */
export const PINNED_HEAT_DAYS: Record<FixtureId, { today: number; y2030: number; y2050: number }> = {
  'SG-EC-001': { today: 0, y2030: 0, y2050: 0 },
  'SG-EC-002': { today: 0, y2030: 6, y2050: 28 },
  'SG-EC-003': { today: 0, y2030: 5, y2050: 25 },
  'SG-KB-003': { today: 0, y2030: 6, y2050: 26 },
  'SG-MS-002': { today: 0, y2030: 6, y2050: 27 },
  'SG-MS-003': { today: 0, y2030: 6, y2050: 27 },
};

/** Singapore annual mean PM2.5. Measured here, and not scored in Singapore. */
export const PINNED_PM25_UGM3 = 14;

/**
 * Coverage state per hazard, identical on all six because all six are Singapore.
 *
 * wind is `absent`: STORM has no basin coverage over Singapore, so there is no
 * value to store. pm25 is `measured_not_scored`: a real value exists and policy
 * excludes it. heat is `scored` even where the delta is zero, so heatHaircut
 * runs and returns 0 rather than short-circuiting on an absent sample. riverine
 * is `absent` so exactly one flood peril can win the max, which keeps the stored
 * depth, damage fraction and both credit columns unambiguous.
 */
export const PINNED_COVERAGE = {
  flood_coastal: 'scored',
  flood_riverine: 'absent',
  heat_days35: 'scored',
  wind: 'absent',
  pm25: 'measured_not_scored',
} as const;

/** SUHI and NDVI tertiles. 1 and 1 is the 1.25 multiplier that turns 28 days into 3.5%. */
export const PINNED_TERTILES = { suhi: 1, ndvi: 1 } as const;

/**
 * Elevations in metres.
 *
 * SG-MS-002 and SG-MS-003 are the AC-8 inundation boundary pair. The flag fires
 * when elevation_m < sea_level_inundation + rules.inundation_threshold_m. At
 * 0.30 m of AR6 regional rise and a 0.50 m threshold the boundary is 0.80 m, so
 * 0.6 fires and 2.6 does not. The pair survives any sea-level value in the OPEN
 * interval (0.10 m, 2.10 m]: the flag fires when 0.6 < slr + 0.5, so slr must be
 * strictly above 0.10, and SG-MS-003 stays clear while 2.6 >= slr + 0.5, so slr
 * may reach 2.10 exactly.
 */
export const PINNED_ELEVATIONS_M: Record<FixtureId, number> = {
  'SG-EC-001': 3.2,
  'SG-EC-002': 3.2,
  'SG-EC-003': 4.8,
  'SG-KB-003': 3.4,
  'SG-MS-002': 0.6,
  'SG-MS-003': 2.6,
};

/**
 * IPCC AR6 regional median sea-level rise at 2050 under SSP5-8.5, metres.
 *
 * Pinned on all six fixtures rather than only on the Marina South pair, so no
 * comparison in the fixture set is left with one side pinned and the other sampled.
 */
export const PINNED_SEA_LEVEL_M = 0.3;

/** Which fixtures carry an adaptation project, and which deliberately do not. */
export const PINNED_ADAPTATION: Record<FixtureId, string | null> = {
  'SG-EC-001': null,
  'SG-EC-002': null,
  'SG-EC-003': 'sg-long-island',
  'SG-KB-003': 'sg-marina-barrage',
  'SG-MS-002': null,
  'SG-MS-003': null,
};

export const SCENARIOS = ['today', 'y2030', 'y2050'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/**
 * The same pinned inputs, flattened one record per fixture.
 *
 * The records above are grouped by quantity, which is how the seed generator
 * thinks about them. A test asserting one case wants them grouped by case
 * instead, so this is the same data pivoted rather than a second declaration:
 * every field below reads from the constants above and cannot drift from them.
 *
 * `tests/fixtures/cases.ts` holds the expected OUTPUTS. Spread a record from
 * here into a fixture there to get the inputs without restating them.
 */
export type PinnedInputs = {
  collateral_id: FixtureId;
  depth_m_today: number;
  depth_m_2030: number;
  depth_m_2050: number;
  heat_days_today: number;
  heat_days_2030: number;
  heat_days_2050: number;
  pm25_ugm3: number;
  elevation_m: number;
  sea_level_m: number;
  suhi_tertile: number;
  ndvi_tertile: number;
  adaptation_project_id: string | null;
};

export const PINNED_INPUTS: Record<FixtureId, PinnedInputs> = Object.fromEntries(
  FIXTURE_IDS.map((id) => [
    id,
    {
      collateral_id: id,
      depth_m_today: PINNED_DEPTHS_M[id].today,
      depth_m_2030: PINNED_DEPTHS_M[id].y2030,
      depth_m_2050: PINNED_DEPTHS_M[id].y2050,
      heat_days_today: PINNED_HEAT_DAYS[id].today,
      heat_days_2030: PINNED_HEAT_DAYS[id].y2030,
      heat_days_2050: PINNED_HEAT_DAYS[id].y2050,
      pm25_ugm3: PINNED_PM25_UGM3,
      elevation_m: PINNED_ELEVATIONS_M[id],
      sea_level_m: PINNED_SEA_LEVEL_M,
      suhi_tertile: PINNED_TERTILES.suhi,
      ndvi_tertile: PINNED_TERTILES.ndvi,
      adaptation_project_id: PINNED_ADAPTATION[id],
    },
  ]),
) as Record<FixtureId, PinnedInputs>;
