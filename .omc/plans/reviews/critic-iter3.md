# Critic Review — RALPLAN-DR consensus iteration 3

Plan: `C:\Coding\2026_OCBC_OPC\.omc\plans\ocbc-climate-collateral-mvp.md` (status "draft (consensus iteration 3)", 1102 lines, seven ADRs)
Spec: `C:\Coding\2026_OCBC_OPC\.omc\specs\deep-interview-ocbc-climate-collateral.md`
Reviewer: Critic (independent; no Architect file read)

## Verdict: REVISE

All six iteration-2 blocking issues are resolved and independently verified by recomputation. Four new blocking issues remain, three of which are one-line fixes.

## Verification of BL1-BL6

| Issue | Status | Independent verification |
|---|---|---|
| BL1 `p_2050` derivation arithmetically false | **Resolved** | `1 - 0.99^n` at base 2025 gives exactly 0.000000, 0.049010, 0.222179 for n = 0, 5, 25. Those round truthfully to 0.00, 0.05, 0.22, and 0.22 reproduces AC-2's 6.6% exactly. ADR-6 publishes the comment verbatim and ADR-5 records the two withdrawn readings. The derivation now survives a director's subtraction. |
| BL2 "today uniformly green" contradicted | **Resolved** | ADR-5 replaces the claim with a precise consequence: only the flood term carries P, so Hong Kong and coastal China are amber at today while the other three markets are green. The claim is withdrawn from the ADR, assumption 3, rehearsal step 5 and demo step 2, and the new version is turned into a selling point for the applicability model. |
| BL3 two tests contradict on PM2.5 coverage | **Resolved** | The enum is now `scored` / `measured_not_scored` / `absent`, and all four places agree: the schema, the `contributes()` guard, the section 4.6 table, the sampling-sanity risk row, and the AC-4 test all say Jakarta stores its measured 41 and contributes zero. Preserving the real value is a better answer than the earlier zero-overwrite. |
| BL4 eleven criteria on unbuilt harnesses | **Resolved** | S4 on Day 1 authors `vitest.workspace.ts`, `playwright.config.ts` and the Chromium install. I checked all 38 named test artefacts: 37 carry an authoring step with a day and an owner. Only `tests/offline/checklist.md` has none, and it is not an automated test. |
| BL5 basemap tile count wrong by eighteen times | **Resolved** | Recomputed from tile indices over 95E-125E, 11S-33N: z10 alone is **11,352**, matching the plan exactly; z0-z10 is 15,216 against the claimed 15,183, a 0.2% difference from edge handling; z0-z12 is 240,527 against the claimed 239,706. The cluster-overlay figures also check out by Mercator area, about 99 tiles at z11 and 394 at z12 against the claimed 102 and 408. |
| BL6 JRC curve points never published | **Resolved** | Section 4.3.1 publishes three curves. I verified the interpolation: f(0.20) = 0.1200, f(0.50) = 0.3000, f(0.80) = 0.4200, and the 2030 amber edge at damage 0.60 falls at 1.4167 m, matching ADR-5's "roughly 1.4 m". All three flood fixtures reproduce: 6.6%, 9.24% and 7.74%, and 2.64% gross flooring to 0.00% net. |

## Blocking issues

**BL7. AC-2's worked example is bound to a real Singapore collateral whose 2050 heat haircut is not zero, so the number on stage will not be 6.6%.** (lines 443, 994)
Iteration 3 pins AC-2 to `SG-EC-014`, Marine Parade Road, and demo step 4 walks that case screen "to S$934,000". The fixture's stated inputs are depth, damage, P, no adaptation, and "wind and PM2.5 not scored in SG". Heat is not mentioned, yet `hazard_applicability` scores `heat_days35` as **yes for Singapore** (line 589), and heat is zero only at today, by the zero-delta construction. At 2050 the NEX-GDDP delta for Singapore is the entire reason the heat hazard exists, so any positive delta adds up to 5% of chronic on top of the 6.6% flood term. The unit test still passes, because it is a node test that supplies its own samples, but the case screen and the provenance panel will show a larger total, and the demo's centrepiece breaks in front of the board. The same ambiguity affects `SG-KB-003` and `SG-EC-041`: their expected values of 7.74%, 9.24% and 0.00% are labelled "haircut" without saying whether that is the flood component or the total. **Fix:** state in section 4.3.2 that the three flood fixtures pin `valuations.flood_haircut`, not `total_haircut`, and give `SG-EC-014` its expected total including heat as a second row. Then correct demo step 4 to walk the flood line to 6.6% and name the heat line separately. AC-3's 1.50-point delta is unaffected either way, since heat cancels in a subtraction.

**BL8. `v_hotspot_membership` can emit duplicate rows, and `v_hotspot_exposure` sums over them, so a hotspot carrying both a polygon and a radius double-counts its exposure.** (lines 324-336)
The membership view joins on `ST_Intersects(c.geom, h.area) OR ST_DWithin(c.geom, h.centroid, h.radius_m)` with no `DISTINCT`, and `hotspots` declares both `area` and `radius_m NULL` with nothing forbidding both being set. A collateral satisfying both predicates yields two membership rows, and the exposure view's `SUM(la.requested_amount)` counts its loan twice. AC-15's test compares the popup to the view and `score_inputs` to the view, so all three read the same wrong number and the test passes. This is the exact class of silent-wrong-number defect ADR-7 was written to eliminate, surviving inside ADR-7's own view. **Fix:** write the membership view as `SELECT DISTINCT`, and add a table constraint `CHECK ((area IS NULL) <> (radius_m IS NULL))` so a hotspot carries exactly one shape.

**BL9. `promptPayload()` emits six top-level keys, not the eight the plan asserts three times, so the named test cannot be written as specified.** (lines 492, 504, 890)
The "sent to the model" block lists `hazard_scores_by_type`, `exposure_sgd`, `exposure_share`, `recent_event_count_90d`, `recent_event_severity_90d` and `days_since_last_event`. That is six keys. Line 526 separately and correctly counts **nine** prompt-visible leaves, matching the nine-value `input_field` enum, because `hazard_scores_by_type` expands into flood, wind, heat and pm25. Neither count is eight. `tests/unit/prompt-payload.test.ts` is specified as asserting "the emitted key set equals the eight-field allowlist", which names a cardinality that does not exist. **Fix:** say six top-level keys expanding to nine leaves, and state which of the two the equality assertion is over. On the substance the payload is correct: it matches the spec's closed list term for term, and `max_event_severity`, `worst_haircut_2050`, `snapshot_max_exposure_sgd` and `reference_index` are all properly withheld.

**BL10. S9 cannot be executed as written, because one `pmtiles extract` invocation cannot produce a single archive with z0-z10 over the region plus z11-z12 over twelve separate boxes.** (lines 280, 625, 630, 732)
`pmtiles extract` takes one bounding box and one maximum zoom and writes one archive. The plan describes a single file, `asia-z0-z10.pmtiles`, containing both the regional extract and a thirteen-box cluster overlay, and says `scripts/fetch-basemap.ts` "shells out to it" in the singular. Thirteen extracts produce thirteen archives, and go-pmtiles offers no documented merge across differing bounding boxes. **Fix:** drop the overlay. The plan already records that MapLibre overzooms vector tiles past the archive maximum (line 629), so a single z0-z10 extract renders usably at address scale, and the disk budget falls to the low end of the stated 94-236 MB range. If the overlay is kept instead, name the merge tool and add it to the Dockerfile beside go-pmtiles.

## Non-blocking improvements

1. `hotspots.exposure_share` survives as a stored column while `loan_exposure_sgd` was dropped, and the same value is also snapshotted inside `score_inputs`; either drop the column or add it to AC-15's three-way reconciliation.
2. `absent` and `measured_not_scored` are not disjoint for a point that is both uncovered and unscored, such as wind over Singapore where STORM has no basin; state that `absent` takes precedence when there is no value to store.
3. `tests/offline/checklist.md` is run by S29 but authored by no step; it is the only named test artefact of 38 without one.
4. `tests/unit/no-network-on-render.test.ts` is a pure static scan needing no harness and no application code, yet it is scheduled on Day 5 in S26 alongside everything else; moving it to Day 1 beside S4 makes it a guard rail during construction rather than an audit afterwards.
5. Day 5 carries six steps: authoring two test files, a visual pass, three suite runs, a twice-run rehearsal, a second-laptop clean-machine run, and full source documentation including re-verifying two research figures. The Day-5 cut line sacrifices only the visual pass, which is the cheapest item on the list.
6. The committed floor is stated as 80 tiles for z0-z6; recomputing from tile indices over the same bbox gives 96. Immaterial at roughly 1 MB, but it is the one basemap figure that did not reconcile.
7. AC-1's `auth.spec.ts` is authored in S18 on Day 3 while AC-1 ships in S3 on Day 1, leaving the login flow unasserted for two days.
8. The S17 estimate of 10 to 35 cases needing revaluation before 2030 is a guess; the plan handles this well by printing the exact figure and recording it, but Hong Kong's annual PM2.5 sits near 20 micrograms, below the 35 threshold, so the chronic term there is mostly heat and the count may land at the low end.
9. `score_inputs` snapshots exposure at prep time while `v_hotspot_exposure` is live; if a loan amount changes after `prep:reference`, AC-15's equality between the two breaks. Note that `prep:reference` must be rerun after any portfolio change.
10. The AC-2 fixture row does not name `SG-EC-014`'s SUHI and NDVI tertiles, which BL7's fix will need in order to state the expected heat line.
11. Twelve overlay boxes are named against 27 seeded clusters; grouping by metro gives about 13, so the count is right but the derivation is not shown.
12. ADR-2's declared exemption for `prep/lib/synthetic.py` is well argued, but the synthetic model is what every acceptance test runs against when Earth Engine is unavailable, so its outputs deserve a sanity assertion of their own rather than only a review diff.

## Scorecard

| Metric | Value |
|---|---|
| ACs with a concrete automated test as written | 17 of 17, 100% |
| ACs with an authoring step carrying a day and an owner | 17 of 17, 100% |
| Named test artefacts with an authoring step | 37 of 38 |
| Claims citing a file, section, ADR, dataset or formula | ~95% |
| Risks with concrete verifiable mitigation | 17 of 17 |
| Cut lines present | 5 of 5 days |
| Spec violations | 2, both declared (ADR-4's credit form; the curated depth-damage fit) |
| Undeclared spec violations | 0 |
| Iteration-2 blocking issues resolved | 6 of 6 |

Numbers I recomputed and confirmed: the three horizon probabilities; the z10, z0-z10, z0-z12 and overlay tile counts; all three flood fixtures including the zero-floor case; the 2030 amber-edge depth; and the 11% Hong Kong today ceiling behind `revalue_by_year = 2025`.

## Rationale

This iteration closes every issue I raised and does so at the root. The horizon probabilities are now a true rounding of one formula at one base year, which I checked to six decimal places, and ADR-5 has the discipline to record both withdrawn readings rather than quietly replacing them. The "uniformly green today" claim was not merely deleted but converted into the sharper and more defensible statement that only the flood term carries P, which turns a defect into the demonstration that applicability lives in data. The coverage model is genuinely better than what I asked for: preserving Jakarta's measured 41 micrograms alongside a zero contribution answers a director's question in a way that overwriting to zero never could. The published curves reconcile to all three fixtures exactly, the tile counts reconcile to within 0.2%, and S4 schedules on Day 1 the harnesses that eleven criteria depend on, which lifts scheduled coverage from 7 of 17 to a figure I verified file by file. ADR-7 is a real addition rather than a response to anything I wrote, and collapsing hotspot containment onto one view with one writer is the right instinct. What holds this back is narrower than before and three of the four items are single-line corrections: a key count that appears as eight where six and nine are the real numbers, a membership view that needs `DISTINCT` and a shape constraint before it can silently double an exposure figure the board will read aloud, and a basemap step that describes one archive where the named tool produces thirteen. The fourth matters more. Binding the worked example to a real Singapore pin was the right move for the demo, but Singapore scores heat, heat is non-zero at 2050, and nothing in the fixture says whether 6.6% is the flood line or the total. That is the one number the whole plan is organised around, and it should be unambiguous before anyone writes the test.
