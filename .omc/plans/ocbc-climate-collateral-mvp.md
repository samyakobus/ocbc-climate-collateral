# Implementation Plan: OCBC Climate Risk Platform with Collateral Decision Tool

Status: consensus approved (Architect SOUND, Critic APPROVED, iteration 5) - PENDING APPROVAL for execution

## Consensus summary

Five RALPLAN-DR iterations were run, each reviewed independently by an Architect and a Critic who did not
read each other's output. Verdicts by iteration: 1, Architect SOUND WITH CHANGES (18 defects) and Critic
REVISE (6 blocking); 2, Architect SOUND WITH CHANGES (14 defects) and Critic REVISE (6 blocking); 3,
Architect SOUND WITH CHANGES (9 defects) and Critic REVISE (4 blocking); 4, Architect SOUND WITH CHANGES
(4 defects) and Critic REVISE (2 blocking); 5, **Architect SOUND** (0 defects, 4 non-blocking nits) and
**Critic APPROVED** (0 blocking, 7 residual improvements), with this snapshot merging those eleven residual
items, deduplicated to ten. Across the five iterations and this merge, **142 review points** were raised:
**137 applied in full, 1 applied in part, 3 declined** with a recorded reason, and 1 merged as a duplicate.
Per iteration those were 46 points (44 applied, 2 declined), 40 (38 full, 1 part, 1 declined), 25 (all
applied), 20 (all applied), and 11 in this merge (10 applied after deduplication). Both reviewers independently recomputed every load-bearing figure in the final pass: the three
horizon probabilities, both AC-2 fixtures, the AC-3 delta and zero-floor case, the five cluster sums to
exactly 200, and the basemap tile counts. Coverage stands at 17 of 17 acceptance criteria with a concrete
automated test, 17 of 17 with an authoring step carrying a day and an owner, 40 of 40 named test artefacts
scheduled, and cut lines on all five days. Reviews are at `.omc/plans/reviews/architect-iter1.md` through
`architect-iter5.md` and `.omc/plans/reviews/critic-iter1.md` through `critic-iter5.md`.

## 1. Requirements Summary

Source of truth: `.omc/specs/deep-interview-ocbc-climate-collateral.md` (ambiguity 10%, PASSED), as amended
2026-09-07. Six active components: login and roles; hazard layer plus portfolio map dashboard;
climate-adjusted collateral valuation engine; recommendations and actions; data layer; AI Dashboard. Insurance
and wealth extensions are deferred to phase 2. Markets: SG, MY, ID, CN, HK.

Binding constraints (spec "Constraints"):
- Three seeded users, email plus password, role-specific home screens. No sign-up.
- Base LTV 75% personal / 60% corporate, applied to the *adjusted* value, editable by the risk manager.
- One global method for all five countries. No country special-cased in a code path.
- Scored hazards: flood (Aqueduct v2 riverine + coastal-with-subsidence, 100-yr, RCP 8.5), typhoon wind
  (STORM v4), extreme heat (NEX-GDDP-CMIP6 vs ERA5-Land, UHI-modified), chronic PM2.5 (GHAP). Landslide is a
  manual-review flag, never a number. Seven context factors, unscored.
- Combination rule: max of the correlated water perils, plus wind, plus the chronic sum capped at 5%, total
  capped at 25%.
- Recommendation bands on the 2050 haircut, editable by the risk manager, conditions only, never a decline.
- LLM explains, never decides, **with one scoped exception**: the AI Dashboard hotspot score 1-100 is assigned
  by the LLM (user decision 2026-09-07). Haircuts, LTVs, conditions and case narratives stay deterministic.
- Offline demo except the per-property satellite thumbnail and the AI Dashboard tile strip.

**Spec amendment 2026-09-07.** AC-1 now reads: the risk manager lands on the AI Dashboard, with the portfolio
dashboard one click away in the top navigation. S3 and `auth.spec.ts` target the amended text.

Seventeen acceptance criteria AC-1 to AC-17 are the definition of done.

## 2. RALPLAN-DR Summary

### Principles

1. **Determinism is the product, with one fenced exception.** Every credit figure is reproducible by hand from
   stored inputs and a published formula. The hotspot score is the single LLM-assigned number; it is fenced by
   a deterministic reference index, a divergence badge and a fallback, and never touches a haircut, LTV or
   loan condition.
2. **Offline-first.** No outbound call during any page render. Outbound calls live only in the three named
   entry points, each with a timeout and a cached fallback.
3. **Provenance on every number, and measurement is separate from policy.** A number without a dataset name,
   version, scenario and sampled-at date does not ship. "Measured at 41 micrograms and not scored in Indonesia"
   is a different statement from "no data here", and the schema keeps them apart.
4. **One method, five countries; applicability lives in data.** No country appears in a branch of the engine.
   Whether a hazard is scored for a country is a row in `hazard_applicability`.
5. **One owner per rule.** A rule implemented twice is a defect. TypeScript owns arithmetic and validation;
   PostGIS owns spatial containment; Python owns raster and Earth Engine sampling only.
6. **Demo reliability beats feature count.**

### Decision Drivers

1. **Five-day timeline with a board-level demo at the end.** Ranked first.
2. **Reproducibility under challenge.** A director will ask where 6.6% comes from, and every intermediate step
   must survive arithmetic.
3. **Zero network dependency on stage**, above data freshness and above LLM quality.

### Viable Options

**Option A: Next.js monolith, server actions, valuation in TypeScript, PostGIS for spatial queries.**
- Pros: one language for arithmetic and validation; one test runner; two containers; AC-9 recomputes
  in-process with no message bus.
- Cons: numeric code in TypeScript is less idiomatic than NumPy.

**Option B: Next.js front end plus a separate FastAPI valuation service.**
- Pros: valuation, sampling and validators become one Python package with no seam.
- Cons: three containers plus a network contract; a second test harness; AC-9 becomes a cross-process fan-out
  over 600 rows plus a revalidation race, on the one demo step performed live in front of the board.

**Option C: Valuation as PL/pgSQL functions invoked from Next.js.**
- Pros: a whole-portfolio recompute is one `UPDATE`; map, case screen and dashboard cannot disagree.
- Cons: the formula is the artefact the board inspects and PL/pgSQL is the worst place to read it from.

**Decision: Option A**, with the rule-ownership boundary of ADR-2 and the partial-Option-C concession of ADR-7.

Invalidation of B: driver 1. Its only real advantage was deduplication, which ADR-2 captures without the second
deployable. Invalidation of C **as a whole**: driver 2. Option C is nonetheless correct on the spatial
sub-domain, and ADR-7 adopts it there.

### Data-prep sub-decision

**Option A': Earth Engine Python API.** **Option B': download GeoTIFFs and sample with rasterio.**

**Decision: hybrid, Earth Engine primary.** Aqueduct Floods v2, ERA5-Land, NEX-GDDP-CMIP6, Yale SUHI v4,
Sentinel-2 NDVI, Copernicus DEM and GHAP through Earth Engine; STORM v4, NASA LHASA, Herrera-Garcia, IPCC AR6
sea level and Deltares Shoreline downloaded once and sampled with rasterio. Pure B' dies on Aqueduct volume;
pure A' dies on the STORM and LHASA asset-ingest quota.

**Three-source rule.** Every prep script accepts `--source=live|frozen|synthetic`. `live` samples and writes
`data/frozen/`. `frozen` replays the committed CSV with no credentials. `synthetic` derives plausible values
from a seeded model needing nothing external. `synthetic` is committed on **Day 1 by 12:00**, before any Earth
Engine dependency resolves, so a committed floor exists unconditionally.

## 3. Architecture Decision Records

### ADR-1: Next.js monolith with the valuation engine in-process

- **Decision.** One Next.js App Router application owns auth, the engine, the rule set, the recompute pass and
  all rendering. PostgreSQL with PostGIS is the only other container.
- **Drivers.** Timeline; reproducibility; AC-9 must recompute and recolour with no restart.
- **Alternatives considered.** A FastAPI valuation service; PL/pgSQL functions.
- **Why chosen.** AC-9 is performed live in front of the board. In-process it is one server action, one
  transaction, one `revalidatePath`.
- **Consequences.** Numeric code is TypeScript. Prep and runtime share a language, which ADR-2 exploits.
- **Follow-ups.** None open.

### ADR-2: TypeScript owns arithmetic and validation; Python owns only raster and Earth Engine sampling

- **Decision.** Python writes raw sampled values only. Every derived value and every validator is TypeScript,
  invoked through `npm run prep:*`. `scripts/compute-reference.ts` computes the reference index;
  `scripts/gen-narratives.ts` and `scripts/gen-hotspot-scores.ts` import `lib/narrative/validate.ts` and
  `lib/index/validate-score.ts` directly.
- **Drivers.** Principle 5; driver 2. Three rules were previously implemented twice, both copies under test.
- **Alternatives considered.** Move everything to Python behind a service; keep both copies and let a test detect drift.
- **Why chosen.** A test whose purpose is to detect drift between two hand-maintained copies of one formula is
  a smell, not a control. The language boundary now follows a capability seam, not a lifecycle seam.
- **Consequences.** `prep/` is `gen_portfolio.py`, `sample_hazards.py`, `build_hotspots.py`, `fetch_events.py`,
  `fetch_tiles.py`.
- **Declared exemption.** `prep/lib/synthetic.py` derives plausible hazard values from elevation, distance to
  coast, latitude and basin membership. That is a physical model, therefore a rule, and it stays in Python by
  exception because it never runs in the same pass as a real sample, it is fully pinned by `seed=20260907`, and
  its outputs are committed to `data/synthetic/` and diffed in review. The exemption is stated here rather than
  left implicit, because `synthetic` is the floor every acceptance test runs against when Earth Engine is
  unavailable.
- **Follow-ups.** The `prep:*` CLI runs under `tsx` without a browser build.

### ADR-3: The hotspot score is LLM-assigned; the reference index is withheld from the prompt

- **Decision.** The displayed score is assigned by the LLM through structured output. A deterministic reference
  index is computed from the same data and is **not** shown to the model. Divergence beyond 25 points raises a
  badge; an unreachable API or a failed validation renders the reference with a fallback badge.
- **Drivers.** The user's 2026-09-07 decision; the spec's AC-17 guardrail, whose input list is closed.
- **Alternatives considered.** Anchoring the model on the reference (adopted in iteration 1, reversed by the team lead).
- **Why chosen.** An anchored model has no mechanism for expressing deliberate departure, so the badge would
  measure neither agreement nor disagreement.
- **Consequences.** Divergence fires more often than under anchoring. That is intended, and the demo shows a
  genuinely divergent hotspot rather than a planted one. A written calibration rubric (section 4.5) keeps
  scores comparable.
- **Documented expansion.** The spec's "recent event count and severity" is expanded into a count and a
  **sum** of weights. `max_event_severity` is stored for the popup's input list and for diagnostics but is
  **not** sent, so the payload matches the spec's closed list term for term.
- **Both demo branches are scripted.** If the Day-4 run produces a genuinely divergent hotspot, demo step 1
  shows it. If it does not, the presenter says so plainly and shows the badge on a `score_source = 'fixture'`
  row, which is labelled as a worked example rather than passed off as a model result.
- **Follow-ups.** The observed divergence rate is recorded in `docs/sources.md` immediately after the Day-4
  pre-generation run. Rubric tightening is **time-boxed to 45 minutes on Day 4**; past that the observed rate
  is accepted and reported as-is.

### ADR-4: Adaptation is a credit in haircut units, not a depth reduction

- **Decision.** `haircut = damage_fraction(depth) x P(scenario) - adaptation_credit_pp`, floored at zero.
  `adaptation_projects.haircut_credit_pp` stores percentage points.
- **Drivers.** The spec's binding formula line reads "− adaptation credit"; AC-3 requires the toggle to change
  the haircut by the documented amount.
- **Alternatives considered.** Adaptation as a depth reduction before the JRC curve (iteration 1), which is physically
  better but makes AC-3's delta curve-dependent.
- **Why chosen.** The spec is internally inconsistent here: the formula subtracts a credit while the adaptation
  bullet describes a depth reduction. Only the credit form makes AC-3 a documented constant.
- **Consequences.** The zero floor means a shallow-flooding property inside a high-credit zone shows an
  **effective** credit smaller than the documented one. The adaptation panel therefore renders both figures
  side by side, and `SG-EC-003` is a fixture where the floor binds, so the behaviour is pinned rather than
  incidental.
- **Containment authority.** `adaptation_projects` carries **no polygon**. Adaptation membership is the curated
  `collateral.adaptation_project_id` and nothing derives it from geometry, so ADR-7's one-owner rule holds here
  too. This is the right call for adaptation specifically, unlike hotspots: an adaptation zone is a curated
  judgement about engineered protection, not measured geography, so hand-assignment is defensible where
  hand-assigned hotspot membership was not. It also removes a real hazard: AC-2 requires `SG-EC-001` and
  `SG-EC-002` to sit outside the Long Island zone while `SG-EC-003`, also on the East Coast, sits inside it, and
  a shoreline polygon drawn the obvious way would have contained all three.
- **Follow-ups.** Phase 2 may restore the depth-reduction form once AC-3 is expressed as a curve-aware range,
  and may add zone polygons once they are drawn from a source rather than sketched.

### ADR-5: Horizon probability varies by scenario; only the flood term carries it

- **Decision.** `P = 1 - 0.99^n` with base year **2025**, the origination year of every seeded loan, and
  `n = 0, 5, 25` for today, 2030 and 2050. This gives `0.000, 0.049, 0.222`, stored as
  `p_today = 0.00`, `p_2030 = 0.05`, `p_2050 = 0.22`. The scenario slider changes **both** the Aqueduct depth
  layer and `P`.
- **Drivers.** The spec's binding text is "P(at least one such flood **before the horizon year**; ~22% for
  2050)". Driver 2 requires the derivation to survive arithmetic.
- **Alternatives considered.** A tenor-based constant 0.22 (iteration 1, withdrawn: its uniqueness claim was false). A
  2026 base year (iteration 2, withdrawn: it yields 0.214, which rounds to 0.21, not 0.22, so the migration
  comment misstated its own arithmetic). `p_today = 0.01`, the one-year probability, proposed by the Architect
  to make the today column a measurement rather than a tautology; **declined** because the team lead fixed
  `n = 0`, and because `n = 0` is the only value consistent with "before the horizon year" when the horizon is
  now.
- **Why chosen.** With base 2025 the three stored values are true roundings of one formula at `n = 0, 5, 25`,
  and 0.22 matches the spec's own "~22% for 2050". A director can check every one by subtraction.
- **Consequences.** Stated precisely: **Only the flood term is multiplied by `P`.** Wind and the chronic perils
  are unconditional return-period bands and carry no horizon probability; heat is zero at today because today
  is the reference window of a relative metric. So at today a pin carries **zero flood and zero heat, but its
  full present-climate wind and its scenario-invariant PM2.5**. Hong Kong 100-year winds near 50-60 m/s give
  roughly 4% after the RC high-rise multiplier, plus 1-2% PM2.5, so **Hong Kong and coastal China pins are
  amber at the leftmost slider position, which the UI labels 2025 (origination), while SG, MY and ID pins are
  green**. That is the correct behaviour and a better story than
  a uniformly green column: it demonstrates that the applicability model, not a country branch, is what zeroes
  the other three markets. At 2030 a flood-only pin needs `damage_fraction >= 0.60`, roughly 1.4 m of water on
  the seeded residential curve, to reach the 3% amber edge, so flood-driven movement is mostly a 2050 story and
  the 2030 column moves chiefly through Hong Kong and China.
- **Scenario label.** The leftmost slider position is labelled **"2025 (origination)"**, not "today". The base
  year is the origination year of every seeded loan, which is what makes the probability arithmetic clean, but
  the demo runs in September 2026, so a position labelled "today" resolving to a past year invites the wrong
  question. The label also makes `revalue_by_year = 2025` legible: a revaluation date in the past means
  **overdue**, which is a finding rather than a clock bug, and the demo script says so.
- **Follow-ups.** `tenor_years` is dropped from `rule_sets`. `return_period` is retained as a **descriptive**
  label, read-only in the editor and marked as not driving `P`.

### ADR-6: The three horizon probabilities are stored constants with a true derivation comment

- **Decision.** The migration comment reads, verbatim: `P = 1 - 0.99^n, base year 2025, n = 0 / 5 / 25 ->
  0.0000 / 0.0490 / 0.2222, stored as 0.00 / 0.05 / 0.22`. The stored values are authoritative; nothing derives
  them at runtime.
- **Drivers.** AC-2 requires exactly 6.6%, which needs `P = 0.22`; driver 2 requires the comment to be checkable.
- **Alternatives considered.** Deriving at runtime from `tenor_years` and `return_period`, which lets the risk manager edit
  three columns into mutual contradiction.
- **Why chosen.** One authoritative value per scenario cannot contradict itself, and with base year 2025 the
  rounding is genuine rather than reverse-engineered.
- **Consequences.** The threshold editor exposes the three probabilities, each labelled with its `n`.
- **Follow-ups.** None open.

### ADR-7: PostGIS owns spatial containment, exclusively

- **Decision.** `v_hotspot_membership (hotspot_id, collateral_id)` in `0002_views.sql` is the single definition
  of which collateral belongs to which hotspot. `v_hotspot_exposure` is defined on top of it.
  `prep/build_hotspots.py` writes **polygons and radii only** and decides no membership.
  `scripts/compute-reference.ts` reads membership from the view.
- **Drivers.** Principle 5. Membership was previously decided by Python clustering **and** recomputed by a
  PostGIS predicate, with AC-15 asserting the popup equals the view. A pin inside the radius but outside the
  polygon, or a point on a boundary, would have made `score_inputs` and the popup disagree.
- **Alternatives considered.** Leave membership in Python and treat the AC-15 test as the reconciliation.
- **Why chosen.** This is the same class of defect ADR-2 was written to eliminate, at a seam ADR-2 did not
  cover. It costs one view.
- **Consequences.** `hotspots.loan_exposure_sgd` is **dropped as a stored column**; the popup, `score_inputs`
  and the AC-15 test all read `v_hotspot_exposure`, so there is one number with one writer.
- **Follow-ups.** None open.

## 4. Architecture

### 4.1 Repo layout

```
docker-compose.yml                  web + db(postgis/postgis:16-3.4), single .env
Dockerfile.web                      node:22-alpine; pinned go-pmtiles v1.22 binary; playwright deps
.env.example                        DATABASE_URL, ANTHROPIC_API_KEY, GOOGLE_MAPS_STATIC_KEY, AUTH_SECRET
.gitignore                          data/raw/
                                    public/basemap/*.pmtiles
                                    !public/basemap/asia-z0-z6.pmtiles          <- negation, D14
package.json                        dev, build, db:migrate, db:seed, db:recompute, verify:dashboard,
                                    prep:reference, prep:narratives, prep:scores, prep:basemap,
                                    test, test:component, test:db, test:e2e
vitest.workspace.ts                 three projects: unit(node), component(jsdom), db(node + pg)
playwright.config.ts                webServer against the compose stack, 1 worker, trace on failure
db/migrations/{0001_schema,0002_views}.sql   tables, PostGIS, indexes; membership, exposure, portfolio views
db/seed/01_users.sql                three seeded users, bcrypt hashes from scripts/seed.ts
db/seed/02_reference.sql            depth_damage_functions, adaptation_projects, rule_sets,
                                    hazard_applicability (25 rows)
db/seed/03_portfolio.sql            from gen_portfolio.py: applicants, loan_applications, collateral
db/seed/04_samples.sql              from sample_hazards.py: hazard_samples, site_modifiers, context_factors
db/seed/05_regional.sql             hotspots (geometry only), environmental_events, satellite_tiles
app/(auth)/login/page.tsx           AC-1
app/(app)/layout.tsx                nav, role guard, offline banner, IllustrativeRibbon
app/(app)/cases/page.tsx            case lists, segment filtered by role
app/(app)/cases/[id]/page.tsx       case screen  AC-2,3,7,10,12
app/(app)/map/page.tsx              MapLibre portfolio map + scenario slider  AC-5,7
app/(app)/portfolio/page.tsx        headline figures + top 10, defaults to 2050  AC-6
app/(app)/rules/page.tsx            threshold editor, risk manager only  AC-9
app/(app)/ai/page.tsx               AI Dashboard, risk-manager landing  AC-14..17
app/api/refresh/{tiles,news}/route.ts   POST only, 5s timeout, cached fallback  AC-14,16
app/api/narrative/regenerate/route.ts   POST only, 8s timeout, rule-text fallback  AC-10
app/actions/rescore-hotspot.ts      regenerate server action, 8s timeout, reference fallback  AC-17
app/actions/rules.ts                save thresholds -> recomputeAll() -> revalidate  AC-9
lib/valuation/{damage,hazards,combine,recompute}.ts   engine  AC-2,4,5,6,8,9
lib/rules/bands.ts                  SEED DEFAULTS ONLY: band edges, condition strings, revalue-by, today_year
lib/rules/curves.ts                 SEED DEFAULTS ONLY: the 4.3.1 curve points + building_damage_class map
lib/index/inputs.ts                 HotspotScoreInputs builder + promptPayload() projection  AC-17
lib/index/reference.ts              deterministic reference index 1-100  AC-17
lib/index/{llm-score,validate-score}.ts   assign_hotspot_score call; range/driver/citation checks  AC-17
lib/narrative/{prompt,validate}.ts  bounded prompt + citation assertions  AC-10
lib/db/{client,queries}.ts          pg Pool + typed query helpers
lib/auth/session.ts                 credentials auth, iron-session cookie, role guard
components/                         CaseHeader, HaircutBreakdown, ProvenancePanel, ContextPanel,
                                    AdaptationToggle, PortfolioMap, ScenarioSlider, HotspotMap, NewsList,
                                    SatelliteStrip, ScoreGauge, ScoreBadges, NarrativeBlock, ConditionList,
                                    IllustrativeRibbon
scripts/seed.ts                     bcrypt hashes, seed orchestration
scripts/compute-reference.ts        npm run prep:reference   -> score_inputs, reference_index
scripts/gen-narratives.ts           npm run prep:narratives  -> narratives
scripts/gen-hotspot-scores.ts       npm run prep:scores      -> llm_score, llm_drivers, llm_rationale
scripts/fetch-basemap.ts            npm run prep:basemap     -> two `pmtiles extract` runs, verifies both SHA-256
scripts/verify-dashboard.ts         npm run verify:dashboard -> recomputes the four AC-6 figures, no browser
prep/gen_portfolio.py               synthetic 200 pins + applicants + loans
prep/sample_hazards.py              GEE + rasterio raw sampling -> hazard_samples, site_modifiers, context
prep/build_hotspots.py              hotspot polygons and radii ONLY (ADR-7)
prep/{fetch_events,fetch_tiles}.py  GDELT/EONET/GDACS/FIRMS; NASA GIBS / Sentinel-2 tiles
prep/lib/{ee_client,raster,frozen,synthetic}.py
data/frozen/*.csv                   committed replay of every prep output
data/synthetic/*.csv                committed unconditional floor  (Day 1 12:00)
public/basemap/asia-z0-z6.pmtiles   committed floor, approx. 1 MB, 96 tiles
public/basemap/clusters.geojson     twelve metro boxes as one MultiPolygon, committed
public/basemap/asia-region-z0-z10.pmtiles   fetched, by bbox
public/basemap/asia-cities-z0-z12.pmtiles   fetched, by --region clusters.geojson
public/cache/{tiles,thumbs}/*.jpg   committed tiles and per-property thumbnails  AC-14, AC-11
docs/{sources,demo-script,phase2}.md
tests/unit/*.test.ts                Vitest, node, no database
tests/component/*.test.tsx          Vitest, jsdom, Testing Library
tests/db/*.test.ts                  Vitest, node, against the seeded compose database
tests/e2e/*.spec.ts                 Playwright against the running compose stack
tests/prep/*.py                     pytest: sampling sanity, clean-machine seed  AC-13
tests/fixtures/{cases,hotspots}.ts  pinned fixtures with hand-computed expected values
tests/offline/checklist.md          scripted offline rehearsal  AC-11
```

### 4.2 Database schema

PostGIS enabled. `geom geography(Point,4326)` on collateral, `area geography(Polygon,4326)` on hotspots.

| Table | Key columns |
|---|---|
| `users` | id, email UNIQUE, password_hash, role ENUM(loan_officer, corporate_credit_officer, risk_manager), display_name |
| `applicants` | id, name, kind ENUM(person, company), country, synthetic BOOL DEFAULT true |
| `loan_applications` | id, applicant_id FK, collateral_id FK, segment ENUM(personal, corporate), requested_amount NUMERIC, originated_year INT DEFAULT 2025, base_ltv_override NUMERIC NULL, status, opened_at |
| `collateral` | id TEXT (e.g. `SG-EC-002`), address_line, cluster_name, country CHAR(2), geom, building_type ENUM(6 values), occupancy_class ENUM(rc_highrise, lowrise_industrial), appraised_value_sgd NUMERIC, floor_level INT, elevation_m NUMERIC, dist_to_coast_km NUMERIC, adaptation_project_id FK NULL, landslide_flag BOOL, slope_deg NUMERIC, satellite_thumb_path |
| `hazard_applicability` | hazard, country CHAR(2), scored BOOL, reason TEXT, source_url — PK(hazard, country), **exactly 25 rows** (5 hazards x 5 countries), enumerated in section 4.6 |
| `hazard_samples` | id, collateral_id FK, hazard ENUM(flood_riverine, flood_coastal, wind, heat_days35, pm25), scenario ENUM(today, y2030, y2050), value NUMERIC NULL, **coverage ENUM(scored, measured_not_scored, absent)**, scenario_invariant BOOL, unit, dataset_name, dataset_version, pathway, return_period_yrs, sampled_at DATE, UNIQUE(collateral_id, hazard, scenario) |
| `site_modifiers` | collateral_id FK PK, suhi_tertile SMALLINT, ndvi_tertile SMALLINT, dataset_name, dataset_version, sampled_at |
| `depth_damage_functions` | id, damage_class ENUM(residential, commercial, industrial), points JSONB `[{depth_m, damage_fraction}]`, curve_label, source_name, source_url |
| `building_damage_class` | building_type PK, damage_class — the six-to-three classification rule, seeded in `02_reference.sql` and read by `lib/valuation/damage.ts`. It determines which curve applies to every flood haircut, so per ADR-2 it is a rule and does not live in the Python generator |
| `adaptation_projects` | id, name, country, haircut_credit_pp NUMERIC, protection_return_period, source_name, source_url, curated BOOL DEFAULT true. **No `area` polygon** (ADR-4): adaptation membership is the curated `collateral.adaptation_project_id`, and nothing derives it from geometry |
| `rule_sets` | id, is_active, base_ltv_personal, base_ltv_corporate, band_low(0.03), band_mid(0.10), band_high(0.20), total_cap(0.25), chronic_cap(0.05), **p_today(0.00), p_2030(0.05), p_2050(0.22)**, **today_year(2025)**, today_label('2025 (origination)'), return_period(100, descriptive), inundation_threshold_m(0.5), adaptation_enabled, updated_by FK, updated_at |
| `valuations` | id, collateral_id FK, scenario, rule_set_id FK, **winning_peril ENUM(flood_riverine, flood_coastal) NULL**, depth_m, damage_fraction, flood_haircut_gross, adaptation_credit_documented_pp, adaptation_credit_effective_pp, flood_haircut, wind_haircut, heat_haircut, pm25_haircut, chronic_haircut, total_haircut, adjusted_value_sgd, band, computed_at, UNIQUE(collateral_id, scenario, rule_set_id) |
| `application_valuations` | id, loan_application_id FK, scenario, rule_set_id FK, segment, ltv_applied, max_loan_sgd, UNIQUE(loan_application_id, scenario, rule_set_id) |
| `recommendations` | id, loan_application_id FK, scenario, band, conditions JSONB, revalue_by_year INT NULL, refer_to_risk BOOL, rule_set_id FK, computed_at, UNIQUE(loan_application_id, scenario, rule_set_id) |
| `narratives` | id, subject_type ENUM(case, portfolio, hotspot), subject_id, scenario, text, model, prompt_hash, generated_at, validated BOOL, fallback_used BOOL |
| `context_factors` | id, collateral_id FK, factor ENUM(haze, water_stress, cooling_degree_days, subsidence_susceptibility, sea_level_inundation, coastal_erosion, wildfire), value NUMERIC, unit, direction_2030, direction_2050, dataset_name, source_url, sampled_at |
| `satellite_tiles` | id, region, bbox, capture_date, cached_path, live_url, fetched_at, provider |
| `hotspots` | id, name, country, centroid, area NULL, radius_m NULL, **`CHECK ((area IS NULL) <> (radius_m IS NULL))`** so exactly one shape, hazard_type, summary, score_inputs JSONB, reference_index INT, llm_score INT NULL, llm_drivers JSONB NULL, llm_rationale TEXT NULL, model TEXT, scored_at TIMESTAMPTZ, score_source ENUM(model, fixture), score_validated BOOL, score_fallback BOOL, divergence_flag, computed_at. **No `loan_exposure_sgd` and no `exposure_share` column** (ADR-7): the view computes both, the popup reads the view, and `prep:reference` snapshots them into `score_inputs` |
| `environmental_events` | id, title, event_type ENUM(fire, flood, pollution, earthquake, storm, haze), occurred_on DATE, location geography(Point), source_feed, source_url, dedupe_key UNIQUE, hotspot_id FK NULL |

Indexes: GIST on every geography column; btree on `hazard_samples(collateral_id, scenario)`,
`valuations(scenario, band)`, `environmental_events(occurred_on DESC)`.

**One flood peril is stored, and it is named.** Two water perils are computed but `valuations` carries one set
of flood columns, so `depth_m`, `damage_fraction`, `flood_haircut_gross` and both credit columns are the values
from the peril that wins the `max`, recorded in `winning_peril`, which is **NULL where both perils contribute
zero** (both `absent`, or both nets floored), as most pins are at the 2025 scenario. The provenance panel then
shows no flood line at all rather than an arbitrary one, and never mixes a
riverine depth with a coastal haircut. AC-3's delta is unaffected: the same credit is subtracted from both
perils' gross, so whichever wins, the delta is exactly the credit wherever the zero floor does not bind.

Three definitions that must be written exactly:

```sql
-- ADR-7: the single definition of hotspot containment.
-- The CHECK constraint makes the two cases disjoint, so this is a UNION of
-- mutually exclusive branches and can never emit a duplicate pair.
CREATE VIEW v_hotspot_membership AS
  SELECT h.id AS hotspot_id, c.id AS collateral_id
  FROM hotspots h JOIN collateral c ON ST_Intersects(c.geom, h.area)
  WHERE h.area IS NOT NULL
UNION
  SELECT h.id, c.id
  FROM hotspots h JOIN collateral c ON ST_DWithin(c.geom, h.centroid, h.radius_m)
  WHERE h.radius_m IS NOT NULL;

-- exposure is defined ON TOP of membership, so there is one containment rule
CREATE VIEW v_hotspot_exposure AS
SELECT hotspot_id, loan_exposure_sgd,
       loan_exposure_sgd / NULLIF(SUM(loan_exposure_sgd) OVER (), 0) AS exposure_share
FROM (
  SELECT h.id AS hotspot_id, COALESCE(SUM(la.requested_amount), 0) AS loan_exposure_sgd
  FROM hotspots h
  LEFT JOIN v_hotspot_membership m ON m.hotspot_id = h.id
  LEFT JOIN loan_applications la ON la.collateral_id = m.collateral_id
  GROUP BY h.id
) e;

-- valid DDL, two-valued even before compute-reference.ts has run
divergence_flag BOOLEAN GENERATED ALWAYS AS (
  COALESCE(llm_score IS NOT NULL AND reference_index IS NOT NULL
           AND abs(llm_score - reference_index) > 25, false)) STORED
```

`v_portfolio_summary` is a view grouped by `(scenario, country)`, not a parameterised view, since PostgreSQL
has none. It returns three of AC-6's four headline figures: share of collateral value amber-or-worse, total haircut in
S$, and `COUNT(DISTINCT loan_application_id)` for applications with `revalue_by_year <= 2030`. The distinct
count is required because `revalue_by_year` is stored identically on all three `recommendations` rows. **The
fourth figure, the top-10 exposed cases, is a separate ordered query** in `lib/db/queries.ts`, not part of this
view, and `dashboard-sums.test.ts` recomputes it from `valuations` ordered by `total_haircut` descending.

**Base LTV precedence.** `rule_sets.base_ltv_*` is authoritative; `loan_applications.base_ltv_override` is a
nullable per-case override. `lib/valuation/combine.ts` reads `override ?? rule_set`, so the risk manager's edit
wins on every case without an override. `tests/db/rule-edit-recompute.test.ts` pins that precedence.

**Rule constants, one source of truth.** The active `rule_sets` row is the only runtime source.
`lib/rules/bands.ts` and `lib/rules/curves.ts` hold the seed defaults consumed by `02_reference.sql` and by the
no-database unit tests, and neither is read at request time. `curves.ts` exists so that
`tests/unit/worked-example.test.ts` and `tests/unit/curve-fixtures.test.ts` can evaluate `damageFraction`
without Postgres, which is the project they are assigned to; without it both tests would need a database and
could not run where the workspace puts them.

### 4.3 Valuation formula

```ts
function damageFraction(depth_m, buildingType) {                       // seeded curves, section 4.3.1
  const cls = damageClassOf(buildingType);   // lib/rules/curves.ts at test time, seeded table at runtime
  return clamp(linearInterp(curve(cls), max(depth_m, 0)), 0, 1);
}

// Every hazard function takes an explicit absent case. A sample contributes only when
// coverage = 'scored'; 'measured_not_scored' and 'absent' both contribute zero.
const ABSENT = 0;                                                      // wind, heat, pm25: scalar
const ABSENT_FLOOD = { net: 0, gross: 0, documented: 0, effective: 0 }; // flood: one object shape
const contributes = (s) => s && s.coverage === 'scored' && s.value !== null;

function floodHaircut(sample, c, rules, scenario, adaptation) {         // returns FloodTerm on every branch
  if (!contributes(sample)) return ABSENT_FLOOD;
  const P     = rules[`p_${scenario}`];                                // 0.00 / 0.05 / 0.22, ADR-5
  const gross = damageFraction(sample.value, c.building_type) * P;
  const documented = rules.adaptation_enabled && adaptation ? adaptation.haircut_credit_pp / 100 : 0;
  const net   = max(gross - documented, 0);                            // ADR-4 zero floor
  const effective = gross - net;                                       // what the credit ACTUALLY bought
  return { net, gross, documented, effective };                        // same shape as ABSENT_FLOOD
}

function windHaircut(sample, occupancy) {                              // STORM v4, no horizon probability
  if (!contributes(sample)) return ABSENT;
  const v = sample.value;
  if (v < 33) return 0;
  const [lo, hi] = v <= 45 ? [0.01, 0.03] : [0.03, 0.06];
  const base = v <= 45 ? 0.01 + ((v - 33) / 12) * 0.02
                       : 0.03 + min((v - 45) / 15, 1) * 0.03;
  const m = occupancy === 'rc_highrise' ? 0.8 : 1.2;
  return clamp(base * m, lo, hi);   // occupancy modulates WITHIN the band, never outside it
}

function heatHaircut(sample, mods) {                                   // BORROWED elasticity, labelled on screen
  if (!contributes(sample)) return ABSENT;
  const elasticityTerm = min(0.001 * sample.value, 0.05);              // inner cap on the ELASTICITY only
  const t = mods.ndvi_tertile === 2 ? max(mods.suhi_tertile - 1, 0) : mods.suhi_tertile;
  return elasticityTerm * [1.0, 1.25, 1.5][t];                         // may reach 7.5%; chronic cap binds
}

function pm25Haircut(sample) {                                         // GHAP, no scenario escalation
  if (!contributes(sample)) return ABSENT;
  const u = sample.value;
  return u < 35 ? 0 : u <= 50 ? 0.01 : 0.02;
}

function valuate(collateral, loan, scenario, rules, samples, mods) {
  const fr = floodHaircut(samples.flood_riverine, ...), fc = floodHaircut(samples.flood_coastal, ...);
  const water    = max(fr.net, fc.net);                                // both branches are FloodTerm, so .net always exists
  const chronic  = min(heatHaircut(...) + pm25Haircut(...), rules.chronic_cap);   // cap 5%
  const total    = min(water + windHaircut(...) + chronic, rules.total_cap);      // cap 25%
  const adjusted = collateral.appraised_value_sgd * (1 - total);
  const ltv      = loan.base_ltv_override
                ?? (loan.segment === 'personal' ? rules.base_ltv_personal : rules.base_ltv_corporate);
  return { total, adjusted, ltv, max_loan: adjusted * ltv, band: bandOf(total, rules) };
}
```

**Only the flood term carries `P`.** Wind and the chronic perils are unconditional return-period bands; heat is
zero at today because the heat metric is defined as warming **relative to the present** and today is the
reference window (section 4.6); the provenance panel states that definition rather than leaving it to inference.

#### 4.3.1 Seeded depth-damage curves

Linear interpolation between the published points below, clamped to `[0, 1]`. These are a **curated fit adapted
from Huizinga et al. 2017 (JRC EUR 28552), Asia curves**, not a direct transcription: the published Asia
residential curve sits near 0.32 at 0.5 m. The case screen labels them "seeded curve, curated fit (JRC Asia)"
in the same way the adaptation credits are labelled curated, and `docs/sources.md` records the deviation.

| depth_m | residential | commercial | industrial |
|---|---|---|---|
| 0.0 | 0.00 | 0.00 | 0.00 |
| 0.5 | **0.30** | 0.22 | 0.18 |
| 1.0 | 0.50 | 0.40 | 0.34 |
| 1.5 | 0.62 | 0.53 | 0.47 |
| 2.0 | 0.72 | 0.65 | 0.58 |
| 3.0 | 0.87 | 0.82 | 0.76 |
| 4.0 | 0.95 | 0.92 | 0.88 |
| 6.0 | 1.00 | 1.00 | 1.00 |

The two fixtures fall out of the residential row: `f(0.50) = 0.30` is a published point, and
`f(0.80) = 0.30 + (0.30/0.50) x 0.20 = 0.42` by interpolation between 0.5 and 1.0. Any change to the 1.0 m
residential point breaks AC-3, so `tests/unit/curve-fixtures.test.ts` pins both values against the seeded table.

#### 4.3.2 Pinned fixtures

**Identifier scheme.** A collateral id is `<CC>-<CLUSTER>-<NNN>`, where `NNN` is a **per-cluster running index
from 001**, so the highest index in a cluster equals that cluster's pin count. `SG-EC-002` is the second pin of
the twelve-pin East Coast cluster.

**All six fixtures are members of the 200, not additions.** Each fixture occupies a slot in its cluster and the
generator produces that cluster's remaining pins, so every published cluster count and the 200 total are
unchanged and `tests/prep/test_clean_machine.py` still asserts exactly 200. The S5 table shows the split.

**The three flood fixtures pin `valuations.flood_haircut`, not `total_haircut`.** Singapore scores
`heat_days35`, and heat is zero only at the reference window, so a Singapore pin carries a chronic term at 2050
on top of its flood term. AC-2's round number therefore lives on a **flood-only demonstration property** whose
heat delta is pinned at zero, and a second **realistic** pin carries the same flood exposure plus a real heat
term. The demo shows the realistic one first and the demonstration one second, as the isolation exhibit.

| Fixture | Collateral | Inputs | Expected |
|---|---|---|---|
| **AC-2 worked example, flood-only** | `SG-EC-001`, Amber Road, Katong, residential_highrise_rc, personal, appraised **S$1,000,000**, `adaptation_project_id IS NULL` | depth 0.50 m at 2050, damage 0.30, `p_2050 = 0.22`; `heat_days35` pinned at a **zero delta**, `coverage = 'scored'` so `heatHaircut` runs and returns 0; wind `absent` and PM2.5 `measured_not_scored` in SG | flood haircut **6.6%**, chronic 0.0%, **total 6.6%**, adjusted **S$934,000**, max loan **S$700,500** at 0.75, unadjusted S$750,000 |
| **Realistic Singapore case** | `SG-EC-002`, Marine Parade Road, residential_highrise_rc, personal, appraised S$1,000,000, `adaptation_project_id IS NULL`, **SUHI tertile 1, NDVI tertile 1** | same flood inputs; `heat_days35` delta **28 days** at 2050 | flood 6.6%; heat `min(0.001 x 28, 0.05) x 1.25` = **3.5%**; chronic `min(3.5%, 5%)` = 3.5%; **total 10.1%**, band 10-20%, adjusted **S$899,000**, max loan **S$674,250** |
| **AC-3 adaptation** | `SG-KB-003`, Kallang Basin, residential, `adaptation_project_id` = Marina Barrage catchment, appraised S$1,200,000 | depth 0.80 m at 2050, damage 0.42, `P = 0.22`, gross 9.24%, documented credit 1.50 pp | flood haircut **7.74%** with the credit, **9.24%** without, documented delta **exactly 1.50 pp**, effective credit 1.50 pp. Heat cancels in the subtraction, so the delta holds whatever the total is |
| **ADR-4 zero floor** | `SG-EC-003`, East Coast, residential, `adaptation_project_id` = Long Island, documented credit 3.00 pp | depth 0.20 m at 2050, damage 0.12, gross **2.64%** | flood haircut **0.00%**, documented credit 3.00 pp, **effective credit 2.64 pp**, both rendered on the panel |
| **Inundation boundary** | `SG-MS-002` and `SG-MS-003`, Marina South | pinned elevations either side of the threshold, **and the `sea_level_inundation` context row pinned alongside them**, so both sides of the comparison are fixed and no source-mode change can move the threshold out from under the pair | one carries the refer-to-risk flag, the other does not |

**Every fixture's hazard samples are pinned in the seed.** `db/seed/04_samples.sql` writes the full sample rows
for all six fixtures with `dataset_version = 'fixture: pinned'`, and the seed applies them **after** sampling
under every source mode, so `--source=synthetic`, `--source=frozen` and `--source=live` all leave the fixture
rows identical. Without this, synthetic depths derived from elevation and distance to coast would never land on
0.50, 0.80 and 0.20 m, the unit tests would still pass because they read `tests/fixtures/cases.ts`, and the
figures walked on stage would diverge from the figures under test. That is the one failure this plan is
organised to prevent, so `tests/db/fixture-pinning.test.ts` asserts that after any prep run the six fixtures'
depths, heat deltas, coverage states, elevations **and the pinned sea-level threshold** equal the values in
`tests/fixtures/cases.ts` exactly, so no comparison in the fixture set is left asymmetric.
The pinned rows are the only rows in the database that are not sampled, and `docs/sources.md` discloses them
rather than leaving them to be discovered.

**AC-2 binds to the formula first, the row second.** `tests/unit/worked-example.test.ts` is a pure
function-level assertion against the spec's literal inputs, depth 0.50 m, damage 0.30, `P = 0.22`, appraised
S$1,000,000, with no database, which is both the stronger binding and the reason it can run in the no-database
unit project. `tests/db/worked-example-row.test.ts` then asserts that `SG-EC-001`'s **stored** valuation equals
that same result, so the case screen and the formula cannot drift apart.

**Adaptation membership is a curated foreign key, not a spatial join** (ADR-4). `adaptation_projects` has no
polygon, so nothing can derive a second opinion. AC-2 depends on `SG-EC-001` and `SG-EC-002` having
`adaptation_project_id IS NULL` while `SG-EC-003`, also on the East Coast, points at Long Island;
`tests/db/adaptation-toggle.test.ts` asserts all three foreign keys directly, since that is the fact the
numbers actually rest on.

**Recommendation bands** on the 2050 haircut: `<3%` none; `3-10%` require flood cover; `10-20%` flood cover plus
an LTV cap holding the adjusted LTV within the segment limit; `>20%` **or** the coastal inundation flag, refer
to risk.

**`revalue_by_year`** is the first scenario year whose total haircut crosses `band_mid`, evaluated over the
literal years `[rule_sets.today_year = 2025, 2030, 2050]`, else null. Pinning today to 2025 makes the value
well-defined and consistent with ADR-5's base year, and it matters: a Hong Kong pin can cross 10% at today
(wind up to 6% plus the 5% chronic cap is 11%), so `revalue_by_year = 2025` is a reachable outcome that
`v_portfolio_summary`'s `<= 2030` count must handle.
`revalue_by_year` is a property of the **application**, not of a scenario, yet it is stored on all three
`recommendations` rows, so the tile is computed with `COUNT(DISTINCT loan_application_id)` and is labelled
**scenario-invariant** on screen. Without the distinct count the figure would treble; without the label it
would read as frozen when the slider moves.

**Coastal inundation flag.** `context_factors.sea_level_inundation` fires when
`collateral.elevation_m < (IPCC AR6 regional median SLR at 2050, SSP5-8.5) + rules.inundation_threshold_m`,
default 0.5 m.

**Adaptation toggle semantics.** The case-screen toggle is a **per-case preview**: it recomputes in memory,
shows the documented and effective credit side by side, and writes nothing. The risk manager's global
`adaptation_enabled` switch on `/rules` writes a new active `rule_sets` row and triggers `recomputeAll()`.
AC-3 tests the preview; AC-9 tests the global switch.

### 4.4 Reference index (deterministic, no LLM)

```ts
// H: hazard severity, normalised by the 25% total cap
H = worst_haircut_2050 / rules.total_cap          // p90 of valuations.total_haircut, 2050, in-hotspot
// E: exposure share, normalised across the current hotspot snapshot
E = exposure_sgd / snapshot_max_exposure_sgd      // both read from v_hotspot_exposure (ADR-7)
// V: recent-event pressure, 90-day window, weighted by event type
weights = { fire:1.0, flood:1.0, storm:1.0, haze:0.8, pollution:0.8, earthquake:0.3 }
V = min(recent_event_severity_90d / 10, 1)        // severity = SUM of weights over the window

reference_index = clamp(round(1 + 99 * clamp01(0.45*H + 0.30*E + 0.25*V)), 1, 100)
```

Empty hotspot: `H = E = V = 0`, reference 1. Earthquakes carry weight 0.3, so a geophysical event moves a
number labelled climate risk. That is deliberate and is stated in `docs/sources.md`.

### 4.5 LLM scoring contract

`lib/index/inputs.ts` builds one `HotspotScoreInputs` record per hotspot, stored verbatim in
`hotspots.score_inputs`. It carries both the fields the model sees and the terms the reference index needs, so
`reference-index.test.ts` recomputes H, E and V from the stored record alone.

The payload key set is declared **once**, as its own TypeScript type. Everything else in the plan and in the
test refers to this declaration rather than restating a count.

```ts
// The prompt payload: SIX top-level keys, which expand to NINE leaves.
// This type is the single source of truth for what the model sees.
type HotspotPromptPayload = {
  hazard_scores_by_type: { flood: number; wind: number; heat: number; pm25: number };  // 4 leaves
  exposure_sgd: number;
  exposure_share: number;
  recent_event_count_90d: number;
  recent_event_severity_90d: number;
  days_since_last_event: number | null;
};

// The stored record: the payload plus three fields that are never sent.
type HotspotScoreInputs = HotspotPromptPayload & {
  max_event_severity: number;        // shown in the popup's input list; not scored, not sent
  worst_haircut_2050: number;        // p90 of the TOTAL haircut, not a sum of p90s
  snapshot_max_exposure_sgd: number;
};
```

`promptPayload(inputs): HotspotPromptPayload` is a pure projection.
`tests/unit/prompt-payload.test.ts` asserts **set equality** between `Object.keys(promptPayload(x))` and the
six keys of `HotspotPromptPayload`, and separately between the flattened leaf names and the nine values of the
`input_field` enum below. Six top-level, nine leaves; a future field is excluded by default rather than by an
enumeration of forbidden names.

The prompt also carries a fixed **calibration rubric**: 1-20 minimal, 21-40 low, 41-60 moderate, 61-80
elevated, 81-100 severe, with one sentence per band tying it to the input ranges. It is a constant in
`lib/index/llm-score.ts` and is reproduced in `docs/sources.md`.

```jsonc
// tool: assign_hotspot_score. Called with tool_choice {type:"tool", name:"assign_hotspot_score"}.
{ "required": ["score","drivers","rationale"], "properties": {
  "score":     { "type":"integer", "minimum":1, "maximum":100 },
  "drivers":   { "type":"array", "minItems":1, "maxItems":5, "items": {
                   "required":["input_field","direction","note"], "properties": {
                     "input_field": { "enum": ["flood","wind","heat","pm25","exposure_sgd",
                                               "exposure_share","recent_event_count_90d",
                                               "recent_event_severity_90d","days_since_last_event"] },
                     "direction":   { "enum": ["raises","lowers"] },
                     "note":        { "type":"string", "maxLength":120 } } } },
  "rationale": { "type":"string", "minLength":40, "maxLength":600 } } }
```

`input_field` is an enum over the **nine** prompt-visible leaves of `HotspotPromptPayload`, so "drivers name
only input fields" is decidable by set membership, and `prompt-payload.test.ts` pins the enum and the type to
each other.

**The schema is advisory, not enforcing.** The Messages API does not reject a tool input violating `minimum`,
`maxItems` or `additionalProperties`. `lib/index/validate-score.ts` is the only enforcement. `tool_choice` is
set so the model must call the tool; a response with **no tool block** is an explicit fallback path, distinct
from malformed tool input.

**Validation** (`lib/index/validate-score.ts`, imported by both `scripts/gen-hotspot-scores.ts` and
`app/actions/rescore-hotspot.ts`):
- reject a `score` that is non-integer or outside `[1,100]`;
- reject `drivers` that is empty, longer than five, or carries an `input_field` outside the enum;
- reject an empty `rationale`, or one whose numeric tokens fail citation.

**Citation tolerance, defined precisely.** This tolerance is shared with `lib/narrative/validate.ts`
(section 4.8), since case narratives quote LTVs and haircuts the same way. A numeric token `x` matches an input
value `v` when any of the following holds:
- `x = v` exactly, or `x` is `v` rounded to 1-3 significant figures;
- **percent rendering**: `x = 100v` and the token is adjacent to a percent sign or the word "percent". All of
  `18%`, `18 %`, `18.0%` and `18 percent` therefore match `exposure_share = 0.18`. Without this rule the most
  natural sentence a model can write about an exposure share is rejected, both retries fail identically, and
  every hotspot falls into fallback on the dashboard that opens the demo;
- **magnitude rendering**: `128,400,000` matches "S$128 million", "S$128.4m" and "S$128,400,000", so thousands
  separators and currency prefixes do not break a match.

Exempt tokens are: four-digit years 1900-2100; ordinals written as words; and a bare integer 1-100 **only when
immediately preceded by "score", "index" or "band", or immediately followed by "out of 100"**. Any other bare
integer must cite. This replaces the earlier blanket 1-100 exemption, which would have swallowed
`exposure_share`, `recent_event_count_90d` and `days_since_last_event`.
`tests/unit/score-validate.test.ts` and `tests/db/narrative-assertions.test.ts` both carry cases for `18%`,
`18 %`, `18.0%` and `S$128.4m` as accepted, and for a bare `18` with no percent marker as rejected.

UI states:

| Condition | Displayed number | Badge |
|---|---|---|
| Valid score, `abs(score - reference_index) <= 25` | `llm_score` | none |
| Valid score, `abs(score - reference_index) > 25` | `llm_score`, reference beside it | **model divergence** |
| API unreachable, timed out, no tool block, or validation failed | `reference_index` | **fallback** |

`reference_index` is always stored and always rendered on the popup. The demo's divergent hotspot is a genuine
one recorded after the Day-4 run; if none diverges, `score_source = 'fixture'` marks a demo row so no false
value lands in `model` or `scored_at`.

### 4.6 Prep pipeline and the coverage model

Per ADR-2, Python writes raw values only; every derived value is a `npm run prep:*` TypeScript job.

**Three coverage states, and only three.** Measurement and policy are separate axes (principle 3):

| `coverage` | Meaning | `value` | Contributes to the haircut |
|---|---|---|---|
| `scored` | The raster measured this point and `hazard_applicability.scored = true` for this country | stored | yes |
| `measured_not_scored` | The raster measured this point and `hazard_applicability.scored = false` | **stored** | no, contributes 0 |
| `absent` | The raster has no coverage at this point at all, for example STORM over Singapore | NULL | no, contributes 0 |

**Precedence.** `absent` wins over `measured_not_scored` whenever both could apply, because there is no value to
store. Singapore wind is therefore `absent` (STORM has no basin coverage), while Kota Kinabalu wind and Jakarta
PM2.5 are `measured_not_scored` (a real value exists and policy excludes it). The two states are disjoint by
this rule, and `tests/db/applicability.test.ts` asserts the partition.

There is no `nodata` row state. A nodata sentinel returned from inside a raster's coverage is a **hard prep
failure**: `sample_hazards.py` collects every offending pin, prints them as one batch, and exits non-zero, so
a run is fixed in one cycle rather than one pin at a time. A sentinel is never coerced to zero and never
persisted.

This makes the two real-data traps into features. GHAP measures roughly 41 micrograms per cubic metre over
Jakarta, so those rows read `coverage = 'measured_not_scored', value = 41`, and the provenance panel says
"measured at 41 ug/m3; not scored in Indonesia: no local hedonic evidence" with the reason and source URL from
`hazard_applicability`. STORM returns a real 100-year wind over Kota Kinabalu, which reads the same way. Both
are stronger answers to a director than "not applicable", and both keep the real value available to the context
panel. `docs/sources.md` records both cases explicitly.

**`hazard_applicability`, all 25 rows.** `scored = true` except the six marked below.

| hazard | SG | MY | ID | CN | HK |
|---|---|---|---|---|---|
| flood_riverine | yes | yes | yes | yes | yes |
| flood_coastal | yes | yes | yes | yes | yes |
| heat_days35 | yes | yes | yes | yes | yes |
| wind | **no** | **no** | **no** | yes | yes |
| pm25 | **no** | **no** | **no** | yes | yes |

The three `wind = no` and three `pm25 = no` rows each carry a reason and a source URL, per the spec's
constraint that wind and PM2.5 are scored for HK and CN only.

| Script | Dataset | Access | Writes |
|---|---|---|---|
| `gen_portfolio.py` | synthetic, seeded RNG `seed=20260907` | none | applicants, loan_applications (`originated_year = 2025`), collateral incl. `building_type`, `elevation_m`, `dist_to_coast_km`. **Not `damage_class`**: the six-to-three classification is a rule and lives in `lib/rules/curves.ts` and the seeded `building_damage_class` table |
| `sample_hazards.py` | Aqueduct Floods v2 `WRI/Aqueduct_Flood_Hazard_Maps/V2`, riverine + coastal-wtsub, 100-yr, RCP8.5, hist/2030/2050. **Ensemble mean over the five GCMs; coastal SLR percentile 50.** Riverine baseline epoch 1980 | GEE | `hazard_samples(flood_riverine, flood_coastal)`, `dataset_version = 'v2 / ens-mean / slr-p50 / hist-epoch-1980'` |
| " | NEX-GDDP-CMIP6 ssp585, days > 35 C. **All three deltas share one reference window, 2016-2035, the present-day period.** `today` is the reference, so it is exactly zero **by definition of the metric** rather than by an accident of labelling; `y2030` is the 2021-2040 window minus the reference; `y2050` is the 2040-2059 window minus the reference. ERA5-Land validates the reference window against observation and is never the subtrahend | GEE | `hazard_samples(heat_days35)`, three scenarios |
| " | STORM **present-climate** (4TU DOI 10.4121/12705164) for `today`; **climate-change edition** (DOI 10.4121/14510817) for `y2030` and `y2050` | rasterio | `hazard_samples(wind)`, three scenarios |
| " | GHAP PM2.5 annual mean, `projects/sat-io/open-datasets/GHAP/GHAP_Y1K_PM25` | GEE | `hazard_samples(pm25)`, three rows, `scenario_invariant = true` |
| " | Yale SUHI v4 tertile; Sentinel-2 NDVI 300 m tertile | GEE | `site_modifiers` |
| " | Copernicus DEM 30 m slope and elevation; NASA LHASA | GEE + rasterio | `collateral.slope_deg`, `elevation_m`, `landslide_flag` |
| " | FIRMS, Aqueduct 4.0, ERA5-Land CDD, Herrera-Garcia 2021 (**susceptibility probability, not cm/yr**), IPCC AR6 regional SLR, Deltares Shoreline | mixed | `context_factors`, 7 rows per pin |
| `build_hotspots.py` | admin-1 aggregation + event clustering | local | `hotspots` **polygons and radii only** (ADR-7) |
| `fetch_events.py` | GDELT, NASA EONET, GDACS, NASA FIRMS | HTTP | `environmental_events`, >= 30 rows |
| `fetch_tiles.py` | NASA GIBS / Sentinel-2 | HTTP/GEE | `public/cache/tiles/*.jpg` + `satellite_tiles` |
| `npm run prep:reference` | `scripts/compute-reference.ts`, reading `v_hotspot_membership` and `v_hotspot_exposure` | local | `score_inputs` (which snapshots `exposure_sgd` and `exposure_share` from the view) and `reference_index`. It writes no exposure column, because none exists |
| `npm run prep:scores` | Anthropic, tool `assign_hotspot_score` | HTTP | `llm_score`, `llm_drivers`, `llm_rationale`, `model`, `scored_at`, `score_validated`, `score_fallback` |
| `npm run prep:narratives` | Anthropic `claude-sonnet-5` | HTTP | `narratives`: 200 cases + 1 portfolio + one insight per hotspot |
| `npm run prep:basemap` | Protomaps daily build, **two `pmtiles extract` runs** (section 4.7) | HTTP + go-pmtiles | `asia-region-z0-z10.pmtiles` and `asia-cities-z0-z12.pmtiles`, each with its SHA-256 |

### 4.7 Offline basemap

**Two archives, two `pmtiles extract` invocations, two MapLibre sources.** One invocation takes one region and
one maximum zoom, so a single archive cannot hold a regional extract plus a separate high-zoom city overlay.
The region archive is extracted by bounding box; the cities archive is extracted by a GeoJSON MultiPolygon of
the twelve metro boxes, which `go-pmtiles` accepts via `--region`. Both are read by the `pmtiles` JavaScript
protocol handler in MapLibre and added as two sources with different zoom ranges.

```bash
# 1. Regional archive, z0-z10 over the whole bbox
pmtiles extract "$PLANET_URL" public/basemap/asia-region-z0-z10.pmtiles   --bbox=95.0,-11.0,125.0,33.0 --maxzoom=10

# 2. Cities archive, z0-z12 over the twelve metro boxes in one MultiPolygon
pmtiles extract "$PLANET_URL" public/basemap/asia-cities-z0-z12.pmtiles   --region=public/basemap/clusters.geojson --maxzoom=12
```

MapLibre adds the region archive with `maxzoom: 10` and the cities archive with `minzoom: 11`, so the cities
file is consulted only where it has detail. The cities extract starts at z0 because relying on a `--minzoom`
flag is unnecessary: the redundant low zooms over 3 square degrees are about 35 tiles.

| Item | Value |
|---|---|
| Format | Protomaps basemap, `.pmtiles` v3, OpenStreetMap data, ODbL, attribution rendered on the map |
| Regional bbox | 95E to 125E, 11S to 33N |
| Region archive | `asia-region-z0-z10.pmtiles`, z0-z10. z10 alone 11,352; **z0-z10 approximately 15,200** |
| Cities archive | `asia-cities-z0-z12.pmtiles` over twelve boxes of 0.5 degrees square. Counted **on tile boundaries**, not by area: a 0.5-degree box spans about 2.84 tiles at z11 and 5.69 at z12, which aligns to at most 4x4 and 7x7, giving about **190 at z11 and 590 at z12**, plus about 35 below z11, **about 815 total**. An earlier area-based estimate of 510 understated it |
| Twelve boxes, derivation | The 27 seeded clusters group into twelve metros: Singapore; Klang Valley; Penang; Johor Bahru; Kota Kinabalu; Jakarta with BSD; Semarang; Surabaya; Shanghai with Ningbo; Guangzhou with Shenzhen; Xiamen; Hong Kong. `public/basemap/clusters.geojson` holds them as one MultiPolygon |
| Archive total | **approximately 16,000 tiles** |
| Disk budget | 6-15 KB per vector tile gives **96-240 MB**; budget 500 MB, hard cap 800 MB across both files, and the fetch step fails above the cap |
| Committed floor | `public/basemap/asia-z0-z6.pmtiles`, **96 tiles**, about 1 MB, committed so a clean clone always renders |
| Floor coverage | **Country and regional scale only.** A z6 tile spans about 5.6 degrees and carries country and major-road geometry, so a Singapore-scale view from the floor is close to empty. City zoom requires the fetched archives, and rehearsal step 6 says so |
| Beyond z12 | MapLibre **overzooms** vector tiles, so pins stay usable past the archive maximum; no z13+ is fetched |
| Tooling | `pmtiles extract` from `go-pmtiles`, pinned at v1.22 in `Dockerfile.web`. `scripts/fetch-basemap.ts` runs both invocations and verifies each SHA-256 recorded in `docs/sources.md`. The JavaScript `pmtiles` package reads archives and cannot create them, so it is used only at runtime |
| Fallback | If either fetched archive is absent, MapLibre falls back to the committed z0-z6 archive; the map is usable at country and regional scale and the map beat still runs |

Two independent recounts of the region archive differ by 0.2%, 15,183 against 15,216, from edge handling at the
bbox boundary, hence "approximately 15,200". The earlier figure of 13,000 tiles for z0-z12 was wrong on two
counts: z0-z12 over this bbox is about 240,000 tiles and 1.4 to 3.6 GB, and 13,000 was in fact the z0-z10 count.

### 4.8 Narrative pre-generation

`scripts/gen-narratives.ts` builds a prompt from a whitelist of the case's rendered numbers, its band and its
exact condition strings; the system prompt forbids introducing either. It imports `lib/narrative/validate.ts`,
the single implementation of the citation rule, shared with runtime regeneration and using the section 4.5
tolerance. Two retries, then `fallback_used = true` and the rule text is stored verbatim.

### 4.9 Caching, refresh, and the offline-first rule

**Rule.** No server component, layout or GET route performs an outbound network call. Outbound calls live in
exactly three places, and this list is the one the static test enforces: `app/api/refresh/*`,
`app/api/narrative/regenerate`, and `app/actions/rescore-hotspot.ts`. Timeouts are 5 s for feeds and tiles, 8 s
for Anthropic, each with a cached fallback that leaves existing rows intact.

**Client injection, so the rule holds inside `lib/`.** `@anthropic-ai/sdk` is forbidden in `app/`,
`components/` and `lib/` alike, which the static scan enforces without exception. `lib/index/llm-score.ts` and
`lib/narrative/prompt.ts` therefore hold prompt building and validation only and take an **injected** client;
the client is constructed in the allowed entry points above and in the `prep:*` scripts, which the scan does
not cover because they never render. S22 and S25 follow this pattern. It is also what makes the AC-17 clause
"with the client stubbed to fail" testable in the no-database unit project.

The one deliberate carve-out is the per-property satellite thumbnail, which the spec requires to be fetched live
with a cached fallback. It is exercised on stage in demo step 4, and the **degraded** view is rehearsed in
offline checklist step 4, so the presenter has seen both outcomes before the board does.

Tiles: `satellite_tiles` rows point at committed files and the strip always renders from `cached_path`. Refresh
writes new files with a hash suffix and updates `fetched_at`; a failed refresh returns a toast and changes
nothing. News: `environmental_events` seeded with >= 30 items; refresh upserts by `dedupe_key` and never
deletes.

**Illustrative-data labelling** (spec non-goal). `IllustrativeRibbon` renders a persistent "synthetic portfolio,
illustrative figures" ribbon in the app layout, and every S$ exposure figure on the portfolio dashboard and the
hotspot popups repeats it in its caption.

## 5. Implementation Steps

Three people. **A** platform and data, **B** engine and case flow, **C** map, dashboards, AI Dashboard and the
portfolio generator. Every day has a cut line.

### Day 1 - Scaffolding, harnesses, data floor

**S1 (A).** Repo and compose. `docker-compose.yml`, `Dockerfile.web` including the pinned `go-pmtiles v1.22`
binary, `.env.example`, `.gitignore` with the basemap negation, `package.json` with every script in section 4.1,
Next.js App Router with TypeScript and Tailwind, `postgis/postgis:16-3.4`.
**The Day-1 network dependency list lives here, in one place**, because everything on it must land before the
12:00 synthetic cut line and none of it is available afterwards on a disabled interface: the Chromium download
for Playwright (about 400 MB, S4); both `pmtiles extract` runs (S9); the STORM West Pacific and North Indian
basin downloads (S7); the Earth Engine cloud-project registration (S7); and the Anthropic API key.

**S2 (A).** Schema and views. `0001_schema.sql` and `0002_views.sql` per section 4.2, including
`v_hotspot_membership`, `v_hotspot_exposure`, the exact `divergence_flag` DDL, and `hazard_applicability`.

**S3 (B).** Auth and roles. `lib/auth/session.ts`, `app/(auth)/login/page.tsx`, `app/(app)/layout.tsx` role
guard, `scripts/seed.ts` (bcrypt cost 10). Users `officer@ocbc.demo`, `corp@ocbc.demo`, `risk@ocbc.demo`,
password `Demo!2026`. `tests/e2e/auth.spec.ts` is authored here, with AC-1, rather than two days later.
Landing routes per the amended AC-1: loan officer to `/cases?segment=personal`; corporate
credit officer to `/cases?segment=corporate`; **risk manager to `/ai`, with `/portfolio` one click away**. No
`/signup` route. **AC-1.**

**S4 (B).** **Test harnesses.** `vitest.workspace.ts` with three projects (unit on node, component on jsdom with
Testing Library, db on node with a `pg` fixture); `playwright.config.ts` with a `webServer` pointed at the
compose stack, one worker and trace-on-failure; `npx playwright install --with-deps chromium` added to the
Dockerfile and to the Day-1 network dependency list, since the browser download is roughly 400 MB and must land
before the Day-5 offline rehearsal. Smoke assertions in each project prove the harness runs. **This step is why
ten criteria have automated coverage; it is scheduled first, not discovered on Day 5.**
Also authored here, because neither needs application code and both are guard rails during construction rather
than audits afterwards: `tests/unit/no-network-on-render.test.ts` (a pure static scan) and the skeleton of
`tests/offline/checklist.md`, the one named test artefact that previously had no authoring step.

**S5 (C).** Synthetic portfolio generator. `prep/gen_portfolio.py`, seeded RNG, exactly 200 pins:

| Country | n | Clusters (fixture pins are members, shown as `total = fixtures + generated`) |
|---|---|---|
| SG | 60 | Marina Bay/Marina South **10 = 2 fixture (`SG-MS-002`, `SG-MS-003`) + 8**, East Coast-Katong-Marine Parade **12 = 3 fixture (`SG-EC-001`, `SG-EC-002`, `SG-EC-003`) + 9**, Sentosa Cove 8, Jurong Island 6, Kallang Basin **8 = 1 fixture (`SG-KB-003`) + 7**, Woodlands 6, Bukit Timah 10 |
| MY | 40 | Shah Alam/Kuala Langat 10, KL city centre 8, George Town coastal 7, Danga Bay JB 8, Kota Kinabalu 7 |
| ID | 40 | Pluit/Muara Baru/Ancol 12, Central Jakarta 6, BSD City Tangerang 8, Semarang north coast 7, Surabaya 7 |
| CN | 35 | Pudong/Lujiazui 10, Nansha Guangzhou 8, Qianhai Shenzhen 7, Xiamen 5, Ningbo 5 |
| HK | 25 | Tseung Kwan O 6, Heng Fa Chuen/Chai Wan 5, Kai Tak 5, Tai Po/Sha Tin 5, Tung Chung 4 |

Values S$0.6m-4m personal (140 pins), S$8m-120m corporate (60 pins), `originated_year = 2025`. The generator
writes `building_type` and **not** `damage_class`: the six-to-three classification is a rule and lives in the
seeded `building_damage_class` table (ADR-2, Architect defect 5). The six fixture collateral of section 4.3.2
are **members of their clusters**, seeded with their exact ids, addresses, values and
`adaptation_project_id`, and the generator produces only the remaining pins in those three clusters. Every
cluster count and the 200 total are therefore unchanged, and ids use the per-cluster running index of section
4.3.2, so `SG-EC-003` is the third of twelve East Coast pins. Kota Kinabalu is deliberately
retained: `hazard_applicability` is what excludes its real wind reading, which is the behaviour worth showing.
**AC-13.**

**S6 (C).** Synthetic hazard floor. `prep/lib/synthetic.py` and `--source=synthetic`, deriving flood depth from
`elevation_m` and `dist_to_coast_km`, heat from latitude, wind from basin membership, PM2.5 from country, with
the ADR-2 exemption noted in the module docstring. Output committed to `data/synthetic/`.
**Day-1 cut line: if this is not committed by 12:00, stop waiting on Earth Engine and proceed on synthetic for
the rest of the day.**

**S7 (A).** Live hazard sampling. `prep/sample_hazards.py` and `prep/lib/{ee_client,raster,frozen}.py` per
section 4.6: three coverage states, batched nodata failure, the pinned Aqueduct ensemble and SLR percentile,
both STORM editions, both NEX-GDDP windows. **Dependency, stated explicitly: S7 gates S12's recompute and S15's
provenance panel. Until S7 lands, both run against `data/synthetic/`.**
**Depends on S4**, same day, different owner: `tests/db/fixture-pinning.test.ts` needs the database project of
the Vitest workspace to exist before it can run.
**Fixture pinning:** the seed applies `db/seed/04_samples.sql`'s six pinned fixture sample sets **after**
sampling in every source mode, so the fixture rows are byte-identical under synthetic, frozen and live.
`tests/db/fixture-pinning.test.ts` is authored here and asserts that. **AC-2, AC-3, AC-8, AC-12, AC-13.**

**S8 (B).** Reference tables. `lib/rules/curves.ts` holding the section 4.3.1 curve points and the
six-to-three `building_damage_class` mapping as seed defaults, so the two curve unit tests need no database,
and `db/seed/02_reference.sql` generated from it: the depth-damage curves, the `building_damage_class` mapping, the active rule set with the ADR-5 and ADR-6 constants, all 25
`hazard_applicability` rows, and the curated adaptation table (no polygons, per ADR-4):

| Project | Country | `haircut_credit_pp` | Source |
|---|---|---|---|
| Marina Barrage catchment | SG | 1.50 | PUB |
| Long Island / City-East Coast coastal protection | SG | 3.00 | PUB / NCCS Coastal Protection |
| SMART tunnel catchment | MY | 2.00 | DID Malaysia / SMART |
| NCICD coastal wall phase A | ID | 2.50 | NCICD programme documents |
| Banger polder, Semarang | ID | 1.50 | Semarang polder project |
| Happy Valley + Tsuen Wan drainage tunnels | HK | 2.25 | HK DSD Drainage Master Plans |
| Shanghai 200-yr seawall standard | CN | 2.50 | Shanghai Water Authority |

**AC-3.**

**S9 (A).** Offline basemap. `public/basemap/clusters.geojson` (twelve metro boxes as one MultiPolygon) and
`scripts/fetch-basemap.ts`, which runs the **two** `pmtiles extract` invocations of section 4.7 and verifies both
SHA-256 values, plus the committed z0-z6 floor. The two archives are two MapLibre sources, so
`protomaps-themes-base` is instantiated twice with an explicit source name per call rather than relying on its
default, which would collide. **AC-5, AC-11.**

### Day 2 - Valuation engine and case flow

**S10 (B).** `lib/valuation/damage.ts` and `lib/valuation/hazards.ts`: curve interpolation and the four hazard
functions with explicit absent cases. Tests authored here: `tests/unit/worked-example.test.ts` (pure formula, the spec's literal inputs, no
database), `tests/unit/caps-and-zeros.test.ts`, and `tests/unit/curve-fixtures.test.ts`, all three reading
`lib/rules/curves.ts` rather than the seeded tables. **AC-2, AC-4.**

**S11 (B).** `lib/valuation/combine.ts`: combination rule, caps, adjusted value, LTV precedence, max loan, and
the documented-versus-effective adaptation credit. **AC-2, AC-3, AC-4.**

**S12 (B).** `lib/rules/bands.ts` and `lib/valuation/recompute.ts` plus `npm run db:recompute`: writes
`valuations`, `application_valuations` and `recommendations` for 200 collateral x 3 scenarios, with
`revalue_by_year` over the literal years `[2025, 2030, 2050]`. Test authored here: `tests/unit/bands.fixtures.test.ts`.
**AC-5, AC-6, AC-8, AC-9.**

**S13 (A).** Applicability and provenance tests: `tests/db/applicability.test.ts` (including the
`absent` versus `measured_not_scored` partition), `tests/db/provenance-panel.test.ts`, and
`tests/prep/test_sampling_sanity.py`, which runs its assertions against **both** `--source=frozen` and
`--source=synthetic`, since the synthetic model is what every acceptance test runs against when Earth Engine is
unavailable and deserves more than a review diff. **AC-4, AC-12.**

**S14 (C).** Case list and case screen. `app/(app)/cases/page.tsx`, `app/(app)/cases/[id]/page.tsx`, plus
`CaseHeader`, `HaircutBreakdown`, `ConditionList`, `ProvenancePanel`, `ContextPanel`, `AdaptationToggle`. The
breakdown names each factor's dataset, shows a borrowed-elasticity chip on heat, and labels the seeded curve as
a curated fit. Component tests authored here: `tests/component/adaptation-toggle.test.tsx`,
`tests/component/breakdown.test.tsx`, `tests/component/landslide-badge.test.tsx`. **AC-2, AC-3, AC-4, AC-7, AC-12.**

**S15 (B).** Fixtures. `tests/fixtures/cases.ts`: the four pinned fixtures of section 4.3.2 plus eight band
fixtures, two per band, each with hand-computed expected haircut, conditions and `revalue_by_year`. Plus
`tests/db/adaptation-toggle.test.ts`, `tests/db/landslide-flag.test.ts`, and
`tests/db/worked-example-row.test.ts`, which asserts `SG-EC-001`'s stored valuation equals the formula result
the unit test proves. **AC-2, AC-3, AC-7, AC-8.**

**Day-2 cut line.** If AC-2 and AC-4 are not green by end of day, the AI Dashboard is reduced to the satellite
strip and the news list, and the LLM score drops to the reference index alone.

### Day 3 - Map and portfolio dashboard

**S16 (C).** Portfolio map. `app/(app)/map/page.tsx`, `PortfolioMap.tsx`, `ScenarioSlider.tsx`, MapLibre on the
local pmtiles archive, hazard layers as GeoJSON, pins coloured from `valuations.band`, click routes to the
case. Tests authored here: `tests/db/scenario-recolour.test.ts`, `tests/e2e/slider.spec.ts`,
`tests/e2e/pin-click.spec.ts`. **AC-5, AC-7.**

**S17 (A).** Risk-manager dashboard. `app/(app)/portfolio/page.tsx` reading `v_portfolio_summary`, defaulting to
2050, plus `scripts/verify-dashboard.ts`, which queries the database directly and needs no browser stack. Test
authored here: `tests/db/dashboard-sums.test.ts`. **The revaluation tile is scenario-invariant and counted with
`COUNT(DISTINCT loan_application_id)`**, because `revalue_by_year` is a property of the application evaluated
over the fixed list `[2025, 2030, 2050]` and is stored identically on all three `recommendations` rows; without
`DISTINCT` the figure would treble. The tile is labelled as not moving with the slider, so it does not read as
frozen. **The expected count is at the low end of roughly 10 to 35 of 200**, concentrated in Hong Kong and
coastal China: only wind-heavy pins cross the 10% mid band at 2025 or 2030, and Hong Kong's annual PM2.5 sits
near 20 micrograms, below the 35 threshold, so its chronic term is mostly heat rather than air. `verify:dashboard`
prints the exact seeded count and it is recorded in `docs/demo-script.md` after this step. **AC-6.**

**S18 (B).** Threshold editor. `app/(app)/rules/page.tsx` and `app/actions/rules.ts`. Saving writes a new active
`rule_sets` row, calls `recomputeAll()`, revalidates `/map`, `/cases`, `/portfolio`, `/ai`. The three horizon
probabilities are editable, each labelled with its `n`; `return_period` is read-only and marked descriptive.
Tests authored here: `tests/db/rule-edit-recompute.test.ts` and `tests/e2e/rule-edit.spec.ts`. **AC-9.**

**S19 (A).** Hotspot geometry. `prep/build_hotspots.py`: 12-16 hotspots from admin-area aggregation and event
clustering, writing **polygons and radii only** per ADR-7. **AC-15.**

**Day-3 cut line.** If the map is not rendering pins by 16:00, the scenario slider ships with two positions
(today and 2050) and the 2030 layer is dropped; AC-5 still passes and the 2030 column is the least informative
under ADR-5.

### Day 4 - AI Dashboard

**S20 (A).** Events and tiles. `prep/fetch_events.py` (>= 30 items including the user's examples: BSD river
pollution, Borneo forest fire, NTT earthquake) and `prep/fetch_tiles.py`. **AC-14, AC-16.**

**S21 (B).** Reference index. `lib/index/inputs.ts` and `lib/index/reference.ts` per sections 4.4 and 4.5,
reading membership and exposure from the views, plus `npm run prep:reference`. Runs with no API key.
`score_inputs` snapshots exposure at prep time while `v_hotspot_exposure` is live, so **`prep:reference` must be
rerun after any change to the portfolio or to loan amounts**, or AC-15's equality between the two breaks; the
seed and recompute scripts chain it automatically. Tests
authored here: `tests/unit/reference-index.test.ts`, `tests/unit/prompt-payload.test.ts`,
`tests/fixtures/hotspots.ts`. **AC-17.**

**S22 (B).** LLM score. `lib/index/llm-score.ts` with `tool_choice` and the calibration rubric,
`lib/index/validate-score.ts`, `npm run prep:scores`, `app/actions/rescore-hotspot.ts`. Tests authored here:
`tests/unit/score-validate.test.ts`, `tests/unit/score-badges.test.ts`, `tests/db/hotspot-score.test.ts`.
**Rubric tightening is time-boxed to 45 minutes** (ADR-3); past that the observed divergence rate is accepted
and reported. **AC-17.**

**S23 (C).** AI Dashboard page. `app/(app)/ai/page.tsx` with `SatelliteStrip`, `HotspotMap` (pointers enlarge on
click, popup showing summary, exposure, score, drivers, rationale, reference, and the stored input list),
`NewsList`, `ScoreGauge`, `ScoreBadges`. Tests authored here: `tests/component/news-list.test.tsx`,
`tests/db/hotspot-exposure.test.ts`, `tests/db/news-list.test.ts`, `tests/e2e/hotspot-popup.spec.ts`.
**AC-14, AC-15, AC-16, AC-17.**

**S24 (A).** Refresh routes. `app/api/refresh/{tiles,news}/route.ts`. Tests authored here:
`tests/db/tiles-cache.test.ts`, `tests/e2e/refresh.spec.ts`. **AC-14, AC-16.**

**S25 (B).** Narratives. `lib/narrative/{prompt,validate}.ts`, `npm run prep:narratives`,
`app/api/narrative/regenerate/route.ts`, `NarrativeBlock.tsx`. Tests authored here:
`tests/db/narrative-assertions.test.ts`, `tests/unit/narrative-fallback.test.ts`. **AC-10.**

**Day-4 cut line.** If S23 is not rendering by 16:00, the insights section ships as reference index plus rule
text only and `prep:scores` is skipped; every AC-17 fallback path is already the tested default.

### Day 5 - Offline, polish, rehearsal

**S26 (A).** Offline enforcement. `tests/e2e/offline.spec.ts` with all outbound routes blocked, and the full
`tests/offline/checklist.md` fleshed out from its S4 skeleton. The static scan already landed on Day 1.
**AC-11, AC-14, AC-16.**

**S27 (C).** Bank-grade visual pass: OCBC-adjacent palette, dense tables, print-ready case screen, illustrative
ribbon.

**S28 (all).** Full suite green: `npx vitest run` across three projects, `npx playwright test`,
`python -m pytest tests/prep`. **Triage order if time runs short: the Playwright specs are cut last-in
first-out in the order `refresh`, `hotspot-popup`, `pin-click`, and their criteria fall back to the rehearsal
checklist.** `tests/db/fixture-pinning.test.ts` is the slowest test in the suite, because asserting identical
fixture rows across three source modes means seeding three times. Budget for it rather than assuming a fast
run, and never cut it: it is what guards the numbers walked on stage. Anything cut is recorded in the changelog rather than left silent.

**S29 (all).** Offline rehearsal, `tests/offline/checklist.md`, run twice. **AC-11.**

**S30 (A).** `tests/prep/test_clean_machine.py`, then a clean-machine run of AC-13 on a **second physical
laptop**, owner A, Day 5 morning, before the rehearsal. **AC-13.**

**S31 (A).** `docs/sources.md`: every dataset, version, licence, URL, the basemap SHA-256, the earthquake-weight
note, the ADR-3 divergence rate, the ADR-4 deviation, the seeded-curve deviation, the Jakarta and Kota
Kinabalu measured-but-unscored cases, and the **corrected exposure caveat**. The iteration-5 view change
inverted the earlier note: because each share is now a hotspot's exposure over the sum of all hotspot
exposures, the shares sum to exactly 1.0 by construction. The caveat worth telling a director is the opposite
one, that collateral inside two hotspots is counted in both, so the **hotspot exposures sum to more than the
portfolio total** and each share understates that hotspot's true fraction of the book. The same note records
that `exposure_share` has one home in `v_hotspot_exposure` and two readers, the popup reading it live and the
prompt reading a snapshot taken at `prep:reference` time, so a reseed moves the view before it moves the
snapshot until `prep:reference` runs again. It also records the **six pinned fixture rows**, the only rows in the database
that are not sampled, and notes that the 2030 heat window (2021-2040) overlaps the 2016-2035 reference by
fifteen of twenty years, so the 2030 heat delta is small and noisy, which reinforces the already-stated point
that 2030 is the least informative column. **Re-verify the two Hong Kong figures the spec's Technical Context flags**
(9.2% electricity per degree, 24.8% UHI cooling load) and either cite a primary source or strike them from the
pitch. `docs/demo-script.md`.

**Day-5 cut line.** If the full suite is not green by 15:00, S27's visual pass is dropped to palette and
typography only, and the remaining hours go to the rehearsal. A rehearsed demo on a plain skin beats a polished
one that has not been run twice.

## 6. Acceptance Criteria Mapping

Every criterion has an automated test **and** an authoring step that produces it. Two criteria additionally
carry a physical-verification clause no runner can observe.

| AC | Authoring steps | Automated test and assertion | Physical clause |
|---|---|---|---|
| AC-1 | S3, S4 | `tests/e2e/auth.spec.ts`: each account lands on its amended home route; `/signup` returns 404; `/portfolio` is one click from `/ai` | none |
| AC-2 | S5, S7, S10, S11, S15 | `tests/unit/worked-example.test.ts`: a **pure formula** assertion on the spec's literal inputs, no database, giving 6.6%, S$934,000 and S$700,500, plus the realistic case at flood 6.6% + heat 3.5% = **10.1%** and S$899,000; `tests/unit/curve-fixtures.test.ts` pins `f(0.50)=0.30` and `f(0.80)=0.42` from `lib/rules/curves.ts`; `tests/db/worked-example-row.test.ts` asserts `SG-EC-001`'s **stored** valuation equals the formula result; `tests/db/fixture-pinning.test.ts` asserts its pinned samples survive every source mode; `tests/db/adaptation-toggle.test.ts` asserts `SG-EC-001` and `SG-EC-002` have `adaptation_project_id IS NULL` | none |
| AC-3 | S8, S11, S14, S15 | `tests/db/adaptation-toggle.test.ts`: `SG-KB-003` reads 7.74% on, 9.24% off, delta exactly 1.50 pp; `SG-EC-003` reads 0.00% with documented 3.00 and effective 2.64; `tests/component/adaptation-toggle.test.tsx` names "Marina Barrage catchment" and links the source; the foreign keys of all three fixtures are asserted directly, since adaptation membership is a curated FK with no polygon to contradict it | none |
| AC-4 | S10, S13, S14 | `tests/unit/caps-and-zeros.test.ts`: total <= 25%, chronic <= 5%, absent and measured_not_scored samples contribute 0; `tests/db/applicability.test.ts`: every SG/MY/ID pin has wind and pm25 with `coverage` in (`measured_not_scored`,`absent`) and a haircut contribution of 0, **including Jakarta at a stored value near 41 and Kota Kinabalu at a stored non-zero wind**; `tests/component/breakdown.test.tsx`: each factor renders a source, heat renders the borrowed-elasticity chip | none |
| AC-5 | S9, S12, S16 | `tests/e2e/slider.spec.ts`: the slider changes pin colours in all five countries and a sampled pin's colour equals its case band; `tests/db/scenario-recolour.test.ts` recomputes the expected bands | none |
| AC-6 | S12, S17 | `tests/db/dashboard-sums.test.ts` recomputes the four figures and compares to the rendered values, including the `revalue_by_year <= 2030` count over literal years | none |
| AC-7 | S14, S15, S16 | `tests/e2e/pin-click.spec.ts`: clicking a pin opens the matching case; `tests/db/landslide-flag.test.ts` and `tests/component/landslide-badge.test.tsx` for both badges | none |
| AC-8 | S7, S12, S15 | `tests/unit/bands.fixtures.test.ts`: eight band fixtures with exact conditions and `revalue_by_year`, plus the two inundation-boundary fixtures; `tests/db/fixture-pinning.test.ts` asserts the seeded `SG-MS-002` and `SG-MS-003` elevations sit either side of the threshold after every prep run, so the pair AC-8 rests on is pinned like the other four | none |
| AC-9 | S18 | `tests/e2e/rule-edit.spec.ts`: edit `band_mid`, save, pins and conditions change with no restart; `tests/db/rule-edit-recompute.test.ts` also pins LTV precedence | none |
| AC-10 | S25 | `tests/db/narrative-assertions.test.ts`: every stored narrative cites only on-screen numbers and no condition outside its rule output; `tests/unit/narrative-fallback.test.ts` with the client stubbed to fail | none |
| AC-11 | S4, S9, S24, S26 | `tests/e2e/offline.spec.ts` with all outbound routes blocked: login, case, valuation, conditions, map, dashboard and AI Dashboard all render, only thumbnails degrade; `tests/unit/no-network-on-render.test.ts` | Host interface physically disabled, S29 |
| AC-12 | S7, S13, S14 | `tests/db/provenance-panel.test.ts`: every rendered number resolves to a row with dataset name, version, scenario and sampled-at; `measured_not_scored` rows render their applicability reason and their measured value | none |
| AC-13 | S5, S6, S7, S30 | `tests/prep/test_clean_machine.py`: `--source=frozen` and `--source=synthetic` each populate **exactly 200 pins**, the six fixtures among them, with flood, wind, heat and PM2.5 for all three horizons in a container with no credentials; `tests/prep/test_sampling_sanity.py` | Second physical laptop, S30 |
| AC-14 | S20, S23, S24 | `tests/db/tiles-cache.test.ts`; `tests/e2e/offline.spec.ts` asserts the strip renders with routes blocked; `tests/e2e/refresh.spec.ts` asserts the button fetches when reachable | none |
| AC-15 | S19, S21, S23 | `tests/db/hotspot-exposure.test.ts`: for **one polygon hotspot and one radius hotspot**, exposure equals a direct hand-written sum over the collateral inside that shape, equals `v_hotspot_exposure`, and equals the `exposure_sgd` inside `score_inputs`; a fourth assertion proves the `CHECK ((area IS NULL) <> (radius_m IS NULL))` constraint rejects a hotspot carrying both shapes, so the UNION can never double-count; `tests/e2e/hotspot-popup.spec.ts`: pointer enlarges, popup shows summary and exposure | none |
| AC-16 | S20, S23, S24 | `tests/db/news-list.test.ts`: >= 10 items with source and date; `tests/component/news-list.test.tsx`: newest-first ordering; `tests/e2e/offline.spec.ts`: refresh offline leaves the list intact | none |
| AC-17 | S21, S22, S23 | Five files, listed below | none |

AC-17's **five** clauses, five files:
- `tests/db/hotspot-score.test.ts`: every stored `llm_score` is an integer in `[1,100]` or
  `score_fallback = true`; every `llm_rationale` is non-empty and cites only prompt-visible values under the
  section 4.5 tolerance, with `18%`, `18 %`, `18.0%` and `S$128.4m` accepted and a bare `18` rejected; `llm_drivers` is 1 to 5 entries with `input_field` in the enum.
- `tests/unit/reference-index.test.ts`: the reference recomputes H, E and V from `score_inputs` plus one
  constant, `rules.total_cap`, which it reads from the active rule set, and matches `reference_index` for every
  hotspot including the empty-hotspot case.
- `tests/unit/score-badges.test.ts`: table-driven over the section 4.5 state table, pinning the **25-point
  boundary** on both sides. Reference 50 with scores 25, 24, 75, 76 gives no badge, divergence, no badge,
  divergence.
- `tests/unit/score-validate.test.ts`: with the client stubbed to fail, with the base URL at a closed port, and
  with a response containing **no tool block**, the page renders `reference_index` with the fallback badge.
  Malformed tool input (score 0, 101, 42.5, empty rationale, six drivers, an `input_field` outside the enum, an
  uncited number) is rejected into the same path and never written.
- `tests/unit/prompt-payload.test.ts`: set equality between the emitted keys and the **six** top-level keys of
  `HotspotPromptPayload`, and between the flattened leaves and the **nine** `input_field` enum values, so
  `max_event_severity`, `worst_haircut_2050`, `snapshot_max_exposure_sgd` and `reference_index` are all excluded.

**`tests/unit/no-network-on-render.test.ts`** scans `app/`, `components/` and `lib/` for outbound **call sites
and module specifiers**, not imports alone: `fetch(`, `axios`, `undici`, `https.request`, `node-fetch`,
`@anthropic-ai/sdk`. `fetch` is a Node global and is never imported, so an import-only check would miss the
likeliest breach. The exclusion list is generated from a single constant shared with the section 4.9 prose.

**Testability and scheduling.** 17 of 17 criteria (100%) have a concrete automated test with a named file, a
clear assertion and fixed inputs. **17 of 17 (100%) also have an authoring step with a day and an owner**, up
from 7 of 17 in iteration 2; S4 schedules the two harnesses on Day 1 that eleven criteria depend on. Two
criteria, AC-11 and AC-13, additionally carry a physical-verification clause that no runner can observe; those
are extra assurance on top of an automated assertion that already covers the criterion, and they are owned by
S29 and S30. No criterion rests on a checklist alone.

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Earth Engine account or approval does not arrive | `--source=synthetic` is committed by Day 1 12:00 and needs nothing external. `frozen` upgrades it when the live run succeeds. The Day-1 cut line makes the switch a decision, not a drift. |
| STORM download size and 4TU latency | Download only the West Pacific and North Indian basins, both editions, on Day 1; cache under gitignored `data/raw/` and commit only the 200 sampled values. |
| GHAP community asset moves or is revoked | Asset path pinned in section 4.6. If unavailable, substitute van Donkelaar v5 and record the substitution. |
| Aqueduct returns a per-GCM stack, so runs differ | Ensemble mean and SLR percentile 50 pinned in `sample_hazards.py` and recorded in `dataset_version`. |
| Coordinate or raster sampling errors | `tests/prep/test_sampling_sanity.py`: every point inside its country polygon; flood depth in [0, 15] m; **wind stored and non-zero for Hong Kong, coastal China and Kota Kinabalu, and `absent` where STORM has no basin coverage; PM2.5 stored and measured for all 200 pins with `coverage = 'measured_not_scored'` outside CN and HK**; no nodata sentinel is ever persisted. Twelve hand-checked control points. |
| **The pmtiles toolchain is not available** | `go-pmtiles` v1.22 is pinned in `Dockerfile.web` and its presence is asserted by S1's smoke check. If `pmtiles extract` cannot run, `scripts/fetch-basemap.ts` falls back to downloading a pre-built regional extract over HTTP and verifying the recorded SHA-256, and failing that the committed z0-z6 floor still renders the map. |
| Demo-day network loss | Section 4.9 rule enforced by a call-site scan across three directories; offline basemap with a committed floor; rehearsal run twice with the interface disabled, including the degraded thumbnail view. |
| LLM cost and latency | Narratives and scores batch pre-generated on Day 4, roughly 230 calls, well under US$5. Runtime regenerate has an 8 s timeout and is demoed once. |
| Scope creep from the AI Dashboard | Fixed scope: four sections, 12-16 hotspots, one reference formula, one score, one insight per hotspot. Day-4 cut line at 16:00. |
| The LLM score looks arbitrary to the board | The popup never shows a bare number: score, up to five drivers, rationale, the stored input list, the reference index alongside, and a divergence badge beyond 25 points. |
| The tool schema is assumed to enforce the range | It does not. `validate-score.ts` is the only enforcement, `tool_choice` forces the tool call, and a missing tool block is an explicit fallback path. Section 4.5 says so rather than implying a guarantee. |
| Divergence fires on most hotspots under ADR-3 | The calibration rubric narrows the range. The rate is recorded after the Day-4 run; tightening is time-boxed to 45 minutes, after which the observed rate is accepted and reported. |
| The 2030 column looks empty on stage | Stated openly in ADR-5 and in the demo script: at `p_2030 = 0.05` flood-driven movement is a 2050 story, and 2030 moves chiefly through Hong Kong and China wind. The Day-3 cut line allows dropping to a two-position slider. |
| Board challenges the borrowed heat elasticity | Every heat figure carries a "borrowed elasticity (China, Kang et al. 2024)" chip; `docs/sources.md` states that no SG/MY/ID hedonic study exists and that the 5% inner cap is a judgemental overlay. |
| Licence constraints | The CC BY-NC Arup/GFDRR raster is not shipped; landslide uses Copernicus DEM slope plus NASA LHASA. The basemap is ODbL with attribution rendered. Every licence is in `docs/sources.md`. |
| Two Hong Kong figures are unverified | S31 re-verifies them against primary sources or strikes them from the pitch. |
| Five days is not enough | **Every one of the five days has a stated cut line**, work is split across three owners with Day 1 rebalanced, the test-authoring cost is scheduled rather than discovered, and S28 names an explicit triage order. **Day 1 is the likeliest to slip**: it is the only day carrying nine steps and it holds every remote dependency at once, which is why the S1 list enumerates them in one place, the 12:00 synthetic cut line is unconditional, and the committed z0-z6 basemap floor bounds the one download that cannot be retried offline. |

## 8. Verification

### Commands

```bash
docker compose up -d db
npm run db:migrate
npm run db:seed                                   # frozen replay; falls back to synthetic
npm run db:recompute
npm run prep:reference

npx vitest run tests/unit/worked-example.test.ts tests/unit/curve-fixtures.test.ts \
               tests/db/worked-example-row.test.ts tests/db/fixture-pinning.test.ts \
               tests/db/adaptation-toggle.test.ts                      # AC-2, all five files
npx vitest run tests/unit/caps-and-zeros.test.ts tests/db/applicability.test.ts   # AC-4
npx vitest run tests/db/dashboard-sums.test.ts                          # AC-6
npx vitest run tests/unit/bands.fixtures.test.ts                        # AC-8
npx vitest run tests/db/narrative-assertions.test.ts                    # AC-10
npx vitest run tests/unit/reference-index.test.ts \
               tests/unit/score-validate.test.ts \
               tests/unit/score-badges.test.ts \
               tests/unit/prompt-payload.test.ts \
               tests/db/hotspot-score.test.ts                           # AC-17
npx vitest run                                    # all three projects: unit, component, db
npx playwright test                               # AC-1,5,7,9,11,14,15,16
npm run verify:dashboard                          # AC-6; queries the database, no browser needed
python -m pytest tests/prep -q                    # AC-13
python prep/sample_hazards.py --source=frozen --check    # dry run: validates the three coverage states
```

### Offline rehearsal checklist (AC-11, AC-13, AC-14, AC-16)

1. `docker compose up -d`; confirm the app answers on `http://localhost:3000`.
2. Disable the host network interface (`Disable-NetAdapter` on Windows).
3. Log in as each of the three users; confirm each lands on its amended home route and that the risk manager
   reaches `/portfolio` in one click. Confirm `/signup` returns 404.
4. Open five cases, one per country. Confirm numbers, conditions, provenance rows and narratives render; that
   a Kota Kinabalu case shows wind **measured with a stored value and marked not scored in Malaysia**, with its
   reason; and **confirm what the satellite thumbnail looks like while the interface is disabled**, so the
   degraded view is rehearsed before demo step 4 might show it.
5. Move the scenario slider through its three positions, which the UI labels **2025 (origination)**, 2030 and
   2050. Confirm **SG, MY and ID pins are green at 2025 while Hong Kong and coastal China pins are amber**, that pins recolour as the slider moves, and that a
   pin's colour equals its case band. Watch flood exposure grow into 2050.
6. Confirm the basemap renders at country and city zoom with the interface disabled. **If exercising the
   committed floor rather than the fetched archives, expect country and regional geometry only: a
   Singapore-scale view from the z0-z6 floor is close to empty, and that is the documented fallback, not a
   failure.**
7. Open `/portfolio`; confirm the four figures render and match `npm run verify:dashboard`, and that the
   revaluation count matches the number recorded in `docs/demo-script.md`.
8. Open `/ai`; confirm the strip renders from cache, the hotspot popup shows exposure, score, drivers,
   rationale, the stored input list and the reference index, and the news list shows at least 10 items newest
   first.
9. Press each refresh button; confirm a failure toast appears and no content disappears.
10. Press regenerate on one case; confirm the rule text renders in place of the narrative.
11. Press regenerate score on one hotspot; confirm the reference index renders with a fallback badge and the
    stored score is not overwritten.
12. Confirm the illustrative-data ribbon is visible on every screen.
13. Re-enable the network and repeat steps 8, 10 and 11; confirm refresh, regenerate and rescore succeed, and
    that the `SG-EC-002` thumbnail fetches live.

### Manual demo script (12 minutes)

1. Log in as the risk manager, landing on the AI Dashboard. Satellite strip, one hotspot popup (North Jakarta:
   summary, S$ exposure, LLM score with drivers and rationale, reference index beside it), one news item, one
   insight. State the scoped exception: the model assigns this triage score, the deterministic reference sits
   next to it, and no credit number is model-assigned. Show a divergent hotspot. **If the Day-4 run produced none, the presenter says so plainly**: "the model and
   the formula agreed on every hotspot this run, so here is the badge on a worked example", pointing at the
   `score_source = 'fixture'` row. Both branches are scripted. (2.5 min)
2. Switch to `/map` at the leftmost position, labelled **2025 (origination)**. Point out that Singapore,
   Malaysia and Indonesia are green while Hong Kong and
   coastal China already carry typhoon wind and chronic air quality, and that this comes from an applicability
   table rather than a country rule. Then move the slider to 2050 and **watch flood risk grow** across the
   coastal clusters. (2 min)
3. `/portfolio`: four headline figures at 2050, top 10 exposed cases. Note that the revaluation tile is
   scenario-invariant and that dates in the past mean **overdue**, which is a finding rather than a clock bug.
   (1.5 min)
4. Open `SG-EC-002` on Marine Parade Road **first**, so the board sees a real case: flood 6.6% plus heat 3.5%
   for a **10.1%** total and S$899,000, which is what a Singapore mortgage actually looks like. Open the
   provenance panel and let the live satellite thumbnail load. Then open `SG-EC-001` as the isolation exhibit,
   the same flood exposure with the heat term held at zero, walking depth, curve and probability to the spec's
   **6.6%** and **S$934,000**. Say "this one's heat sample is pinned" out loud in the same breath, before a
   director reads `dataset_version = 'fixture: pinned'` off the provenance panel. Switch to `SG-KB-003` and toggle the adaptation preview, reading the 1.50 point
   delta off the screen. (3.5 min)
5. Conditions and revalue-by year, then the narrative, stating that on this screen the model wrote the sentence
   and none of the numbers. (1 min)
6. `/rules`: raise `band_mid` from 10% to 12%, save, return to the map, pins recoloured with no restart.
   (1.5 min)

## 9. Assumptions and Open Questions

No blocking questions. Assumptions, all reversible in code:

1. **Spec amendment recorded.** AC-1's original parenthetical conflicted with the AI Dashboard block; the team
   lead amended AC-1 on 2026-09-07 and S3 and `auth.spec.ts` target the amended text.
2. **Horizon probability** is `1 - 0.99^n` with base year 2025 and `n = 0, 5, 25`, giving 0.00, 0.05 and 0.22
   (ADR-5, ADR-6). Iteration 1's constant-0.22 claim and iteration 2's 2026 base year are both withdrawn.
3. **Only the flood term carries `P`.** Wind and chronic perils are unconditional bands, so **Hong Kong and
   coastal China pins are amber at the leftmost position, labelled 2025 (origination), while SG, MY and ID are
   green**. The earlier "uniformly green today"
   claim is withdrawn from the ADR, the rehearsal and the demo script.
4. **Adaptation is a credit in haircut units** (ADR-4), which departs from the spec's adaptation bullet
   describing a depth reduction while matching the spec's binding formula line. The zero floor means documented
   and effective credit can differ, so both are rendered and `SG-EC-003` pins the case where the floor binds.
5. **AC-2 binds to the formula first and the seeded row second.** The unit test asserts the spec's literal
   inputs with no database; a separate database test asserts `SG-EC-001`'s stored valuation equals that result.
   Singapore scores heat, so the realistic `SG-EC-002` totals 10.1%; both are shown, and the three flood
   fixtures pin `flood_haircut` rather than `total_haircut`.
6. **All six fixtures are members of the 200**, with per-cluster running-index ids, and each occupies a slot its
   cluster's generator does not fill, so every cluster count and the 200 total are unchanged.
7. **Every fixture's hazard samples are pinned in the seed** and reapplied after sampling under all three source
   modes, so the tested figures and the on-stage figures are the same rows. These are the only unsampled rows in
   the database and `docs/sources.md` discloses them.
8. **Adaptation membership is a curated foreign key with no polygon** (ADR-4), so no spatial join can produce a
   second opinion on a credit-relevant number.
9. **The heat metric is warming relative to the present**, all three deltas measured against one 2016-2035
   reference window, so today is zero by definition of the metric rather than by an accident of labelling.
10. **The leftmost scenario is labelled "2025 (origination)"** rather than "today", and revaluation dates in the
   past mean overdue.
11. **The depth-damage curves are a curated fit**, not a transcription: the published JRC Asia residential curve
   is near 0.32 at 0.5 m, and the seeded table uses 0.30 so that AC-2 and AC-3 are mutually consistent. Labelled
   on screen and in `docs/sources.md`.
12. **The reference index is withheld from the prompt** (ADR-3), and `max_event_severity` is stored but not sent,
   so the payload matches the spec's closed list term for term.
13. **Divergence is a badge, not a rejection.** Only range, driver-enum, tool-block or citation failures fall
   back.
14. **Wind occupancy multipliers** are 0.8 for RC high-rise and 1.2 for low-rise or industrial, clamped within
   the spec's own band so neither can push a value outside 1-3% or 3-6%.
15. **Reference-index weights** are 0.45 hazard, 0.30 exposure, 0.25 events, over a 90-day window and the p90 of
   the 2050 total haircut. The spec requires a deterministic reference but does not fix its shape.
16. **Heat's inner 5% cap applies to the elasticity term only**, before the UHI multiplier, so heat alone can
    reach 7.5% and the 5% chronic cap is what binds. This matches the spec's literal wording.
17. **`--source=synthetic` is the unconditional floor**, `frozen` the preferred replay, `live` the enrichment.
    `prep/lib/synthetic.py` is a rule in Python by declared exemption (ADR-2).
18. **Twelve to sixteen hotspots** and at least 30 seeded events, giving headroom over AC-16's floor of 10.
19. **Model is `claude-sonnet-5`** for narratives and scores, batch pre-generated.
20. **Adaptation credits are curated judgements** traceable to named programmes, labelled as curated, not
    published protection values.
21. **Landslide inputs are Copernicus DEM slope plus NASA LHASA only**, excluding the CC BY-NC Arup/GFDRR map.
22. **Subsidence is a susceptibility probability**, not a rate, because Herrera-Garcia 2021 is a susceptibility
    map.
23. **The basemap is two Protomaps ODbL archives**, a z0-z10 region extract by bbox and a z0-z12 cities extract by
    MultiPolygon, produced by two `pmtiles extract` runs and served as two MapLibre sources, over a committed
    z0-z6 floor, and MapLibre overzooming beyond the archive maximum.

## 10. Changelog: review dispositions

### Iterations 1-4

Critic BL1-BL12 and Architect D1-D14 plus iteration-3 defects 1-9 were resolved across four iterations, with
every quantitative claim independently recomputed by both reviewers in iteration 4: both AC-2 fixtures, the AC-3
and zero-floor fixtures, the six-key and nine-leaf payload counts, the percent and magnitude citation rules, all
five cluster sums, and every basemap figure including the 96-tile floor. Those dispositions stand.

### Critic iteration-4 blocking, 2 of 2 applied

| Point | Disposition |
|---|---|
| BL11 fixture ids cannot exist in their clusters; the 201st pin is undefined | **Applied** per the team lead's ruling. Section 4.3.2 states the identifier scheme once: per-cluster running index from 001, so the highest index equals the cluster count. The three East Coast fixtures renumber to `SG-EC-001`, `SG-EC-002` and `SG-EC-003`, all valid within twelve. All six fixtures are **members** of the 200: the S5 table shows each affected cluster as `total = fixtures + generated`, so Marina South reads 10 = 2 + 8, East Coast 12 = 3 + 9, Kallang Basin 8 = 1 + 7. Every cluster count and the 200 total are unchanged and the count assertion stands. |
| BL12 fixture hazard samples are not pinned, so tested and demonstrated figures can diverge | **Applied.** `db/seed/04_samples.sql` pins the full sample rows for all six fixtures with `dataset_version = 'fixture: pinned'`, applied **after** sampling under synthetic, frozen and live alike. `tests/db/fixture-pinning.test.ts`, authored in S7, asserts that depths, heat deltas, coverage states and the two Marina South elevations equal `tests/fixtures/cases.ts` after any prep run. This covers all six fixtures, so non-blocking point 8 is closed by the same fix. |

### Critic iteration-4 non-blocking, 8 of 8 applied

The stale `damage_class` prep cell is deleted; `valuations` gains `winning_peril` and the prose states that the
stored flood columns come from the peril that wins the maximum, with a note that AC-3's delta is unaffected;
`reference-index.test.ts` is stated to read `rules.total_cap` from the active rule set; the 2030 heat window's
fifteen-year overlap with the reference is recorded in `docs/sources.md`; `v_portfolio_summary` is stated to
return three of the four headline figures with the top-10 list named as a separate ordered query;
rehearsal step 5 and demo step 2 now read "2025 (origination)" to match the on-screen label; S9 names an
explicit `protomaps-themes-base` source per archive so the two sources do not collide; and the Marina South
elevation pair is pinned by the BL12 fix.

### Architect iteration-4 defects, 4 of 4 applied

| Defect | Disposition |
|---|---|
| 1 stale `damage_class` in the prep table would fail the seed | **Applied.** The cell now reads `building_type` and states in place that the classification is a rule living in `lib/rules/curves.ts` and the seeded table. |
| 2 two curve unit tests have no database-free source | **Applied.** `lib/rules/curves.ts` holds the section 4.3.1 points and the six-to-three mapping as seed defaults, exactly as `bands.ts` already does for the band constants. `02_reference.sql` is generated from it and the three affected unit tests import it, so they run in the no-database project they are assigned to. |
| 3 `exposure_share` declared absent, unreadable and written | **Applied**, taking the Architect's first option. `v_hotspot_exposure` now computes the share with a window function, the schema states the view is where it lives, and the prep table says `prep:reference` snapshots it into `score_inputs` and writes no column. One home, one writer. |
| 4 the 201st pin | **Applied** via the BL11 ruling above. |

### Architect synthesis and improvements

The **synthesis is taken**: `tests/unit/worked-example.test.ts` is now a pure formula assertion on the spec's
literal inputs with no database, which is both the stronger binding and the reason it can run in its assigned
project, and `tests/db/worked-example-row.test.ts` separately asserts that `SG-EC-001`'s stored valuation equals
that result. The antithesis's sharpest point, that a property called "Fixture property, East Coast" would be
opened in front of a board, is answered twice over: the fixture now carries a real Amber Road, Katong address
inside its cluster, and demo step 4 opens the realistic Marine Parade case **first**, using the demonstration
property second as the isolation exhibit.

Improvements 1 through 6 all applied: the cities archive is recounted on tile boundaries at about 815 tiles
rather than the area-based 510, taking the archive to about 16,000 tiles and 96-240 MB and leaving it an order
of magnitude inside the budget; `COUNT(DISTINCT loan_application_id)` is carried into the section 4.2 view
prose a builder implements from; demo step 4 is reordered; the pinned heat row's `coverage = 'scored'` is
stated so `provenance-panel.test.ts` knows what it will find; `docs/sources.md` discloses the six pinned rows;
and S1 carries the Day-1 network dependency list in one place.

**Totals for iteration 5.** Twenty review points: Critic BL11-BL12 (2), Critic non-blocking 1-8 (8), Architect
defects 1-4 (4), Architect synthesis (1), Architect improvements 1-6 (6, with improvement 8 subsumed).
**20 applied, 0 declined.**

### Iteration 5 post-approval merge

Architect **SOUND** with four non-blocking nits; Critic **APPROVED** with seven residual improvements. Eleven
raw items, deduplicated to ten, none of which changes a decided number, a formula, an ADR or an acceptance
criterion. **10 applied, 0 declined.**

| Item | Source | Disposition |
|---|---|---|
| The exposure-share caveat is inverted by the iteration-5 view | Critic 1, merged with Architect 4 | **Applied**, and it was the sharpest item in either review. The window-function view makes the shares sum to exactly 1.0 by construction, so the old note in S31 was now false. The caveat is restated the correct way round: double-counted collateral inflates the denominator, so the **hotspot exposures sum to more than the portfolio total** and each share understates its hotspot's true fraction of the book. The same note absorbs Architect nit 4 by recording that the share has one home and two readers, the popup live and the prompt from a `prep:reference` snapshot. |
| `winning_peril` undefined where both perils contribute zero | Critic 2 | **Applied.** Marked `NULL`, which is the common case at the 2025 scenario, and the provenance panel shows no flood line rather than an arbitrary one. |
| The inundation threshold is unpinned while the elevations are pinned | Critic 3 | **Applied.** The `sea_level_inundation` context row is pinned alongside the two Marina South elevations and asserted by `fixture-pinning.test.ts`, so no comparison in the fixture set is left asymmetric. |
| Prose says "today" where the UI reads "2025 (origination)" | Critic 4 | **Applied** in the two remaining places, ADR-5's consequences and assumption 3. The scenario key stays `today`. |
| `SG-EC-001` is addressed on an expressway | Critic 5 | **Applied.** Re-addressed to Amber Road, Katong, which sits in the same East Coast cluster and reads as a real mortgage. |
| The presenter should name the pinned sample before a director reads it | Critic 6 | **Applied.** Demo step 4 now says it in the same breath as the 6.6%. |
| Day 1 is the crowded day | Critic 7 | **Applied** as clarity rather than as a change, since the instruments were already right: the risk row now names Day 1 as the likeliest to slip and points at the three that bound it, the consolidated dependency list, the unconditional 12:00 cut line, and the committed basemap floor. |
| The AC-2 convenience command runs two of five files | Architect 1 | **Applied.** The command now names all five. |
| `fixture-pinning.test.ts` is the slowest test in the suite | Architect 2 | **Applied.** S28 records that it seeds three times, says to budget for it, and marks it as never cut, since it is what guards the numbers on stage. |
| S7 authors a database test that S4 makes possible | Architect 3 | **Applied.** S7 states the same-day, cross-owner dependency explicitly. |

Nothing in this merge was declined. One item, Architect nit 4, was merged into Critic 1 rather than applied
separately, because both concern the same sentence in `docs/sources.md`.


### Execution amendments (lead, 2026-09-08, from worker-c calibration findings)

- **ADR-5 correction.** ADR-5 states that `revalue_by_year = 2025` is reachable via "wind up to 6% plus the 5% chronic cap". It is not: at the 2025 (origination) position the heat delta is zero by definition of the metric, so the chronic term is PM2.5 alone (max 2%) and the ceiling is 6% + 2% = 8%, below `band_mid` (10%). `revalue_by_year` therefore takes only the values 2030, 2050, or null. S15 band fixtures must not assume a 2025 revaluation; the demo-script line about overdue 2025 revaluation dates is struck.
- **S17 expectation corrected.** The revalue-before-2030 tile reads about 3 of 200, not "roughly 10 to 35". Derivation: SG/MY/ID pins score neither wind nor PM2.5 at 2030, so their maximum is 5% water (damage(1.0) x p_2030 0.05) + 5% chronic cap = 10.00%, which ties `band_mid` and never exceeds it; CN/HK pins cross only through the 6% wind band, which needs `lowrise_industrial` occupancy (11 of 60 pins). The plan's own risk row ("the 2030 column looks empty") already anticipated this. `verify:dashboard` prints the exact seeded count; the demo script leads with the 2050 orange/red split and the HK/CN 2030 movement, not the 2030 tile.
- **Synthetic data calibration.** The synthetic hazard floor (not any rule constant) was recalibrated to a stated 2050 distribution: green 37%, amber 30.5%, orange 25.5%, red 7%, red confined to Pluit, Nansha, Semarang, Ningbo and Marina South; amber-or-worse share at 2050 is 63% (was 99.5%). HEAT_2030_FRACTION stays 0.30, justified by the NEX-GDDP window spacing. Details in docs/sources.md ("Synthetic data calibration").

- **Section 4.3 pseudocode bug (worker-b, S10).** `const P = rules['p_' + scenario]` composes `p_y2030` / `p_y2050` from the scenario enum (`today`, `y2030`, `y2050`) while the rule_sets columns are `p_today`, `p_2030`, `p_2050`; the lookup returns undefined and every 2030/2050 flood haircut would be NaN or zero. lib/valuation/hazards.ts uses an explicit scenario-to-column map. Anyone re-implementing from 4.3 must not use string composition.
- **Wind band discontinuity (worker-b, S10), known property not a defect.** The two wind curves are continuous at 45 m/s (both 0.030) but the clamp window steps from [0.01, 0.03] to [0.03, 0.06], so the clamped haircut steps by exactly 0.6 pp for both occupancies. Pinned by tests/unit/caps-and-zeros.test.ts. Consequence of "occupancy modulates within the band, never outside it".
- **Self-correcting reference seed (worker-b).** 02_reference.sql is authoritative for the four curated tables: each upsert is followed by a delete of rows the seed no longer claims; tests/db/seed-self-correcting.test.ts proves it. The manual stale-row delete is no longer needed.

- **Coastal inundation flag is a comparison, not a presence test (worker-b, S12).** The sea_level_inundation context row is a measurement (AR6 regional median SLR at 2050, 0.28-0.32 m in the seeded data) present on every pin; reading its presence as the flag referred all 200 applications. The flag is elevation < SLR + 0.50 m, now `coastalInundationFlag` in lib/rules/bands.ts; referrals are 16 (ID 10, CN 5, SG 1), and the AC-8 pair SG-MS-002 (0.60 m, flagged) / SG-MS-003 (2.60 m, not) proves it.
- **Seeded 2050 distribution after recompute:** 73 green / 62 amber / 52 orange / 13 red; all 13 red refer to risk; revalue_by_year = 2030 for 3, 2050 for 62, null for 135, never 2025 (a test pins the 8% origination ceiling).

- **MapLibre GL v6 worker must be vendored (worker-c, S16).** maplibre-gl 6.x spawns its worker from a separate ES module; neither Turbopack nor webpack emits that chunk for a dependency's internal `new Worker(new URL(...))`, so the worker never starts and the map silently renders no tiles or pins with no console error and `load` never firing. Fix: `public/maplibre/maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` copied from the pinned version, `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')`, VERSION.txt records the source version. RELEASE CHECKLIST: any maplibre-gl bump must recopy both files. Pins are added on `style.load`, not `load`, so a slow or missing archive cannot keep them off the map. S23's hotspot map reuses the same setup.
- **03_portfolio.sql has one generator (lead ruling).** prep/gen_portfolio.py emits it (plan S5 literal assignment); scripts/gen-portfolio-sql.ts is removed. Loan statuses corrected to open / in_review / approved / conditionally_approved to satisfy the CHECK.
- **End-to-end calibration check (worker-c, S16).** In a real browser at 2050 the map shows 73/62/52/13 (green/amber/orange/red) against the synthetic calibration's predicted 74/61/51/14; origination is 140 green / 60 amber (ADR-5 exactly). Zero external network requests on the map path.

- **Rule-set restore in tests (worker-b, S15).** Every valuation references the rule set it was computed against; a test that inserts or re-seeds an active rule set and leaves it active silently orphans all 600 rows. Tests touching rule_sets must restore the exact original active id, not merely the highest.
- **NUMERIC(6,4) rounding (worker-b, S15).** Haircuts are stored rounded to 4 dp while adjusted_value is stored from the unrounded haircut; re-deriving totals from the stored rounded haircut differs by a few dollars. Dashboard and verify:dashboard sum stored S$ columns or recompute from components at full precision. Test tolerances are 3 dp.
- **AC-7 data gap (worker-b, S15; fix assigned to worker-c #24).** The synthetic floor set landslide_flag on no pin; tests/db/landslide-flag.test.ts is left failing with an actionable message until steep MY/ID/HK pins are flagged.

- **Dashboard figures from the seeded database (worker-a, S17, 2026-09-08).** 200 properties, S$2,396,510,000 collateral. Amber-or-worse by value: 34.76% (2025), 37.77% (2030), 66.01% (2050). Total haircut: S$39.9m / S$77.2m / S$175.4m. Revaluation before 2030: 3 (scenario-invariant, COUNT(DISTINCT); 9 non-distinct rows). `verify:dashboard` recomputes every figure from base tables and compares to the view to the cent.
- **Landslide flag derivation (worker-a, closes the AC-7 gap).** prep/lib/context.py derives slope_deg and landslide_flag under its ADR-2 exemption: 11 of 200 pins flagged (KL city centre 7, Tai Po / Sha Tin 3, BSD City 1), no fixture affected, boolean only, never multiplied into a haircut.
- **Shared DB pool (worker-a).** lib/db/client.ts (one pg Pool cached on globalThis) and lib/db/queries.ts now exist per plan 4.1; private pools in auth, map pins and scripts are to be folded in because PGlite's connection ceiling is bounded. `db:up --fresh` now refuses if the port is already listening.

- **E2E isolation (lead ruling after worker-c's S14/S16 report).** Playwright ran against the shared dev database while AC-9's rule-edit spec rewrote the active rule set and recomputed 600 rows, making e2e results non-deterministic (76 rule_sets rows accumulated; 2050 read 73/79/35/13 under a leftover 12% band_mid). The e2e project now gets its own in-memory PGlite instance per run, like the vitest db project; rule-edit.spec.ts restores the original active rule set. `npm run db:reset-rules` restores the seeded rule set on the shared instance before any rehearsal.
- **Case screen verified against fixtures (worker-c, S14).** Every figure rendered is a stored column; the adaptation toggle switches between stored flood_haircut and flood_haircut_gross with no recompute. SG-EC-002 2050: 10.1% / S$899,000 / S$674,250; SG-KB-003: 7.74% vs 9.24%; SG-EC-003: documented 3.00 pp, effective 2.64 pp, flood 0.00% with the zero-floor explanation; origination rows show no flood line because winning_peril is null.

- **Landslide threshold (lead ruling, 2026-09-08).** The spec fixes the flag at slope > 25 deg plus LHASA exposure; the first synthetic derivation used 18 deg (only 2 of 11 flagged pins exceeded 25). The rule is set to 25 deg and the synthetic slope envelopes are adjusted so hillside clusters still yield ~8-12 flagged MY/ID/HK pins. The 18-deg LHASA argument is kept as a note on why real data would flag more.
- **Bundler tracing (worker-c).** The map page reads archives through string-literal paths and next.config.ts excludes public/basemap, public/maplibre and data from output file tracing; a path constant imported from another module is not traceable, so filesystem paths live at the call site.

- **Unbounded growth on threshold save (worker-b, S18): root cause of e2e flakiness.** recompute deleted computed rows only for the rule set being written, so every AC-9 save left 1,800 stale rows; test runs reached 105 rule sets and 60,000 valuations, and any spec running beside a heavy recompute timed out. recompute now clears valuations, application_valuations and recommendations entirely before rewriting; rule_sets history is kept (derived outputs are reproducible). Queries no longer need a rule_set_id filter to read the right numbers.
- **Threshold editor (worker-b, S18).** Save = deactivate previous, insert new active rule set, recompute, all in one transaction, then revalidate five paths. Validation rejects 12-for-0.12, non-increasing bands, top edge above the total cap, decreasing probabilities. validateRuleSetEdit lives in lib/rules/bands.ts because a 'use server' module may export only async functions.
- **Free-port db harness (worker-b).** The vitest db project binds port 0 and reads back the assigned port; TEST_DB_PORT overrides.

- **Two Hong Kong figures struck from the pitch (lead ruling, S31).** 9.2% electricity per deg C and 24.8% UHI cooling load could not be re-verified against a primary source; neither feeds any number in the product. docs/sources.md section 14 records the recommendation and is where a primary source goes if one is found.
- **Amber-or-worse has two definitions; the pitch uses one.** Dashboard, demo script and pitch use the collateral-VALUE share (66.01% at 2050, AC-6). The pin-count share (63%) is a calibration target only and appears solely in the calibration section of docs/sources.md, labelled as such.
- **Shared-document discipline.** docs/sources.md was once overwritten by a whole-file write, destroying a teammate's delimited section (no git history yet). Shared documents are edited with targeted edits only; a checkpoint commit is recommended to the user.

- **db:reset-rules (worker-a, #32).** The shared database had accumulated 114 rule sets with the active flag on a test-created row. The script keeps the oldest (seeded) rule set, deletes the rest (cascading their valuations), resets its constants to RULE_SET_SEED_DEFAULTS, reactivates it, recomputes; idempotent, with --dry-run. After reset the dashboard figures match docs/demo-script.md exactly (34.76 / 37.77 / 66.01% amber-or-worse by value). First step of the Day-5 rehearsal checklist.
- **Landslide at 25 deg (worker-a, #33).** Rule is slope > 25 deg plus susceptibility, per spec; synthetic slope envelope rescaled by measurement. 10 of 200 pins flagged (KL hillsides 6, Tai Po / Sha Tin 3, BSD City 1), none in SG or coastal CN, no fixture; slope_deg populated on all 200 pins (max 35.16). MY-KL-001 dropped off the previous list.

### Execution deviations

Environment-forced departures from the plan as written, recorded at execution time. Each names the plan text
it departs from, what was done instead, and what must be true on demo day.

| Date | Step | Plan text | What was done | Demo-day target |
|---|---|---|---|---|
| 2026-09-07 | S1 (A) | 4.1 and ADR-1: "PostgreSQL with PostGIS is the only other container", `postgis/postgis:16-3.4` under `docker-compose.yml` | Docker is not installed on the build host and installing PostgreSQL natively needs elevation, so local development and the Vitest `db` project run **PGlite 0.5.8 with `@electric-sql/pglite-postgis` 0.2.8**, served over the ordinary Postgres wire protocol by `@electric-sql/pglite-socket` (`npm run db:up`, `scripts/db-server.ts`). This is a **container substitution, not an ADR-7 deviation**: PostGIS 3.6 with GEOS and PROJ is present, `geography(Point,4326)` and `geography(Polygon,4326)` columns, GIST indexes, `ST_Intersects` and `ST_DWithin` all work, and `v_hotspot_membership` was run verbatim against both branches before the decision was taken. The `CHECK ((area IS NULL) <> (radius_m IS NULL))` constraint and the exact `divergence_flag` GENERATED column DDL were both verified to compile and behave. Nothing above the `pg` driver changes: the app and every test read `DATABASE_URL` unchanged | `docker compose up -d` on `postgis/postgis:16-3.4`. `docker-compose.yml` and `Dockerfile.web` are committed unchanged and the SQL is identical on both servers, so the switch is a change of `DATABASE_URL` host |
| 2026-09-07 | S4 (B) | 4.1: `vitest.workspace.ts` with three projects | Vitest 5.0.0, the version that resolves against this Node 24 / React 19 scaffold, **removed workspace files entirely**; the replacement is `test.projects`. The harness is `vitest.config.mts` with the same three projects, named `unit`, `component` and `db`, so `npm run test:component` and `npm run test:db` (`vitest run --project ...`) work exactly as `package.json` already scripts them. The `.mts` extension is needed because the repo has no `"type": "module"` and the config uses `import.meta.url` | Unchanged. The filename is the only difference; three projects with the plan's names, environments and include globs |
| 2026-09-07 | S4 (B) | 4.1: `playwright.config.ts` with a `webServer` against the compose stack | `webServer` runs `npm run dev` against whatever `DATABASE_URL` names, which on this host is the PGlite server of the S1 deviation above. Setting `PLAYWRIGHT_BASE_URL` skips `webServer` and reuses an already-running stack. One worker, `trace: 'retain-on-failure'`, Chromium 153.0.8010.12 installed (114.6 MiB, inside the Day-1 network window) | `docker compose up -d` then `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test`, or the same config unchanged with `DATABASE_URL` pointing at the compose database |
| 2026-09-07 | S4 (B) | S1 pinned `@types/node` at `^20` | Bumped to `^24`. Vitest 5 declares a peer requirement of `@types/node@^22 \|\| >=24`, and the build host runs Node 24.15.0, so `^20` was already behind the runtime | Unchanged; a devDependency only |
| 2026-09-07 | S9 (A) | 4.7: "twelve boxes of 0.5 degrees square" | Eleven boxes are 0.5 degrees square. The twelfth, **Shanghai with Ningbo, is 0.50 x 1.86 degrees**: Pudong sits at 31.23N and Ningbo at 29.87N, 1.36 degrees apart, so no 0.5-degree square holds both and the plan's own metro grouping pairs them. Every other pairing does fit, including Guangzhou with Shenzhen (0.37 x 0.27 degrees apart) and Jakarta with BSD. The boxes live in `METRO_BOXES` in `scripts/fetch-basemap.ts` and `npm run prep:basemap -- --clusters` regenerates `clusters.geojson` from them | unchanged; twelve metro boxes as one MultiPolygon |
| 2026-09-07 | S9 (A) | 4.7 tile and size table | **Recounted against `pmtiles extract --dry-run`, which agrees with an independent Mercator calculation to the tile.** Region z0-z10 is **15,216 exactly**, confirming the higher of the plan's two recounts rather than "approximately 15,200". The committed floor is **96 tiles exactly**, as planned. The cities archive is **982 tiles**, not the estimated 815: the plan counted about 35 tiles below z11, but deduplicated across twelve boxes the z0-z10 contribution is 170, and z12 is 621 rather than 590 because of the taller Shanghai box. Archive total **16,198**, against the planned approximately 16,000. Actual sizes: region **168.6 MB**, cities **34.0 MB**, **202.6 MB together**, inside the plan's 96-240 MB estimate and well under the 500 MB budget. The committed floor is **3.3 MB, not the estimated 1 MB**, which is still small enough to commit | unchanged |
| 2026-09-07 | S9 (A) | 4.7: "verifies both SHA-256 recorded in `docs/sources.md`" | `go-pmtiles` publishes **no `checksums.txt`** for v1.22.0, so the binary hashes were computed from the downloaded assets on 2026-09-07 and pinned in `scripts/fetch-basemap.ts` and `Dockerfile.web`, which now verifies with `sha256sum -c` before unpacking. The archive hashes are recorded in the committed `public/basemap/checksums.json` rather than only in prose, so `npm run prep:basemap` can verify them mechanically and `-- --verify` re-checks the archives on disk with **no network at all**, which is what the Day-5 rehearsal needs. S31 copies the table the script prints into `docs/sources.md` | unchanged |
| 2026-09-08 | S7 (A) | 4.6: `sample_hazards.py` writes `context_factors`, seven rows per pin | Under `--source=live` those seven are sampled, which is squarely Python's job. Under `--source=synthetic` they must be derived from nothing, which is a physical model and therefore a rule. Added `prep/lib/context.py` and claimed the **same ADR-2 exemption already granted to `prep/lib/synthetic.py`**, on the same four grounds: it never runs in the same pass as a real sample, it is pinned by `seed=20260907`, its output is committed and diffed, and `synthetic` is the floor every acceptance test runs against. It stores the AR6 sea-level rise in metres and does **not** decide whether the inundation flag fires; that comparison stays in TypeScript against the active rule set. An extension of the existing exemption, not a new one | unchanged |
| 2026-09-08 | S7 (A) | 4.3.2 fixture sample sets | `flood_riverine` is pinned **`absent`** on all six fixtures, so exactly one flood peril can win the `max` and the stored depth, damage fraction and both credit columns are unambiguous. This also sidesteps a real ambiguity in the plan: 4.2 says `winning_peril` is NULL where both perils contribute zero, which the ADR-4 zero-floor fixture `SG-EC-003` is, yet 4.3.2 requires its panel to render an effective credit of 2.64 pp that can only come from a peril's gross. Raised with worker B to settle in S11. Separately, the `sea_level_inundation` row is pinned on **all six** fixtures rather than only the Marina South pair, so no comparison in the fixture set is left with one side pinned and the other sampled | unchanged |
| 2026-09-08 | S7 (A) | 4.2 `building_type` ENUM | The plan names only `residential_highrise_rc`. S2 proposed six labels and worker B's `02_reference.sql` and worker C's generator both settled on `retail_podium` where S2 had written `retail_mall`. The schema was changed to match the two consumers, so the six are `residential_highrise_rc`, `residential_landed`, `shophouse_mixed`, `office_tower`, `retail_podium`, `industrial_warehouse` | unchanged |
| 2026-09-08 | S7 (A) | 4.1: "`db/seed/03_portfolio.sql` from `gen_portfolio.py`" | That file did not exist and `gen_portfolio.py` has no SQL emitter, so landing `04_samples.sql` made the whole Vitest `db` project fail in global setup on a foreign key. Added `scripts/gen-portfolio-sql.ts`, a **stopgap owned by A**, following the convention worker B already set with `scripts/gen-reference-sql.ts` for `02_reference.sql`. It derives nothing: every column is copied from the CSV except `geom`, which becomes `ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography`, and it deliberately does not write `damage_class` (ADR-2). **Delete it if `gen_portfolio.py` grows its own emitter**; two generators for one seed file is the duplication ADR-2 exists to prevent. `04_samples.sql` also now opens with a guard that names the missing file instead of failing on `hazard_samples_collateral_id_fkey` | one generator, either this or the Python one |
| 2026-09-08 | S13 (A) | 6, AC-12: `provenance-panel.test.ts` | The Vitest `db` project's global setup runs `migrate` and `seedDatabase` but not `db:recompute`, so `valuations` is empty when the project starts and the valuation half of AC-12 had nothing to assert against. The test now runs `scripts/recompute.ts` itself when that file exists, and when it does not it reports in the run output that the valuation half is **not** being asserted rather than passing quietly. It spawns node against `node_modules/tsx/dist/cli.mjs` rather than `npx`, which on Windows is a `.cmd` shim that `execFile` cannot start | unchanged |
| 2026-09-08 | S13 (A) | 7, risk row: `test_sampling_sanity.py` runs against **both** `--source=frozen` and `--source=synthetic` | Both are parameterised as the plan requires. `frozen` **skips** on this machine, with a reason naming `data/frozen/hazard_samples.csv` as missing, because only a live Earth Engine run writes it and no credentials exist here. It passes 13 assertions against `synthetic` and skips 10 against `frozen`; the frozen half starts asserting the moment a live run is committed, with no change to the test | both sources asserted |
| 2026-09-08 | S7/S13 (A) | 4.6: `sample_hazards.py` writes `collateral.slope_deg` and `landslide_flag` from Copernicus DEM slope and NASA LHASA | The synthetic floor wrote neither, so AC-7 had no landslide badge to render and `tests/db/landslide-flag.test.ts` failed with nothing to assert against. Added `derive_collateral_updates()` to `prep/lib/context.py` under the ADR-2 exemption that module already claims: slope rises with elevation scaled by a per-market terrain ruggedness factor, and the flag fires at 18 degrees. It flags **11 of 200 pins**, 7 in Kuala Lumpur city centre, 3 in Tai Po / Sha Tin and 1 in BSD City, which are hillside-development locations rather than an arbitrary spread. No fixture is affected. The flag is a boolean and nothing multiplies it into a haircut, which is the binding spec constraint | Copernicus DEM slope and NASA LHASA on the live path |
| 2026-09-08 | S17 (A) | 4.1: `lib/db/{client,queries}.ts` | Neither existed, and three modules had each grown a private `pg` Pool: `lib/auth/session.ts`, `app/(app)/map/pins.ts` and the scripts. Harmless against a real Postgres, not harmless against PGlite behind a socket with a bounded connection ceiling, where N pools of five is N times the connections for the same work. Created both. The pool caches on `globalThis` so a Next hot reload does not leak one per reload. The dashboard page and `npm run verify:dashboard` both read `v_portfolio_summary` through `queries.ts`, so the screen and the terminal cannot disagree | one pool; the two remaining private pools fold into it |
| 2026-09-08 | S17 (A) | S17: "the expected count is at the low end of roughly 10 to 35 of 200" | **Superseded. The seeded count is 3.** Nine `recommendations` rows carry `revalue_by_year <= 2030`, exactly three per application. Crossing `band_mid` by 2030 needs wind plus a chronic term, and only the most exposed Chinese pins get there at that horizon. `npm run verify:dashboard` prints the distinct count beside the raw row count so the arithmetic behind `COUNT(DISTINCT)` is visible, and `docs/demo-script.md` records it | unchanged |
| 2026-09-08 | S19 (A) | S19: "12-16 hotspots from admin-area aggregation and event clustering" | `environmental_events` is empty until S20, so the clustering term is aggregation over collateral only for now and the event join stays in place. The 27 seeded clusters group into **19 candidates** by contiguous metro area, matching the basemap's twelve metro boxes, and the largest **16 by aggregate loan exposure** are kept. The cap is therefore a documented ranking rather than a quiet omission: every cluster is a candidate, and the three that fall out are George Town, Kota Kinabalu and Ningbo. Shape is chosen by the data, a radius where every member sits within 4 km of the centroid and a bounding polygon otherwise, giving **6 polygons and 10 radii**, which is what lets AC-15 test one of each. `hazard_type` is labelled by RELATIVE EXCESS over the portfolio mean rather than by absolute magnitude: an earlier absolute scale labelled thirteen of sixteen hotspots "heat", which said more about the divisors than about the map | events clustering added at S20 |
| 2026-09-08 | S19 (A) | S31 / 4.4: "collateral inside two hotspots is counted in both, so the hotspot exposures sum to more than the portfolio total" | Not yet true of the seeded data, and `docs/sources.md` must say which. The 16 hotspots **do not overlap**: 181 membership rows over 181 distinct pins. Their exposures sum to S$1,182,061,000 against a S$1,219,706,000 loan book, which is LESS than the total, because 19 pins sit in no hotspot at all. The double-counting caveat remains the right one to write down, because it is a property of the view rather than of this seed, but the seeded figures currently understate rather than overstate | unchanged |
| 2026-09-08 | S19/S20 (A) | 4.1: one `db/seed/05_regional.sql` carrying `hotspots`, `environmental_events` and `satellite_tiles` | Three scripts produce those rows, and one file with three writers is a race. Added `prep/build_regional.py` as the **only writer**; `build_hotspots.py`, `fetch_events.py` and `fetch_tiles.py` each return their own SQL and write no file. `python -m prep.build_regional --source=live\|frozen\|synthetic` composes it | unchanged |
| 2026-09-08 | S20 (A) | 4.6: `fetch_events.py` reads GDELT, NASA EONET, GDACS and NASA FIRMS | **NASA EONET alone**, which already aggregates GDACS and carries the region and the 90-day window as query parameters. FIRMS needs an API key and returns HTTP 400 without one; GDELT adds volume rather than signal for this map. The live run returned **55 usable events** in the regional bbox, all inside the 90-day window, frozen to `data/frozen/environmental_events.csv`. The **three events the spec names by hand** (BSD river pollution, Borneo forest fire, NTT earthquake) are curated rows present in every source mode, because no live feed can be relied on to carry them on demo day; they are disclosed in `docs/sources.md` alongside the six pinned hazard fixtures. 58 events seeded against AC-16's floor of 10 and the plan's 30 | GDELT and FIRMS remain optional enrichment |
| 2026-09-08 | S20 (A) | 4.2: `environmental_events.hotspot_id` | Written by a **PostGIS statement at the end of `05_regional.sql`**, not by any producer, for the same one-owner reason ADR-7 gives `v_hotspot_membership` collateral containment. An event attaches to the NEAREST hotspot within **400 km** and to nothing beyond. That radius is calibrated on transboundary haze, the real regional-pressure mechanism in this basin, and it was chosen by measurement rather than by feel: at 75 km one event of 58 attaches to one hotspot, leaving the reference index's V term at zero for fifteen of sixteen; at 400 km, 11 events attach across 7 hotspots; at 600 km, 35 attach across 10, but that has a Borneo fire bearing on Shanghai. The 47 unattached events still render on the news list and weigh nothing, which is a correct reading rather than a missing one | unchanged |
| 2026-09-08 | S20 (A) | 4.6: `fetch_tiles.py` reads NASA GIBS / Sentinel-2 | **NASA GIBS only**: MODIS Terra corrected-reflectance true colour, ready-made 256px JPEG tiles over WMTS, no key and no quota. Twelve tiles, one per metro at z6, 188 kB in total, committed under `public/cache/tiles/` so the strip renders with the interface disabled. The capture date is resolved by stepping back from today until GIBS answers, because it lags a day or two; this run cut 2026-09-07. Each file carries a content-hash suffix so a refresh writes a NEW file and never overwrites the one the strip is currently rendering | Sentinel-2 remains optional enrichment |
| 2026-09-08 | S12 (B) | 4.2: `valuations.adjusted_value_sgd NUMERIC(16,2)` beside `total_haircut NUMERIC(6,4)` | Recorded rather than changed. The haircut columns round to four decimal places, but the adjusted value is computed from the UNROUNDED haircut and then stored, so recomputing it from the stored total disagrees by a few dollars. `SG-EC-003` stores a 0.0313 haircut and S$1,453,125, which comes from the unrounded 0.03125; from the stored figure it would be S$1,453,050. **S17 and `verify:dashboard` must recompute from the components, never from the stored total.** Fixture tests compare haircuts at three decimal places for the same reason: a true 0.03125 stores as 0.0313, a difference of exactly 5e-5, which is precisely the boundary a four-place comparison rejects | Unchanged. The stored value is the correct one and is what the case screen renders |
| 2026-09-08 | S12, S18 (B) | 4.2: "the previous rule set is kept, not deleted" | Kept for `rule_sets` and NOT for its computed rows. `recomputeAll` now clears `valuations`, `application_valuations` and `recommendations` entirely before rewriting them, rather than only the rows of the rule set being written. Each threshold save had been leaving 1,800 rows behind; a run of the AC-9 specs reached 105 rule sets and 60,000 valuations, which slowed every dashboard and map query and made the live AC-9 step flake. Nothing is lost: the figures for a superseded rule set are reproducible by recomputing against it, which is what determinism is for, and every screen reads the active rule set. It also removes a trap for any query that forgets to filter by `rule_set_id` | Unchanged. The threshold audit trail survives in `rule_sets`; the three computed tables hold exactly one rule set's worth of rows |
| 2026-09-08 | S24 (A) | 6, AC-14/AC-16: `tests/e2e/refresh.spec.ts` "asserts the button fetches when reachable"; AC-11: "`refresh` offline leaves the list intact" | The reachable half is asserted end to end. The OFFLINE half **cannot be asserted from a Playwright spec** and a test claiming to would be false: `page.route` intercepts requests the BROWSER makes, while both refresh routes call out from the SERVER inside the Next handler, so a browser-level block never reaches them. Written first and it failed by succeeding, sailing past the interception to NASA and returning ok. The failure path is therefore asserted in `tests/unit/refresh-fallback.test.ts` against `lib/feeds/refresh.ts`, the pure function that decides the message, and end to end by the Day-5 rehearsal with the interface physically disabled (checklist step 9) plus S26's offline spec. The e2e spec now states in its own header what it does and does not cover | S26 and the rehearsal carry the offline half |
| 2026-09-08 | S24 (A) | 4.9: refresh routes | Both are POST-only and answer a GET with 405, because a GET would put an outbound call on a render path and `no-network-on-render.test.ts` allows these two files by name. Both use a 5 s AbortSignal. The tile route's ordering is the design: every download completes, then NEW files are written under content-hashed names, and only then does the row move, so a failure at any stage leaves the strip rendering the image it already had and a rollback needs no file restore. The tile refresh does not rebuild a URL; it substitutes the date segment of the stored `live_url`, so `prep/fetch_tiles.py` stays the only place that decides which tile a metro is. The news upsert keys on `dedupe_key` and never deletes, so the three curated events survive every refresh | unchanged |
| 2026-09-08 | S32 (A) | Shared-instance hygiene, not a plan deviation | `/rules` writes a NEW active `rule_sets` row on every save, which AC-9 requires, and `tests/e2e/rule-edit.spec.ts` saves on every Playwright run. The shared development database had accumulated **114 rule sets**, with the active flag on a test-created row and `band_mid` left wherever the last test put it, so every dashboard figure described a rule set nobody chose. Added `npm run db:reset-rules` (`scripts/db-reset-rules.ts`): keeps the oldest row, which is the seeded one, deletes the rest, resets its constants to `RULE_SET_SEED_DEFAULTS` so a test that edited the seeded row in place is undone too, reactivates it and recomputes. Verified: 113 deleted, 600 valuations recomputed, headline figures back to 34.76 / 37.77 / 66.01 per cent and `verify:dashboard` agreeing to the cent. `-- --dry-run` reports without changing | unchanged |
| 2026-09-08 | S33 (A) | Landslide threshold | Raised from **18 to 25 degrees**, which is what the spec fixes; 18 was where NASA LHASA susceptibility starts climbing, and the spec wins. The synthetic slope envelope was rescaled so the new threshold still flags a useful population: **10 of 200 pins**, 6 on the Kuala Lumpur hillsides, 3 in Tai Po / Sha Tin, 1 in BSD City, none in Singapore or coastal China and no fixture. The coefficient was chosen by measurement, not by feel: a lower value flags 5, a higher one flags 16 and starts catching Indonesian pins that are not on hillsides. The flag remains a boolean that nothing multiplies into a haircut | Copernicus DEM slope and NASA LHASA on the live path |
