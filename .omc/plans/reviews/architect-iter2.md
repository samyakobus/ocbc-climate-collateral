# Architect Review: `ocbc-climate-collateral-mvp.md` (RALPLAN-DR consensus, iteration 2)

Reviewer: Architect (read-only). Date: 2026-09-07.
Snapshot reviewed: `draft (consensus iteration 2)`, 943 lines, six ADRs in section 3, changelog in section 10.
Spec: `.omc/specs/deep-interview-ocbc-climate-collateral.md` as amended 2026-09-07. Research: the three files
under `.omc/research/`. No Critic output was consulted.

Two claims in this snapshot were checked by computation rather than by reading: the basemap tile count
(section 4.7) and the horizon-probability derivation (ADR-6). Both are wrong, and both are recorded as defects
with the arithmetic shown.

---

## 0. Disposition of my iteration-1 defects

Section 10 states "Architect defects, 18 of 18 applied". My own audit against the text: **15 fully resolved,
3 partially resolved.** The three partials are not bookkeeping quibbles; each has become a new defect below.

| # | Iteration-1 defect | Status in this snapshot |
|---|---|---|
| 1, 2 | Jakarta PM2.5 and Kota Kinabalu wind break "zero by data" | **Partial.** `hazard_applicability` (L286) is the right mechanism and Kota Kinabalu is deliberately retained (L610), which is the correct call. But the encoding of the exclusion contradicts itself in three places - see D6. |
| 3 | nodata versus zero contradiction | **Partial.** Three coverage states exist (L521-528), but `nodata` is simultaneously a persisted row state and a hard prep failure, so it can never exist - see D7. |
| 4 | Aqueduct per-GCM stack | **Resolved.** Ensemble mean and SLR percentile 50 pinned, recorded in `dataset_version` (L506). |
| 5 | No 2030 or today heat and wind samples | **Resolved.** Two NEX-GDDP windows and both STORM editions with DOIs (L507-508). |
| 6 | `valuate()` free variable, LTV in two homes | **Resolved.** `valuate` takes the loan (L375); `base_ltv_override ?? rule_set` precedence pinned by a test (L325-328). |
| 7 | `rule_sets` three inconsistent columns | **Partial.** `tenor_years` dropped and the three probabilities are authoritative (ADR-6), which is right. The derivation comment ADR-6 mandates is arithmetically false - see D2. |
| 8 | Tool schema does not enforce | **Resolved.** L470-474 states it plainly, `tool_choice` is set, and a missing tool block is an explicit path. |
| 9 | Reference index in the prompt | **Resolved.** ADR-3 withholds it; `prompt-payload.test.ts` enforces the projection. |
| 10 | Reference not recomputable from `score_inputs` | **Resolved.** `worst_haircut_2050`, `snapshot_max_exposure_sgd`, `recent_event_severity_90d` all stored (L444-446). |
| 11 | `drivers` free text versus field-name validator | **Resolved.** `input_field` is an enum (L459-464); decidable by set membership. |
| 12 | Parameterised views | **Resolved.** Real view with both membership shapes written out in SQL (L313-321). |
| 13 | Generated column DDL | **Resolved.** `GENERATED ALWAYS AS (COALESCE(...)) STORED` (L308-311). |
| 14 | Import-only network scan | **Resolved.** Call sites and module specifiers across three directories, exclusion list shared with the prose (L775-779). |
| 15 | Section 3.7 omitted the rescore action | **Resolved.** Section 4.9 names all three entry points (L563-566). |
| 16 | Frozen-replay circularity | **Resolved.** Three-source rule with `synthetic` committed by Day 1 12:00 (L96-104). |
| 17 | Wind multiplier below band floor | **Resolved.** `clamp(base * m, lo, hi)` confines the multiplier within the band (L352-360). |
| 18 | Missing `verify:dashboard`, `scripts/seed.ts` | **Resolved.** Both in the layout and in `package.json` (L211-213, L246-252). |

Improvement 8 (re-confirm the reference-in-prompt question) is recorded as declined on the ground that the team
lead already corrected it. That is the correct disposition and I withdraw the improvement: ADR-3 records the
decision and the spec's closed list is now honoured.

---

## 1. Architectural soundness of the chosen option

**Sound, and materially stronger than iteration 1.** Option A survives (L58-80) and ADR-1 restates the case
crisply: AC-9 is the one step performed live in front of the board, and in-process it is one server action, one
transaction, one `revalidatePath` (L114-117). Nothing in this snapshot weakens that.

The three improvements that carry the most architectural weight:

- **ADR-2 redraws the language boundary along a capability seam** (L122-139). Python writes raw samples;
  every derived value and every validator is TypeScript behind `npm run prep:*`. This is the synthesis I
  proposed in iteration 1 and it is implemented faithfully: `scripts/compute-reference.ts`,
  `scripts/gen-narratives.ts`, `scripts/gen-hotspot-scores.ts` all import the runtime validators directly
  (L126-129), and `build_hotspots.py` explicitly writes no score (L129). `reference-index.test.ts` now tests a
  formula instead of detecting drift between two copies of one.
- **The three-source rule** (L96-104) breaks the circularity cleanly, and tying `synthetic` to a Day-1 12:00
  commitment (L616-618) converts a hope into a gate.
- **Principle 3 extended to distinguish "not applicable here" from "measured as zero"** (L44-45) is the right
  provenance model for a board demo, and the provenance panel renders the applicability reason (L664-665).

`application_valuations` (L299) is a genuine improvement I did not ask for: separating loan-keyed from
collateral-keyed figures means a collateral securing two applications has two well-defined maximum loans.

Where the snapshot is weakest is not the architecture but the **quantitative claims layered on top of it**. Two
numbers that a director could check in ten seconds are wrong (D2, D4), and one qualitative claim that the demo
script leans on twice is false (D1).

---

## 2. Antithesis: PostGIS should own spatial membership

The iteration-1 antithesis (a FastAPI service) is now dead. ADR-2 captured its only real advantage,
deduplication, without the second deployable, and the changelog is right to treat that argument as closed.

The strongest remaining counterargument is narrower and aimed squarely at ADR-2's own principle 5, "every rule
has exactly one implementation" (L48-49). **ADR-2 draws the boundary at "raster and Earth Engine sampling"
versus "rules", but spatial membership is a rule, and it is currently implemented twice.**

- `prep/build_hotspots.py` writes hotspot "geometry **and membership**" (L516, L697-699), which means Python
  clustering decides which collateral belongs to which hotspot.
- `v_hotspot_exposure` (L313-321) independently recomputes membership geometrically with `ST_Intersects` and
  `ST_DWithin`, and **AC-15's test asserts the popup figure equals the view** (L757).

If Python's membership and PostGIS's predicate ever disagree - a pin within the radius but outside the polygon,
a point exactly on a boundary, a hotspot with both `area` and `radius_m` populated - then `score_inputs` and the
popup will disagree, and the failure surfaces in the AC-15 test rather than in prep. This is precisely the class
of defect ADR-2 was written to eliminate, reappearing at a seam ADR-2 does not cover.

The same gap admits a second instance: `prep/lib/synthetic.py` derives flood depth from `elevation_m` and
`dist_to_coast_km`, heat from latitude, wind from basin membership (L615-617). That is a physical model - a
rule - written in Python, and it produces the numbers that flow into every acceptance test whenever the seed
runs on `--source=synthetic`, which section 8 makes the fallback for `db:seed` (L808). Principle 5 says a rule
implemented in two languages is a defect; here a rule is implemented in the language ADR-2 reserved for
sampling, and it is the rule that generates the committed data floor.

**The steelman conclusion:** the language boundary is the wrong axis. The right axis is **who owns each kind of
rule**, and for spatial containment the answer should be PostGIS, exclusively - the direction Option C pointed
in. A partial Option C, where PostGIS owns membership and TypeScript owns arithmetic, would satisfy principle 5
across the whole surface rather than across the part ADR-2 happened to look at.

**Where the antithesis fails.** It does not reach the valuation engine. Option C's original defeat on driver 2
still holds: the haircut formula is the artefact the board inspects, and section 4.3 is readable in a way
PL/pgSQL would not be. The antithesis wins only on the spatial sub-domain, which is exactly where ADR-2 is
silent.

---

## 3. Unresolved tensions

**T1 - Spec literalism has cost two of the slider's three positions.**
ADR-5 is right that the constant-0.22 reading was wrong and right to withdraw iteration 1's false uniqueness
claim (L184-187). But adopting the literal formula without adjusting anything else makes `P(today) = 0.00`, so
the today flood column is zero **by definition, carrying no information**, and `P(2030) = 0.04` means a pin
needs `damage_fraction >= 0.75` to reach the 3% amber edge from flood alone. On the JRC Asia curves that is
roughly four metres of water. So the 2030 column is very nearly as empty as the today column, and the
three-position slider demos as green, green, colourful. AC-5 still passes, because it only requires recolouring
across the range, but the map component - one of the six active spec components - loses two thirds of its
range. The plan never confronts this, and demo step 2 (L855-856) spends two minutes on it. See D3 for the fix.

**T2 - The live thumbnail moved from unused liability to on-stage dependency.**
The changelog resolves my iteration-1 T2 by exercising the thumbnail in demo step 4 (L865-866), which is a
legitimate answer and better than leaving the credential unused. The residual tension is that driver 3 is "zero
network dependency on stage" (L56) and the demo now has a step whose visible outcome differs with and without
network. It degrades gracefully to the cached copy, so nothing breaks. But rehearsal step 13 only exercises it
**after** the network is restored (L849-850), so the presenter never rehearses what the audience sees if the
venue network is down at that exact moment. One line in step 4 of the offline rehearsal would close it.

**T3 - The testability claim and the authoring budget are in tension.**
Section 6 now claims "17 of 17 criteria (100%) have a concrete automated test" (L781), and the accounting that
separates automated assertions from physical-verification clauses (L781-786) is honest and well done. But that
claim is purchased with **thirteen new test files** - eight Playwright specs and five Testing Library component
tests - and no implementation step authors any of them. They appear in the AC table and in S26, which is a
verification step, not an authoring step. Playwright is also a new toolchain on a five-day build. See D8.

---

## 4. Synthesis

Keep ADR-2 exactly as written, and **extend principle 5 from "one language per rule" to "one owner per rule",
naming the owner for the two rule classes ADR-2 does not currently cover.**

1. **Spatial membership belongs to PostGIS.** Add `v_hotspot_membership (hotspot_id, collateral_id)` to
   `0002_views.sql`, defined once with the both-shapes predicate already written at L316-319. Redefine
   `v_hotspot_exposure` on top of it. Then `build_hotspots.py` writes **polygons and radii only**, and
   `scripts/compute-reference.ts` reads membership from the view rather than from anything Python decided.
   The AC-15 test then compares the popup against the same definition that produced `score_inputs`, instead of
   against a second opinion.
2. **Synthetic derivation is a rule, so name it as a deliberate exception or move it.** Either move
   `prep/lib/synthetic.py` to `scripts/gen-synthetic.ts` alongside the other `prep:*` jobs, or add one line to
   ADR-2 stating that synthetic generation is exempt because it never runs in the same pass as a real sample
   and is fully pinned by `seed=20260907`. The exemption is defensible; leaving it unstated is not, because
   `synthetic` is the committed floor that every acceptance test runs against when Earth Engine is unavailable.

This costs one view and one paragraph, keeps every ADR intact, and closes the antithesis's only landing spot.

---

## 5. Concrete defects

**D1. L188-190, L873-875, L843, L855 - "the today column is uniformly green" is false, and the offline
checklist asserts it.**
Only the flood term carries `P`. In `valuate` (L376-381), `windHaircut` is not multiplied by `P`, and PM2.5
is `scenario_invariant = true` (L509). At the today scenario a Hong Kong pin therefore computes:
flood 0, heat 0 (today is a zero delta by construction, L507), wind non-zero, PM2.5 non-zero. Hong Kong 100-year
wind speeds sit around 50-60 m/s, which lands in the second band: `base = 0.03 + min((v-45)/15, 1) x 0.03`, so
roughly 0.05, times the 0.8 RC high-rise multiplier gives about **4%**. With `band_low = 0.03`, that pin is
**amber today**. All 25 Hong Kong pins and several mainland China pins will be.
This contradicts four places: ADR-5's consequence (L188-190), assumption 2 (L873-875), **offline rehearsal step
5, which instructs the tester to "confirm the today view is uniformly green"** (L843) and will fail on the first
rehearsal, and demo script step 2 (L855).
*Fix:* correct the claim to "predominantly green, with wind-exposed Hong Kong and China pins amber", amend
rehearsal step 5 and demo step 2, and state in ADR-5 that wind and chronic perils are unconditional bands
carrying no horizon probability, which is the correct reading of the spec.

**D2. L196-198 - ADR-6's mandated migration comment is arithmetically wrong.**
It says `1 - 0.99^n` for `n = 0, 4, 24` gives `0.000, 0.039, 0.214`, "rounded to `0.00, 0.04, 0.22`". The first
two round correctly. **0.214 rounds to 0.21, not 0.22.** ADR-6 itself acknowledges the gap two lines later,
noting that deriving the value yields 0.2143 and fails AC-2 (L199-201). So the ADR knowingly prescribes a
comment that misstates its own arithmetic, in the one artefact whose purpose is to let a director check the
derivation.
*Fix:* either use `n = 25` (`1 - 0.99^25 = 0.2222`, which does round to 0.22 and matches the spec's "~22%"), or
write the comment honestly: "0.22 is the spec's stated horizon probability; `1 - 0.99^24 = 0.214` is the
24-year elapsed-time check, and the stored value is the spec's, not the derivation's."

**D3. L176-178, L188-190 - `p_today = 0.00` and `p_2030 = 0.04` make two of the three slider positions
information-free.**
`P(today) = 0` asserts a zero probability of a 100-year flood ever occurring, which is not what "current
exposure" means to a credit officer; the honest reading is that the horizon window has zero length, so the
column is a tautology rather than a measurement. At 2030, reaching the 3% amber edge from flood alone requires
`damage_fraction x 0.04 >= 0.03`, so `damage_fraction >= 0.75`, roughly four metres of water on the JRC Asia
curves. Almost no pin qualifies.
*Fix:* set `p_today = 0.01`, the one-year probability at a 100-year return period. It is defensible, it is the
same formula with `n = 1`, it keeps AC-2 untouched, it makes the today column a real measurement, and it makes
the slider's three positions genuinely distinct. Record the choice in ADR-5 alongside the `n = 0` alternative.

**D4. L544-546 - the basemap tile count is wrong by roughly eighteen times, and the archive will breach its own
hard cap.**
For the stated bbox (95E-125E, 11S-33N) at z0-z12, computed tile by tile in Web Mercator:

| Zoom | Tiles |
|---|---|
| z10 | 11,352 |
| z11 | 44,973 |
| z12 | 179,550 |
| **z0-z12 total** | **239,706** |
| z0-z10 total | 15,183 |
| z0-z6 total | 80 |

The plan states "approx. 13,000 tiles" and "approx. 500 MB, hard cap 800 MB", and says the fetch step **fails**
if the archive exceeds the cap (L546). The stated 13,000 corresponds to z0-z10, not z0-z12. At a realistic
6-15 KB per vector tile, z0-z12 is **1.4 to 3.6 GB**, so S8 as specified fails its own gate on Day 1.
*Fix:* pick one of two coherent configurations. Either cap the regional archive at **z0-z10** (15,183 tiles,
comfortably inside 500 MB), which matches the stated tile count and still renders country and city scale; or
keep z0-z10 regionally and fetch z11-z12 only for small bounding boxes around the 24 named clusters, which is
a few hundred tiles each. MapLibre overzooms vector tiles, so pins remain usable past the archive's maximum
zoom either way, and that should be stated so the z12 question does not resurface.

**D5. L520, L640 - `scripts/fetch-basemap.ts` cannot extract a pmtiles archive in TypeScript.**
Extracting a regional archive from the Protomaps planet build is done by the `pmtiles extract` command in
`go-pmtiles`, a Go binary. The JavaScript `pmtiles` library reads archives; it does not create them by range
request against a planet file. No Go binary is declared in `Dockerfile.web`, `.env.example` or `package.json`.
*Fix:* either declare and pin the `go-pmtiles` binary as a build dependency and have the TypeScript job shell
out to it, or fetch a pre-built regional extract over HTTP and have the script verify only the SHA-256 it
already records (L545).

**D6. L521-528 versus L790 versus L741 - `out_of_basin` conflates two different facts, and three places
contradict each other about PM2.5.**
Section 4.6 defines `coverage = 'out_of_basin'` as written **either** when `hazard_applicability.scored = false`
for the country **or** when the raster genuinely has no basin coverage (L524-526). Those are different
statements about the world, and the plan then contradicts itself on which applies to PM2.5:
- The AC-4 test asserts every SG/MY/ID pin has PM2.5 with `coverage='out_of_basin'` (L741).
- The sampling-sanity mitigation asserts "PM2.5 **measured everywhere** but `scored = false` outside CN/HK" (L790).
Both cannot hold. GHAP measures 35-45 ug/m3 over Jakarta, as section 4.6 itself says (L530-532), so labelling
that row "out of basin" is factually false, and PM2.5 has no basins at all.
*Fix:* separate the two axes. Keep `coverage` describing the raster (`measured` / `out_of_coverage` /
`nodata`) and let `hazard_applicability.scored` alone describe policy. Jakarta PM2.5 then reads
`coverage='measured', value=41, scored=false`, and the provenance panel can say "measured at 41 ug/m3, not
scored in Indonesia: no local hedonic evidence" with the reason and source URL already in the table. That is a
markedly stronger answer to a director than "not applicable at this location", and it makes the AC-4 test and
the sanity test agree.

**D7. L527-528 - `coverage = 'nodata'` is defined as a row state that can never exist.**
It is specified as a persisted row with `value = NULL`, **and** as a hard prep failure where
`sample_hazards.py` exits non-zero. If prep exits, the row is never written, so the engine's `nodata` branch
(L342-343), the provenance panel's handling, and any test of it cover an unreachable state. Separately, a single
bad pin out of 200 aborts the entire sampling run, which is brittle on a five-day clock.
*Fix:* let nodata rows persist and quarantine the affected pins, failing the run only above a threshold (say
more than five pins, or any of the twelve hand-checked control points). The state then exists, the engine
branch is reachable and testable, and one bad pin does not cost a morning.

**D8. Section 6 versus section 5 - thirteen test files have no authoring step.**
The AC table names eight Playwright specs (`auth`, `slider`, `pin-click`, `rule-edit`, `offline`, `refresh`,
`hotspot-popup`, plus the e2e clauses of AC-11 and AC-14) and five component tests
(`adaptation-toggle`, `breakdown`, `landslide-badge`, `news-list`, and the AC-7 badge test). No step in section
5 lists any of them as a deliverable; S26 is "full test suite green" (L719), which verifies rather than
authors. Playwright's config, its CI wiring and its browser binaries (roughly 400 MB) are also an undeclared
Day-1 network dependency that must land before the offline rehearsal on Day 5.
*Fix:* add Playwright setup and browser install to S1's deliverables and to the Day-1 network dependency list,
and attach each spec to the step that owns its criterion, so the authoring cost is visible in the day plan
rather than discovered on Day 5.

**D9. L389-390 versus L323-324 - `revalue_by_year` has no defined value for the today scenario.**
It is "the first scenario year whose total haircut crosses `band_mid`", over the scenarios today, 2030 and 2050.
"Today" has no integer year, yet `v_portfolio_summary` counts applications with `revalue_by_year <= 2030`
(L323-324) and AC-6 tests that count. Per D1, a Hong Kong pin can cross `band_mid` at today: wind up to 6% plus
the 5% chronic cap is 11%, above the 10% mid band.
*Fix:* pin the today scenario to a literal year in `rule_sets` or in `lib/rules/bands.ts`, and state it in the
AC-6 assertion.

**D10. L346-349, L400-405 - ADR-4's zero floor makes the "documented amount" conditional.**
`floodHaircut` returns `max(gross - credit, 0)` (L349). For a property inside an adaptation zone whose gross
haircut is below its project's `haircut_credit_pp`, the observed delta is the gross, not the documented credit.
Of the seven curated projects, credits run 1.50 to 3.00 percentage points (L630-638), and at `P = 0.22` a gross
of 3.00 points needs `damage_fraction >= 0.136`, so shallow-flooding properties in the Long Island, NCICD and
Shanghai zones will show less than the table says. AC-3 passes because `FIX-SG-MB-01` is chosen with gross
9.24%, well above its 1.50-point credit, but the case screen generalises the claim.
*Fix:* render the **effective** credit applied next to the documented one on the adaptation panel, and add one
fixture where the floor binds so the behaviour is pinned rather than incidental.

**D11. L588-641 - Day 1 remains unbalanced across the three owners.**
Owner A carries S1, S2, S4, S5 and S6: compose and `package.json`, the full seventeen-table migration with
PostGIS, generated columns and views, the 200-pin generator, the synthetic sampler, and the live Earth Engine
sampling across eight datasets. Owner B carries S3 and S7. Owner C carries S8 alone, which per D4 is also
mis-scoped. The changelog records Day 1 as "rebalanced across three owners with cut lines", and the 12:00 cut
line is a real improvement, but the load itself is not balanced.
*Fix:* move S4 and S5, the portfolio generator and the synthetic floor, to owner C. They are self-contained,
they have no dependency on the migration, and they are exactly what the Day-1 cut line at 12:00 depends on.

**D12. L302 versus L313-321 - `hotspots.loan_exposure_sgd` and `v_hotspot_exposure` compute the same figure
with no stated authority.**
The column is in the schema and the view returns a column of the same name. No step says who writes the column
or which the popup reads, while AC-15 asserts the popup equals the view (L757).
*Fix:* drop the stored column and read the view, or state that `npm run prep:reference` writes it from the view
and have the AC-15 test compare all three. This is the same duplication the antithesis identifies at the
membership level and is fixed by the same `v_hotspot_membership` view proposed in section 4.

**D13. L443, L143-146 - `max_event_severity` is sent to the model but is not in the spec's closed list.**
ADR-3 states the prompt "carries exactly the spec's closed input list" (L145). The spec enumerates hazard scores
by type, loan exposure and share of book, recent event count and severity, and days since last event.
`promptPayload()` sends `recent_event_count_90d`, `recent_event_severity_90d` **and** `max_event_severity`
(L443). The third is a defensible reading of "severity", but ADR-3's word is "exactly".
*Fix:* either drop `max_event_severity` from the projection, or soften ADR-3 to record it as a documented
expansion of "severity" into a sum and a maximum, with the reason.

**D14. L210 - the `.gitignore` entry is prose, not a pattern.**
`public/basemap/*.pmtiles (except the committed z0-z6 floor)` will ignore the committed floor as written,
which defeats the guarantee at L547 that a clean clone always renders a map.
*Fix:* two lines, the pattern followed by `!public/basemap/asia-z0-z6.pmtiles`.

---

## 6. Improvement suggestions

1. Add `v_hotspot_membership` to `0002_views.sql` as the single definition of hotspot containment, and have
   `compute-reference.ts` and `v_hotspot_exposure` both read it.
2. State in ADR-2 whether `prep/lib/synthetic.py` is a rule or a sampler, and either move it to TypeScript or
   record the exemption with its reason.
3. Set `p_today = 0.01` so the today column measures something, and record the `n = 0` alternative in ADR-5.
4. Correct ADR-6's migration comment to use `n = 25`, or state that 0.22 is the spec's given value rather than a
   rounding of 0.214.
5. Amend rehearsal step 5 and demo step 2 to say "predominantly green, Hong Kong and China wind-exposed pins
   amber", and add one line to ADR-5 explaining that wind and chronic perils carry no horizon probability.
6. Re-scope the basemap to z0-z10 regionally, with optional z11-z12 only around the 24 named clusters, and state
   that MapLibre overzooms beyond the archive maximum.
7. Declare the `go-pmtiles` binary and its pinned version in `Dockerfile.web`, or switch to fetching a
   pre-built extract and verifying the recorded SHA-256.
8. Split `coverage` (raster fact) from `scored` (policy fact) so Jakarta PM2.5 reads "measured 41 ug/m3, not
   scored in Indonesia" and the AC-4 and sanity tests stop contradicting each other.
9. Make nodata a quarantine with a threshold rather than an immediate non-zero exit, so the state is reachable
   and one bad pin does not cost a morning.
10. Attach each Playwright spec and component test to the step that owns its criterion, and add Playwright
    setup plus browser install to S1 and to the Day-1 network dependency list.
11. Pin a literal year for the today scenario so `revalue_by_year` and the AC-6 count are well defined.
12. Show the effective adaptation credit beside the documented credit, and add a fixture where the zero floor
    binds.
13. Move S4 and S5 to owner C so Day 1 is balanced and the 12:00 cut line is owned by someone with capacity.
14. Resolve `hotspots.loan_exposure_sgd` against `v_hotspot_exposure` by dropping the column or naming its
    writer.
15. Reconcile `max_event_severity` with ADR-3's "exactly the spec's closed list".
16. Fix the `.gitignore` negation so the committed basemap floor is actually committed.
17. Add a line to offline rehearsal step 4 confirming what the satellite thumbnail looks like **while** the
    interface is disabled, so the presenter has rehearsed the degraded view demo step 4 might show.
18. Record in `docs/sources.md` that Kota Kinabalu and Jakarta are measured but unscored, with the reason, since
    both are strong answers to the "one method, five countries" challenge and are currently only in the plan.

---

## 7. Final verdict

**SOUND WITH CHANGES.**

Iteration 2 is a substantially better plan than iteration 1, and the improvement is structural rather than
cosmetic. ADR-2 fixes the language boundary along a capability seam and eliminates the three duplicated rule
implementations that were the deepest problem in the previous draft; ADR-3 restores the spec's closed input list
and with it the meaning of the divergence badge; the three-source rule breaks a circular mitigation; and the
testability accounting in section 6 is honest in a way the earlier "17 of 17 have a named test" claim was not.
Fifteen of my eighteen iteration-1 defects are genuinely resolved, not merely acknowledged, and the two
improvements the changelog declines are declined for good reasons.

What holds the plan back from SOUND is a cluster of quantitative and internal-consistency errors sitting on top
of a sound structure. Three are checkable in seconds by anyone who looks: the basemap is specified at 13,000
tiles when the stated bbox and zoom range yield 239,706, so the step fails its own 800 MB cap; ADR-6 mandates a
migration comment stating that 0.214 rounds to 0.22; and the claim that the today column is uniformly green,
which ADR-5, assumption 2, the offline rehearsal and the demo script all rely on, is contradicted by the plan's
own valuation function, because wind and PM2.5 carry no horizon probability. The offline rehearsal will fail at
step 5 on its first run. Alongside those, the `out_of_basin` encoding contradicts itself across three places,
the nodata state cannot exist, and thirteen named test files have no authoring step in the day plan.

None of these require rethinking the architecture. Fix D1 through D8, apply the membership view from section 4
so principle 5 holds across the spatial domain as well as the arithmetic one, and this plan is executable in
five days and defensible in front of a board.
