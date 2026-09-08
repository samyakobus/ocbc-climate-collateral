# Architect Review: `ocbc-climate-collateral-mvp.md` (RALPLAN-DR consensus, iteration 4)

Reviewer: Architect (read-only). Date: 2026-09-07.
Snapshot: `draft (consensus iteration 4)`, 1227 lines, seven ADRs. No Critic files consulted.

Bar applied, per the team lead's instruction: a finding is a **defect** only if it would break the build, a
test, a fixture number, a demo step, or the five-day schedule. Everything else is an improvement. Four findings
clear that bar. All of them are one-line or one-module fixes.

Every number the team lead named was recomputed rather than read. All of them are correct.

---

## 0. Disposition of my iteration-3 defects 1-9

**8 resolved in full; 1 resolved in substance but with a stale reference left behind, which is defect 1 below.**

| # | Defect | Status | Verification |
|---|---|---|---|
| 1 | `floodHaircut` returned two shapes; `fr.net` would not compile | **Resolved** | `ABSENT_FLOOD = { net: 0, gross: 0, documented: 0, effective: 0 }` (L389), returned on the absent branch (L392), success branch returns the same four keys (L399), and the call site reads `max(fr.net, fc.net)` with no optional chaining (L428). One shape on every path; the comment at L391 names the return type `FloodTerm`. |
| 2 | Payload cardinality wrong in three places | **Resolved** | `HotspotPromptPayload` is declared once as a TypeScript type (L539-547) with **six top-level keys**, and the comment states "SIX top-level keys, which expand to NINE leaves". `HotspotScoreInputs` extends it with the three never-sent fields (L550-554). `prompt-payload.test.ts` asserts set equality at both levels (L557-560, L1012-1014), and the `input_field` enum carries exactly nine values (L573-576). I counted both: six and nine. The plan no longer restates a count anywhere it could drift. |
| 3 | Citation tolerance lost percent rendering | **Resolved** | Percent rule at L599-603 (`x = 100v` adjacent to a percent sign or the word "percent"), magnitude rule at L604-606, exemptions narrowed at L607-610, and the tolerance is explicitly shared with `lib/narrative/validate.ts` (L595-596). Both test files carry `18%`, `18 %`, `18.0%`, `S$128.4m` as accepted and a bare `18` as rejected (L611-612, L994). |
| 4 | Heat baseline differed across the slider | **Resolved** | All three deltas now share one 2016-2035 reference window (L660-663). `today` is the reference, so it is zero **by definition of the metric**; `y2030` is 2021-2040 minus the reference; `y2050` is 2040-2059 minus it. ERA5-Land validates the reference rather than serving as the subtrahend. L440-442 carries the same statement into the formula section and says the provenance panel states the definition. |
| 5 | `damage_class` mapping was a rule in Python | **Resolved in substance, one stale reference** | The fix is right: a seeded `building_damage_class` table (L324), `damageFraction(depth_m, buildingType)` calling `damageClassOf` (L383-384), `collateral` no longer carrying a `damage_class` column (L318), and S5 stating the generator writes `building_type` and **not** `damage_class` (L793-795). But the section 4.6 prep table still lists `damage_class` as a `gen_portfolio.py` output (L670). See defect 1. |
| 6 | `revalue_by_year` scenario-invariant but stored per scenario | **Resolved** | `COUNT(DISTINCT loan_application_id)` and an on-screen scenario-invariant label (L500-505), with the reason for each stated: without the distinct count the figure trebles, without the label it reads as frozen. Demo step 3 says the same (L1108-1110). |
| 7 | Adaptation containment defined twice | **Resolved** | `adaptation_projects` has no `area` polygon (L325), ADR-4 declares the curated foreign key authoritative, S8 seeds the table with no polygons (L813-814), and `adaptation-toggle.test.ts` asserts all three fixture foreign keys directly (L483-486, L971). The plan's own note at L166 is correct: a shoreline polygon drawn the obvious way would have contained all three East Coast fixtures. |
| 8 | z0-z6 floor claimed to cover city scale | **Resolved** | Restated as "Country and regional scale only" with the reason spelled out (L717-718), and rehearsal step 6 tells a tester exercising the fallback what to expect. The **96-tile** figure is correct: I recomputed z0-z6 over the bbox with floor/ceil tile indexing and got exactly 96 (1+2+2+2+6+20+63). My iteration-3 estimate of 80 used a cruder method; the plan's number is the accurate one. |
| 9 | "today" resolved to 2025 in a 2026 demo | **Resolved** | `rule_sets.today_label = '2025 (origination)'` (L328), assumption 8, and demo step 3 states that a revaluation date in the past means overdue, "a finding rather than a clock bug" (L1109-1110). |

**Improvement 11 (a both-shapes hotspot assertion) was superseded, correctly.** The `CHECK ((area IS NULL) <> (radius_m IS NULL))` constraint (L333) makes that row impossible, so AC-15 now asserts the constraint **rejects** it (L983). That is a stronger test than the one I asked for.

---

## 1. Verification of the items named for this review

| Item | Result |
|---|---|
| `floodHaircut` single return shape and call site | **Correct.** One shape on both branches; `max(fr.net, fc.net)` is type-safe. |
| Prompt payload type, six keys / nine leaves, set-equality test | **Correct.** Counted both; the type is the single declaration and the enum is pinned to it. |
| Citation percent and S$ rendering rules | **Correct**, and shared with the narrative validator so one rule governs both. |
| Hotspot `CHECK` constraint and UNION membership view | **Correct.** The constraint makes the two UNION branches mutually exclusive, so the view cannot emit a duplicate pair, and AC-15 proves the constraint rejects a two-shape row. |
| Deleted adaptation polygon, curated FK sole authority | **Correct.** No polygon column exists; three fixture FKs are asserted directly. |
| AC-2 flood-only fixture | **Correct.** 0.30 x 0.22 = 6.6%; 1,000,000 x 0.934 = S$934,000; x 0.75 = S$700,500; unadjusted S$750,000. |
| Realistic Marine Parade fixture at 10.1% | **Correct.** NDVI tertile 1 is not 2, so `t` = SUHI tertile = 1 and the multiplier is 1.25. `min(0.001 x 28, 0.05) x 1.25` = 0.035. Flood 0.066 + chronic 0.035 = **0.101**. Adjusted S$899,000; max loan S$674,250. Band 10-20% is right. |
| AC-3 and the zero-floor fixture | **Correct.** `f(0.80) = 0.30 + (0.30/0.50) x 0.20 = 0.42`; 0.42 x 0.22 = 9.24%; less 1.50 pp = 7.74%. `f(0.20) = 0.12`; 0.12 x 0.22 = 2.64%; floored to 0.00% with effective credit 2.64 pp. |
| Two-archive basemap commands | **Correct in structure.** One `pmtiles extract` invocation takes one region and one maxzoom, so two archives is the right call, `--bbox` and `--region` are the right flags, and MapLibre `maxzoom: 10` / `minzoom: 11` is the right composition. |
| 96-tile floor | **Correct**, verified independently. |
| Region archive z0-z10 | **Correct.** I got 15,216 with tile-index counting; the plan says "approximately 15,200" and openly reports both 15,183 and 15,216 as two recounts differing by 0.2% (L722-723). Honest and right. |
| Single heat reference window | **Correct**, and it dissolves the two-baseline problem properly rather than papering over it. |
| "2025 (origination)" label | **Correct**, carried into the schema, the assumptions and the demo script. |
| Every section-6 test file has an authoring step | **Correct.** I cross-checked all 35 files against section 5; every one has a step, a day and an owner, and S4 now also picks up `no-network-on-render.test.ts` and the `checklist.md` skeleton, which were the last two without one. |

One counted figure does **not** match and is recorded as an improvement rather than a defect, because it
changes nothing: see improvement 1 on the cities archive.

---

## 2. Architectural soundness

**Sound.** ADR-1 through ADR-7 are coherent, each states its alternatives and consequences, and iteration 4
adds no new architecture. The three structural properties that matter are all now enforced rather than asserted:

- **One owner per rule.** ADR-2 for arithmetic and validation, ADR-7 for hotspot containment, and now ADR-4 for
  adaptation containment. The `building_damage_class` table closes the last classification rule that had drifted
  into Python. Principle 5 holds across the whole surface, which was not true two iterations ago.
- **One declaration per shared shape.** `HotspotPromptPayload` as a type with the enum pinned to it, the
  citation tolerance shared between two validators, and the offline exclusion list generated from one constant.
  Each of these was a place where a count or a list had previously drifted between prose and test.
- **One shape per function.** `ABSENT_FLOOD` removes the union return type that would not have compiled.

The fixture design in section 4.3.2 is the strongest new work. Separating "the number the spec asks us to
reproduce" from "the number a real Singapore pin actually carries", and stating openly that the three flood
fixtures pin `flood_haircut` rather than `total_haircut`, is the honest resolution of a genuine tension. Demo
step 4 showing both in sequence is better than either alone.

---

## 3. Antithesis: AC-2 does not need a seeded property at all

The strongest remaining counterargument targets the fixture design that is otherwise this iteration's best work.

`FIX-SG-01` exists because Singapore scores heat, so no real Singapore pin can total exactly 6.6% at 2050. The
plan's answer is a dedicated property with its heat sample **pinned to a zero delta** and a
`dataset_version` of `'fixture: pinned zero delta'` (L476). That is a synthetic row inserted into the hazard
pipeline specifically so one acceptance number comes out round.

The antithesis: **the spec's AC-2 is a formula demonstration, not a portfolio case.** It reads "Worked example
reproduces by hand and in an automated test: appraised S$1,000,000, 0.5 m flood depth in 2050, damage fraction
0.30, horizon probability 0.22, no adaptation → haircut 6.6%". Every input is given as a literal. Nothing in it
requires a database row, a property, an address, or a pin on a map. `tests/unit/worked-example.test.ts` could
call `floodHaircut` with those literals and assert 6.6%, S$934,000 and S$700,500 directly, and AC-2 would be
satisfied more strictly than it is now, because the assertion would be bound to the formula rather than to a
seeded row that a later reseed could perturb.

The cost of the current design is real and it is not only aesthetic:

1. A property whose `address_line` is literally "Fixture property, East Coast" is opened on stage in demo step 4
   (L1111), in front of a board, immediately before the real one. The presenter has to explain why the first
   property is not a property.
2. It introduces a pinned, non-sampled hazard row into a pipeline whose entire claim is that every number is
   sampled and provenanced. AC-12 asserts every rendered number resolves to a row with a dataset name and a
   sampled-at date; this row's dataset is the fixture itself.
3. It creates the 200-versus-201 ambiguity that is defect 4 below.
4. `worked-example.test.ts` is listed as a **unit** test with no database (L265), yet it is now described as
   operating "on the flood-only `FIX-SG-01`" (L969), which is a seeded row.

**Where the antithesis fails.** A director asked "show me where 6.6% comes from" will want a case screen, not a
test file, and the case screen needs a row. AC-2's phrase "reproduces by hand **and** in an automated test"
does suggest something a human can walk through on screen. So the fixture earns its place as a presentation
artefact even if it should not be load-bearing for the test.

---

## 4. Synthesis

Keep `FIX-SG-01` for the case-screen walk, and **cut its load-bearing role in the test**:

1. Make `tests/unit/worked-example.test.ts` a pure function-level assertion against the spec's literal inputs -
   depth 0.50 m, damage 0.30, `P = 0.22`, appraised S$1,000,000 - with no seeded row. It then genuinely runs in
   the no-database unit project, and AC-2's number is bound to the formula, which is the stronger binding.
2. Keep `FIX-SG-01` as a seeded property for demo step 4 and cover it with a **database** test that asserts the
   case screen renders 6.6% and S$934,000.
3. Then state explicitly in S5 whether `FIX-SG-01` is one of the twelve East Coast pins or a 201st property.
   Once the unit test no longer depends on it, either answer is fine, and defect 4 dissolves.

This costs one sentence in S5 and moves one assertion between two test files. It also removes the awkward demo
moment: the presenter can open the real Marine Parade case first, walk the flood line to 6.6%, and use the
fixture only if someone asks to see the flood term in isolation.

---

## 5. Concrete defects

**1. L670 - the prep table still lists `damage_class` as a `gen_portfolio.py` output, contradicting four other
places, and the seed will fail.**
The section 4.6 row reads "collateral incl. `elevation_m`, `dist_to_coast_km`, `damage_class`". But
`collateral` has no `damage_class` column (L318), the six-to-three mapping is the seeded
`building_damage_class` table (L324), `damageFraction` derives the class at call time (L383-384), and S5 says
in bold that the generator writes `building_type` and **not** `damage_class` (L793-795). A builder generating
`db/seed/03_portfolio.sql` from the prep table inserts a column that does not exist and `npm run db:seed`
fails on Day 1.
*Fix:* delete `damage_class` from L670. One word.

**2. L265, L969-970 versus L323-324, L383-384 - the two curve unit tests have no database-free source for the
curves or the class mapping.**
`tests/unit/*.test.ts` is declared "Vitest, node, **no database**" (L265). `tests/unit/worked-example.test.ts`
and `tests/unit/curve-fixtures.test.ts` both evaluate `damageFraction`, which calls `damageClassOf(buildingType)`
against the seeded `building_damage_class` table and `curve(cls)` against seeded `depth_damage_functions`.
Neither is reachable without Postgres. The existing escape hatch does not cover them: `lib/rules/bands.ts` is
scoped in the layout to "band edges, condition strings, revalue-by, today_year" (L271) and in the prose to
rule constants (L376-378). There is no equivalent module for curves or the mapping, so both named unit tests
cannot run in the project they are assigned to.
*Fix:* add `lib/rules/curves.ts` holding the section 4.3.1 curve points and the six-to-three mapping as seed
defaults, consumed by `02_reference.sql` and imported by the unit tests, exactly as `bands.ts` already is.
Add it to the layout at L271 and to S8's deliverables.

**3. L333 versus L336-341 and L681 - `exposure_share` has three inconsistent homes and none of them works as
written.**
The schema says `hotspots` has "no `loan_exposure_sgd` and no `exposure_share` column (ADR-7): **both** are
read from `v_hotspot_exposure`" (L333). But `v_hotspot_exposure` as written returns only
`hotspot_id, loan_exposure_sgd` (L336-341); it computes no share, and it cannot without the book total.
Meanwhile the prep table lists `exposure_share` as something `npm run prep:reference` **writes** (L681), which
implies a column that L333 says does not exist. The only coherent home is inside `score_inputs`, where
`HotspotPromptPayload.exposure_share` does live (L543). As specified, the hotspot popup and
`compute-reference.ts` have no defined place to read or write it.
*Fix:* pick one. Either add the share to the view,
`loan_exposure_sgd / NULLIF(SUM(loan_exposure_sgd) OVER (), 0) AS exposure_share`, and drop it from the
prep-table writes column; or state at L333 that `exposure_share` lives in `score_inputs` and is written by
`prep:reference`, and correct "both are read from `v_hotspot_exposure`" to name only `loan_exposure_sgd`.

**4. L789 and L795-797 versus L988 - `FIX-SG-01` sits outside the cluster table while the pin count is stated
as exact and asserted by a test.**
S5 says "exactly 200 pins" and gives cluster counts that sum to 200 (60 + 40 + 40 + 35 + 25). It then says the
**six** fixture collateral of section 4.3.2 are seeded with their exact ids, including `FIX-SG-01`. Five of the
six follow the cluster id convention and are plainly inside the 200; `FIX-SG-01` does not, and its cluster
"Fixture property, East Coast" appears nowhere in the table. `tests/prep/test_clean_machine.py` asserts the
seed populates **200 pins** (L988). A builder who reads S5 literally seeds 201 and that test fails.
*Fix:* one sentence in S5 saying either that `FIX-SG-01` replaces one of the twelve East Coast pins, leaving
the total at 200, or that it is a 201st fixture property and the test asserts 200 portfolio pins plus one
fixture. The synthesis in section 4 makes the first option cleaner.

---

## 6. Improvement suggestions

1. **Correct the cities archive tile count.** The plan gives 102 at z11 and 408 at z12 for twelve 0.5-degree
   boxes (L713). Those are area-based figures. Counting on actual tile boundaries, a 0.5-degree box spans about
   2.84 tiles at z11 and 5.69 at z12, which aligns to 4 x 4 and 7 x 7, giving roughly 188 and 588 across twelve
   boxes, about 776 rather than 510. The archive total becomes roughly 16,200 tiles and 97 to 243 MB. This
   changes nothing - it is still an order of magnitude inside the 500 MB budget and the 800 MB cap - but the
   plan's credibility rests on numbers a director can recheck, and this is the only one that will not survive
   the recheck.
2. Add `COUNT(DISTINCT loan_application_id)` to the `v_portfolio_summary` description at L376. The ruling is
   stated correctly at L500-505, but section 4.2 is the section a builder implements `0002_views.sql` from, and
   its prose there says only "the count of applications with `revalue_by_year <= 2030`".
3. In demo step 4, open `SG-EC-014` before `FIX-SG-01` so the board sees a real property first and the fixture
   second, as the isolation exhibit rather than the opening figure.
4. State in section 4.6 which `coverage` value `FIX-SG-01`'s pinned heat row carries. It must be `scored` for
   `heatHaircut` to run and return zero, but a row with `coverage = 'scored'` and a fixture dataset version is
   exactly what `provenance-panel.test.ts` will inspect.
5. Note in `docs/sources.md` that `FIX-SG-01` is a demonstration property with a pinned hazard sample, so the
   one row in the database that is not sampled is disclosed rather than discovered.
6. Give the Day-1 network dependencies a single list in S1: the 400 MB Playwright download, both `pmtiles
   extract` runs, and the STORM basin downloads all land on Day 1 before the 12:00 synthetic cut line, and no
   one place enumerates them.

---

## 7. Final verdict

**SOUND WITH CHANGES.**

This iteration closes all nine of my previous defects, and it closes them by fixing causes rather than symptoms:
one shape for `floodHaircut`, one declaration for the payload type, one reference window for heat, one owner for
adaptation containment, one `CHECK` constraint that makes the membership UNION provably duplicate-free. Every
figure I was asked to verify recomputes correctly, including the ones I got wrong myself last round: the
96-tile floor is right and my earlier 80 was not, and the region archive at 15,216 matches the plan's own second
recount, which it reports openly alongside the first. The fixture design in section 4.3.2 is honest about a real
tension between a spec-mandated round number and what a Singapore pin actually carries, and it resolves it by
showing both rather than by hiding one.

The four remaining defects are all small and mechanical, and three of them are single-line edits: a stale
`damage_class` in one prep-table cell that would fail the seed, a missing database-free module for the curves
that leaves two named unit tests unable to run in their assigned project, an `exposure_share` that is
simultaneously declared absent, unreadable and written, and a fixture property that may or may not be the 201st
pin against a test asserting 200. None of them touches the architecture, and none needs a decision from the
user. Fix those four, take the synthesis in section 4 so AC-2's assertion binds to the formula rather than to a
seeded row, and this plan is ready to build.
