# Critic Review — RALPLAN-DR consensus iteration 4

Plan: `C:\Coding\2026_OCBC_OPC\.omc\plans\ocbc-climate-collateral-mvp.md` (status "draft (consensus iteration 4)", 1228 lines, seven ADRs)
Spec: `C:\Coding\2026_OCBC_OPC\.omc\specs\deep-interview-ocbc-climate-collateral.md`
Reviewer: Critic (independent; no Architect file read). Strict bar applied: blocking only where something breaks the build, a test, a fixture number, a demo step, the spec, or the schedule.

## Verdict: REVISE

Both remaining issues are in the seed, both are narrow, and both have a named fix. If the team lead prefers, they are small enough to direct as edits rather than spend the last iteration on.

## Verification of BL7-BL10

| Issue | Status | Independent verification |
|---|---|---|
| BL7 AC-2 bound to a pin whose 2050 heat is non-zero | **Resolved** | The split is clean and both halves reproduce. `FIX-SG-01` gives flood 0.066, adjusted S$934,000, loan S$700,500 with heat pinned at a zero delta and wind `absent`, PM2.5 `measured_not_scored`. `SG-EC-014` at 28 days with SUHI tertile 1 and NDVI tertile 1 gives elasticity 0.028, multiplier 1.25, heat 3.5%, total 10.1%, adjusted S$899,000, loan S$674,250, and lands in the 10-20% band. Section 4.3.2 now states that the three flood fixtures pin `flood_haircut` rather than `total_haircut`, and demo step 4 shows both properties in sequence, which is a better beat than the single number it replaced. |
| BL8 membership view can double-count exposure | **Resolved** | `CHECK ((area IS NULL) <> (radius_m IS NULL))` is correct boolean XOR: it rejects both-null and both-set and admits exactly one shape. The view is a `UNION` of two branches each guarded by the matching `IS NOT NULL`, so the branches are disjoint by the constraint and deduplicated by `UNION` regardless. AC-15 now tests a polygon hotspot and a radius hotspot against hand-written sums plus a fourth assertion that the constraint rejects a both-shapes row. |
| BL9 payload described as eight keys | **Resolved** | `HotspotPromptPayload` is declared once as a type: six top-level keys expanding to nine leaves. I counted both. The nine leaves match the nine `input_field` enum values exactly. The test is set equality against the type's keys and against the enum, and all three former "eight" statements are gone. |
| BL10 one extract cannot build the described archive | **Resolved** | Two invocations, two archives, two MapLibre sources, both commands written out with real `go-pmtiles` flags. The arithmetic holds: cities 35 + 102 + 408 = 545, archive total 15,200 + 545 = 15,745, and 15,745 tiles at 6-15 KB gives 94-236 MB against the stated 95-236 MB. The committed floor is corrected to 96 tiles, which matches my own z0-z6 count for this bbox exactly. |

## Blocking issues

**BL11. The fixture collateral identifiers cannot exist inside the seeded clusters, and `FIX-SG-01`'s place in the 200-pin count is undefined.** (lines 476-480, 787, 795)
The East Coast cluster is seeded with 12 pins, yet two fixtures are named `SG-EC-014` and `SG-EC-041`. Under per-cluster numbering neither identifier exists. A country-wide running index with a cluster tag resolves both, since 14 and 41 are within Singapore's 60, but the plan never states which scheme applies, and the identifiers are quoted verbatim in five test assertions and two demo steps. Separately, `FIX-SG-01` is a seventh Singapore property that belongs to no cluster in the S5 table. If it is added to the 200, `tests/prep/test_clean_machine.py`'s "populate 200 pins" assertion fails at 201. If it replaces an East Coast pin, the S5 table's 12 is wrong and Singapore's real portfolio is 59 plus a fixture. I verified the cluster arithmetic: every country sums correctly and the total is exactly 200, so the fixture has nowhere to go without changing a published number. **Fix:** state that identifiers carry a country-wide running index with a cluster tag, and say explicitly whether `FIX-SG-01` is the 201st row excluded from the portfolio count or one of the 12 East Coast pins. Either answer works; the count assertion and the S5 table must agree with it.

**BL12. The hazard samples behind the fixture numbers are not pinned in the seed, so the tested figures and the on-stage figures can differ under every source mode.** (lines 476-477, 795, 801-805, 1111-1114)
S5 says the six fixture collateral are seeded with "their exact ids, values and `adaptation_project_id`". Appraised value and the adaptation foreign key are pinned; the hazard samples that actually produce the numbers are not. Only `FIX-SG-01`'s heat delta is pinned, and it is pinned well, with `dataset_version = 'fixture: pinned zero delta'` so the provenance panel discloses it. But `FIX-SG-01`'s 0.50 m depth, `SG-EC-014`'s 0.50 m depth and 28-day heat delta, `SG-KB-003`'s 0.80 m, and `SG-EC-041`'s 0.20 m are all presented as ordinary samples. Under `--source=synthetic`, which S6 makes the unconditional floor and which every acceptance test falls back to, depths are derived from elevation and distance to coast and heat from latitude; those derivations will not land on 0.50, 0.80, 0.20 and 28. The unit tests read `tests/fixtures/cases.ts` and pass regardless, so nothing catches the divergence, and demo step 4 walks S$934,000 and S$899,000 off live screens. This is the same failure mode as BL7 one layer down: the tested number and the demonstrated number are not tied together. **Fix:** pin the full hazard-sample rows for all six fixture collateral in `db/seed/04_samples.sql` with `dataset_version = 'fixture: pinned'`, applied after sampling in every source mode, and add an assertion to `tests/db/adaptation-toggle.test.ts` that the seeded depths and heat delta equal the values in `tests/fixtures/cases.ts`.

## Non-blocking improvements

1. Section 4.6's prep table still says `gen_portfolio.py` writes `damage_class`, which contradicts S5's explicit "the generator writes `building_type` and **not** `damage_class`" and the collateral schema, which has no such column. S5 and the schema are two independent corrections against one stale cell, so the intent is clear, but the cell should go.
2. `valuations` carries one set of flood columns while two flood perils are computed; state that the stored `flood_haircut_gross`, `documented` and `effective` come from the peril that wins the `max`, so the provenance panel does not mix perils. The AC-3 delta is unaffected, since subtracting the same credit from both nets leaves the maximum's delta at exactly the credit whenever the floor does not bind.
3. `reference-index.test.ts` recomputes H from `worst_haircut_2050 / rules.total_cap`, so it needs `total_cap` as well as `score_inputs`; say the test reads the active rule set for that one constant.
4. The 2030 heat window, 2021-2040, overlaps the 2016-2035 reference by 15 of 20 years, so the 2030 heat delta will be small and noisy. That reinforces the already-stated point that 2030 is the least informative column, and is worth a line in `docs/sources.md` rather than a change.
5. `v_portfolio_summary` returns three of the four headline figures; the top-10 list is a separate query. AC-6's test says it recomputes "the four figures", so name where the fourth comes from.
6. Rehearsal step 5 and demo step 2 still say "today" where the UI now reads "2025 (origination)"; the scenario enum value is legitimately `today`, but the prose a presenter reads should match the label on screen.
7. Two MapLibre sources means the Protomaps style layers are instantiated twice; `protomaps-themes-base` takes a source name for exactly this, so name it in S9 and the step stays a two-liner.
8. Nothing asserts the seeded `SG-MS-002` and `SG-MS-003` elevations sit either side of the inundation threshold, which is the same pinning gap as BL12 on the pair AC-8 depends on; the BL12 fix should cover all six fixtures, not four.

## Scorecard

| Metric | Value |
|---|---|
| ACs with a concrete automated test as written | 17 of 17, 100% |
| ACs with an authoring step carrying a day and an owner | 17 of 17, 100% |
| Named test artefacts with an authoring step | 38 of 38 |
| Claims citing a file, section, ADR, dataset or formula | ~96% |
| Risks with concrete verifiable mitigation | 17 of 17 |
| Cut lines present | 5 of 5 days |
| Spec violations | 2, both declared (ADR-4's credit form; the curated depth-damage fit) |
| Undeclared spec violations | 0 |
| Iteration-3 blocking issues resolved | 4 of 4 |

Recomputed and confirmed this pass: both AC-2 fixtures including the heat elasticity, multiplier, total, adjusted value and band; the AC-3 and zero-floor fixtures; the `CHECK` constraint's boolean behaviour; the six-key and nine-leaf payload counts against the nine-value enum; the percent rule at `100 x 0.18 = 18` and the magnitude rule at 128,400,000 to three significant figures; all five cluster sums and the 200 total; and every basemap figure including the 96-tile floor.

## Rationale

Iteration 4 resolves all four blocking issues and does so without introducing the kind of arithmetic slip that characterised the two iterations before it. Every number I recomputed landed exactly, including the ones that had to be constructed rather than corrected: the realistic Marine Parade case at 3.5% heat and a 10.1% total is not a figure that falls out of a formula by accident, and the fact that it reproduces to the cent from the published tertiles and the published elasticity is the clearest evidence yet that the plan's numbers are being derived rather than asserted. The BL7 fix is better than what I asked for, because splitting the worked example into a flood-only fixture and a realistic pin turns an inconsistency into a demo beat that shows what a Singapore mortgage actually looks like. ADR-4's containment ruling is the strongest addition of the iteration and it came from the Architect rather than from me: dropping the adaptation polygon so a curated foreign key is the only authority removes a second opinion on a credit number, and the observation that a shoreline polygon drawn the obvious way would have swallowed all three East Coast fixtures is exactly the kind of catch that pays for a consensus loop. The single heat reference window, the `COUNT(DISTINCT)` on the revaluation tile, and the "2025 (origination)" label each close a question that would have surfaced as a director's raised eyebrow rather than as a failing test. What remains is confined to one file. The seed pins the fixtures' identities, values and adaptation links but not the hazard samples that generate their numbers, and the fixture identifiers do not fit the clusters they are drawn from. Both would surface on Day 5 as a demo whose screens disagree with a green test suite, which is the one failure this plan has spent four iterations designing itself out of. Neither needs an architectural change and both fixes are a paragraph each.
