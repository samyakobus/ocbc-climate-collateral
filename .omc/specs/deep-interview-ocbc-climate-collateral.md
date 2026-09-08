# Deep Interview Spec: OCBC Climate Risk Platform with Collateral Decision Tool

## Metadata
- Interview ID: di-ocbc-climate-collateral-20260906
- Rounds: 16 (plus Round 0 topology gate; three answers revised by the user mid-interview, final answers recorded)
- Final Ambiguity Score: 10%
- Type: greenfield
- Generated: 2026-09-07
- Threshold: 0.2 (user-requested run target: 0.10, met)
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.40 | 0.36 |
| Constraint Clarity | 0.90 | 0.30 | 0.27 |
| Success Criteria | 0.90 | 0.30 | 0.27 |
| **Total Clarity** | | | **0.90** |
| **Ambiguity** | | | **0.10** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| Login & roles | active | Seeded email + password login, three roles | AC-1 |
| Climate hazard layer + portfolio map dashboard | active | Multi-hazard layers, collateral pins, scenario slider, risk-manager headline figures | AC-5, AC-6, AC-7 |
| Climate-adjusted collateral valuation engine | active | Deterministic haircut, adjusted value, max loan / LTV | AC-2, AC-3, AC-4 |
| Recommendations & actions | active | Rule-band conditions per case, editable thresholds, LLM advisor narrative | AC-8, AC-9, AC-10 |
| Data layer | active | ~200 synthetic collateral across SG/MY/ID/CN/HK, pre-computed hazard samples, live satellite thumbnail, provenance | AC-11, AC-12, AC-13 |
| AI Dashboard (regional intelligence) | active | Satellite imagery strip, Southeast Asia hotspot map with loan exposure popups, environmental news list, AI insights and 1-100 climate credit risk index | AC-14, AC-15, AC-16, AC-17 (added by user 2026-09-07 after interview close) |
| Insurance & wealth extensions | deferred | Great Eastern flood-rider upsell, Bank of Singapore property haircut and client resilience report | User-confirmed deferral 2026-09-06: "phase 2; MVP focused on the retail bank (personal and corporate) of OCBC across the group" |

## Goal
A climate risk platform for OCBC Bank's lending business that shows, for every collateral property across Singapore, Malaysia, Indonesia, China, and Hong Kong, its physical climate exposure under today / 2030 / 2050 scenarios, computes a deterministic climate-adjusted collateral value and maximum loan, proposes rule-based loan conditions, and summarises portfolio exposure for risk managers, and opens on an AI Dashboard that compiles recent satellite imagery, a Southeast Asia hotspot map with OCBC loan exposure per hotspot, recent environmental news, and AI insights with a 1-100 climate credit risk index per hotspot. Numbers come from one global method with public sources; an LLM explains them but never decides them. The demo must run on a laptop without network, except satellite thumbnails.

## Constraints
- Users: three seeded accounts (loan officer, corporate credit officer, risk manager), email + password, no sign-up, no external identity provider. Each lands on its role's home screen.
- Segments: personal mortgages and corporate property loans. Base LTV fixed per segment: personal 75%, corporate 60%, applied to the adjusted value, editable by the risk manager. Same rule in every country.
- Geographies: SG, MY, ID, CN, HK, one method for all; no country special-cased.
- Scored hazards (enter the haircut):
  - Flood: WRI Aqueduct Floods v2 riverine + coastal (coastal "with subsidence" variant so surge and subsidence-adjusted sea level are included), 100-year return period, RCP 8.5, horizons today / 2030 / 2050. Damage via JRC global depth-damage functions by region and building type.
  - Typhoon wind (HK and CN pins only, zero elsewhere): STORM v4 100-year wind speed, two-occupancy damage bands (<33 m/s 0%; 33-45 m/s 1-3%; >45 m/s 3-6%).
  - Extreme heat: haircut = 0.1% x projected increase in days above 35°C per year (NEX-GDDP-CMIP6 ssp585 2050 vs ERA5-Land baseline), capped at 5%, multiplied by an urban-heat-island factor of 1.0 / 1.25 / 1.5 by Yale SUHI tertile, reduced one step where Sentinel-2 NDVI within 300 m is in the top tertile. Elasticity is from Chinese studies and must be labelled "borrowed" on screen.
  - Chronic PM2.5 (CN and HK only): GHAP annual mean bands <35 µg/m³ 0%; 35-50 1%; >50 2%. No scenario escalation.
- Combination rule: max of the correlated water perils, plus wind, plus the chronic sum (heat + air) capped at 5%, total haircut capped at 25%.
- Flood haircut formula: haircut = damage_fraction(depth at 100-yr flood under scenario) x P(at least one such flood before the horizon year; ~22% for 2050) − adaptation credit.
- Adaptation credit: curated table of known adaptation projects, each with source and protection level (e.g. Singapore Long Island / PUB coastal defence zones, Jakarta sea wall segments, HK drainage tunnels). Properties inside a zone get a depth reduction; the case screen names the project and source; risk manager can toggle the credit off.
- Landslide (MY, ID, HK): manual-review flag on parcels with slope >25° and LHASA exposure above threshold. Never a numeric haircut.
- Context panel (not scored, shows value and 2030/2050 direction): transboundary haze (FIRMS fire), water stress (Aqueduct 4.0), cooling degree-days (ERA5-Land, CMIP6), land subsidence (Herrera-Garcia 2021), permanent sea-level inundation (IPCC AR6 regional), coastal erosion (Deltares Shoreline Monitor), wildfire (FIRMS). Climate inputs may be long-run averages, scenario projections, or monthly / yearly summaries; no same-day data.
- Recommendation rule bands on the 2050 haircut: <3% no action; 3-10% require flood cover; 10-20% require flood cover + cap LTV so adjusted LTV stays within the segment limit; >20% or any coastal inundation refer to risk; revalue-by date = first scenario year the haircut crosses 10%. Defaults fixed in code; risk manager can edit thresholds. Recommendations add conditions, never plain declines.
- LLM: Claude via the Anthropic API, advisor and explainer only. Narratives for the ~200 seeded cases and the portfolio summary are pre-generated and stored; a live "regenerate" button exists; fallback is the rule text. The LLM never changes a condition or a number.
- Map: collateral pins on hazard layers, scenario slider today / 2030 / 2050, pin colour reuses the haircut bands (green <3%, amber 3-10%, orange 10-20%, red >20%), click a pin to open the case. No live events feed.
- Risk-manager dashboard headline figures: share of collateral value in amber-or-worse by country; total haircut in S$ under the selected scenario; number of cases needing revaluation before 2030; top 10 exposed cases.
- Data at demo: all hazard samples for the ~200 pins computed offline by Python prep scripts and stored in the database with source and sampled-at date. Only the per-property satellite thumbnail is fetched live from Google (Maps Static or Earth Engine) with a cached copy as fallback. A provenance panel shows the source and date of every number.
- AI Dashboard (regional intelligence, added 2026-09-07):
  - Satellite strip at the top: recent imagery tiles for OCBC's Southeast Asia markets (e.g. NASA GIBS / Sentinel-2 via Earth Engine), pre-cached before the demo with a manual refresh button; cached copies are the fallback.
  - Hotspot map: Southeast Asia-wide geographical map with clickable location pointers for areas with high climate or environmental risk. Hotspots are derived from (a) scored hazard data aggregated by admin area and (b) recent environmental events. Clicking a pointer enlarges it and shows a popup with: a summary of what is happening at that point, and OCBC's loan exposure to CIFs in that area (sum of synthetic loans whose collateral falls within the hotspot polygon or radius).
  - Environmental news list under the imagery: current and recent environmental news for the region (examples from the user: river poisoned by pesticides in BSD, fire in Borneo forest, earthquakes in NTT). Sourced from free feeds (GDELT, NASA EONET, GDACS, NASA FIRMS), pre-fetched and cached with a refresh button; each item links to its source and shows its date. Earthquakes are geophysical, not climate, and are shown in the list as "environmental" events but never enter the climate haircut.
  - AI insights section down the dashboard: LLM-written insights per hotspot (e.g. how fast a fire is spreading, derived from FIRMS hotspot counts over consecutive days), and a 1-100 climate credit risk score per hotspot. USER DECISION 2026-09-07: the LLM assigns the score. This is a deliberate, scoped exception to the Round 9 rule (which still governs the collateral valuation, conditions, and narratives). Guardrails: the LLM receives only the deterministic inputs for the hotspot (hazard scores by type, loan exposure S$ and share of book, recent event count and severity, days since last event) and must return a JSON object {score 1-100, drivers[], rationale} via structured output; a deterministic reference index is computed from the same inputs; if the LLM score differs from the reference by more than 25 points the UI shows a 'model divergence' badge; if the API is unreachable the reference index is shown with a 'fallback' badge. Scores and insights are pre-generated for the seeded hotspots with a live regenerate button.
  - The AI Dashboard is the landing view for the risk manager and reachable from the top navigation for the other roles.
- Stack: Next.js (App Router, TypeScript), MapLibre, PostgreSQL + PostGIS, credentials-based auth, Anthropic SDK; Python prep scripts (rasterio / Earth Engine) run once; docker compose on the laptop.
- Presentation: must look like a bank system, not a data notebook; every figure traceable to a public source.

## Non-Goals
- Great Eastern insurance features and Bank of Singapore wealth features (phase 2).
- Live events on the collateral map (Round 3). A cached, refreshable environmental news list lives on the AI Dashboard only; no real-time weather.
- Real authentication, sign-up, password reset, role administration.
- Claiming lower default rates for green or resilient homes.
- A hard S$ loss figure for OCBC's real book; all portfolio and hotspot exposure figures are over synthetic data and labelled illustrative.
- LLM-assigned numbers anywhere except the AI Dashboard hotspot score: collateral haircuts, LTVs, and conditions stay deterministic.
- Numeric haircuts for haze, water stress, subsidence, humidity, rainfall-regime shift, lightning, dust, green certification, saline intrusion, coastal erosion, wildfire (context only or phase 2).
- Per-country regulatory LTV tables.
- Any address on demand (geocoding new addresses) in the MVP.

## Acceptance Criteria
- [ ] AC-1 Each of the three seeded accounts logs in with email + password and lands on its role home (officer: case list; corporate officer: corporate case list; risk manager: AI Dashboard, with the portfolio dashboard one click away in the top navigation). No sign-up route exists. (Amended 2026-09-07: the AI Dashboard addition supersedes the earlier 'portfolio dashboard' landing for the risk manager.)
- [ ] AC-2 Worked example reproduces by hand and in an automated test: appraised S$1,000,000, 0.5 m flood depth in 2050, damage fraction 0.30, horizon probability 0.22, no adaptation → haircut 6.6%, adjusted value S$934,000, max loan S$700,500 at 75% (vs S$750,000 unadjusted).
- [ ] AC-3 Toggling the adaptation credit off for a property inside a curated adaptation zone changes its haircut by the documented amount, and the case screen names the project and its source.
- [ ] AC-4 The combined haircut never exceeds 25%; the chronic component never exceeds 5%; wind and PM2.5 are zero for SG, MY, ID pins; every scored factor shows its source and, where borrowed, a "borrowed elasticity" label.
- [ ] AC-5 Moving the scenario slider recomputes and recolours pins in all five countries; a pin's colour always equals the band shown on its case screen.
- [ ] AC-6 The four dashboard figures equal a direct sum over the seeded data for the selected scenario (verified by a test that recomputes them from the database).
- [ ] AC-7 Clicking a pin opens the corresponding case; landslide-flagged parcels show a manual-review badge on both map and case.
- [ ] AC-8 Fixture cases exist for every haircut band and each shows exactly the conditions its band prescribes, including the correct revalue-by year.
- [ ] AC-9 After the risk manager edits a threshold, the affected cases show updated conditions and pin colours without a restart.
- [ ] AC-10 Every pre-generated narrative cites only numbers present on the screen and names no condition outside the rule output (checked by an automated assertion over the stored narratives); with the Anthropic API unreachable, the case still renders numbers and conditions with the rule text in place of the narrative.
- [ ] AC-11 With the network disabled, login, case screens, valuation, recommendations, map, and dashboard all work; only satellite thumbnails fall back to cached copies.
- [ ] AC-12 The provenance panel on a case lists, for each number, the dataset name, scenario, and sampled-at date.
- [ ] AC-13 Prep scripts run from scratch on a clean machine and populate ~200 pins across SG, MY, ID, CN, HK with flood, wind, heat, PM2.5 samples for all three horizons.
- [ ] AC-14 The AI Dashboard shows a satellite imagery strip at the top from cached tiles; with the network disabled the strip still renders; the refresh button fetches new tiles when online.
- [ ] AC-15 The Southeast Asia hotspot map shows clickable pointers; clicking one enlarges it and opens a popup containing a summary of the event or hazard and the total synthetic loan exposure to CIFs in that area, which equals a database sum over collateral inside the hotspot area.
- [ ] AC-16 The environmental news list shows at least 10 cached items with source link and date, sorted newest first; the refresh button pulls new items from the configured feeds when online and leaves the cached list intact when offline.
- [ ] AC-17 Each hotspot shows an LLM-assigned 1-100 climate credit risk score with its drivers and rationale, produced from the documented deterministic inputs via structured output; a test asserts every stored score is an integer 1-100 with a non-empty rationale that cites only input values; a deterministic reference index is computed alongside, a 'model divergence' badge appears when |score - reference| > 25, and with the Anthropic API unreachable the reference index renders with a 'fallback' badge.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "Value a collateral" was undefined ("you can help figure it out") | What does the officer act on? | Climate-adjusted value + LTV / max loan |
| Recommendations were generic "protect the bank" advice | For whom, at what level? | Per-case conditions on the officer screen, rule-based, no plain declines |
| Map shows "major climate change things going on" | Live events or hazard exposure? | Collateral pins on hazard layers with scenario slider (user revised twice, settled here) |
| "Works across the group" means equal depth everywhere | Contrarian: what if it means same method? | One global dataset, same method, no country special-cased |
| A haircut can be any number | How would the CEO trace it? | JRC depth-damage curves, deterministic, worked example as test |
| Login needs to be "real" | Simplifier: least login that identifies the user? | Seeded users, email + password, no external service |
| Rule thresholds could be left to build time | What makes case X show condition Y? | Fixed default bands, editable, plus LLM narrative |
| Product identity | Ontologist: what IS this? | Climate risk platform containing a deterministic collateral tool (user revised from "AI copilot") |
| Demo data can be fetched live | What if the network drops on stage? | Pre-computed store, only thumbnails live |
| Flood is enough | User: flood-only "would not cut it" | Research-ranked set: flood, wind, heat, PM2.5 scored; landslide flag; context panel |
| Adaptation can be ignored (as OCBC does) | It is MAS-permitted and the differentiator | Curated adaptation table with per-property credit |
| Stack is a build-time detail | It bounds every component | Next.js + PostGIS + Python prep scripts |

## Technical Context
- Hazard datasets: WRI Aqueduct Floods v2 (GEE: `WRI/Aqueduct_Flood_Hazard_Maps/V2`), STORM v4 tropical cyclone wind (4TU, ingest as asset), ERA5-Land and NEX-GDDP-CMIP6 (GEE), Yale SUHI v4 (GEE), Sentinel-2 NDVI (GEE), GHAP PM2.5 (GEE community catalog), NASA LHASA landslide, Copernicus DEM 30 m (GEE), FIRMS, Aqueduct 4.0 water risk, Herrera-Garcia 2021 subsidence, IPCC AR6 sea-level projections, Deltares Shoreline Monitor.
- Damage curves: JRC global flood depth-damage functions (Huizinga et al. 2017) by continent and building type; wind bands per research briefing.
- Research files: `.omc/research/retail-bank-climate-sensitivity.md`, `.omc/research/ocbc-group-arms-climate.md`, `.omc/research/climate-factors-beyond-flood.md` (to be written after approval). Note: the skeptic pass on the first briefing returned empty, so its figures are unverified; the factor briefing's critic flagged two HK figures (9.2%/°C electricity, 24.8% UHI cooling load) for re-verification before the pitch.
- Regulatory anchors for the pitch: MAS ENRM Guidelines 2020, MAS Transition Planning Guidelines (Mar 2026, effective Sep 2027), HKMA 2021 pilot stress test, BNM PD 028-124, EU Taxonomy Appendix A hazard list.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Portfolio | core domain | country, segment, exposure stats (share amber-or-worse, total haircut by scenario, revaluations before 2030, top 10) | has many Collateral / LoanApplication |
| LoanApplication | core domain | applicant, loan amount, segment, base LTV, max loan, status | belongs to Applicant; has one Collateral; has Recommendations |
| Collateral | core domain | address, geocode, country, building type, appraised value, per-scenario hazard samples, damage fraction, horizon probability, adaptation credit, haircut %, adjusted value, landslide flag | secures LoanApplication; located in Geography; inside AdaptationProject zone (optional) |
| Applicant | core domain | name, type person / company, synthetic | has many LoanApplications |
| HazardLayer | supporting | hazard type (flood riverine / coastal, wind, heat, PM2.5), source, resolution, scenario, sampled-at | scored under ClimateScenario; sampled per Collateral |
| ClimateScenario | supporting | horizon (today / 2030 / 2050), pathway RCP 8.5, return period 100 y | drives HazardLayer samples and haircut |
| DepthDamageFunction | supporting | region, building type, depth-damage points, source JRC | maps Collateral depth to damage fraction |
| AdaptationProject | supporting | name, country, zone, protection level, source | reduces depth for Collateral in zone |
| RuleSet | supporting | haircut bands, base LTV per segment, editable-by risk manager, defaults | produces Recommendation; guards LLM narrative |
| Recommendation | supporting | conditions[], revalue-by year, refer-to-risk flag, narrative (model, pre-generated text, regenerated-at) | attached to LoanApplication |
| ContextFactor | supporting | factor, value, 2030/2050 direction, source | shown per Collateral, not scored |
| SatelliteImage | supporting | live URL, cached path | one per Collateral |
| User | supporting | email, password hash, role (loan officer / corporate credit officer / risk manager) | opens LoanApplication; risk manager edits RuleSet |
| Geography | supporting | country SG / MY / ID / CN / HK | contains Collateral |
| Hotspot | core domain | name, centroid, area polygon or radius, hazard type, summary, loan exposure (S$), LLM score 1-100 with drivers and rationale, reference index, divergence flag, insight text | aggregates Collateral in area; linked to EnvironmentalEvents |
| EnvironmentalEvent | supporting | title, type (fire, flood, pollution, earthquake, storm), date, location, source URL, feed | shown in news list; may seed a Hotspot |
| SatelliteTile | supporting | region, capture date, cached path, live URL | shown on AI Dashboard strip |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 8 | 8 | - | - | - |
| 2 | 8 | 0 | 0 | 8 | 100% |
| 3 | 8 | 0 (ClimateEvent added then removed on revision) | 0 | 8 | 100% |
| 4 | 8 | 0 | 0 | 8 | 100% |
| 5 | 9 | 1 (DepthDamageFunction) | 0 | 8 | 89% |
| 6 | 9 | 0 | 0 | 9 | 100% |
| 7 | 10 | 1 (RuleSet) | 0 | 9 | 90% |
| 8 | 10 | 0 | 0 | 10 | 100% |
| 9 | 11 | 1 (Portfolio) | 0 | 10 | 91% |
| 10 | 12 | 1 (SatelliteImage) | 0 | 11 | 92% |
| 11 | 12 | 0 | 0 | 12 | 100% |
| 12-16 | 14 | 2 (AdaptationProject, ContextFactor) | 0 | 12 | 93% |

## Interview Transcript (condensed, final answers)
1. Core output → adjusted value + LTV (70.5%)
2. Recommendation shape → per-case rule-based conditions (65%)
3. Map purpose → collateral on hazard zones with scenario slider (59.5%, revised twice)
4. Contrarian, coverage rule → same method, one global dataset (56.5%)
5. Haircut method → JRC depth-damage curves (52%)
6. Simplifier, login → seeded email + password, three roles (38%)
7. Rule triggers → fixed bands + editable + LLM-capable (35%)
8. Scenario set → today/2030/2050, RCP 8.5, 100-yr, ~200 pins (33.5%)
9. Ontologist, identity → climate risk platform with a collateral tool (25.5%, revised once)
10. Demo data → pre-computed store, live thumbnails only (22.5%)
11. LTV + formula → fixed per segment, formula and worked example accepted (22.5%)
12. Hazard set → research proposal: flood, wind, heat, PM2.5 scored; landslide flag; context panel (closed last, 10%)
13. LLM → Claude API, pre-generated narratives, regenerate button (17.5%)
14. Map criteria → haircut-band colours + four headline figures (14.5%)
15. Adaptation credit → curated table + per-property flag (14.5%)
16. Stack → Next.js + PostGIS + Python prep scripts (14.5%)

## Post-interview addition (2026-09-07)
User added the AI Dashboard component after the interview closed. Recorded decisions: news list is cached with refresh (reliability rule); the 1-100 hotspot score is LLM-assigned by explicit user decision (scoped exception to Round 9, with a deterministic reference index and fallback); earthquakes are listed but never scored. Ambiguity for this component is not interview-scored; the Planner and Critic must treat it as the least-specified component.

## Verification of this plan
- After approval: confirm the spec file exists at the exact path, the research file is written, and the state file records `spec_path` and status PASSED.
- The execution bridge question is presented and no source files are created until an execution option is chosen.
