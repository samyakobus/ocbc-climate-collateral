# Critic Review — RALPLAN-DR consensus iteration 5 (final pass)

Plan: `C:\Coding\2026_OCBC_OPC\.omc\plans\ocbc-climate-collateral-mvp.md` (status "consensus candidate (iteration 5) - pending approval")
Spec: `.omc/specs/deep-interview-ocbc-climate-collateral.md`
Reviewer: Critic (independent; no Architect file read). Strict bar: block only on something that would break the build, a test, a fixture number, a demo step, the spec, or the five-day schedule.

## Verdict: APPROVED

Nothing meets the blocking bar. Both iteration-4 blockers and all eight non-blocking items are resolved, and every figure I recomputed landed.

## Verification of iteration-4 items

| Item | Status | Independent verification |
|---|---|---|
| **BL11** fixture ids cannot exist in their clusters; the 201st pin undefined | **Resolved** | The identifier scheme is now stated once as a per-cluster running index from 001, so the highest index equals the cluster count. The three East Coast fixtures renumber to 001, 002 and 003, all within twelve; Marina South's fixtures at 002 and 003 are within ten; Kallang's at 003 is within eight. The S5 table shows each affected cluster as `total = fixtures + generated`, and I checked the arithmetic: 10 = 2 + 8, 12 = 3 + 9, 8 = 1 + 7, Singapore still 60, every country unchanged, total exactly 200. `test_clean_machine.py` now asserts "exactly 200 pins, the six fixtures among them". |
| **BL12** fixture hazard samples not pinned | **Resolved** | `db/seed/04_samples.sql` pins the full sample rows for all six fixtures with `dataset_version = 'fixture: pinned'`, reapplied after sampling under synthetic, frozen and live alike. `tests/db/fixture-pinning.test.ts` is authored in S7 and asserts depths, heat deltas, coverage states and the two Marina South elevations against `tests/fixtures/cases.ts`. The pinned heat row is explicitly `coverage = 'scored'` with value zero, so `heatHaircut` runs and returns 0 rather than being skipped, which is the detail that makes the provenance panel consistent. |
| 1 stale `damage_class` prep cell | **Resolved** | The cell reads `building_type` and states in place that the six-to-three classification is a rule. |
| 2 one flood peril stored, two computed | **Resolved** | `valuations.winning_peril` is added and the prose states the stored flood columns come from the peril that wins the maximum, with the note that AC-3's delta is unaffected. |
| 3 `reference-index.test.ts` also needs `total_cap` | **Resolved** | Stated as "`score_inputs` plus one constant, `rules.total_cap`, which it reads from the active rule set". |
| 4 2030 heat window overlap | **Resolved** | Recorded in S31 as fifteen of twenty years, reinforcing the 2030 column's stated weakness. |
| 5 `v_portfolio_summary` returns three of four | **Resolved** | Stated, with the top-10 named as a separate ordered query in `lib/db/queries.ts` and recomputed by `dashboard-sums.test.ts`. |
| 6 "today" prose against the on-screen label | **Resolved in the two places that matter** | Rehearsal step 5 and demo step 2 both read "2025 (origination)". |
| 7 two MapLibre sources collide | **Resolved** | S9 names an explicit `protomaps-themes-base` source per archive rather than relying on the default. |
| 8 Marina South elevations unpinned | **Resolved** | Folded into the BL12 fix, which covers all six fixtures. |

## Additional verification requested

- **Pure-formula AC-2 plus stored-row test.** Both exist and are separately scheduled. `tests/unit/worked-example.test.ts` asserts the spec's literal inputs with no database in S10; `tests/db/worked-example-row.test.ts` asserts `SG-EC-001`'s stored valuation equals that result in S15. Binding the criterion to the formula first and the row second is the stronger ordering.
- **Curves module.** `lib/rules/curves.ts` holds the 4.3.1 points and the six-to-three map as seed defaults, `02_reference.sql` is generated from it, and the three affected unit tests import it, so they run in the no-database project they are assigned to. This is the same pattern `bands.ts` already used.
- **`exposure_share` in one home.** No column on `hotspots`; the view computes it with a window function guarded by `NULLIF`; `prep:reference` snapshots it into `score_inputs` and writes no column. One writer.
- **Seven ADRs, six fields each.** All seven carry Decision, Drivers, Alternatives considered, Why chosen, Consequences and Follow-ups. ADR-2, ADR-3, ADR-4 and ADR-5 add a named extra subsection; none omits a canonical field.
- **Test authoring.** All 40 named test artefacts have an authoring step with a day and an owner, including the two new files.
- **Arithmetic.** Both AC-2 fixtures reproduce exactly (6.6%, S$934,000, S$700,500; heat 3.5%, total 10.1%, S$899,000, S$674,250), as do the AC-3 delta of 1.50 points and the zero-floor case at 2.64% effective. The recounted cities archive checks out: a 0.5-degree box spans 2.844 tiles at z11 and 5.689 at z12, aligning to 4x4 and 7x7, giving 192 and 588 across twelve boxes, plus 35 below z11, for 815; with the region archive that is 16,015 tiles and 96-240 MB. The upward correction from the earlier area-based 510 is right, and saying so in the table is the correct handling.

## Non-blocking improvements

1. **The `exposure_share` caveat in S31 is now inverted by the iteration-5 view change.** The note says shares "do not sum to one" because a collateral inside two hotspots counts in both. Under the new window-function definition, each share is exposure divided by the sum of all hotspot exposures, so they sum to exactly 1.0 by construction; I confirmed this. The real caveat is the opposite and still worth stating: because double-counted collateral inflates the denominator, each share understates that hotspot's fraction of the actual book, and the hotspot exposures sum to more than the portfolio total. Restate it that way before a director does the addition.
2. `winning_peril` has no defined value where both flood samples are `absent` or both nets are zero, which is most pins at the 2025 scenario. Mark it nullable, or say it defaults to the riverine row.
3. The inundation boundary pins the two Marina South elevations but not the AR6 regional SLR value they are compared against, so a source-mode change could in principle move the threshold and put both pins on the same side, breaking AC-8's two fixtures. The published projection will not move materially, but pinning the `sea_level_inundation` context row alongside the elevations closes the last asymmetric comparison for one line.
4. ADR-5's consequences paragraph and assumption 3 still say "amber at today" where the UI now reads "2025 (origination)"; the scenario key is legitimately `today`, but these two read as prose about the screen.
5. `SG-EC-001` is addressed at East Coast Parkway, which is an expressway rather than a residential address. It answers the "fixture property" objection only partly; a Katong or Amber Road address would carry the same cluster and read as a real mortgage.
6. Demo step 4 opens `SG-EC-001` second as the isolation exhibit, and its provenance panel will show `dataset_version = 'fixture: pinned'` on the heat row. The presenter should say "pinned" before a director reads it, in the same breath as the 6.6%.
7. Day 1 now carries S1 through S9, including two `pmtiles extract` runs against a remote planet archive, a 400 MB Chromium download, the STORM basin downloads and Earth Engine registration. The consolidated Day-1 network dependency list is the right instrument, and the 12:00 cut line plus the committed z0-z6 floor bound the downside, but this is the day most likely to slip.

## Scorecard

| Metric | Value |
|---|---|
| ACs with a concrete automated test as written | 17 of 17, 100% |
| ACs with an authoring step carrying a day and an owner | 17 of 17, 100% |
| Named test artefacts with an authoring step | 40 of 40 |
| Claims citing a file, section, ADR, dataset or formula | ~96% |
| Risks with concrete verifiable mitigation | 17 of 17 |
| Cut lines present | 5 of 5 days |
| ADRs with all six canonical fields | 7 of 7 |
| Spec violations | 2, both declared (ADR-4's credit form; the curated depth-damage fit) |
| Undeclared spec violations | 0 |
| Iteration-4 blocking issues resolved | 2 of 2 |
| Iteration-4 non-blocking items resolved | 8 of 8 |

## Rationale

This is a plan I would hand to three engineers on a Monday. Across five iterations the arithmetic went from wrong in three places to reproducing to the cent on every figure I could check independently, and iteration 5 adds no new numeric claim that fails. The two fixes that closed my last blockers are both structural rather than cosmetic: making the six fixtures members of their clusters preserves every published count instead of carving out an exception, and reapplying the pinned sample rows after sampling under all three source modes ties the number walked on stage to the number under test, which is the single failure this plan has spent four iterations designing itself out of. Splitting AC-2 into a pure formula assertion and a stored-row assertion is better than what I asked for, because it binds the criterion to the spec's literal inputs first and to a database row second, so neither can drift without a test noticing. Two smaller decisions deserve mention because they show the plan correcting itself rather than defending itself: the cities archive was recounted upward from 510 to 815 tiles on tile boundaries with the superseded estimate named, and `lib/rules/curves.ts` was extracted for the honest reason that two unit tests could not otherwise run in the project they were assigned to. What remains is seven items that change no number and break nothing. The sharpest is a documentation note that the new exposure view has quietly inverted: shares now sum to exactly one, and the caveat worth telling a director is that the hotspot exposures sum to more than the book. Fix that line, decide the nullability of `winning_peril`, and pin the sea-level row beside the elevations it is compared against, and the residual list is cosmetic. The five-day schedule is tight and Day 1 is the crowded one, but every day carries a cut line, every fallback is committed, and the triage order is written down. Approved.
