/**
 * tests/fixtures/cases.ts - S15. The pinned cases every headline figure rests on.
 *
 * Two groups.
 *
 * The SIX PINNED FIXTURES of plan 4.3.2 carry hazard samples written into
 * `db/seed/04_samples.sql` with `dataset_version = 'fixture: pinned'`, applied
 * after sampling under every source mode, so they are byte-identical whether
 * the prep ran live, from frozen CSVs or from the synthetic floor. They are
 * members of their clusters, not additions: the 200 total is unchanged.
 *
 * The EIGHT BAND FIXTURES are ordinary generated pins, two per band, chosen
 * from the calibrated synthetic portfolio. They exist so the band edges are
 * exercised against real combinations of hazards rather than against
 * hand-invented totals.
 *
 * INPUTS live in `tests/fixtures/pinned-samples.ts` (owner A), transcribed from
 * plan 4.3.2, and are imported here rather than restated a third time. This
 * file holds only the hand-computed OUTPUTS: haircuts, bands, adjusted values,
 * referrals and revaluation years.
 *
 * Every expected figure here is derived from the formula and shown with its
 * arithmetic, so a reader can check it without running anything. None of it was
 * copied out of the database; the tests that use it are what compare the two.
 *
 * Rounding, which matters when comparing against stored rows. Haircut columns
 * are NUMERIC(6,4) and money is NUMERIC(16,2), so a haircut of 0.03125 stores
 * as 0.0313. The adjusted value is computed at full precision BEFORE storage,
 * so recomputing it from a stored, rounded haircut can differ by a few dollars.
 * Compare haircuts to four decimal places and money to the adjusted value the
 * engine produced, not to a product of rounded parts.
 */

import type { Band } from '@/lib/rules/bands';
import type { BuildingType } from '@/lib/rules/curves';
import type { OccupancyClass } from '@/lib/valuation/hazards';

import {
  type FixtureId,
  PINNED_ADAPTATION,
  PINNED_DEPTHS_M,
  PINNED_ELEVATIONS_M,
  PINNED_HEAT_DAYS,
  PINNED_TERTILES,
} from './pinned-samples';

/**
 * Decimal places for comparing a computed haircut against a stored one.
 *
 * Three, not four, and deliberately. A haircut column is NUMERIC(6,4), so a
 * true value of 0.03125 stores as 0.0313 and the difference is exactly 5e-5,
 * which is precisely the boundary `toBeCloseTo(x, 4)` rejects. Summing three
 * separately rounded components can drift twice that. Three decimal places
 * gives 5e-4, which absorbs the rounding while still catching any error of
 * 0.05 percentage points or more, far below anything that would change a band
 * or a figure on screen.
 */
export const HAIRCUT_PRECISION = 3;

export type PinnedFixture = {
  collateral_id: FixtureId;
  loan_application_id: string;
  address_line: string;
  building_type: BuildingType;
  occupancy_class: OccupancyClass;
  appraised_value_sgd: number;

  expected: {
    damage_fraction: number;
    flood_haircut_gross: number;
    adaptation_credit_documented_pp: number;
    adaptation_credit_effective_pp: number;
    flood_haircut: number;
    heat_haircut: number;
    chronic_haircut: number;
    total_haircut: number;
    adjusted_value_sgd: number;
    band: Band;
    /** NULL where both water perils contribute zero to the total. */
    winning_peril: 'flood_riverine' | 'flood_coastal' | null;
    refer_to_risk: boolean;
    revalue_by_year: number | null;
  };

  /** How the figures above were arrived at, for a reader checking by hand. */
  derivation: string;
};

/**
 * Singapore scores flood and heat, and measures PM2.5 without scoring it.
 * Wind is `absent`: STORM has no basin coverage over Singapore.
 */
export const PINNED_FIXTURES: readonly PinnedFixture[] = [
  {
    collateral_id: 'SG-EC-001',
    loan_application_id: 'LA-011',
    address_line: '12 Amber Road, Katong, Singapore',
    building_type: 'residential_highrise_rc',
    occupancy_class: 'rc_highrise',
    appraised_value_sgd: 1_000_000,
    expected: {
      damage_fraction: 0.3,
      flood_haircut_gross: 0.066,
      adaptation_credit_documented_pp: 0,
      adaptation_credit_effective_pp: 0,
      flood_haircut: 0.066,
      heat_haircut: 0,
      chronic_haircut: 0,
      total_haircut: 0.066,
      adjusted_value_sgd: 934_000,
      band: 'amber',
      winning_peril: 'flood_coastal',
      refer_to_risk: false,
      revalue_by_year: null,
    },
    derivation:
      'AC-2 worked example. f(0.50) = 0.30 is a published curve point. ' +
      '0.30 x p_2050 0.22 = 0.066. The heat sample is pinned at a zero delta and ' +
      'coverage scored, so heatHaircut runs and returns 0; wind is absent and PM2.5 ' +
      'is measured but not scored in Singapore. Total 6.6%. ' +
      '1,000,000 x (1 - 0.066) = 934,000. At 0.75 LTV, 700,500.',
  },
  {
    collateral_id: 'SG-EC-002',
    loan_application_id: 'LA-012',
    address_line: '88 Marine Parade Road, Katong, Singapore',
    building_type: 'residential_highrise_rc',
    occupancy_class: 'rc_highrise',
    appraised_value_sgd: 1_000_000,
    expected: {
      damage_fraction: 0.3,
      flood_haircut_gross: 0.066,
      adaptation_credit_documented_pp: 0,
      adaptation_credit_effective_pp: 0,
      flood_haircut: 0.066,
      heat_haircut: 0.035,
      chronic_haircut: 0.035,
      total_haircut: 0.101,
      adjusted_value_sgd: 899_000,
      band: 'orange',
      winning_peril: 'flood_coastal',
      refer_to_risk: false,
      revalue_by_year: 2050,
    },
    derivation:
      'The realistic Singapore case, opened first in the demo. Same flood exposure ' +
      'as SG-EC-001. Heat: min(0.001 x 28, 0.05) x 1.25 = 0.035, since the middle ' +
      'SUHI tertile carries 1.25 and NDVI tertile 1 earns no step down. ' +
      'Chronic min(0.035, 0.05) = 0.035. Total 0.066 + 0.035 = 0.101, which is at ' +
      'or above band_mid, so the 10-20% band. 1,000,000 x 0.899 = 899,000.',
  },
  {
    collateral_id: 'SG-EC-003',
    loan_application_id: 'LA-013',
    address_line: '215 East Coast Road, Katong, Singapore',
    building_type: 'residential_landed',
    occupancy_class: 'lowrise_industrial',
    appraised_value_sgd: 1_500_000,
    expected: {
      damage_fraction: 0.12,
      flood_haircut_gross: 0.0264,
      adaptation_credit_documented_pp: 3.0,
      adaptation_credit_effective_pp: 2.64,
      flood_haircut: 0,
      heat_haircut: 0.03125,
      chronic_haircut: 0.03125,
      total_haircut: 0.03125,
      adjusted_value_sgd: 1_453_125,
      band: 'amber',
      winning_peril: 'flood_coastal',
      refer_to_risk: false,
      revalue_by_year: null,
    },
    derivation:
      'The ADR-4 zero floor. f(0.20) = 0.12 by interpolation from 0.00 at 0 m to ' +
      '0.30 at 0.5 m. Gross 0.12 x 0.22 = 0.0264, which is 2.64 points, less than ' +
      'the 3.00 point Long Island credit, so the net floors at zero and the ' +
      'EFFECTIVE credit is 2.64 points, not 3.00. The panel shows both. ' +
      'winning_peril is flood_coastal, selected on GROSS, so the screen can say ' +
      'the credit was fully absorbed ON COASTAL FLOOD; depth and damage fraction ' +
      'are populated for the same reason. Heat: 0.025 x 1.25 = 0.03125, the whole ' +
      'of the total. ' +
      '1,500,000 x (1 - 0.03125) = 1,453,125.',
  },
  {
    collateral_id: 'SG-KB-003',
    loan_application_id: 'LA-039',
    address_line: '31 Stadium Boulevard, Kallang Basin, Singapore',
    building_type: 'residential_highrise_rc',
    occupancy_class: 'rc_highrise',
    appraised_value_sgd: 1_200_000,
    expected: {
      damage_fraction: 0.42,
      flood_haircut_gross: 0.0924,
      adaptation_credit_documented_pp: 1.5,
      adaptation_credit_effective_pp: 1.5,
      flood_haircut: 0.0774,
      heat_haircut: 0.0325,
      chronic_haircut: 0.0325,
      total_haircut: 0.1099,
      adjusted_value_sgd: 1_068_120,
      band: 'orange',
      winning_peril: 'flood_coastal',
      refer_to_risk: false,
      revalue_by_year: 2050,
    },
    derivation:
      'AC-3 adaptation. f(0.80) = 0.30 + (0.30 / 0.50) x 0.20 = 0.42 by ' +
      'interpolation between the 0.5 m and 1.0 m points. Gross 0.42 x 0.22 = 0.0924. ' +
      'Marina Barrage documents 1.50 points, and the gross exceeds it, so the floor ' +
      'does not bind and the effective credit equals the documented one: ' +
      '0.0924 - 0.015 = 0.0774. The AC-3 delta is therefore exactly 1.50 points. ' +
      'Heat: 0.026 x 1.25 = 0.0325. Total 0.0774 + 0.0325 = 0.1099. ' +
      '1,200,000 x (1 - 0.1099) = 1,068,120.',
  },
  {
    collateral_id: 'SG-MS-002',
    loan_application_id: 'LA-002',
    address_line: '8 Marina View, Marina South, Singapore',
    building_type: 'residential_highrise_rc',
    occupancy_class: 'rc_highrise',
    appraised_value_sgd: 1_800_000,
    expected: {
      damage_fraction: 0.68,
      flood_haircut_gross: 0.1496,
      adaptation_credit_documented_pp: 0,
      adaptation_credit_effective_pp: 0,
      flood_haircut: 0.1496,
      heat_haircut: 0.03375,
      chronic_haircut: 0.03375,
      total_haircut: 0.18335,
      adjusted_value_sgd: 1_469_970,
      band: 'orange',
      winning_peril: 'flood_coastal',
      /* Elevation 0.60 m is below the regional 0.30 m SLR plus the 0.50 m
         threshold, so the coastal inundation flag fires and forces a referral
         regardless of the band. This is the low side of the AC-8 pair. */
      refer_to_risk: true,
      revalue_by_year: 2050,
    },
    derivation:
      'The AC-8 inundation boundary, low side. f(1.80) = 0.62 + (0.30 / 0.50) x ' +
      '0.10 = 0.68 by interpolation between the 1.5 m and 2.0 m points. ' +
      'Gross 0.68 x 0.22 = 0.1496. Heat 0.027 x 1.25 = 0.03375. ' +
      'Total 0.18335, the 10-20% band. 1,800,000 x (1 - 0.18335) = 1,469,970. ' +
      'Referred because 0.60 < 0.30 + 0.50, not because of the band.',
  },
  {
    collateral_id: 'SG-MS-003',
    loan_application_id: 'LA-003',
    address_line: '10 Marina View, Marina South, Singapore',
    building_type: 'residential_highrise_rc',
    occupancy_class: 'rc_highrise',
    appraised_value_sgd: 1_800_000,
    expected: {
      damage_fraction: 0.38,
      flood_haircut_gross: 0.0836,
      adaptation_credit_documented_pp: 0,
      adaptation_credit_effective_pp: 0,
      flood_haircut: 0.0836,
      heat_haircut: 0.03375,
      chronic_haircut: 0.03375,
      total_haircut: 0.11735,
      adjusted_value_sgd: 1_588_770,
      band: 'orange',
      winning_peril: 'flood_coastal',
      /* Elevation 2.60 m clears 0.30 + 0.50, so no flag and no referral. Same
         building, same value, same tertiles as SG-MS-002: the elevation is what
         separates them. */
      refer_to_risk: false,
      revalue_by_year: 2050,
    },
    derivation:
      'The AC-8 inundation boundary, high side. f(0.70) = 0.30 + (0.20 / 0.50) x ' +
      '0.20 = 0.38. Gross 0.38 x 0.22 = 0.0836. Heat 0.027 x 1.25 = 0.03375. ' +
      'Total 0.11735. 1,800,000 x (1 - 0.11735) = 1,588,770. Not referred: ' +
      '2.60 is above 0.30 + 0.50, and the band alone does not refer.',
  },
];

export type BandFixture = {
  collateral_id: string;
  band: Band;
  /** The stored 2050 components, which must sum under the caps to the total. */
  flood_haircut: number;
  wind_haircut: number;
  heat_haircut: number;
  pm25_haircut: number;
  chronic_haircut: number;
  total_haircut: number;
  revalue_by_year: number | null;
  refer_to_risk: boolean;
  derivation: string;
};

/**
 * Two ordinary pins per band from the calibrated portfolio, at 2050.
 *
 * There is deliberately no origination-year revaluation fixture. The most a pin
 * can carry at 2025 is 6 percent wind plus 2 percent PM2.5, because heat is zero
 * at the reference window by definition and the flood probability is zero, and 8
 * percent is below the 10 percent mid band. `revalue_by_year` is therefore 2030,
 * 2050 or null, never 2025, and `bands.fixtures.test.ts` proves that ceiling.
 */
export const BAND_FIXTURES: readonly BandFixture[] = [
  {
    collateral_id: 'ID-BS-001',
    band: 'green',
    flood_haircut: 0,
    wind_haircut: 0,
    heat_haircut: 0.022,
    pm25_haircut: 0,
    chronic_haircut: 0.022,
    total_haircut: 0.022,
    revalue_by_year: null,
    refer_to_risk: false,
    derivation:
      'BSD City, inland Tangerang. No coastal or riverine depth, wind is not ' +
      'scored in Indonesia and PM2.5 is measured but not scored, so heat is the ' +
      'whole haircut at 2.2%, below the 3% edge.',
  },
  {
    collateral_id: 'ID-BS-002',
    band: 'green',
    flood_haircut: 0,
    wind_haircut: 0,
    heat_haircut: 0.0225,
    pm25_haircut: 0,
    chronic_haircut: 0.0225,
    total_haircut: 0.0225,
    revalue_by_year: null,
    refer_to_risk: false,
    derivation: 'As ID-BS-001, at 2.25%. Still green, and comfortably inside the edge.',
  },
  {
    collateral_id: 'CN-NB-001',
    band: 'amber',
    flood_haircut: 0,
    wind_haircut: 0.0463,
    heat_haircut: 0.06,
    pm25_haircut: 0.01,
    chronic_haircut: 0.05,
    total_haircut: 0.0963,
    revalue_by_year: null,
    refer_to_risk: false,
    derivation:
      'Ningbo. The chronic cap binds: heat 6.00% plus PM2.5 1.00% is 7.00%, held ' +
      'at 5.00%. Plus wind 4.63% gives 9.63%, inside the 3-10% band. Wind and ' +
      'PM2.5 are scored here because the applicability table scores them for CN.',
  },
  {
    collateral_id: 'CN-NB-003',
    band: 'amber',
    flood_haircut: 0,
    wind_haircut: 0.0334,
    heat_haircut: 0.05,
    pm25_haircut: 0.01,
    chronic_haircut: 0.05,
    total_haircut: 0.0834,
    revalue_by_year: null,
    refer_to_risk: false,
    derivation:
      'Ningbo, reinforced-concrete high-rise, so the 0.8 wind multiplier applies. ' +
      'Chronic capped at 5.00% again, plus wind 3.34%, giving 8.34%.',
  },
  {
    collateral_id: 'CN-NB-005',
    band: 'orange',
    flood_haircut: 0.0801,
    wind_haircut: 0.0312,
    heat_haircut: 0.046,
    pm25_haircut: 0.01,
    chronic_haircut: 0.05,
    total_haircut: 0.1613,
    revalue_by_year: 2050,
    refer_to_risk: false,
    derivation:
      'Ningbo retail podium. All three groups contribute: flood 8.01%, wind 3.12%, ' +
      'chronic capped at 5.00%, giving 16.13%. Crosses band_mid only at 2050, so ' +
      'the revaluation year is 2050.',
  },
  {
    collateral_id: 'CN-NS-002',
    band: 'orange',
    flood_haircut: 0.084,
    wind_haircut: 0.0474,
    heat_haircut: 0.0625,
    pm25_haircut: 0.01,
    chronic_haircut: 0.05,
    total_haircut: 0.1814,
    revalue_by_year: 2050,
    refer_to_risk: false,
    derivation:
      'Nansha, Guangzhou. Flood 8.40% plus wind 4.74% plus capped chronic 5.00% ' +
      'gives 18.14%, near the top of the 10-20% band but not over it.',
  },
  {
    collateral_id: 'CN-NB-002',
    band: 'red',
    flood_haircut: 0.1206,
    wind_haircut: 0.0301,
    heat_haircut: 0.0705,
    pm25_haircut: 0.01,
    chronic_haircut: 0.05,
    total_haircut: 0.2006,
    revalue_by_year: 2050,
    refer_to_risk: true,
    derivation:
      'Ningbo. Flood 12.06% plus wind 3.01% plus capped chronic 5.00% gives 20.06%, ' +
      'just over the 20% edge, so red and referred to risk on the band alone. ' +
      'A useful fixture precisely because it sits close to the boundary.',
  },
  {
    collateral_id: 'CN-NB-004',
    band: 'red',
    flood_haircut: 0.128,
    wind_haircut: 0.0323,
    heat_haircut: 0.039,
    pm25_haircut: 0.01,
    chronic_haircut: 0.049,
    total_haircut: 0.2093,
    revalue_by_year: 2050,
    refer_to_risk: true,
    derivation:
      'Ningbo. Here the chronic cap does NOT bind: heat 3.90% plus PM2.5 1.00% is ' +
      '4.90%, under the 5.00% cap. Flood 12.80% plus wind 3.23% gives 20.93%. ' +
      'Worth keeping alongside CN-NB-002, where the cap does bind.',
  },
];

/**
 * The pinned INPUTS for a fixture, from `pinned-samples.ts`.
 *
 * Gathered here so a test reads one object instead of importing five records,
 * and so the single source of those inputs stays owner A's file.
 */
export function inputsFor(id: FixtureId) {
  return {
    depth_m: PINNED_DEPTHS_M[id],
    heat_days: PINNED_HEAT_DAYS[id],
    elevation_m: PINNED_ELEVATIONS_M[id],
    adaptation_project_id: PINNED_ADAPTATION[id],
    suhi_tertile: PINNED_TERTILES.suhi,
    ndvi_tertile: PINNED_TERTILES.ndvi,
  };
}

/** Every collateral id this file pins, for tests that need the whole set. */
export const FIXTURE_COLLATERAL_IDS: readonly string[] = [
  ...PINNED_FIXTURES.map((f) => f.collateral_id),
  ...BAND_FIXTURES.map((f) => f.collateral_id),
];
