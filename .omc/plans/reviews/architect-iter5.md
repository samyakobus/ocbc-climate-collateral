# Architect Review: `ocbc-climate-collateral-mvp.md` (RALPLAN-DR consensus, iteration 5, final)

Reviewer: Architect (read-only). Date: 2026-09-07.
Snapshot: `consensus candidate (iteration 5) - pending approval`, 1294 lines, seven ADRs. No Critic files read.

Bar applied: a finding is a **defect** only if it would break the build, a test, a fixture number, a demo step,
the spec, or the five-day schedule. **Nothing clears that bar.** Residual nits are listed as non-blocking.

---

## 0. Disposition of my iteration-4 defects D1-D4, and the synthesis

**4 of 4 resolved. The section-4 synthesis was taken in full.**

| # | Defect | Status | Verification |
|---|---|---|---|
| D1 | Stale `damage_class` in the prep table would fail the seed | **Resolved** | L712 now reads `building_type`, `elevation_m`, `dist_to_coast_km` and states in place "**Not `damage_class`**: the six-to-three classification is a rule and lives in `lib/rules/curves.ts` and the seeded `building_damage_class` table". Consistent with L318, L401 and S5. No occurrence of `damage_class` as a generator output remains. |
| D2 | Two curve unit tests had no database-free source | **Resolved** | `lib/rules/curves.ts` is in the layout (L272), in the one-source-of-truth prose (L391-395), at the call site (L401: "`lib/rules/curves.ts` at test time, seeded table at runtime"), and in S8 as the artefact `02_reference.sql` is generated from (L863). S10 names **all three** affected tests reading it: `worked-example`, `caps-and-zeros`, `curve-fixtures` (L889-891). L392-395 states plainly why the module exists. |
| D3 | `exposure_share` declared absent, unreadable and written | **Resolved, one home, one writer** | `v_hotspot_exposure` computes it with a window function over a grouped subquery (L361-370), which is the correct shape since a window function cannot sit beside `GROUP BY` aggregates at the same level, and `NULLIF(..., 0)` guards the divide. The schema says the view is the home (L334) and the prep table says `prep:reference` snapshots it into `score_inputs` and "writes no exposure column, because none exists" (L723). |
| D4 | The 201st pin | **Resolved** | Fixtures are members of their clusters, not additions (L497-499). Arithmetic checked below. |

**Synthesis taken.** `tests/unit/worked-example.test.ts` is now a pure formula assertion on the spec's literal
inputs with no database (L518-521, L889-890, L1029), and `tests/db/worked-example-row.test.ts` separately
asserts `SG-EC-001`'s stored valuation equals that result, so formula and case screen cannot drift. The
antithesis's sharpest point is answered twice: the demonstration property now carries a real East Coast Parkway
address inside its cluster, and demo step 4 opens the realistic Marine Parade case **first** (L1173-1178).

---

## 1. Verification of the items named for this review

| Item | Result |
|---|---|
| Per-cluster identifier scheme | **Correct.** `<CC>-<CLUSTER>-<NNN>`, per-cluster running index from 001, highest index equals the cluster's pin count (L491-494). |
| Six fixtures are members of the 200 | **Correct.** Marina South 10 = 2 + 8; East Coast 12 = 3 + 9; Kallang 8 = 1 + 7. Fixtures total 2 + 3 + 1 = 6. |
| Country sums still 200 | **Correct.** SG 10+12+8+6+8+6+10 = 60; MY 40; ID 40; CN 35; HK 25. Total **200**. `test_clean_machine.py` still asserts exactly 200. |
| No stale fixture ids | **Correct.** `FIX-SG-01`, `SG-EC-014` and `SG-EC-041` appear nowhere. The six ids in use are `SG-EC-001/002/003`, `SG-KB-003`, `SG-MS-002/003`, consistently across sections 4.3.2, 5, 6, 8 and 9. |
| Pinned samples reapplied in all three source modes | **Correct**, and this is the strongest addition in the iteration. `db/seed/04_samples.sql` writes full fixture sample rows with `dataset_version = 'fixture: pinned'`, applied **after** sampling under synthetic, frozen and live (L515-521 region, S7). The plan states the failure it prevents exactly: synthetic depths derived from elevation would never land on 0.50, 0.80 and 0.20 m, the unit tests would still pass because they read `tests/fixtures/cases.ts`, and the stage figures would diverge from the tested ones. `tests/db/fixture-pinning.test.ts` is authored in S7 and asserts it. |
| Database-free curves module, three tests in their project | **Correct.** All three are in `tests/unit/`, the no-database project, and all three import `lib/rules/curves.ts`. |
| Pure-formula AC-2 test plus separate stored-row test | **Correct**, both named, both with authoring steps (S10, S15). |
| `exposure_share` single home | **Correct**, as above. |
| All seven ADRs carry the six fields | **Correct.** Every ADR carries Decision, Drivers, Alternatives considered, Why chosen, Consequences and Follow-ups. ADR-2, 3, 4 and 5 carry an extra field each (Declared exemption, Documented expansion and demo branches, Containment authority, Scenario label). |
| Cities archive recount | **Correct**, and it now matches my own count. I computed 188 at z11 and 588 at z12 across the twelve boxes; the plan says about 190 and 590 plus 35 below z11, about **815 total**, taking the archive to about 16,000 tiles and 96-240 MB, an order of magnitude inside the 500 MB budget. The plan states openly that the earlier area-based 510 understated it. |

Fixture arithmetic re-checked and unchanged from iteration 4: AC-2 gives 6.6%, S$934,000, S$700,500;
`SG-EC-002` gives 10.1% and S$899,000 with the 1.25 multiplier from SUHI tertile 1 and NDVI tertile 1;
`SG-KB-003` gives 9.24% gross, 7.74% net, a 1.50 pp delta; `SG-EC-003` gives 2.64% gross floored to 0.00% with
2.64 pp effective.

---

## 2. Soundness

**Sound.** No architectural change this iteration, and none needed. The seven ADRs are internally consistent and
each records its alternatives, so a reader can reconstruct why every contested choice went the way it did. The
three invariants the plan set itself now all hold across the whole surface: one owner per rule (ADR-2 for
arithmetic, ADR-4 for adaptation containment, ADR-7 for hotspot containment, `building_damage_class` for
classification), one declaration per shared shape (`HotspotPromptPayload`, the citation tolerance, the offline
exclusion list, and now the curve points), and one shape per function (`ABSENT_FLOOD`).

The fixture-pinning rule is the piece of work that most improves the plan's odds on the day. It closes a gap no
test would have caught: every unit test would have stayed green while the numbers on stage drifted, because the
unit tests read the fixture module and the screen reads the database. Naming that failure and pinning against it
in all three source modes is the difference between a plan that passes its tests and one that survives a demo.

---

## 3. Antithesis

I have none left that clears the bar. My iteration-4 antithesis, that AC-2 did not need a seeded property, was
accepted and implemented in the stronger form: the criterion now binds to the formula, and the row is asserted
against the formula rather than the other way round. The residual objection I would have raised, that a
demonstration property with pinned samples is the one unsampled row in a provenance-first system, is answered by
disclosing all six pinned rows in `docs/sources.md` (L1008 region) rather than leaving them to be found.

---

## 4. Non-blocking nits

None of these breaks anything. They are listed so the record is complete, and any of them can be ignored.

1. **The AC-2 convenience command runs two of five files.** L1109-1110 runs `worked-example` and
   `curve-fixtures` under `--project unit`, but AC-2's coverage at L1029 also names
   `tests/db/worked-example-row.test.ts`, `tests/db/fixture-pinning.test.ts` and
   `tests/db/adaptation-toggle.test.ts`. The bare `npx vitest run` two lines down covers all three, so nothing
   is untested; the per-criterion command is just narrower than the criterion.
2. **`fixture-pinning.test.ts` is the heaviest test in the suite.** Asserting byte-identical fixture rows across
   synthetic, frozen and live implies seeding three times. Worth a note in S28's triage order about its runtime,
   since it is the one test that cannot be fast.
3. **S4 authors the db project harness and S7 authors a db test, both on Day 1 with different owners** (B and A).
   The dependency is one way and same-day, so it is not a schedule risk, but S7 could say it depends on S4.
4. **`exposure_share` is read from the view by the popup and from `score_inputs` by the prompt.** One source,
   two readers, and AC-15 asserts they agree, so this is correct as designed. It is worth one line in
   `docs/sources.md` that the snapshot is taken at `prep:reference` time, since a later reseed would move the
   view without moving the snapshot.

---

## 5. Final verdict

**SOUND.**

All four of my iteration-4 defects are fixed, the synthesis was taken in full and in its stronger form, and
every figure named for verification recomputes correctly: the cluster splits sum to 200 with all six fixtures as
members, the identifier scheme is consistent and no stale id survives, the exposure view uses the one SQL shape
that is actually valid, the curves module puts three unit tests in the project they were assigned to, and the
cities archive recount now matches an independent count on tile boundaries. Across five iterations this plan has
closed forty-one of my forty-one findings, declining exactly one with a better answer than the one I proposed.

The four residual nits above are non-blocking and none of them touches a number, a test, a demo step or the
schedule. I recommend approval.
