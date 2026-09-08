# Architect Review: `ocbc-climate-collateral-mvp.md` (RALPLAN-DR consensus, iteration 1)

Reviewer: Architect (read-only). Date: 2026-09-07.
Plan snapshot reviewed: initial read at 601 lines; **re-verified against the current 604-line snapshot edited
2026-09-07 13:31**, which now includes `reference_index` in the LLM prompt input JSON and renames the hotspot
score columns to `llm_score`, `llm_drivers`, `llm_rationale`, `reference_index`, `divergence_flag`, `scored_at`,
`model`. All line references below are to the **current** snapshot unless marked otherwise. Points invalidated
by that edit are marked *superseded by current snapshot* and retained rather than deleted.

Spec: `.omc/specs/deep-interview-ocbc-climate-collateral.md`. Research: the three files under `.omc/research/`.
No Critic output was consulted.

---

## 1. Architectural soundness of Option A

**Sound as a shape.** Option A (section 2 "Viable Options", L53-74) is the right call for the stated drivers.
The invalidation of B on driver 1 is honest: three containers and a second test harness against 200 rows and a
25% cap is pure overhead. The invalidation of C on driver 2 is stronger still, because section 3.3's pseudocode
(L183-219) *is* the artefact the board inspects, and PL/pgSQL would bury it.

Three structural choices are load-bearing and correct:

- **`rule_sets` as data, not constants** (L160, L178) is what makes AC-9 a recompute rather than a deploy, and
  it makes AC-2 a fixture over a stored row rather than over a literal.
- **`hotspots.score_inputs` stored verbatim** (L253-254) makes the AC-17 tests reproducible against exactly
  what the prompt saw. This is the best single design decision in section 3.4, and it survives the 13:31 edit.
- **The offline rule stated as a code invariant** (L326-329: outbound calls only in POST routes and server
  actions) is the only version of "offline-first" that survives contact with Next.js server components.

The Earth Engine-primary hybrid (L81-88) is also right. Pure B' is correctly killed on Aqueduct v2 volume;
pure A' is correctly killed on the STORM and LHASA asset-ingest quota, which is a hard external dependency on
a five-day clock.

**But the monolith is not actually a monolith.** Section 3.1 puts `prep/gen_narratives.py` and
`prep/gen_hotspot_scores.py` (L136-137) in Python, while their validators live in TypeScript (L125-126), and
section 3.4 Step 3 (L283) asserts validation is "applied identically in prep and at runtime". That is two
implementations of one rule, in two languages, both under test by AC-10 and AC-17. Option A's headline pro
("one language for all runtime logic; one test runner") is already breached by the plan's own file list.

---

## 2. Antithesis: the strongest case for Option B (separate Python/FastAPI valuation service)

Steelmanning the rejected option:

The plan's cost model for B counts containers, but the real cost driver on a five-day clock is **the number of
times a rule has to be written twice**. Option B has exactly one such seam: the HTTP contract. Option A as
drafted already has three:

1. The numeric-citation validator, in `prep/gen_narratives.py` (Python) and `lib/narrative/validate.ts` (TS).
2. The score validator, in `prep/gen_hotspot_scores.py` (Python) and `lib/index/validate-score.ts` (TS).
3. The reference index itself: `build_hotspots.py` writes `reference_index` (L305), `lib/index/reference.ts`
   recomputes it (L234-248), and `tests/unit/reference-index.test.ts` (L491) exists **precisely to catch the
   two copies drifting apart**. A test whose purpose is to detect divergence between two hand-maintained
   copies of one formula is a smell, not a control.

Option B collapses all three. `sample_hazards.py`, `build_hotspots.py`, the two validators and the reference
index become one Python package, imported by both the prep CLI and the service. The board-readability argument
does not favour TypeScript either: a JRC lookup and four clamped arithmetic expressions are no less legible in
Python, and the prep scripts a director might ask to see are already Python.

The plan's sharpest objection to B, "a service down at 09:00 on demo day ends the demo with no fallback"
(L62), is answered by the plan's own architecture. Valuations are **precomputed into a table** (L161) and every
page reads rows. The service is needed only for `db:recompute` and the two regenerate paths, all three of which
already have fallbacks or are demoed once. The demo does not depend on the service being up; only the
threshold-edit step does.

**Where the antithesis fails.** AC-9 requires a threshold edit to update conditions and recolour pins with no
restart. Option A does that in-process, in one transaction, in one server action, with `revalidatePath`
(L418-420). Option B turns it into a cross-process fan-out over 600 rows plus a revalidation race, on the one
step of the demo script that is guaranteed to be performed live in front of the board (section 7, step 6).
That single acceptance criterion is worth more on demo day than the deduplication is worth over five days.

**Net:** the antithesis wins the argument about *where the LLM scripts live*. It loses the argument about
*where the valuation engine lives*. That asymmetry is what makes a synthesis available.

---

## 3. Unresolved tensions

**T1 - Assumption 1's justification is factually wrong, and the slider's meaning is never settled.**
L590-592 claims a tenor-based constant 0.22 is "the only reading that reproduces AC-2 exactly". It is not.
The spec's literal formula, "P(at least one such flood *before the horizon year*; ~22% for 2050)", also yields
0.22 for 2050 at a 25-year distance, and additionally yields about 0.04 for 2030 and about 0 for today. The two
readings are indistinguishable at AC-2 and wildly different everywhere else. Under the plan's reading, the
"today" column shows a portfolio already carrying flood haircuts computed from an Aqueduct historical layer
whose riverine baseline epoch is 1980, which is awkward to defend to a director asking what "today" means.
Under the spec's reading, "today" is uniformly green and the slider is far more dramatic. The plan picks one
reading and misstates why, which means the choice was never actually made. It also never says what happens to
`horizon_probability` if the risk manager edits `tenor_years` in the threshold editor.

**T2 - Offline-first versus live imagery buys risk for no demo value.**
Live thumbnails are the sole network carve-out (L24), requiring a billed Google Maps Static key, while Earth
Engine thumbnail URLs expire. Yet the 12-minute demo script (section 7) never shows a live thumbnail fetch, and
the offline checklist only ever confirms the *cached* path (steps 4 and 7). The carve-out therefore contributes
a credential, a billing account and a failure mode, and nothing the board actually sees. Unresolved: either
exercise it deliberately in script step 4 so the carve-out earns its keep, or drop to zero-network and delete
the key entirely. The plan does neither.

**T3 - Day 1 has no cut line, and it is the least controllable day.**
The plan gates Day 2 explicitly (L521: "Day 2 ends with AC-2/AC-4 green or the AI Dashboard is cut to the
satellite strip and news list only"). Day 1 gets no equivalent, despite carrying S1-S6: compose, the full
PostGIS schema, auth, a 200-pin generator, seven Earth Engine datasets, a STORM basin download, and JRC curve
entry, *plus* Earth Engine cloud-project registration whose approval timing is outside the team's control
(L509). A 604-line plan across five days is defensible only if every day has a stated fallback branch, and the
riskiest one does not.

---

## 4. Synthesis: keep Option A, absorb the antithesis's strongest point

Keep Option A's runtime boundary exactly as drawn, and absorb the antithesis by **moving the two LLM prep
scripts across the line into TypeScript**.

`gen_narratives.py` and `gen_hotspot_scores.py` (L136-137, L308-309) do no geospatial work whatsoever. They
issue HTTP calls and validate strings. Recast them as `scripts/gen-narratives.ts` and
`scripts/gen-hotspot-scores.ts`, importing `lib/narrative/validate.ts` and `lib/index/validate-score.ts`
directly. Then move `reference_index` computation out of `build_hotspots.py` (L305) into
`scripts/compute-reference.ts`, which S18 (L431-434) already specifies as existing.

Python retains exactly what needs rasterio and `ee`: `gen_portfolio.py`, `sample_hazards.py`,
`fetch_events.py`, `fetch_tiles.py`, and the hotspot geometry and clustering in `build_hotspots.py`.

This yields one implementation of every rule the acceptance criteria test, one test runner over all of them,
and a language boundary that follows a **capability** boundary (geospatial raster sampling) rather than a
**lifecycle** boundary (prep versus runtime). It costs nothing on the timeline, it removes the reason
`reference-index.test.ts` had to be a drift detector, and it makes defect 10 below structurally impossible
rather than merely fixed.

---

## 5. Concrete defects

Each defect names the step or section, the line in the current snapshot, and a fix.

**1. L40, L208, L512 - "zero by data, not by branch" is false for Indonesia.**
GHAP annual-mean PM2.5 over Jakarta is roughly 35-45 ug/m3, so `pm25Haircut` (L208-210) returns 1% on the 40
Indonesian pins. That breaks AC-4 ("wind and PM2.5 are zero for SG, MY, ID pins") and falsifies principle 4
(L40) and the inline comment at L208. The sanity assertion at L512 ("PM2.5 null outside CN/HK") also cannot
hold, because GHAP is a global product and will return a real value.
*Fix:* seed a `hazard_applicability(hazard, country, scored BOOL)` reference table read by the engine, so the
HK/CN restriction lives in data. This honours principle 4 without an `if` and keeps one code path.

**2. Section 4 S4 country table (L360) versus L512 - the seeded portfolio contains Kota Kinabalu, in Sabah.**
`climate-factors-beyond-flood.md` states that STORM v4 already covers the South Indian and West Pacific basins
and warns explicitly: "simply do not hard-code zero outside HK/CN", citing Typhoon Greg (Sabah, 1996, over 200
deaths) and Cyclone Seroja (East Nusa Tenggara, 2021). The plan seeds 7 Kota Kinabalu pins. A correct STORM
sample there will be non-zero, so the sanity assertion "wind 0 for SG/MY/ID pins" (L512) fails against real
data, and AC-4 fails with it.
*Fix:* same `hazard_applicability` table as defect 1, or relocate the Malaysian cluster off Sabah. The table
is preferable, because the research explicitly recommends against zeroing by geography.

**3. L40 versus L512 - a direct internal contradiction on nodata.**
"A nodata sentinel is never coerced to 0" cannot coexist with "wind 0 for SG/MY/ID pins" when STORM has no
raster coverage over Singapore. As written, one of the two assertions in the same test must fail.
*Fix:* three states, not two. Out-of-basin becomes `value 0` with `dataset_name` plus a "no cyclone basin
coverage" provenance note; in-coverage nodata becomes NULL and a hard prep failure; a genuine zero stays 0.
Provenance (AC-12) then distinguishes "not applicable here" from "measured as zero", which is exactly the
distinction a director will probe.

**4. L301 - Aqueduct v2 future riverine images are per-GCM, so the filter returns a stack, not an image.**
Filtering `WRI/Aqueduct_Flood_Hazard_Maps/V2` on scenario plus year plus return period returns five ensemble
members (GFDL-ESM2M, HadGEM2-ES, IPSL-CM5A-LR, MIROC-ESM-CHEM, NorESM1-M) for riverine, and the coastal images
additionally carry a sea-level-rise percentile dimension. The plan reduces an unspecified stack, so two runs
can legitimately produce different numbers for the same pin, which is fatal to "reproducibility under
challenge" (driver 2).
*Fix:* pin the ensemble mean and the percentile explicitly in `sample_hazards.py`, and record both choices in
`hazard_samples.dataset_version` so the provenance panel can answer "which model" as well as "which dataset".
Also record that the riverine historical baseline epoch is 1980, not 2026, so the "today" scenario label is
honest.

**5. L302-303 - no 2030 or today values exist for heat or wind.**
The prep table specifies only "NEX-GDDP-CMIP6 ssp585 2050 vs ERA5-Land baseline" for heat and a single
"STORM v4 100-yr wind" raster for wind. But `hazard_samples` carries `UNIQUE(collateral_id, hazard, scenario)`
over three scenarios (L157), and AC-13 requires samples "for all three horizons". As written, `db:recompute`
has nothing to read for `heat_days35` and `wind` at `today` and `y2030`, so the scenario slider (AC-5) moves
only the flood term.
*Fix:* sample NEX-GDDP-CMIP6 over two windows (roughly 2016-2035 and 2040-2059) with today as a zero delta;
use STORM present-climate (4TU DOI 10.4121/12705164) for today and the climate-change edition
(DOI 10.4121/14510817, 2015-2050 SSP5-8.5, four CMIP6 models) for 2030 and 2050. Cite both DOIs in
`docs/sources.md`; the research file flags that the plan's single citation points only at the second.

**6. L212-219, L155, L160 - `valuate()` references a free variable, and LTV has two homes.**
`valuate(c, scenario, rules)` uses `segment` at L217, which is not a parameter and does not exist on
`collateral`; it lives on `loan_applications` (L155). Separately, `loan_applications.base_ltv` (L155)
duplicates `rule_sets.base_ltv_personal` and `base_ltv_corporate` (L160) with no stated precedence, and AC-9
requires the risk manager's rule-set edit to win.
*Fix:* pass the loan (or its segment) into `valuate`, and either delete `loan_applications.base_ltv` or
demote it to a nullable per-case override with the precedence written into `lib/valuation/combine.ts`.

**7. L160, L178-180 - `rule_sets` stores three mutually inconsistent columns.**
`horizon_probability (0.22)`, `tenor_years (25)` and `return_period (100)` cannot all be authoritative, because
1 - 0.99^25 = 0.2222, not 0.22. AC-2 needs exactly 6.6%, so any code that derives the probability from the
other two silently breaks the single most-scrutinised number in the demo, and the threshold editor exposes all
three to a risk manager who can make them disagree.
*Fix:* make `horizon_probability` the single source of truth, mark `tenor_years` and `return_period` as
display-only labels (or drop them), and put the rounding decision in a migration comment so the 0.2222-to-0.22
step is documented rather than discovered.

**8. L271-277, L515 - the Anthropic tool schema does not enforce what the plan claims.**
The `input_schema` keywords used (`minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`,
`additionalProperties`) are advisory. The Messages API does not reject a tool input that violates them, so the
risk row's first mitigation layer, "the strict tool schema bounds it to an integer 1-100" (L515), is not a
guardrail at all. The plan also never sets `tool_choice`, so the model may answer in prose and never call the
tool, which is a different failure from the malformed-output cases `score-validate.test.ts` covers (L495-500).
*Fix:* set `tool_choice` to `{type: "tool", name: "assign_hotspot_score"}` on the call; handle "no tool block in
the response" as an explicit fallback path in `validate-score.ts`; and rewrite L515 so `validate-score.ts` is
the only claimed enforcement, with the schema described as advisory shaping.

**9. L254-255, L268, L594-595 - putting `reference_index` in the prompt contradicts the spec's guardrail and
empties the divergence badge of meaning.**
The spec's AC-17 guardrail enumerates what the model receives as a closed list: "the LLM receives only the
deterministic inputs for the hotspot (hazard scores by type, loan exposure S$ and share of book, recent event
count and severity, days since last event)". The reference index is not in that list, and its exclusion is
what makes "if the LLM score differs from the reference by more than 25 points the UI shows a 'model
divergence' badge" a check rather than a formality. The current snapshot adds `reference_index` to the input
JSON (L268) and justifies it at L594-595 as anchoring, so that "divergence therefore reads as intent, not as
drift". But an anchored model has no mechanism for expressing intent: nothing in the prompt tells it when
departing from the anchor is warranted, and nothing in `validate-score.ts` distinguishes a deliberate 30-point
departure from sampling noise. The badge now fires on a quantity that measures neither agreement nor
disagreement, and it will fire rarely, which is why checklist step 11 (L561) and assumption 7 (L598) both have
to **fixture** a hotspot into the divergence state for the demo. A director shown a badge that only appears on
a hand-planted row will ask what it is for.
*Fix:* either revert to withholding the reference (restoring the spec's check semantics and accepting that the
badge fires often, which then needs a calibration rubric), or keep the anchor and be explicit that the badge
signals deliberate departure, which requires giving the model a stated rule for when to depart and recording
that rule in `docs/sources.md`. Because this changes a user-decided guardrail recorded in the spec on
2026-09-07, it should be re-confirmed with the user rather than settled in the plan.

*Note on my earlier draft:* my initial review argued that divergence would be the **normal** state, because an
unanchored model asked for a 1-100 risk score reliably returns 65-85 while the reference lands roughly 15-55.
That specific prediction is **superseded by current snapshot** - anchoring inverts it, and divergence now
becomes rare rather than common. The underlying defect survives the inversion: in both versions the badge
measures something the design cannot interpret, and in both versions the demo has to fixture the state.

**10. L237-247 versus L259-269, and test L491-492 - `reference-index.test.ts` is now impossible to write.**
The test asserts "the reference recomputes from `score_inputs` and matches `reference_index` for every
hotspot". The 13:31 edit broke that on two of the three terms:

- **H** is `p90(valuations.total_haircut)` (L239), but `score_inputs` now carries only
  `hazard_scores_by_type` as `{flood, wind, heat, pm25}`, the p90 of each *component* (L262). The p90 of a sum
  is not the sum of p90s, and the previous input field `worst_haircut_2050` was deleted in the edit.
- **V** is `sum(weights[event_type])` over the 90-day window (L244), but `score_inputs` now carries
  `recent_event_count_90d` and `max_event_severity`, the *highest* weight (L265-266). A count and a maximum do
  not determine a weighted sum.

Only **E** remains recomputable, and only if the test loads all hotspot rows to obtain the max.
*Fix:* restore `worst_haircut_2050` (p90 of the total) and a summed `recent_event_severity_90d` to
`HotspotScoreInputs`, keeping `max_event_severity` if it is wanted for the prompt. Without this, AC-17's
deterministic-reference clause has no passing test.

**11. L274-275 versus L284-286 and L490 - `drivers` was loosened to free text but the validator was not.**
The output schema now declares `drivers` as an array of plain strings with `maxLength: 120` (L274-275). The
validator still rejects drivers "naming a field outside `HotspotScoreInputs`" (L285-286), and
`hotspot-score.test.ts` asserts `llm_drivers` is "1 to 5 strings naming only `HotspotScoreInputs` fields"
(L490). You cannot reliably decide whether a 120-character natural-language phrase "names only" a set of
fields. A substring check passes only if the model writes literal identifiers such as
`hazard_scores_by_type`, which no fluent rationale-writing model will do, so the validator will reject nearly
every valid response and drive every hotspot into fallback. The earlier snapshot's structured driver objects
(`input_field` as an enum, plus `direction` and `weight_note`) made this assertion decidable; the edit removed
that without updating the two places that depend on it.
*Fix:* restore the structured driver object with `input_field` as an enum over the input leaf names, or change
both the validator and the test to a decidable rule, such as requiring each driver string to begin with one of
the enumerated field names.

**12. L173-174 - `v_portfolio_summary(scenario, country)` and `v_hotspot_exposure(hotspot_id)` are written as
parameterised views, which PostgreSQL does not have.**
Views take no arguments. Also, `hotspots` carries both `area` and a nullable `radius_m` (L166), so the
membership predicate must handle both shapes rather than picking one.
*Fix:* make them views grouped by those keys, or SQL set-returning functions, and name `0002_views.sql`
accordingly. The exposure predicate should read
`(h.area IS NOT NULL AND ST_Intersects(c.geom, h.area)) OR (h.radius_m IS NOT NULL AND ST_DWithin(c.geom, h.centroid, h.radius_m))`.
This matters directly for AC-15, whose test asserts the popup figure equals a database sum.

**13. L166 - the generated column is not valid DDL and evaluates to NULL.**
`divergence_flag BOOL GENERATED (...)` is missing `ALWAYS AS (...) STORED`. Worse, `reference_index` is NULL
until `scripts/compute-reference.ts` runs in S18, and `abs(llm_score - NULL) > 25` is NULL rather than false,
so `divergence_flag` is three-valued where the UI table (L289-292) assumes two.
*Fix:* declare it as
`divergence_flag BOOLEAN GENERATED ALWAYS AS (COALESCE(llm_score IS NOT NULL AND reference_index IS NOT NULL AND abs(llm_score - reference_index) > 25, false)) STORED`.

**14. L501-503 - `no-network-on-render.test.ts` cannot catch the likeliest violation.**
It is specified as a static check that no file "imports `fetch`, `axios`, or the Anthropic SDK". `fetch` is a
global in Node 18+ and in Next.js server components; it is never imported, so the single most probable
offline-rule breach is undetectable by the test that AC-11 and the demo-day risk row (L513) both rely on. The
check is also scoped to `app/**`, leaving `components/**` and `lib/**` unguarded, and a data helper in `lib/db`
or a map component is exactly where an outbound call would appear.
*Fix:* scan for call sites and module specifiers (`fetch(`, `axios`, `undici`, `@anthropic-ai/sdk`, `https.`)
across `app`, `components` and `lib`, excluding `app/api/refresh/**`, `app/api/narrative/**` and
`app/actions/rescore-hotspot.ts`.

**15. L326-327 versus S19 (L438) - section 3.7's offline rule no longer lists every outbound call site.**
Section 3.7 states "All outbound calls live in `app/api/refresh/*` and `app/api/narrative/regenerate`". The
13:31 edit replaced the hotspot rescore route with a server action, `app/actions/rescore-hotspot.ts` (L438),
which makes an outbound Anthropic call and is not named in section 3.7. The rule that the offline test enforces
and the rule that section 3.7 states have drifted apart.
*Fix:* add the server action to the section 3.7 sentence, and keep the exclusion list in the static test and
the section 3.7 prose cross-referenced so they cannot drift again.

**16. L92, L509, L596 - the frozen-replay safety net is circular.**
`--source=frozen` is both the default seed path *and* the stated mitigation for Earth Engine access not
arriving in time. But the frozen CSVs can only be produced by a successful live run, so if Earth Engine
approval slips there is nothing to replay, and AC-13's clean-machine criterion has no path to green. The
mitigation presupposes that the risk it mitigates has not occurred.
*Fix:* add `--source=synthetic` on Day 1 morning, deriving physically plausible flood depths from Copernicus
DEM elevation and distance-to-coast, and commit its output immediately as the true floor. `frozen` then becomes
the *preferred* replay and `synthetic` the guaranteed one, which also gives T3's missing Day-1 cut line
something concrete to switch to.

**17. L194-200 - the wind occupancy multiplier breaches the spec band at the lower edge.**
At 33-34 m/s the band value is about 0.0117; the 0.8 RC high-rise multiplier takes it to roughly 0.93%, below
the spec's stated "33-45 m/s 1-3%". The upper clamp is present but there is no lower clamp.
*Fix:* clamp to `[0.01, 0.06]` whenever `v_ms >= 33`, so the occupancy split modulates within the spec band
rather than outside it. This is directly exposed by AC-4's source-and-band assertions.

**18. L102 versus L554, and L104/L347 versus the section 3.1 layout - two referenced artefacts do not exist.**
`npm run verify:dashboard` is used in offline checklist step 6 (L554) but is absent from the `package.json`
script list (L102). `scripts/seed.ts` is referenced by S3 (L347) and by the seed file comment (L104) but does
not appear in the section 3.1 repo layout tree (L96-144).
*Fix:* add `verify:dashboard` to the scripts list and `scripts/seed.ts` to the layout.

---

## 6. Improvement suggestions

1. Move `gen_narratives.py` and `gen_hotspot_scores.py` to TypeScript under `scripts/` so the AC-10 and AC-17
   validators exist exactly once.
2. Move `reference_index` computation out of `build_hotspots.py` into `scripts/compute-reference.ts`, leaving
   `reference-index.test.ts` to test a formula rather than a copy of one.
3. Add a seeded `hazard_applicability` table so the HK/CN restriction on wind and PM2.5 is data, satisfying
   both principle 4 and AC-4 for Jakarta and Kota Kinabalu.
4. Resolve the horizon-probability semantics explicitly in section 3.3, and state what the "today" haircut
   means, rather than justifying the choice with the incorrect AC-2 uniqueness claim in assumption 1.
5. Record the Aqueduct GCM ensemble choice and sea-level percentile in `hazard_samples.dataset_version` so the
   provenance panel can answer "which model" as well as "which dataset".
6. Add a Day-1 gate mirroring L521: if Earth Engine access is not live by Day 1 midday, switch to
   `--source=synthetic` and stop waiting.
7. Set `tool_choice` on the `assign_hotspot_score` call and rewrite the L515 risk row so schema conformance is
   described as advisory rather than binding.
8. Re-confirm with the user whether `reference_index` belongs in the prompt, since the spec's AC-17 guardrail
   enumerates the inputs as a closed list that excludes it.
9. Restore `worst_haircut_2050` and a summed `recent_event_severity_90d` to `HotspotScoreInputs` so
   `reference-index.test.ts` can actually recompute H and V.
10. Restore structured driver objects with `input_field` as an enum, so "drivers name only input fields" is a
    decidable assertion rather than a substring guess over free text.
11. Record `context_factors.subsidence` as a susceptibility probability rather than a rate, since
    Herrera-Garcia 2021 is a susceptibility map and cannot yield cm/yr; the research file flags this explicitly.
12. Name the GHAP asset path `projects/sat-io/open-datasets/GHAP/GHAP_Y1K_PM25` in section 3.5 and note in
    `docs/sources.md` that it is a community-catalog asset, because a board question about reproducibility will
    land there first.
13. Decide T2 deliberately: either demo a live thumbnail in script step 4, or drop the Google Maps Static key
    and make the demo fully zero-network.
14. Add `UNIQUE(loan_application_id, scenario, rule_set_id)` to `recommendations`, matching the constraint
    already present on `valuations`.
15. Drop the unused `environmental_events.scored` column, which is dead and invites the wrong reading given
    that earthquakes are listed but never scored.
16. State whether the case-screen adaptation toggle mutates the active `rule_sets` row or creates a new one,
    since AC-3 and AC-9 both depend on the answer and the demo script toggles it twice.

---

## 7. Final verdict

**SOUND WITH CHANGES.**

The architecture is well chosen and the reasoning behind Option A survives scrutiny. The runtime boundary, the
rule set as data rather than constants, the verbatim `score_inputs` snapshot, and the offline invariant
expressed as a testable code rule are all decisions a stronger team would also make, and the
acceptance-criteria mapping in section 5 is unusually complete for a five-day hackathon plan. The changes the
plan needs are not architectural but factual, and three of them are demo-breaking rather than cosmetic: the
claim that wind and PM2.5 are zero outside Hong Kong and China "by data, not by branch" is contradicted both by
Jakarta's PM2.5 and by the plan's own Kota Kinabalu pins; heat and wind have no samples defined for the today
and 2030 horizons that AC-13 and the scenario slider require; and the 13:31 edit that moved `reference_index`
into the prompt also deleted the two input fields that `reference-index.test.ts` needs, leaving AC-17's
deterministic-reference clause with no test that can pass. Fix those three, correct the Anthropic tool-schema
claim, restore decidable driver validation, break the frozen-replay circularity with a synthetic source, and
collapse the duplicated validators into TypeScript per section 4, and the plan is executable in five days as
written.

The one item that is not the plan's to settle: including the reference index in the scoring prompt departs
from a guardrail the user fixed in the spec on 2026-09-07. That should go back to the user rather than be
resolved in consensus.
