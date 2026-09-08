# Critic Review — RALPLAN-DR consensus iteration 2

Plan: `C:\Coding\2026_OCBC_OPC\.omc\plans\ocbc-climate-collateral-mvp.md` (status "draft (consensus iteration 2)", 944 lines)
Spec: `C:\Coding\2026_OCBC_OPC\.omc\specs\deep-interview-ocbc-climate-collateral.md`
Reviewer: Critic (independent; no Architect file read)

## Verdict: REVISE

Iteration 1's six blocking issues are all genuinely resolved, not merely acknowledged. Six new blocking issues arise from the fixes themselves.

## Verification of B1-B6 from iteration 1

| Issue | Status | Evidence |
|---|---|---|
| B1 reference index not recomputable | **Resolved** | Section 4.5 stores `worst_haircut_2050`, `snapshot_max_exposure_sgd` and `recent_event_severity_90d` inside `score_inputs`, and all three feed H, E and V in section 4.4. `promptPayload()` drops only the first two. The named test can now pass. |
| B2 risk-manager landing contradicts AC-1 | **Resolved** | Independently confirmed: spec line 77 now reads "risk manager: AI Dashboard, with the portfolio dashboard one click away", carrying an explicit "Amended 2026-09-07" note. Plan section 1, S3 and `auth.spec.ts` all target the amended text. |
| B3 missing samples give wrong numbers | **Resolved in the engine, broken in the tests** | Every hazard function in section 4.3 opens with an explicit absent case returning `ABSENT = 0`, which fixes the `undefined` coercion and the `NaN`. But the three coverage states are described inconsistently across two named tests (see BL3). |
| B4 offline basemap unscheduled | **Resolved in structure, wrong in the numbers** | Section 4.7 and S8 add bbox, zoom range, disk budget, committed floor and a failure mode. The tile count is wrong by roughly a factor of 18 (see BL5). |
| B5 testability below the bar | **Resolved on paper, unscheduled in the plan** | The AC table now names Playwright and Testing Library files for every UI clause, and the honest accounting replaces the old overclaim. No step builds either harness (see BL4). |
| B6 flood formula deviation, AC-3 unpinned | **Resolved** | ADR-4 reverts to the spec's binding formula. The fixture arithmetic checks out exactly: 0.42 x 0.22 = 0.0924, minus 1.50pp = 0.0774. Delta is exactly 1.50 points, and the deviation from the spec's adaptation bullet is declared in assumption 3. |

## Blocking issues

**BL1. ADR-6's stated derivation of `p_2050 = 0.22` is arithmetically false, on the number the board will challenge hardest.** (lines 193-204)
ADR-6 says a migration comment will record `1 - 0.99^n` for `n = 0, 4, 24` giving `0.000, 0.039, 0.214`, "rounded to `0.00, 0.04, 0.22`". `0.214` does not round to `0.22`. Worse, no single base year produces the plan's three values: a 2026 base gives `0.00, 0.039, 0.214` (so `0.21`), and a 2025 base gives `0.00, 0.049, 0.222` (so `0.05` and `0.22`). The plan has taken `p_2030` from one base year and `p_2050` from another, then labelled the pair a derivation. ADR-6's own driver section concedes that deriving at runtime yields 6.43% and fails AC-2, so the team knows the number is reverse-engineered. Driver 2 is "a director will ask where 6.6% comes from"; this comment hands that director a subtraction that does not work. **Fix:** adopt a 2025 base and publish `p_today = 0.00`, `p_2030 = 0.05`, `p_2050 = 0.22`, which is a true rounding of `1 - 0.99^n` for `n = 0, 5, 25` and matches the spec's own "~22% for 2050". Update the AC-8 fixtures and the 2030 column accordingly.

**BL2. "The today column is uniformly green by construction" is contradicted by the plan's own PM2.5 and wind decisions.** (lines 187, 838, 858)
ADR-5 zeroes the flood term at `today`, and heat at `today` is a zero delta by construction. But section 4.6 writes PM2.5 as `scenario_invariant = true` across all three scenarios, and it samples STORM's **present-climate** edition for `today`. A Hong Kong or Shenzhen pin therefore carries 1-2% PM2.5 plus 1-6% wind at `today`. Chai Wan and Tseung Kwan O sit well above STORM's 33 m/s threshold, so those pins land in the 3-10% amber band today, not green. Offline-rehearsal step 5 asserts the today view is uniformly green and demo-script step 2 opens on that claim; both fail on a Hong Kong pin. **Fix:** restate the claim as "uniformly green across SG, MY and ID, with HK and CN carrying their scenario-invariant chronic and present-climate wind components", and correct rehearsal step 5 and demo step 2. This is a better story anyway: it demonstrates that the applicability model, not a country branch, is what zeroes the other three markets.

**BL3. Two named tests make contradictory assertions about PM2.5 coverage outside China and Hong Kong.** (lines 736, 789, 526)
Section 4.6 says `coverage = 'out_of_basin'` with `value = 0` is written "when `hazard_applicability.scored = false` for that country". `tests/db/applicability.test.ts` accordingly asserts "every SG/MY/ID pin has wind and pm25 `coverage='out_of_basin'`". But the sampling-sanity risk row specifies "PM2.5 **measured** everywhere but `scored = false` outside CN/HK". A row cannot be both `measured` and `out_of_basin`. As written, `applicability.test.ts` and `test_sampling_sanity.py` cannot both pass. **Fix:** decide whether applicability is enforced at sampling time (overwrite to `out_of_basin`) or at scoring time (keep `measured`, and let the engine consult `hazard_applicability`). The second is better, because it preserves the real Jakarta GHAP value for the context panel and keeps the applicability rule in exactly one place. Then correct whichever of the two test descriptions no longer matches.

**BL4. Eleven of the seventeen criteria now depend on two test harnesses that no implementation step builds.** (section 5, S1-S28)
B5's fix introduced `tests/component/*.test.tsx` (Vitest plus Testing Library on jsdom) and `tests/e2e/*.spec.ts` (Playwright against the running compose stack): thirteen new files across six Playwright specs and four component tests. `package.json` lists `test:component` and `test:e2e`, and section 4.1 lists both directories, but no step in Days 1 to 5 authors `playwright.config.ts`, the browser install, the compose-stack fixture, the jsdom environment split, or the Vitest workspace that lets `npx vitest run` span three environments and a live database in one invocation. S26 on Day 5 says only "full test suite green", which presumes the harnesses exist. Six criteria (AC-1, AC-5, AC-7, AC-9, AC-11, AC-14) have no automated coverage at all without them. **Fix:** add a step with an owner and a slot on Day 1 or Day 2 for the Playwright and component harnesses, and name the Vitest workspace config in section 4.1.

**BL5. The basemap tile count is wrong by roughly eighteen times, which is the number B4's fix rested on.** (line 547)
Section 4.7 states "approx. 13,000 tiles in the archive" for z0-z12 over 95E-125E, 11S-33N. That bbox is 8.33% of the world in longitude and 12.80% in Web Mercator latitude, so z12 alone holds about 178,900 tiles and z0-z12 about 238,500. The quoted 13,000 is close to the z0-**z10** count (about 14,900), so the figure appears to have been computed for the wrong zoom ceiling. The 500 MB budget and 800 MB cap survive independently, since a Protomaps extract at roughly 1% of planet area sits in that range, but the stated derivation does not support them. **Fix:** correct the count to approximately 240,000 tiles for z0-z12, and either confirm the disk budget against a real `pmtiles extract` run or state it as a cap to be measured on Day 1.

**BL6. AC-2 and AC-3 both depend on JRC curve points the plan never publishes, and the two numbers constrain each other.** (lines 391-397, S7)
AC-2 fixes damage 0.30 at 0.50 m and AC-3 fixes damage 0.42 at 0.80 m. Under linear interpolation those two are only mutually consistent if the seeded Asia curve passes through roughly (0.5, 0.30) and (1.0, 0.50); a curve reaching 0.55 at 1.0 m yields 0.45 at 0.80 m and breaks the 7.74% fixture. The published Huizinga Asia residential curve is near 0.32 at 0.5 m, not 0.30, so the seeded table is a curated approximation and not a direct transcription. `db/seed/02_reference.sql` is named but its contents are not. **Fix:** publish the three or four depth-damage points the fixtures rely on in section 4.3, state whether they are the published JRC values or a curated fit, and label them on the case screen the way the adaptation credits are labelled.

## Non-blocking improvements

1. "Each day has a stated cut line, including Day 1" (line 584) and "Every day has a stated cut line" (line 799) are both false: Days 3 and 5 have none.
2. Section 6 announces "AC-17's four clauses" and the AC table row says "Four files", then five bullets and five files follow.
3. `prompt-payload.test.ts` asserts the projection never emits `reference_index`, but `reference_index` is not a field of `HotspotScoreInputs`, so that third assertion is vacuous.
4. `out_of_basin` conflates a policy exclusion with a raster-coverage fact; the two carry different provenance and a director may ask which one applies. Rename to `not_applicable` and let `hazard_applicability.reason` carry the distinction.
5. Exempting "the numbers 1-100 appearing as a band label" from citation checking swallows most of the inputs, since `exposure_share`, `recent_event_count_90d`, `max_event_severity` and `days_since_last_event` all fall in that range; define what makes a token a band label.
6. Under BL3's better resolution, GHAP's real Jakarta reading of 35-45 micrograms per cubic metre stays available for the context panel instead of being overwritten with zero.
7. AC-6's "count needing revaluation before 2030" will be near zero under ADR-5, because `p_2030 = 0.04` caps the 2030 flood haircut at 4% and only wind-heavy HK and CN pins can cross 10%; state the expected count so the tile does not read as broken on stage.
8. `tests/fixtures/hotspots.ts` appears in the layout but no step authors it and no test references it.
9. No risk row covers the Protomaps tooling: `npm run prep:basemap` needs the pmtiles CLI plus either a planet extract or the hosted build service, neither of which is named.
10. ADR-3 predicts frequent divergence and prescribes "tighten the rubric", but that lands on Day 4 evening with no time box; give it one or accept the observed rate.
11. `return_period` is read-only and display-only, yet it is the parameter that would justify `1 - 0.99^n`; label it descriptive so the editor does not imply it drives P.
12. `hazard_applicability` is keyed on five hazard values including both flood variants; confirm all 25 rows are seeded, since section 4.2 describes the seeds in prose only.
13. Demo step 4 opens a Sentosa Cove case to reach the S$934,000 worked example, but that example is a unit fixture at S$1,000,000; name the actual seeded collateral that renders those figures on screen.
14. S6 runs Earth Engine sampling in the background but gates S12's recompute and S13's provenance panel; make that dependency explicit alongside the Day-1 cut line.
15. AC-13's second-physical-machine clause has no owner and no day.
16. Iteration 1's non-blocking point about `npm run verify:dashboard` is fixed, but the checklist now calls it at step 7 while `scripts/verify-dashboard.ts` is authored in S16 on Day 3; that ordering is fine, just worth confirming it runs without the Playwright stack.

## Scorecard

| Metric | Value |
|---|---|
| ACs with a concrete automated test as written | 17 of 17, 100% |
| ACs whose coverage is also **scheduled** by a step | 7 of 17, 41% |
| ACs with no automated coverage until BL4 is fixed | 6 of 17 (AC-1, 5, 7, 9, 11, 14) |
| Claims citing a file, section, ADR, dataset or formula | ~93% |
| Risks with concrete verifiable mitigation | 14 of 15 |
| Spec violations | 1, declared (ADR-4's adaptation form) |
| Undeclared spec violations | 0 |
| Iteration 1 blocking issues genuinely resolved | 6 of 6 |

Fully covered by already-scheduled harnesses: AC-2, AC-6, AC-8, AC-10, AC-12, AC-13, AC-17.
Partially covered: AC-3, AC-4, AC-15, AC-16.
Entirely dependent on unscheduled harnesses: AC-1, AC-5, AC-7, AC-9, AC-11, AC-14.

The single risk without a fully concrete mitigation is "five days is not enough", whose mitigation cites cut lines on every day when two days have none.

## Rationale

This is a substantially better plan than iteration 1, and the improvement is real rather than cosmetic. Every one of my six blocking issues was fixed at the root rather than papered over: the reference index is now recomputable because the three terms it needs are stored, the spec was actually amended rather than the conflict being argued away, the hazard functions carry explicit absent cases backed by a three-state coverage model, and ADR-4 reverts to the spec's binding formula with a fixture whose arithmetic I verified to the point. ADR-2 is the strongest single addition, because moving the language boundary from lifecycle to capability removes three duplicated rule implementations that no test could have policed. ADR-3's reversal is also correct: an anchored model cannot express deliberate departure, so the badge would have measured nothing. The candour in ADR-5, withdrawing iteration 1's false claim about the only reading that reproduces AC-2, is the kind of thing that makes the rest of the document trustworthy. What blocks approval is that three of the six fixes introduced defects of their own, and they are the same class of defect as before: a number that does not survive arithmetic. ADR-6 labels 0.22 a rounding of 0.214, the basemap table reports a z10 tile count under a z12 heading, and the "uniformly green today" line the demo opens on is falsified by the plan's own decision to sample present-climate wind and scenario-invariant PM2.5. Alongside those, two named tests now contradict each other on PM2.5 coverage, the fixtures rest on an unpublished curve, and the harnesses that lifted testability to 100% have no step, no owner and no hour. Each fix is small and local, and none requires rethinking an architecture decision, so a third iteration should close this out.
