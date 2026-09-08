/**
 * scripts/gen-reference-sql.ts  ->  db/seed/02_reference.sql
 *
 * S8. Generates the reference seed from the TypeScript seed defaults so the SQL
 * is derived, not hand-copied (ADR-2, principle 5). The curve points and the
 * six-to-three classification come from `lib/rules/curves.ts`; every rule-set
 * constant comes from `lib/rules/bands.ts`. The two tables below,
 * `hazard_applicability` and `adaptation_projects`, are pure seed data with no
 * runtime TypeScript consumer, so they live here rather than adding a third
 * file to `lib/rules/` beyond the two named in plan section 4.1.
 *
 * Run: npx tsx scripts/gen-reference-sql.ts
 * Never edit db/seed/02_reference.sql by hand; edit this and regenerate.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILDING_DAMAGE_CLASS,
  BUILDING_TYPES,
  CURVE_LABEL,
  CURVE_SOURCE_NAME,
  CURVE_SOURCE_URL,
  DAMAGE_CLASSES,
  DEPTH_DAMAGE_CURVES,
} from '../lib/rules/curves';
import { HORIZON_PROBABILITY_DERIVATION, RULE_SET_SEED_DEFAULTS } from '../lib/rules/bands';

/* ------------------------------------------------------------------ *
 * Seed data with no runtime TypeScript consumer
 * ------------------------------------------------------------------ */

type Country = 'SG' | 'MY' | 'ID' | 'CN' | 'HK';
type Hazard = 'flood_riverine' | 'flood_coastal' | 'heat_days35' | 'wind' | 'pm25';

const COUNTRIES: readonly Country[] = ['SG', 'MY', 'ID', 'CN', 'HK'];
const HAZARDS: readonly Hazard[] = [
  'flood_riverine',
  'flood_coastal',
  'heat_days35',
  'wind',
  'pm25',
];

/** The dataset each hazard is sampled from (plan 4.6), cited on every row. */
const HAZARD_SOURCE: Readonly<Record<Hazard, { name: string; url: string }>> = {
  flood_riverine: {
    name: 'WRI Aqueduct Floods v2, riverine, 100-yr, RCP 8.5',
    url: 'https://www.wri.org/data/aqueduct-floods-hazard-maps',
  },
  flood_coastal: {
    name: 'WRI Aqueduct Floods v2, coastal with subsidence, 100-yr, RCP 8.5',
    url: 'https://www.wri.org/data/aqueduct-floods-hazard-maps',
  },
  heat_days35: {
    name: 'NASA NEX-GDDP-CMIP6 ssp585, days above 35 C',
    url: 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6',
  },
  wind: {
    name: 'STORM v4 tropical cyclone wind return periods',
    url: 'https://doi.org/10.4121/12705164',
  },
  pm25: {
    name: 'GHAP global high-resolution PM2.5, annual mean',
    url: 'https://gee-community-catalog.org/projects/ghap/',
  },
};

/**
 * The six `scored = false` rows of plan section 4.6, each with the reason the
 * provenance panel renders beside a measured-but-unscored value. Everything not
 * listed here is scored.
 *
 * The `absent` versus `measured_not_scored` distinction is a property of the
 * SAMPLE, not of this table: `absent` means the raster has no coverage at the
 * point (Singapore wind), `measured_not_scored` means a real value exists and
 * this table excludes it (Kota Kinabalu wind, Jakarta PM2.5).
 */
const NOT_SCORED: Readonly<Partial<Record<Hazard, Partial<Record<Country, string>>>>> = {
  wind: {
    SG: 'Not scored in Singapore: the island sits below the typhoon belt and outside STORM basin coverage, so there is no 100-year cyclone wind hazard to price.',
    MY: 'Not scored in Malaysia: the peninsula and Borneo sit off the main North West Pacific track. STORM returns a real value at Kota Kinabalu, and it is stored and shown, but no local damage evidence supports scoring it.',
    ID: 'Not scored in Indonesia: the archipelago lies within roughly ten degrees of the equator, where tropical cyclones do not form.',
  },
  pm25: {
    SG: 'Not scored in Singapore: annual mean PM2.5 sits near the regional low and no local hedonic evidence links it to property values.',
    MY: 'Not scored in Malaysia: no local hedonic evidence links annual mean PM2.5 to property values.',
    ID: 'Not scored in Indonesia: GHAP measures roughly 41 micrograms per cubic metre over Jakarta, and that value is stored and shown, but no local hedonic evidence links it to property values.',
  },
};

/** The reason text carried by a `scored = true` row. */
const SCORED_REASON: Readonly<Record<Hazard, string>> = {
  flood_riverine: 'Scored in all five markets: one global method, Aqueduct riverine depth at the 100-year return period.',
  flood_coastal: 'Scored in all five markets: one global method, Aqueduct coastal-with-subsidence depth at the 100-year return period.',
  heat_days35: 'Scored in all five markets as a delta against the 2016-2035 reference window, so the origination scenario is zero by definition of the metric.',
  wind: 'Scored in Hong Kong and mainland China only, where the North West Pacific typhoon track gives a material 100-year wind.',
  pm25: 'Scored in Hong Kong and mainland China only, where local evidence links chronic air quality to property values.',
};

/**
 * The seven curated adaptation projects of plan S8 (ADR-4: a credit in haircut
 * units, no polygon; membership is the curated `collateral.adaptation_project_id`).
 *
 * `haircut_credit_pp` values and source names are fixed by the plan.
 * `protection_return_period` is a curated planning-level figure, not a quoted
 * engineering standard except for Shanghai, whose 200-year seawall standard the
 * project name itself states. `docs/sources.md` (S31) records that distinction
 * and verifies each URL.
 */
type AdaptationProject = {
  id: string;
  name: string;
  country: Country;
  haircut_credit_pp: number;
  protection_return_period: number;
  source_name: string;
  source_url: string;
};

const ADAPTATION_PROJECTS: readonly AdaptationProject[] = [
  {
    id: 'sg-marina-barrage',
    name: 'Marina Barrage catchment',
    country: 'SG',
    haircut_credit_pp: 1.5,
    protection_return_period: 100,
    source_name: 'PUB, Singapore National Water Agency',
    source_url: 'https://www.pub.gov.sg/Public/WaterLoop/OurWaterStory/MarinaBarrage',
  },
  {
    id: 'sg-long-island',
    name: 'Long Island / City-East Coast coastal protection',
    country: 'SG',
    haircut_credit_pp: 3.0,
    protection_return_period: 100,
    source_name: 'PUB / NCCS Coastal Protection',
    source_url: 'https://www.nccs.gov.sg/singapores-climate-action/coastal-protection/',
  },
  {
    id: 'my-smart-tunnel',
    name: 'SMART tunnel catchment',
    country: 'MY',
    haircut_credit_pp: 2.0,
    protection_return_period: 100,
    source_name: 'DID Malaysia / SMART',
    source_url: 'https://smarttunnel.com.my/',
  },
  {
    id: 'id-ncicd-phase-a',
    name: 'NCICD coastal wall phase A',
    country: 'ID',
    haircut_credit_pp: 2.5,
    protection_return_period: 50,
    source_name: 'NCICD programme documents',
    source_url: 'https://www.deltares.nl/en/projects/national-capital-integrated-coastal-development',
  },
  {
    id: 'id-banger-polder',
    name: 'Banger polder, Semarang',
    country: 'ID',
    haircut_credit_pp: 1.5,
    protection_return_period: 25,
    source_name: 'Semarang polder project',
    source_url: 'https://www.deltares.nl/en/projects/banger-polder-semarang',
  },
  {
    id: 'hk-drainage-tunnels',
    name: 'Happy Valley + Tsuen Wan drainage tunnels',
    country: 'HK',
    haircut_credit_pp: 2.25,
    protection_return_period: 50,
    source_name: 'HK DSD Drainage Master Plans',
    source_url: 'https://www.dsd.gov.hk/EN/Our_Services/Stormwater_Drainage/index.html',
  },
  {
    id: 'cn-shanghai-seawall',
    name: 'Shanghai 200-yr seawall standard',
    country: 'CN',
    haircut_credit_pp: 2.5,
    protection_return_period: 200,
    source_name: 'Shanghai Water Authority',
    source_url: 'http://swj.sh.gov.cn/',
  },
];

/* ------------------------------------------------------------------ *
 * SQL emitters
 * ------------------------------------------------------------------ */

function str(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function num(value: number): string {
  return String(value);
}

function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

function jsonb(value: unknown): string {
  return `${str(JSON.stringify(value))}::jsonb`;
}

/**
 * A DELETE that removes every row of a curated table whose key is not in the
 * seed set, making the seed AUTHORITATIVE rather than merely additive.
 *
 * Without this an upsert is additive only: a row that was seeded under an old
 * key survives forever, because nothing ever looks for rows the seed no longer
 * claims. That is exactly how seven adaptation projects seeded under the old
 * uppercase ids outlived the switch to slugs, and it would have left the
 * database holding fourteen rows where the plan says seven.
 *
 * Emitted AFTER the insert, so the current rows are already present and only
 * genuine strays are removed. If a stray is still referenced, the foreign key
 * aborts the seed transaction, which is the right outcome: a loud failure
 * beats a silent orphan in the figures on stage.
 */
function pruneTo(table: string, keyExpression: string, keys: readonly string[]): string {
  return [
    `DELETE FROM ${table} WHERE ${keyExpression} NOT IN (`,
    `  ${keys.map((key) => str(key)).join(', ')}`,
    ');',
  ].join('\n');
}

function section(title: string): string {
  return [
    '-- ------------------------------------------------------------------',
    `-- ${title}`,
    '-- ------------------------------------------------------------------',
  ].join('\n');
}

function header(): string {
  return [
    '-- db/seed/02_reference.sql',
    '--',
    '-- GENERATED FILE. Do not edit by hand.',
    '-- Source: scripts/gen-reference-sql.ts, lib/rules/curves.ts, lib/rules/bands.ts',
    '-- Regenerate: npx tsx scripts/gen-reference-sql.ts',
    '--',
    '-- Assumes a freshly migrated database. Re-running is safe, and this file is',
    '-- AUTHORITATIVE for the four curated tables rather than merely additive:',
    '-- each upserts on its natural key and then deletes any row the seed no',
    '-- longer claims, so a key that changes (adaptation ids becoming slugs, a',
    '-- renamed building type) leaves no orphan behind.',
    '--',
    '-- rule_sets is the exception. Its previous active row is deactivated rather',
    '-- than deleted, because valuations.rule_set_id references it and the',
    '-- rule_sets_one_active partial index allows only one active row at a time.',
    '-- The history is an audit trail, not a stray.',
    '--',
    '-- No BEGIN/COMMIT here: scripts/seed.ts applies each seed file inside one',
    '-- transaction, so the runner owns transaction control and this file does not.',
  ].join('\n');
}

function depthDamageFunctions(): string {
  const rows = DAMAGE_CLASSES.map((cls) => {
    const points = DEPTH_DAMAGE_CURVES[cls].map((p) => ({
      depth_m: p.depth_m,
      damage_fraction: p.damage_fraction,
    }));
    return (
      `  (${str(`ddf_${cls}`)}, ${str(cls)}, ${jsonb(points)}, ` +
      `${str(CURVE_LABEL)}, ${str(CURVE_SOURCE_NAME)}, ${str(CURVE_SOURCE_URL)})`
    );
  });

  return [
    section('depth_damage_functions - plan section 4.3.1'),
    '-- A curated fit adapted from the JRC Asia curves, not a transcription: the',
    '-- published Asia residential curve sits near 0.32 at 0.5 m, this one at 0.30.',
    '-- The case screen labels them as a curated fit and docs/sources.md records',
    '-- the deviation. Linear interpolation between points, clamped to [0, 1].',
    '--',
    '-- The two pinned fixtures fall out of the residential row:',
    '--   f(0.50) = 0.30 (a published point)',
    '--   f(0.80) = 0.30 + (0.30 / 0.50) x 0.20 = 0.42 (interpolated)',
    'INSERT INTO depth_damage_functions (id, damage_class, points, curve_label, source_name, source_url) VALUES',
    `${rows.join(',\n')}`,
    'ON CONFLICT (damage_class) DO UPDATE SET',
    '  points = EXCLUDED.points,',
    '  curve_label = EXCLUDED.curve_label,',
    '  source_name = EXCLUDED.source_name,',
    '  source_url = EXCLUDED.source_url;',
    '',
    pruneTo('depth_damage_functions', 'damage_class::text', [...DAMAGE_CLASSES]),
  ].join('\n');
}

function buildingDamageClass(): string {
  const rows = BUILDING_TYPES.map(
    (bt) => `  (${str(bt)}, ${str(BUILDING_DAMAGE_CLASS[bt])})`,
  );

  return [
    section('building_damage_class - the six-to-three classification rule'),
    '-- ADR-2: this is a rule, so it is seeded here and read by',
    '-- lib/valuation/damage.ts, and prep/gen_portfolio.py writes building_type',
    '-- only. It decides which curve applies to every flood haircut.',
    'INSERT INTO building_damage_class (building_type, damage_class) VALUES',
    `${rows.join(',\n')}`,
    'ON CONFLICT (building_type) DO UPDATE SET damage_class = EXCLUDED.damage_class;',
    '',
    pruneTo('building_damage_class', 'building_type::text', [...BUILDING_TYPES]),
  ].join('\n');
}

function ruleSets(): string {
  const r = RULE_SET_SEED_DEFAULTS;

  return [
    section('rule_sets - the active rule set (ADR-5, ADR-6)'),
    `-- ${HORIZON_PROBABILITY_DERIVATION}`,
    '--',
    '-- The stored values are authoritative; nothing derives them at runtime.',
    '-- Only the flood term is multiplied by P. return_period is descriptive,',
    '-- read-only in the threshold editor, and does not drive P.',
    '--',
    '-- The previous active row is deactivated rather than deleted, because',
    '-- valuations.rule_set_id references it. That is the same move the',
    '-- threshold editor makes on save (S18).',
    'UPDATE rule_sets SET is_active = false WHERE is_active;',
    'INSERT INTO rule_sets (',
    '  is_active, base_ltv_personal, base_ltv_corporate,',
    '  band_low, band_mid, band_high, total_cap, chronic_cap,',
    '  p_today, p_2030, p_2050,',
    '  today_year, today_label, return_period, inundation_threshold_m,',
    '  adaptation_enabled, updated_by, updated_at',
    ') VALUES (',
    `  true, ${num(r.base_ltv_personal)}, ${num(r.base_ltv_corporate)},`,
    `  ${num(r.band_low)}, ${num(r.band_mid)}, ${num(r.band_high)}, ${num(r.total_cap)}, ${num(r.chronic_cap)},`,
    `  ${num(r.p_today)}, ${num(r.p_2030)}, ${num(r.p_2050)},`,
    `  ${num(r.today_year)}, ${str(r.today_label)}, ${num(r.return_period)}, ${num(r.inundation_threshold_m)},`,
    `  ${bool(r.adaptation_enabled)},`,
    "  (SELECT id FROM users WHERE email = 'risk@ocbc.demo'), now()",
    ');',
  ].join('\n');
}

function hazardApplicability(): string {
  const rows: string[] = [];

  for (const hazard of HAZARDS) {
    for (const country of COUNTRIES) {
      const notScoredReason = NOT_SCORED[hazard]?.[country];
      const scored = notScoredReason === undefined;
      const reason = scored ? SCORED_REASON[hazard] : notScoredReason;
      rows.push(
        `  (${str(hazard)}, ${str(country)}, ${bool(scored)}, ${str(reason)}, ${str(HAZARD_SOURCE[hazard].url)})`,
      );
    }
  }

  if (rows.length !== 25) {
    throw new Error(`hazard_applicability must be exactly 25 rows, built ${rows.length}`);
  }

  return [
    section('hazard_applicability - all 25 rows (plan section 4.6)'),
    '-- Principle 4: one method, five countries. Whether a hazard is scored is a',
    '-- row here, never a branch in the engine. Exactly 25 rows, five hazards by',
    '-- five countries, with six scored = false: wind and pm25 in SG, MY and ID.',
    '--',
    '-- The absent versus measured_not_scored distinction belongs to the sample,',
    '-- not to this table. Singapore wind is absent (STORM has no basin coverage);',
    '-- Kota Kinabalu wind and Jakarta PM2.5 are measured_not_scored, with the',
    '-- real value stored and the reason below rendered beside it.',
    'INSERT INTO hazard_applicability (hazard, country, scored, reason, source_url) VALUES',
    `${rows.join(',\n')}`,
    'ON CONFLICT (hazard, country) DO UPDATE SET',
    '  scored = EXCLUDED.scored,',
    '  reason = EXCLUDED.reason,',
    '  source_url = EXCLUDED.source_url;',
    '',
    '-- The key is a pair, but the seed inserts every hazard-country combination,',
    '-- so pruning each axis is exactly equivalent to pruning the pairs, and reads',
    '-- far better than a 25-row NOT IN over row constructors.',
    pruneTo('hazard_applicability', 'hazard::text', [...HAZARDS]),
    pruneTo('hazard_applicability', 'country::text', [...COUNTRIES]),
  ].join('\n');
}

function adaptationProjects(): string {
  const rows = ADAPTATION_PROJECTS.map(
    (p) =>
      `  (${str(p.id)}, ${str(p.name)}, ${str(p.country)}, ${num(p.haircut_credit_pp)}, ` +
      `${num(p.protection_return_period)}, ${str(p.source_name)}, ${str(p.source_url)}, true)`,
  );

  return [
    section('adaptation_projects - the seven curated projects (plan S8)'),
    '-- ADR-4: adaptation is a credit in haircut units, in percentage points,',
    '-- subtracted from the gross flood haircut and floored at zero. There is no',
    '-- polygon: membership is the curated collateral.adaptation_project_id and',
    '-- nothing derives it from geometry, so no second opinion can exist.',
    '--',
    '-- haircut_credit_pp and source_name are fixed by the plan.',
    '-- protection_return_period is a curated planning-level figure except for',
    '-- Shanghai, whose 200-year standard the project name states.',
    'INSERT INTO adaptation_projects (id, name, country, haircut_credit_pp, protection_return_period, source_name, source_url, curated) VALUES',
    `${rows.join(',\n')}`,
    'ON CONFLICT (id) DO UPDATE SET',
    '  name = EXCLUDED.name,',
    '  country = EXCLUDED.country,',
    '  haircut_credit_pp = EXCLUDED.haircut_credit_pp,',
    '  protection_return_period = EXCLUDED.protection_return_period,',
    '  source_name = EXCLUDED.source_name,',
    '  source_url = EXCLUDED.source_url,',
    '  curated = EXCLUDED.curated;',
    '',
    '-- collateral.adaptation_project_id references this table, so a stray row',
    '-- that is still pointed at aborts the seed rather than being removed. That',
    '-- is intended: it names the mismatch instead of hiding it.',
    pruneTo(
      'adaptation_projects',
      'id',
      ADAPTATION_PROJECTS.map((project) => project.id),
    ),
  ].join('\n');
}

function build(): string {
  return [
    header(),
    depthDamageFunctions(),
    buildingDamageClass(),
    ruleSets(),
    hazardApplicability(),
    adaptationProjects(),
    '',
  ].join('\n\n');
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '..', 'db', 'seed', '02_reference.sql');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, build(), 'utf8');
process.stdout.write(`wrote ${outPath}\n`);
