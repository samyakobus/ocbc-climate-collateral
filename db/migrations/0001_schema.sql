-- 0001_schema.sql
-- OCBC climate risk platform: tables, enums, constraints and indexes.
-- Authoritative definition: plan section 4.2. Do not add a column here that a view can compute
-- (ADR-7) and do not add a rule here that TypeScript owns (ADR-2).
--
-- Spatial containment is PostGIS's, exclusively (ADR-7). geography(Point,4326) on collateral
-- and environmental_events, geography(Point,4326) centroid plus geography(Polygon,4326) area
-- on hotspots. 0002_views.sql defines membership on top of them.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('loan_officer', 'corporate_credit_officer', 'risk_manager');

CREATE TYPE applicant_kind AS ENUM ('person', 'company');

CREATE TYPE loan_segment AS ENUM ('personal', 'corporate');

-- The six building types. They map six-to-three onto damage_class through the seeded
-- building_damage_class table, which is a RULE and therefore lives in lib/rules/curves.ts
-- and 02_reference.sql, never in the Python generator (ADR-2).
CREATE TYPE building_type AS ENUM (
  'residential_highrise_rc',
  'residential_landed',
  'shophouse_mixed',
  'office_tower',
  'retail_podium',
  'industrial_warehouse'
);

-- Modulates the wind band within its own limits (plan 4.3 windHaircut).
CREATE TYPE occupancy_class AS ENUM ('rc_highrise', 'lowrise_industrial');

CREATE TYPE damage_class AS ENUM ('residential', 'commercial', 'industrial');

CREATE TYPE hazard AS ENUM ('flood_riverine', 'flood_coastal', 'wind', 'heat_days35', 'pm25');

-- The two correlated water perils. valuations stores one set of flood columns and names
-- which peril they came from; NULL where both perils contribute zero (plan 4.2).
CREATE TYPE flood_peril AS ENUM ('flood_riverine', 'flood_coastal');

-- The leftmost position is labelled "2025 (origination)" on screen; the key stays today.
CREATE TYPE scenario AS ENUM ('today', 'y2030', 'y2050');

-- Three coverage states and only three (plan 4.6, principle 3). Measurement is separate
-- from policy: measured_not_scored keeps the measured value and contributes zero.
-- absent wins over measured_not_scored whenever both could apply.
CREATE TYPE coverage_state AS ENUM ('scored', 'measured_not_scored', 'absent');

-- Four bands from the three edges band_low / band_mid / band_high. "amber or worse" in AC-6
-- means anything other than green.
CREATE TYPE risk_band AS ENUM ('green', 'amber', 'orange', 'red');

CREATE TYPE narrative_subject AS ENUM ('case', 'portfolio', 'hotspot');

CREATE TYPE context_factor_kind AS ENUM (
  'haze',
  'water_stress',
  'cooling_degree_days',
  'subsidence_susceptibility',
  'sea_level_inundation',
  'coastal_erosion',
  'wildfire'
);

CREATE TYPE event_type AS ENUM ('fire', 'flood', 'pollution', 'earthquake', 'storm', 'haze');

-- fixture marks a demo row shown as a worked example rather than passed off as a model
-- result (ADR-3). A fixture row leaves model and scored_at untouched.
CREATE TYPE score_source AS ENUM ('model', 'fixture');

-- ---------------------------------------------------------------------------
-- Identity and portfolio
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  display_name  TEXT NOT NULL
);

CREATE TABLE applicants (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  kind      applicant_kind NOT NULL,
  country   CHAR(2) NOT NULL,
  synthetic BOOLEAN NOT NULL DEFAULT true
);

-- ADR-4: adaptation membership is the curated collateral.adaptation_project_id and nothing
-- derives it from geometry. This table therefore carries NO polygon, deliberately, so no
-- spatial join can produce a second opinion on a credit-relevant number.
CREATE TABLE adaptation_projects (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  country                  CHAR(2) NOT NULL,
  haircut_credit_pp        NUMERIC(5, 2) NOT NULL CHECK (haircut_credit_pp >= 0),
  protection_return_period INTEGER,
  source_name              TEXT NOT NULL,
  source_url               TEXT NOT NULL,
  curated                  BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON COLUMN adaptation_projects.haircut_credit_pp IS
  'Percentage POINTS subtracted from the gross flood haircut, floored at zero (ADR-4). 1.50 means 1.50pp.';

CREATE TABLE collateral (
  id                    TEXT PRIMARY KEY,
  address_line          TEXT NOT NULL,
  cluster_name          TEXT NOT NULL,
  country               CHAR(2) NOT NULL,
  geom                  geography(Point, 4326) NOT NULL,
  building_type         building_type NOT NULL,
  occupancy_class       occupancy_class NOT NULL,
  appraised_value_sgd   NUMERIC(16, 2) NOT NULL CHECK (appraised_value_sgd > 0),
  floor_level           INTEGER,
  elevation_m           NUMERIC(8, 2),
  dist_to_coast_km      NUMERIC(8, 3),
  adaptation_project_id TEXT REFERENCES adaptation_projects (id),
  landslide_flag        BOOLEAN NOT NULL DEFAULT false,
  slope_deg             NUMERIC(6, 2),
  satellite_thumb_path  TEXT
);

COMMENT ON COLUMN collateral.id IS
  'Format <CC>-<CLUSTER>-<NNN>, NNN a per-cluster running index from 001, so the highest index in a cluster equals that cluster pin count. SG-EC-002 is the second of twelve East Coast pins.';
COMMENT ON COLUMN collateral.landslide_flag IS
  'Manual-review flag, never a number. It never enters the haircut (spec constraint).';

CREATE TABLE loan_applications (
  id                TEXT PRIMARY KEY,
  applicant_id      TEXT NOT NULL REFERENCES applicants (id),
  collateral_id     TEXT NOT NULL REFERENCES collateral (id),
  segment           loan_segment NOT NULL,
  requested_amount  NUMERIC(16, 2) NOT NULL CHECK (requested_amount > 0),
  originated_year   INTEGER NOT NULL DEFAULT 2025,
  base_ltv_override NUMERIC(4, 3)
                    CHECK (base_ltv_override IS NULL OR (base_ltv_override > 0 AND base_ltv_override <= 1)),
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_review', 'approved', 'conditionally_approved')),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN loan_applications.base_ltv_override IS
  'Nullable per-case override. lib/valuation/combine.ts reads override ?? rule_set, so the risk manager edit wins on every case without one.';

-- ---------------------------------------------------------------------------
-- Hazard measurement
-- ---------------------------------------------------------------------------

-- Whether a hazard is scored for a country is a ROW, not a branch (principle 4).
-- Exactly 25 rows: 5 hazards x 5 countries, seeded in 02_reference.sql.
CREATE TABLE hazard_applicability (
  hazard     hazard NOT NULL,
  country    CHAR(2) NOT NULL,
  scored     BOOLEAN NOT NULL,
  reason     TEXT NOT NULL,
  source_url TEXT NOT NULL,
  PRIMARY KEY (hazard, country)
);

CREATE TABLE hazard_samples (
  id                 BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  collateral_id      TEXT NOT NULL REFERENCES collateral (id) ON DELETE CASCADE,
  hazard             hazard NOT NULL,
  scenario           scenario NOT NULL,
  value              NUMERIC(12, 4),
  coverage           coverage_state NOT NULL,
  scenario_invariant BOOLEAN NOT NULL DEFAULT false,
  unit               TEXT NOT NULL,
  dataset_name       TEXT NOT NULL,
  dataset_version    TEXT NOT NULL,
  pathway            TEXT,
  return_period_yrs  INTEGER,
  sampled_at         DATE NOT NULL,
  UNIQUE (collateral_id, hazard, scenario),
  -- absent means the raster has no coverage at this point, so there is no value to store.
  -- The other two states measured something and must keep it. A nodata sentinel is a hard
  -- prep failure and is never persisted (plan 4.6).
  CONSTRAINT hazard_samples_coverage_value_agree
    CHECK ((coverage = 'absent' AND value IS NULL) OR (coverage <> 'absent' AND value IS NOT NULL))
);

COMMENT ON COLUMN hazard_samples.coverage IS
  'scored contributes to the haircut; measured_not_scored keeps its measured value and contributes zero; absent has no value at all. Jakarta PM2.5 near 41 and Kota Kinabalu wind are measured_not_scored; Singapore wind is absent.';

CREATE TABLE site_modifiers (
  collateral_id   TEXT PRIMARY KEY REFERENCES collateral (id) ON DELETE CASCADE,
  suhi_tertile    SMALLINT NOT NULL CHECK (suhi_tertile BETWEEN 0 AND 2),
  ndvi_tertile    SMALLINT NOT NULL CHECK (ndvi_tertile BETWEEN 0 AND 2),
  dataset_name    TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  sampled_at      DATE NOT NULL
);

COMMENT ON TABLE site_modifiers IS
  'Tertiles are 0, 1, 2. heatHaircut indexes the multiplier array [1.0, 1.25, 1.5] with them (plan 4.3).';

CREATE TABLE context_factors (
  id             BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  collateral_id  TEXT NOT NULL REFERENCES collateral (id) ON DELETE CASCADE,
  factor         context_factor_kind NOT NULL,
  value          NUMERIC(12, 4),
  unit           TEXT NOT NULL,
  direction_2030 TEXT,
  direction_2050 TEXT,
  dataset_name   TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  sampled_at     DATE NOT NULL,
  UNIQUE (collateral_id, factor)
);

COMMENT ON TABLE context_factors IS
  'The seven unscored context factors. They are shown, never summed into a haircut. Seven rows per pin.';

-- ---------------------------------------------------------------------------
-- Reference data: curves, classification, rule set
-- ---------------------------------------------------------------------------

CREATE TABLE depth_damage_functions (
  id           TEXT PRIMARY KEY,
  damage_class damage_class NOT NULL UNIQUE,
  points       JSONB NOT NULL,
  curve_label  TEXT NOT NULL,
  source_name  TEXT NOT NULL,
  source_url   TEXT NOT NULL
);

COMMENT ON COLUMN depth_damage_functions.points IS
  'Ordered [{depth_m, damage_fraction}], linearly interpolated and clamped to [0,1]. A curated fit adapted from Huizinga et al. 2017 (JRC EUR 28552) Asia curves, not a transcription: the published Asia residential curve is near 0.32 at 0.5 m and this table uses 0.30. Labelled as a curated fit on screen and in docs/sources.md.';

-- The six-to-three classification rule. Read by lib/valuation/damage.ts at runtime and by
-- lib/rules/curves.ts at test time. It is a RULE, so the Python generator never writes it (ADR-2).
CREATE TABLE building_damage_class (
  building_type building_type PRIMARY KEY,
  damage_class  damage_class NOT NULL
);

CREATE TABLE rule_sets (
  id                     BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  is_active              BOOLEAN NOT NULL DEFAULT false,
  base_ltv_personal      NUMERIC(4, 3) NOT NULL DEFAULT 0.750,
  base_ltv_corporate     NUMERIC(4, 3) NOT NULL DEFAULT 0.600,
  band_low               NUMERIC(5, 4) NOT NULL DEFAULT 0.0300,
  band_mid               NUMERIC(5, 4) NOT NULL DEFAULT 0.1000,
  band_high              NUMERIC(5, 4) NOT NULL DEFAULT 0.2000,
  total_cap              NUMERIC(5, 4) NOT NULL DEFAULT 0.2500,
  chronic_cap            NUMERIC(5, 4) NOT NULL DEFAULT 0.0500,
  -- ADR-6, verbatim:
  -- P = 1 - 0.99^n, base year 2025, n = 0 / 5 / 25 -> 0.0000 / 0.0490 / 0.2222, stored as 0.00 / 0.05 / 0.22
  -- The stored values are authoritative. Nothing derives them at runtime.
  p_today                NUMERIC(4, 3) NOT NULL DEFAULT 0.000,
  p_2030                 NUMERIC(4, 3) NOT NULL DEFAULT 0.050,
  p_2050                 NUMERIC(4, 3) NOT NULL DEFAULT 0.220,
  today_year             INTEGER NOT NULL DEFAULT 2025,
  today_label            TEXT NOT NULL DEFAULT '2025 (origination)',
  return_period          INTEGER NOT NULL DEFAULT 100,
  inundation_threshold_m NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
  adaptation_enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_by             TEXT REFERENCES users (id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rule_sets_bands_ordered CHECK (band_low < band_mid AND band_mid < band_high)
);

COMMENT ON COLUMN rule_sets.return_period IS
  'DESCRIPTIVE label only, read-only in the editor. It does NOT drive P; the three stored probabilities do (ADR-5).';
COMMENT ON COLUMN rule_sets.today_label IS
  'The leftmost slider position reads "2025 (origination)", not "today". The scenario key stays today.';

-- Exactly one active rule set at a time. Saving on /rules writes a new active row.
CREATE UNIQUE INDEX rule_sets_one_active ON rule_sets (is_active) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Computed outputs
-- ---------------------------------------------------------------------------

CREATE TABLE valuations (
  id                              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  collateral_id                   TEXT NOT NULL REFERENCES collateral (id) ON DELETE CASCADE,
  scenario                        scenario NOT NULL,
  rule_set_id                     BIGINT NOT NULL REFERENCES rule_sets (id) ON DELETE CASCADE,
  winning_peril                   flood_peril,
  depth_m                         NUMERIC(8, 3),
  damage_fraction                 NUMERIC(6, 4),
  flood_haircut_gross             NUMERIC(6, 4),
  adaptation_credit_documented_pp NUMERIC(5, 2),
  adaptation_credit_effective_pp  NUMERIC(5, 2),
  flood_haircut                   NUMERIC(6, 4) NOT NULL DEFAULT 0,
  wind_haircut                    NUMERIC(6, 4) NOT NULL DEFAULT 0,
  heat_haircut                    NUMERIC(6, 4) NOT NULL DEFAULT 0,
  pm25_haircut                    NUMERIC(6, 4) NOT NULL DEFAULT 0,
  chronic_haircut                 NUMERIC(6, 4) NOT NULL DEFAULT 0,
  total_haircut                   NUMERIC(6, 4) NOT NULL DEFAULT 0,
  adjusted_value_sgd              NUMERIC(16, 2) NOT NULL,
  band                            risk_band NOT NULL,
  computed_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collateral_id, scenario, rule_set_id)
);

COMMENT ON COLUMN valuations.winning_peril IS
  'Which of the two water perils won the max. The flood columns are that peril values. NULL where both contribute zero, which is most pins at the 2025 scenario; the provenance panel then shows no flood line rather than an arbitrary one.';
COMMENT ON COLUMN valuations.adaptation_credit_effective_pp IS
  'gross minus net, i.e. what the credit ACTUALLY bought after the ADR-4 zero floor. Rendered beside the documented credit, never instead of it.';

CREATE TABLE application_valuations (
  id                  BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  loan_application_id TEXT NOT NULL REFERENCES loan_applications (id) ON DELETE CASCADE,
  scenario            scenario NOT NULL,
  rule_set_id         BIGINT NOT NULL REFERENCES rule_sets (id) ON DELETE CASCADE,
  segment             loan_segment NOT NULL,
  ltv_applied         NUMERIC(4, 3) NOT NULL,
  max_loan_sgd        NUMERIC(16, 2) NOT NULL,
  UNIQUE (loan_application_id, scenario, rule_set_id)
);

CREATE TABLE recommendations (
  id                  BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  loan_application_id TEXT NOT NULL REFERENCES loan_applications (id) ON DELETE CASCADE,
  scenario            scenario NOT NULL,
  band                risk_band NOT NULL,
  conditions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  revalue_by_year     INTEGER,
  refer_to_risk       BOOLEAN NOT NULL DEFAULT false,
  rule_set_id         BIGINT NOT NULL REFERENCES rule_sets (id) ON DELETE CASCADE,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_application_id, scenario, rule_set_id)
);

COMMENT ON COLUMN recommendations.revalue_by_year IS
  'First scenario year whose total haircut crosses band_mid, over the literal years [today_year=2025, 2030, 2050], else NULL. A property of the APPLICATION, stored identically on all three scenario rows, so the dashboard tile counts it with COUNT(DISTINCT loan_application_id) and labels itself scenario-invariant.';
COMMENT ON COLUMN recommendations.conditions IS
  'Conditions only, never a decline (spec constraint).';

CREATE TABLE narratives (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  subject_type  narrative_subject NOT NULL,
  subject_id    TEXT NOT NULL,
  scenario      scenario,
  text          TEXT NOT NULL,
  model         TEXT,
  prompt_hash   TEXT,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated     BOOLEAN NOT NULL DEFAULT false,
  fallback_used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX narratives_subject_idx ON narratives (subject_type, subject_id, scenario);

-- ---------------------------------------------------------------------------
-- Regional layer
-- ---------------------------------------------------------------------------

CREATE TABLE satellite_tiles (
  id           TEXT PRIMARY KEY,
  region       TEXT NOT NULL,
  bbox         TEXT NOT NULL,
  capture_date DATE,
  cached_path  TEXT NOT NULL,
  live_url     TEXT,
  fetched_at   TIMESTAMPTZ,
  provider     TEXT NOT NULL
);

COMMENT ON COLUMN satellite_tiles.cached_path IS
  'The strip ALWAYS renders from here. Refresh writes a new file with a hash suffix and updates fetched_at; a failed refresh changes nothing (plan 4.9).';

CREATE TABLE hotspots (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  country         CHAR(2) NOT NULL,
  centroid        geography(Point, 4326) NOT NULL,
  area            geography(Polygon, 4326),
  radius_m        NUMERIC(10, 1),
  hazard_type     TEXT NOT NULL,
  summary         TEXT,
  score_inputs    JSONB,
  reference_index INTEGER CHECK (reference_index IS NULL OR reference_index BETWEEN 1 AND 100),
  llm_score       INTEGER,
  llm_drivers     JSONB,
  llm_rationale   TEXT,
  model           TEXT,
  scored_at       TIMESTAMPTZ,
  score_source    score_source,
  score_validated BOOLEAN NOT NULL DEFAULT false,
  score_fallback  BOOLEAN NOT NULL DEFAULT false,
  -- ADR-3, valid DDL and two-valued even before compute-reference.ts has run.
  divergence_flag BOOLEAN GENERATED ALWAYS AS (
    COALESCE(llm_score IS NOT NULL AND reference_index IS NOT NULL
             AND abs(llm_score - reference_index) > 25, false)) STORED,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one shape per hotspot, so the membership UNION in 0002_views.sql is a union of
  -- mutually exclusive branches and can never emit a duplicate pair (ADR-7).
  CONSTRAINT hotspots_exactly_one_shape CHECK ((area IS NULL) <> (radius_m IS NULL))
);

-- ADR-7: there is no loan_exposure_sgd and no exposure_share column. v_hotspot_exposure
-- computes both, the popup reads the view, and prep:reference snapshots them into score_inputs.
COMMENT ON TABLE hotspots IS
  'Polygons and radii only, written by prep/build_hotspots.py. It decides no membership (ADR-7).';
COMMENT ON COLUMN hotspots.llm_score IS
  'The one LLM-assigned number in the product. Range is enforced by lib/index/validate-score.ts, not by the tool schema, which is advisory. An out-of-range or unvalidated score is never written; the row falls back to reference_index instead.';

CREATE TABLE environmental_events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  event_type  event_type NOT NULL,
  occurred_on DATE NOT NULL,
  location    geography(Point, 4326),
  source_feed TEXT NOT NULL,
  source_url  TEXT NOT NULL,
  dedupe_key  TEXT NOT NULL UNIQUE,
  hotspot_id  TEXT REFERENCES hotspots (id) ON DELETE SET NULL
);

COMMENT ON COLUMN environmental_events.dedupe_key IS
  'Refresh upserts on this key and never deletes (plan 4.9).';

-- ---------------------------------------------------------------------------
-- Indexes (plan 4.2)
-- ---------------------------------------------------------------------------

-- GIST on every geography column.
CREATE INDEX collateral_geom_gist          ON collateral           USING GIST (geom);
CREATE INDEX hotspots_centroid_gist        ON hotspots             USING GIST (centroid);
CREATE INDEX hotspots_area_gist            ON hotspots             USING GIST (area);
CREATE INDEX environmental_events_loc_gist ON environmental_events USING GIST (location);

CREATE INDEX hazard_samples_collateral_scenario_idx ON hazard_samples (collateral_id, scenario);
CREATE INDEX valuations_scenario_band_idx           ON valuations (scenario, band);
CREATE INDEX environmental_events_occurred_idx      ON environmental_events (occurred_on DESC);

-- Supporting indexes for the joins the views and the case list make.
CREATE INDEX loan_applications_collateral_idx ON loan_applications (collateral_id);
CREATE INDEX loan_applications_segment_idx    ON loan_applications (segment);
CREATE INDEX valuations_collateral_idx        ON valuations (collateral_id, scenario);
CREATE INDEX recommendations_application_idx  ON recommendations (loan_application_id, scenario);
CREATE INDEX context_factors_collateral_idx   ON context_factors (collateral_id);
