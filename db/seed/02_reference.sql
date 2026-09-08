-- db/seed/02_reference.sql
--
-- GENERATED FILE. Do not edit by hand.
-- Source: scripts/gen-reference-sql.ts, lib/rules/curves.ts, lib/rules/bands.ts
-- Regenerate: npx tsx scripts/gen-reference-sql.ts
--
-- Assumes a freshly migrated database. Re-running is safe, and this file is
-- AUTHORITATIVE for the four curated tables rather than merely additive:
-- each upserts on its natural key and then deletes any row the seed no
-- longer claims, so a key that changes (adaptation ids becoming slugs, a
-- renamed building type) leaves no orphan behind.
--
-- rule_sets is the exception. Its previous active row is deactivated rather
-- than deleted, because valuations.rule_set_id references it and the
-- rule_sets_one_active partial index allows only one active row at a time.
-- The history is an audit trail, not a stray.
--
-- No BEGIN/COMMIT here: scripts/seed.ts applies each seed file inside one
-- transaction, so the runner owns transaction control and this file does not.

-- ------------------------------------------------------------------
-- depth_damage_functions - plan section 4.3.1
-- ------------------------------------------------------------------
-- A curated fit adapted from the JRC Asia curves, not a transcription: the
-- published Asia residential curve sits near 0.32 at 0.5 m, this one at 0.30.
-- The case screen labels them as a curated fit and docs/sources.md records
-- the deviation. Linear interpolation between points, clamped to [0, 1].
--
-- The two pinned fixtures fall out of the residential row:
--   f(0.50) = 0.30 (a published point)
--   f(0.80) = 0.30 + (0.30 / 0.50) x 0.20 = 0.42 (interpolated)
INSERT INTO depth_damage_functions (id, damage_class, points, curve_label, source_name, source_url) VALUES
  ('ddf_residential', 'residential', '[{"depth_m":0,"damage_fraction":0},{"depth_m":0.5,"damage_fraction":0.3},{"depth_m":1,"damage_fraction":0.5},{"depth_m":1.5,"damage_fraction":0.62},{"depth_m":2,"damage_fraction":0.72},{"depth_m":3,"damage_fraction":0.87},{"depth_m":4,"damage_fraction":0.95},{"depth_m":6,"damage_fraction":1}]'::jsonb, 'seeded curve, curated fit (JRC Asia)', 'Huizinga, De Moel & Szewczyk 2017, JRC EUR 28552, Asia depth-damage curves (curated fit)', 'https://publications.jrc.ec.europa.eu/repository/handle/JRC105688'),
  ('ddf_commercial', 'commercial', '[{"depth_m":0,"damage_fraction":0},{"depth_m":0.5,"damage_fraction":0.22},{"depth_m":1,"damage_fraction":0.4},{"depth_m":1.5,"damage_fraction":0.53},{"depth_m":2,"damage_fraction":0.65},{"depth_m":3,"damage_fraction":0.82},{"depth_m":4,"damage_fraction":0.92},{"depth_m":6,"damage_fraction":1}]'::jsonb, 'seeded curve, curated fit (JRC Asia)', 'Huizinga, De Moel & Szewczyk 2017, JRC EUR 28552, Asia depth-damage curves (curated fit)', 'https://publications.jrc.ec.europa.eu/repository/handle/JRC105688'),
  ('ddf_industrial', 'industrial', '[{"depth_m":0,"damage_fraction":0},{"depth_m":0.5,"damage_fraction":0.18},{"depth_m":1,"damage_fraction":0.34},{"depth_m":1.5,"damage_fraction":0.47},{"depth_m":2,"damage_fraction":0.58},{"depth_m":3,"damage_fraction":0.76},{"depth_m":4,"damage_fraction":0.88},{"depth_m":6,"damage_fraction":1}]'::jsonb, 'seeded curve, curated fit (JRC Asia)', 'Huizinga, De Moel & Szewczyk 2017, JRC EUR 28552, Asia depth-damage curves (curated fit)', 'https://publications.jrc.ec.europa.eu/repository/handle/JRC105688')
ON CONFLICT (damage_class) DO UPDATE SET
  points = EXCLUDED.points,
  curve_label = EXCLUDED.curve_label,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url;

DELETE FROM depth_damage_functions WHERE damage_class::text NOT IN (
  'residential', 'commercial', 'industrial'
);

-- ------------------------------------------------------------------
-- building_damage_class - the six-to-three classification rule
-- ------------------------------------------------------------------
-- ADR-2: this is a rule, so it is seeded here and read by
-- lib/valuation/damage.ts, and prep/gen_portfolio.py writes building_type
-- only. It decides which curve applies to every flood haircut.
INSERT INTO building_damage_class (building_type, damage_class) VALUES
  ('residential_highrise_rc', 'residential'),
  ('residential_landed', 'residential'),
  ('shophouse_mixed', 'commercial'),
  ('office_tower', 'commercial'),
  ('retail_podium', 'commercial'),
  ('industrial_warehouse', 'industrial')
ON CONFLICT (building_type) DO UPDATE SET damage_class = EXCLUDED.damage_class;

DELETE FROM building_damage_class WHERE building_type::text NOT IN (
  'residential_highrise_rc', 'residential_landed', 'shophouse_mixed', 'office_tower', 'retail_podium', 'industrial_warehouse'
);

-- ------------------------------------------------------------------
-- rule_sets - the active rule set (ADR-5, ADR-6)
-- ------------------------------------------------------------------
-- P = 1 - 0.99^n, base year 2025, n = 0 / 5 / 25 -> 0.0000 / 0.0490 / 0.2222, stored as 0.00 / 0.05 / 0.22
--
-- The stored values are authoritative; nothing derives them at runtime.
-- Only the flood term is multiplied by P. return_period is descriptive,
-- read-only in the threshold editor, and does not drive P.
--
-- The previous active row is deactivated rather than deleted, because
-- valuations.rule_set_id references it. That is the same move the
-- threshold editor makes on save (S18).
UPDATE rule_sets SET is_active = false WHERE is_active;
INSERT INTO rule_sets (
  is_active, base_ltv_personal, base_ltv_corporate,
  band_low, band_mid, band_high, total_cap, chronic_cap,
  p_today, p_2030, p_2050,
  today_year, today_label, return_period, inundation_threshold_m,
  adaptation_enabled, updated_by, updated_at
) VALUES (
  true, 0.75, 0.6,
  0.03, 0.1, 0.2, 0.25, 0.05,
  0, 0.05, 0.22,
  2025, '2025 (origination)', 100, 0.5,
  true,
  (SELECT id FROM users WHERE email = 'risk@ocbc.demo'), now()
);

-- ------------------------------------------------------------------
-- hazard_applicability - all 25 rows (plan section 4.6)
-- ------------------------------------------------------------------
-- Principle 4: one method, five countries. Whether a hazard is scored is a
-- row here, never a branch in the engine. Exactly 25 rows, five hazards by
-- five countries, with six scored = false: wind and pm25 in SG, MY and ID.
--
-- The absent versus measured_not_scored distinction belongs to the sample,
-- not to this table. Singapore wind is absent (STORM has no basin coverage);
-- Kota Kinabalu wind and Jakarta PM2.5 are measured_not_scored, with the
-- real value stored and the reason below rendered beside it.
INSERT INTO hazard_applicability (hazard, country, scored, reason, source_url) VALUES
  ('flood_riverine', 'SG', true, 'Scored in all five markets: one global method, Aqueduct riverine depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_riverine', 'MY', true, 'Scored in all five markets: one global method, Aqueduct riverine depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_riverine', 'ID', true, 'Scored in all five markets: one global method, Aqueduct riverine depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_riverine', 'CN', true, 'Scored in all five markets: one global method, Aqueduct riverine depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_riverine', 'HK', true, 'Scored in all five markets: one global method, Aqueduct riverine depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_coastal', 'SG', true, 'Scored in all five markets: one global method, Aqueduct coastal-with-subsidence depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_coastal', 'MY', true, 'Scored in all five markets: one global method, Aqueduct coastal-with-subsidence depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_coastal', 'ID', true, 'Scored in all five markets: one global method, Aqueduct coastal-with-subsidence depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_coastal', 'CN', true, 'Scored in all five markets: one global method, Aqueduct coastal-with-subsidence depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('flood_coastal', 'HK', true, 'Scored in all five markets: one global method, Aqueduct coastal-with-subsidence depth at the 100-year return period.', 'https://www.wri.org/data/aqueduct-floods-hazard-maps'),
  ('heat_days35', 'SG', true, 'Scored in all five markets as a delta against the 2016-2035 reference window, so the origination scenario is zero by definition of the metric.', 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6'),
  ('heat_days35', 'MY', true, 'Scored in all five markets as a delta against the 2016-2035 reference window, so the origination scenario is zero by definition of the metric.', 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6'),
  ('heat_days35', 'ID', true, 'Scored in all five markets as a delta against the 2016-2035 reference window, so the origination scenario is zero by definition of the metric.', 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6'),
  ('heat_days35', 'CN', true, 'Scored in all five markets as a delta against the 2016-2035 reference window, so the origination scenario is zero by definition of the metric.', 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6'),
  ('heat_days35', 'HK', true, 'Scored in all five markets as a delta against the 2016-2035 reference window, so the origination scenario is zero by definition of the metric.', 'https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6'),
  ('wind', 'SG', false, 'Not scored in Singapore: the island sits below the typhoon belt and outside STORM basin coverage, so there is no 100-year cyclone wind hazard to price.', 'https://doi.org/10.4121/12705164'),
  ('wind', 'MY', false, 'Not scored in Malaysia: the peninsula and Borneo sit off the main North West Pacific track. STORM returns a real value at Kota Kinabalu, and it is stored and shown, but no local damage evidence supports scoring it.', 'https://doi.org/10.4121/12705164'),
  ('wind', 'ID', false, 'Not scored in Indonesia: the archipelago lies within roughly ten degrees of the equator, where tropical cyclones do not form.', 'https://doi.org/10.4121/12705164'),
  ('wind', 'CN', true, 'Scored in Hong Kong and mainland China only, where the North West Pacific typhoon track gives a material 100-year wind.', 'https://doi.org/10.4121/12705164'),
  ('wind', 'HK', true, 'Scored in Hong Kong and mainland China only, where the North West Pacific typhoon track gives a material 100-year wind.', 'https://doi.org/10.4121/12705164'),
  ('pm25', 'SG', false, 'Not scored in Singapore: annual mean PM2.5 sits near the regional low and no local hedonic evidence links it to property values.', 'https://gee-community-catalog.org/projects/ghap/'),
  ('pm25', 'MY', false, 'Not scored in Malaysia: no local hedonic evidence links annual mean PM2.5 to property values.', 'https://gee-community-catalog.org/projects/ghap/'),
  ('pm25', 'ID', false, 'Not scored in Indonesia: GHAP measures roughly 41 micrograms per cubic metre over Jakarta, and that value is stored and shown, but no local hedonic evidence links it to property values.', 'https://gee-community-catalog.org/projects/ghap/'),
  ('pm25', 'CN', true, 'Scored in Hong Kong and mainland China only, where local evidence links chronic air quality to property values.', 'https://gee-community-catalog.org/projects/ghap/'),
  ('pm25', 'HK', true, 'Scored in Hong Kong and mainland China only, where local evidence links chronic air quality to property values.', 'https://gee-community-catalog.org/projects/ghap/')
ON CONFLICT (hazard, country) DO UPDATE SET
  scored = EXCLUDED.scored,
  reason = EXCLUDED.reason,
  source_url = EXCLUDED.source_url;

-- The key is a pair, but the seed inserts every hazard-country combination,
-- so pruning each axis is exactly equivalent to pruning the pairs, and reads
-- far better than a 25-row NOT IN over row constructors.
DELETE FROM hazard_applicability WHERE hazard::text NOT IN (
  'flood_riverine', 'flood_coastal', 'heat_days35', 'wind', 'pm25'
);
DELETE FROM hazard_applicability WHERE country::text NOT IN (
  'SG', 'MY', 'ID', 'CN', 'HK'
);

-- ------------------------------------------------------------------
-- adaptation_projects - the seven curated projects (plan S8)
-- ------------------------------------------------------------------
-- ADR-4: adaptation is a credit in haircut units, in percentage points,
-- subtracted from the gross flood haircut and floored at zero. There is no
-- polygon: membership is the curated collateral.adaptation_project_id and
-- nothing derives it from geometry, so no second opinion can exist.
--
-- haircut_credit_pp and source_name are fixed by the plan.
-- protection_return_period is a curated planning-level figure except for
-- Shanghai, whose 200-year standard the project name states.
INSERT INTO adaptation_projects (id, name, country, haircut_credit_pp, protection_return_period, source_name, source_url, curated) VALUES
  ('sg-marina-barrage', 'Marina Barrage catchment', 'SG', 1.5, 100, 'PUB, Singapore National Water Agency', 'https://www.pub.gov.sg/Public/WaterLoop/OurWaterStory/MarinaBarrage', true),
  ('sg-long-island', 'Long Island / City-East Coast coastal protection', 'SG', 3, 100, 'PUB / NCCS Coastal Protection', 'https://www.nccs.gov.sg/singapores-climate-action/coastal-protection/', true),
  ('my-smart-tunnel', 'SMART tunnel catchment', 'MY', 2, 100, 'DID Malaysia / SMART', 'https://smarttunnel.com.my/', true),
  ('id-ncicd-phase-a', 'NCICD coastal wall phase A', 'ID', 2.5, 50, 'NCICD programme documents', 'https://www.deltares.nl/en/projects/national-capital-integrated-coastal-development', true),
  ('id-banger-polder', 'Banger polder, Semarang', 'ID', 1.5, 25, 'Semarang polder project', 'https://www.deltares.nl/en/projects/banger-polder-semarang', true),
  ('hk-drainage-tunnels', 'Happy Valley + Tsuen Wan drainage tunnels', 'HK', 2.25, 50, 'HK DSD Drainage Master Plans', 'https://www.dsd.gov.hk/EN/Our_Services/Stormwater_Drainage/index.html', true),
  ('cn-shanghai-seawall', 'Shanghai 200-yr seawall standard', 'CN', 2.5, 200, 'Shanghai Water Authority', 'http://swj.sh.gov.cn/', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  haircut_credit_pp = EXCLUDED.haircut_credit_pp,
  protection_return_period = EXCLUDED.protection_return_period,
  source_name = EXCLUDED.source_name,
  source_url = EXCLUDED.source_url,
  curated = EXCLUDED.curated;

-- collateral.adaptation_project_id references this table, so a stray row
-- that is still pointed at aborts the seed rather than being removed. That
-- is intended: it names the mismatch instead of hiding it.
DELETE FROM adaptation_projects WHERE id NOT IN (
  'sg-marina-barrage', 'sg-long-island', 'my-smart-tunnel', 'id-ncicd-phase-a', 'id-banger-polder', 'hk-drainage-tunnels', 'cn-shanghai-seawall'
);

