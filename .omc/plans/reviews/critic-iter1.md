# Critic Review — RALPLAN-DR consensus iteration 1

Plan: `C:\Coding\2026_OCBC_OPC\.omc\plans\ocbc-climate-collateral-mvp.md` (status "draft (consensus iteration 1, revised for LLM score)")
Spec: `C:\Coding\2026_OCBC_OPC\.omc\specs\deep-interview-ocbc-climate-collateral.md`
Reviewer: Critic (independent; no Architect review consulted)

## Verdict: REVISE

## Blocking issues

**B1. The reference index cannot be recomputed from `score_inputs`, which breaks a named AC-17 test.**
Section 3.4 step 1 defines `H = p90(valuations.total_haircut)/total_cap`, `E = exposure_sgd / max(exposure_sgd over all hotspots)`, and `V = min(sum(weights[event_type]) / 10, 1)`. The `HotspotScoreInputs` type in step 2 carries none of those three. It carries `hazard_scores_by_type` (per-component p90, not p90 of the total), `exposure_share` (divided by *total book exposure*, a different denominator than E's max-hotspot normaliser), `recent_event_count_90d` and `max_event_severity` (a count and a max, not the weighted sum V needs). Line 492 asserts `reference-index.test.ts` "recomputes from `score_inputs` and matches `reference_index` for every hotspot". As specified, that test cannot pass. **Fix:** store `h_component`, `e_component`, `v_component` (or the raw p90 total haircut, the snapshot max exposure, and the weighted event sum) inside `score_inputs`, and restate the test against those fields.

**B2. The risk manager's landing page contradicts AC-1, and the plan does not flag the conflict.**
Step S3 routes the risk manager to `/ai`. Spec AC-1 requires "risk manager: portfolio dashboard". Spec line 61 requires the AI Dashboard to be the risk manager's landing view. The spec contradicts itself, the plan silently picks one side, and `tests/db/auth.test.ts` is mapped to an AC whose text it will fail. **Fix:** record the conflict in section 8, state that the 2026-09-07 addition supersedes AC-1's parenthetical, and amend the AC text in the spec so the test has an unambiguous target.

**B3. Missing hazard samples produce wrong numbers rather than zeros, defeating principle 4.**
`pm25Haircut(u)` returns `0.02` when `u` is `undefined`, because `undefined < 35` and `undefined <= 50` are both false. `windHaircut` returns `NaN` on `undefined`. Meanwhile the sanity test at line 512 asserts "PM2.5 null outside CN/HK" while principle 4 (line 40) asserts values are *zero* outside HK/CN. Null and zero are not the same, and the code handles neither. **Fix:** decide null-or-zero, state it once, and make every hazard function take an explicit absent case that returns 0 with a test pinning it. This directly threatens AC-4's "wind and PM2.5 are zero for SG, MY, ID pins".

**B4. Offline basemap tiles have no step, no size budget, and no test.**
Assumption 11 says "basemap tiles are bundled locally"; S13 says "a free raster basemap tiled locally". A raster basemap covering SG, MY, ID, CN and HK at a usable zoom range is the single largest deliverable no step allocates time to, and AC-11 and AC-5 both die on stage without it. **Fix:** add a step with an explicit zoom range, bounding boxes, tile count, disk budget, and a checklist item confirming the map renders with the interface disabled.

**B5. Testability is below the 90% bar because UI-clause ACs have no runner.**
Line 487 claims "17 of 17 criteria have a named test", but no component or end-to-end harness appears anywhere. `score-validate.test.ts` is described as asserting "the page renders `reference_index` with the fallback badge" (line 497) with only Vitest available. AC-1's landing pages, AC-5's slider, AC-7's pin click, AC-14's strip render, AC-15's popup, and AC-16's sort order are all asserted at the database layer only. **Fix:** either add Testing Library plus a smoke Playwright spec and name the files, or split each affected AC row into a tested clause and a checklist-verified clause, and drop the 17-of-17 claim.

**B6. The flood formula silently changes shape from the spec, and AC-3 has no fixed expected value.**
The spec's binding line reads `haircut = damage_fraction(depth) x P − adaptation credit`; the plan applies adaptation as a depth reduction *before* the JRC curve. The plan's version is physically better, but it is an undeclared deviation and it makes AC-3's "changes its haircut by the documented amount" curve-dependent rather than a documented constant. `tests/db/adaptation-toggle.test.ts` names no property, no depth, and no expected delta. **Fix:** add this to section 8 as an explicit assumption, and pin one collateral in the Marina Barrage zone with a hand-computed before and after haircut.

## Non-blocking improvements

1. `npm run verify:dashboard` is invoked at offline-checklist step 6 but is absent from the `package.json` script list on line 102; likewise `--check` is used on line 543 but never defined in section 3.5.
2. `scripts/seed.ts`, `scripts/compute-reference.ts`, `tests/fixtures/cases.ts`, `docs/sources.md`, `docs/demo-script.md`, `docs/phase2.md` and `.gitignore` are all referenced in steps but missing from the section 3.1 tree.
3. The spec's non-goal requiring exposure figures to be "labelled illustrative" has no corresponding UI element or step.
4. `valuate()` reads `segment`, which lives on `loan_applications`, while `valuations.max_loan_sgd` is keyed on collateral; a collateral with two applications has no defined max loan.
5. Injecting a fake divergent `llm_score` into the fixtures (checklist step 11) writes false values into the `model` and `scored_at` provenance columns; use a dedicated demo hotspot or a UI preview state instead.
6. The rationale validator rejecting any numeric token not matching `score_inputs` will over-reject natural phrasing like "S$128 million"; allow rounded magnitudes or most scores will silently fall back.
7. Earthquakes carry weight 0.3 in the reference index V term, so a geophysical event moves a number labelled "climate credit risk"; defensible, but say so in `docs/sources.md` before a director finds it.
8. Section 3.3 says constants "live in `rule_sets`, not in code" while line 20 and `lib/rules/bands.ts` say defaults live in code; name one source of truth.
9. `heatHaircut` applies the 5% cap *before* the 1.0/1.25/1.5 multiplier, so heat alone reaches 7.5%; only the chronic cap saves AC-4. Matches the spec's literal wording, but relabel the inner cap.
10. Assumption 2's wind occupancy multiplier of 1.2 pushes a 40 m/s pin to 3.6%, outside the spec's stated 1-3% band for 33-45 m/s.
11. `hazard_samples.hazard` mixes true hazards with modifiers (`suhi_tertile`, `ndvi_tertile`), and PM2.5 has no scenario escalation yet needs three rows under the unique constraint.
12. The band rule for haircuts above 20% or any coastal inundation reads `context_factors.sea_level_inundation`, but no threshold defines when the flag fires, so AC-8's fixtures have nothing to pin.
13. Steps are labelled "S7-S8" and "S9-S10" as pairs, yet the AC table references S7, S8, S9 and S10 individually.
14. The `GENERATED` clause on `hotspots.divergence_flag` needs `ALWAYS AS (...) STORED` to be valid PostgreSQL.
15. The spec's Technical Context flags two Hong Kong figures for re-verification before the pitch; no step does it.
16. Day 1 carries repo, compose, schema, auth, the 200-pin generator, eight Earth Engine datasets and five rasterio downloads; Day 4 carries hotspots, events, tiles, the reference index, the LLM score, the whole AI Dashboard page, three refresh routes and 215 narratives. Both are roughly a day and a half of work.

## Scorecard

| Metric | Value |
|---|---|
| ACs with a concrete test (file, clear assertion, fixed inputs) | 11 of 17, 65% |
| ACs concrete or partially concrete | 14 of 17, 82% |
| Bar | 90%, not met |
| Claims citing a file, section, dataset or formula | ~88% |
| Risks with concrete verifiable mitigation | 12 of 13 |
| Spec violations or omissions | 4 |

Spec violations counted: risk-manager landing route versus AC-1 (B2); undeclared change to the flood formula shape (B6); the "labelled illustrative" requirement omitted; the wind occupancy multiplier breaching the spec's 33-45 m/s band (declared as assumption 2, counted at half weight and rounded up).

Concretely testable ACs: AC-2, AC-4, AC-6, AC-8, AC-10, AC-11 (static import check), AC-12, AC-13, AC-15, AC-16, AC-17.
Partially concrete: AC-5, AC-9, AC-14.
Weak: AC-1, AC-3, AC-7.

## Rationale

The plan is strong on the things that usually sink a hackathon build. Principles genuinely drive the option choice: driver 1 rules out Option B's second deployable and second test harness, driver 2 rules out Option C's PL/pgSQL formula, and both invalidations name the driver rather than gesturing at one. The alternatives are real rather than straw men, the data-prep hybrid earns its complexity with a specific reason per dataset, and the frozen-replay rule is the single best decision in the document. Internal arithmetic checks out: the seed counts sum to 200 across every country and cluster, the worked example reproduces exactly at 6.6%, S$934,000 and S$700,500, the 25-point divergence boundary is pinned on both sides by the 25/24/75/76 fixtures, and the caps are consistent throughout. What blocks approval is a cluster of defects that would surface as red tests rather than as debate. The scoring inputs cannot regenerate the reference index they are tested against, the risk manager's landing route fails the acceptance criterion it is mapped to, absent hazard samples yield a 2% haircut or a NaN instead of the zero the plan promises, the offline basemap that AC-11 depends on has no step or budget, and six criteria rest on user-interface behaviour that no named runner can observe. Each is a bounded edit to the plan rather than a rethink, so a second iteration should clear this.
