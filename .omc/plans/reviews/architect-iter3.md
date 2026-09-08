# Architect Review: `ocbc-climate-collateral-mvp.md` (RALPLAN-DR consensus, iteration 3)

Reviewer: Architect (read-only). Date: 2026-09-07.
Snapshot: `draft (consensus iteration 3)`, 1101 lines, seven ADRs, changelog in section 10.
Spec: `.omc/specs/deep-interview-ocbc-climate-collateral.md` as amended 2026-09-07. No Critic files consulted.

Everything the team lead asked me to verify was recomputed rather than read. The horizon probabilities, the
basemap tile counts, the depth-damage interpolation and all four pinned fixtures are **arithmetically correct**.
The defects below are elsewhere.

---

## 0. Disposition of my iteration-2 defects D1-D14

**13 resolved, 1 declined with a reason I accept. None outstanding.** The changelog claims "12 in full, 1 in
part, 1 declined"; my audit is slightly more favourable than the plan's own, because D7 is better resolved than
the changelog credits itself with.

| # | Defect | Status | Evidence |
|---|---|---|---|
| D1 | "today is uniformly green" is false | **Resolved** | ADR-5 "Consequences, stated precisely" (L181-188) now says HK and coastal China are amber at today and SG/MY/ID green, with the wind arithmetic shown. Verified against `valuate` (L401-410): only `floodHaircut` multiplies by `P`. Rehearsal step 5 (L969-972) and demo step 2 (L991-994) both rewritten. The plan turned the defect into its best demo line: applicability, not a country branch, is what zeroes the other three markets. |
| D2 | ADR-6 derivation comment misstated its arithmetic | **Resolved** | Base year 2025, `n = 0/5/25`. Recomputed: `1-0.99^0 = 0.0000`, `1-0.99^5 = 0.049010`, `1-0.99^25 = 0.222183`. Stored 0.00 / 0.05 / 0.22 are **genuine roundings**, and 0.22 matches the spec's "~22% for 2050". The 2026 base is explicitly withdrawn in ADR-5's alternatives (L172-173). |
| D3 | `p_today = 0.01` | **Declined** | Recorded as an alternative in ADR-5 (L174-177). I accept the decline. `n = 0` is the consistent reading of "before the horizon year", and my underlying concern - an information-free today column - is answered better than my fix would have: today is not empty, because wind and PM2.5 carry through. |
| D4 | Basemap tile count wrong by ~18x | **Resolved** | Re-scoped to z0-z10. Recomputed independently: z10 = 11,352 and z0-z10 = 15,183, **matching the plan exactly** (L621-622). Cluster overlay of 12 boxes at 0.5 degrees square gives z11 about 102 and z12 about 408; my own count gives 108 and 432 at the box edges, so 510 is right to within rounding. 15,693 tiles at 6-15 KB is 94-236 MB, inside the 500 MB budget. L633-634 states the old 239,706 figure openly. |
| D5 | TypeScript cannot extract pmtiles | **Resolved** | `go-pmtiles` v1.22 pinned in `Dockerfile.web` (L630, S1 at L670), `scripts/fetch-basemap.ts` shells out, HTTP pre-built extract as fallback, committed z0-z6 floor beneath that, and S1 asserts the binary's presence. |
| D6 | `out_of_basin` conflated measurement with policy | **Resolved** | Three states `scored` / `measured_not_scored` / `absent` (L563-570), measurement and policy on separate axes. Jakarta stores 41 and reads "measured at 41 ug/m3; not scored in Indonesia: no local hedonic evidence". The AC-4 test (L862) and the sanity test (L915) now agree, which they did not in iteration 2. |
| D7 | `nodata` was both a row state and a hard failure | **Resolved** (changelog says "in part") | The state is deleted entirely (L571-575), which removes the contradiction I raised rather than papering over it: there is no unreachable state left to test. My brittleness concern is met by batching every offending pin into one report. This is a cleaner answer than the quarantine I proposed. |
| D8 | 13 test files with no authoring step | **Resolved** | S4 (L689-695) schedules both harnesses on Day 1. I cross-checked **all 35 test files** named in section 6 against section 5: every one has a step, a day and an owner. The claim at L899-901 is true as written. |
| D9 | `revalue_by_year` undefined at today | **Resolved** | `rule_sets.today_year = 2025` (L305), evaluated over literal years `[2025, 2030, 2050]` (L455-459), and the plan notes a HK pin can cross at 2025 so the `<= 2030` count must handle it. See new defect 6 for a residual. |
| D10 | Zero floor made "documented amount" conditional | **Resolved** | `floodHaircut` returns documented and effective (L369-376); the panel renders both; `SG-EC-041` pins the floor. Verified: depth 0.20 m gives damage 0.12, gross 2.64%, credit 3.00 pp, net 0.00%, effective 2.64 pp. All four figures correct. |
| D11 | Day 1 unbalanced | **Resolved** | A holds S1, S2, S7, S9; B holds S3, S4, S8; C holds S5, S6. The generator and synthetic floor moved to C, and the 12:00 cut line now sits with an owner who has capacity. |
| D12 | Two writers for hotspot exposure | **Resolved** | `hotspots.loan_exposure_sgd` dropped (L313), `v_hotspot_exposure` is the sole source, and the AC-15 test compares popup, `score_inputs` and view (L868). |
| D13 | `max_event_severity` outside the spec's closed list | **Resolved** | Removed from `promptPayload()`, stored for the popup only (L497). The payload now matches the spec's six terms exactly. See new defect 2 for a miscount in how it is described. |
| D14 | `.gitignore` was prose | **Resolved** | Pattern plus negation, in S1 (L671). |

---

## 1. Architectural soundness of the chosen option

**Sound.** Option A with ADR-1 is unchanged and remains correct; nothing in this iteration weakens it. Three
things make this snapshot materially stronger than iteration 2.

**ADR-7 is the right fix and is implemented properly** (L203-218). `v_hotspot_membership` is written out as
actual SQL (L327-332), `v_hotspot_exposure` is defined on top of it rather than beside it (L335-341),
`build_hotspots.py` is reduced to polygons and radii (L607), and the stored exposure column is gone. The OR
predicate produces one row per hotspot-collateral pair whether a hotspot carries a polygon, a radius, or both,
so the both-shapes case does not double count. Principle 5 restated as "one owner per rule" rather than "one
language per rule" is the correct generalisation, and it is the generalisation I asked for.

**ADR-5's consequences section is now the best-written part of the plan** (L181-188). It states the behaviour
precisely, quantifies it, and converts what was a false claim into the demo's strongest line. The
`damage_fraction >= 0.60` threshold for the 2030 amber edge is right (`0.03 / 0.05`), and "roughly 1.4 m of
water" checks out against the seeded curve: interpolating between 1.0 m at 0.50 and 1.5 m at 0.62 gives 1.417 m.

**The seeded curve is now honest about being curated** (L419-423). Declaring that the published JRC Asia
residential curve sits near 0.32 at 0.5 m while the seeded table uses 0.30, labelling it on screen, and pinning
both fixture values in `curve-fixtures.test.ts` is exactly the right handling. AC-2 and AC-3 are now mutually
consistent by construction rather than by luck, and `f(0.80) = 0.30 + (0.30/0.50) x 0.20 = 0.42` is correct.

Where the plan is weakest is a narrow band of **type-level and definitional slips**, several of them introduced
by the iteration-2 fixes themselves. Defect 1 below does not compile; defect 2 is a miscount inside a test that
is specified to be exact.

---

## 2. Antithesis: ADR-7 was applied to one containment relation, and there are two

The strongest case against the current design is that **ADR-7 is right and was stopped one table short.**

ADR-7's argument is that spatial containment decided in two places will eventually disagree, and that the
disagreement surfaces in an acceptance test rather than in prep. That argument is correct and the plan accepts
it for hotspots. But **adaptation-zone containment is the same relation, and it is still defined twice:**

- `adaptation_projects.area` is a polygon column (L302).
- `collateral.adaptation_project_id` is a foreign key (L300).

Nothing reconciles them. No view derives the FK from the polygon, no test asserts they agree, and no ADR says
which is authoritative. The FK is what `floodHaircut` reads (L373), so the FK wins at runtime while the polygon
is what a director would see if the adaptation zones were ever drawn on the map - and drawing them is a natural
thing to want on a map screen whose whole purpose is showing hazard geography.

The stakes are higher here than they were for hotspots. Hotspot membership drives a triage score that is
explicitly labelled illustrative. Adaptation membership drives **AC-3, a credit-relevant number the board is
invited to check by subtraction**, and it drives AC-2 by omission: `SG-EC-014` at Marine Parade Road must fall
**outside** the Long Island / City-East Coast zone for the worked example to produce 6.6%, while `SG-EC-041`,
also on the East Coast, must fall **inside** it. Those two facts are asserted by FK assignment in the seed and
by nothing else. A polygon drawn in the obvious way along the East Coast shoreline would contain both.

The antithesis, then: apply ADR-7 to every containment relation, not to the one that happened to be reviewed.
Either drop `adaptation_projects.area` and declare the FK authoritative with the polygon out of scope for the
MVP, or add `v_adaptation_membership` and derive the FK from it the way `compute-reference.ts` now derives
hotspot membership.

**Where the antithesis fails.** It does not reach the engine or the language boundary; ADR-1 and ADR-2 are
untouched by it. And unlike the hotspot case, there is a legitimate reason to prefer the FK: adaptation zones
are curated judgements, not measured geography, so hand-assigning membership is defensible in a way that
hand-assigning hotspot membership was not. That is an argument for **deleting the polygon**, not for keeping
both.

---

## 3. Unresolved tensions

**T1 - "Today" is 2025, and the demo is in September 2026.**
The base year is justified as the origination year of every seeded loan (L163, L305, L599), which is a clean
justification for the probability arithmetic. But the scenario is labelled "today" in the slider, the case
screen and the demo script, and it resolves to a year that has already passed. The knock-on is that
`revalue_by_year = 2025` is a reachable and expected outcome for Hong Kong pins (L456-459), so the dashboard
will tell a risk manager that roughly 10 to 35 cases needed revaluing last year. That may read as a feature
(overdue revaluations) or as a bug (the clock is wrong), and the plan does not say which it intends. See
defect 9.

**T2 - The heat baseline is not the same baseline at "today" and at 2030.**
`today` is a zero delta by construction, while `y2030` is the NEX-GDDP 2016-2035 window minus the ERA5-Land
baseline (L601). That window is centred on 2025.5 - the same period "today" denotes. So the identical physical
climate yields zero at one slider position and a positive haircut at the next, and the difference comes from
the label rather than from the climate. See defect 4.

**T3 - The rubric time-box is a schedule control, not a quality control.**
ADR-3 now time-boxes rubric tightening to 45 minutes on Day 4 and accepts the observed divergence rate past
that (L124-125, L811). That is good schedule discipline and I endorse it. The residual tension is that the
demo script promises "a genuinely divergent hotspot" (L988) while the fallback if none diverges is a
`score_source = 'fixture'` row (L557-558). Both branches are handled honestly, but the plan never says what the
presenter says out loud in the second branch, and demo step 1 is scripted around the first.

---

## 4. Synthesis

Keep every ADR. Extend ADR-7 by one sentence and one table, which is the same move that made iteration 3 better
than iteration 2:

1. **Name the authority for adaptation-zone containment.** The cheapest correct answer is to delete
   `adaptation_projects.area`, state in ADR-4 that adaptation membership is a curated per-collateral assignment
   rather than a spatial join, and add an assertion to `tests/db/adaptation-toggle.test.ts` that `SG-EC-014` has
   `adaptation_project_id IS NULL` and `SG-EC-041` points at Long Island. That pins AC-2 and AC-3 against the
   fact they actually depend on, costs one line of SQL and two assertions, and removes a polygon that nothing
   reads.
2. **Move the `building_type` to `damage_class` mapping into the seed or into TypeScript** (defect 5). It is a
   classification rule, ADR-2 reserves rules for TypeScript, and it is not in ADR-2's declared exemption list,
   which currently covers only `prep/lib/synthetic.py`.

Both changes apply the plan's own principle 5 to the two places it has not yet reached. Neither touches the
engine, the schedule or any acceptance criterion.

---

## 5. Concrete defects

**1. L363-378 versus L401-403 - `floodHaircut` returns a number in one branch and an object in the other, and
the call site does not type-check.**
`const ABSENT = 0` (L365) is returned when `contributes(sample)` is false (L370), but the success path returns
`{ net, gross, documented, effective }` (L376). The declared return type is therefore `0 | { net: number, ... }`.
`valuate` then does `max(fr.net ?? 0, fc.net ?? 0)` (L402-403). Accessing `.net` on the `0` branch is a
TypeScript compile error, not a runtime nicety that optional chaining rescues. This is a regression introduced
by the D10 fix, which changed `floodHaircut`'s success shape without changing its absent shape.
*Fix:* return a zeroed object, `const ABSENT_FLOOD = { net: 0, gross: 0, documented: 0, effective: 0 }`, and
keep the scalar `ABSENT` for wind, heat and PM2.5, whose shapes did not change.

**2. L490, L502-504, L890-891 - the prompt payload is described as eight keys; it is six.**
The commented block lists `hazard_scores_by_type`, `exposure_sgd`, `exposure_share`,
`recent_event_count_90d`, `recent_event_severity_90d`, `days_since_last_event`. That is **six top-level keys**,
or **nine leaves** once `hazard_scores_by_type` is expanded, and the `input_field` enum correctly calls it nine
(L521). Neither count is eight, yet the payload is described as "exactly these eight keys" (L490), the
projection test asserts "the emitted key set **equals** an exact allowlist" of "the eight fields above" (L503),
and section 6 repeats "the eight-field allowlist" (L890). A test specified as an exact set equality cannot be
written from a wrong cardinality.
*Fix:* say six top-level keys, or restate the allowlist at leaf level as nine and align it with the enum. The
six do match the spec's closed list term for term, so only the count is wrong.

**3. L541-547 - the tightened citation tolerance drops percent rendering and will drive systematic fallback.**
The tolerance admits an exact match, a 1-3 significant-figure rounding, and a magnitude rendering
(`128,400,000` matching "S$128.4m"). The blanket 1-100 exemption was deliberately removed, so a bare integer
now must cite unless it is preceded by "score", "index" or "band". `exposure_share` is a fraction, and the
natural sentence for a model to write is "18% of the book". Under this rule `18` is a bare integer that does
not equal `0.18`, is not a rounding of it, and is not a magnitude rendering of it, so the rationale is rejected,
two retries fail the same way, and the hotspot falls back. Iteration 1's narrative validator explicitly
tolerated "percent forms"; the tightening lost that.
*Fix:* add the percent form to the tolerance, so a token `x` matches an input value `v` when `x = 100v` and the
token is adjacent to a percent sign or the word "percent". Apply it in `lib/narrative/validate.ts` too, since
section 4.8 shares this tolerance and case narratives quote LTVs and haircuts the same way.

**4. L601 versus ADR-5 - the heat baseline differs between today and 2030.**
`today` is defined as a zero delta by construction, while `y2030` is the NEX-GDDP 2016-2035 window minus the
ERA5-Land baseline. The 2016-2035 window is centred on 2025.5, which is the period `today` denotes, so the
already-realised warming between the ERA5-Land baseline and the present is charged to 2030 and not to today.
The same climate produces two different haircuts depending only on the scenario label, which is precisely the
kind of thing driver 2 says a director will pull on.
*Fix:* either move `y2030` to a later window (2021-2040) and let `today` carry the realised delta measured
against the same ERA5-Land baseline, or state explicitly in ADR-5 and on the provenance panel that the heat
term is defined as warming **relative to now**, so today is zero by definition rather than by accident.

**5. L300, L598 versus ADR-2 - the `damage_class` mapping is a classification rule living in Python.**
`collateral.damage_class` is an enum of three values derived from `building_type`, an enum of six, and
`gen_portfolio.py` writes it (L598). Choosing which of six building types maps to residential, commercial or
industrial determines which depth-damage curve applies and therefore every flood haircut. That is a rule.
ADR-2 reserves rules for TypeScript and its declared exemption covers only `prep/lib/synthetic.py` (L117-123).
*Fix:* put the mapping in `db/seed/02_reference.sql` next to the curves, or in `lib/valuation/damage.ts`, and
have the generator write `building_type` alone.

**6. L306-307, L455-459 - `revalue_by_year` is scenario-invariant by definition but stored per scenario.**
It is "the first scenario year whose total haircut crosses `band_mid`" over the fixed list `[2025, 2030, 2050]`,
so it is a property of the application, not of a scenario. Yet `recommendations` is
`UNIQUE(loan_application_id, scenario, rule_set_id)` and carries `revalue_by_year` on every row, and
`v_portfolio_summary` is grouped by `(scenario, country)` and counts applications with `revalue_by_year <= 2030`
(L346-348). The same application contributes three identical rows, so the count is correct only if the view
filters to one scenario or counts distinct applications, and the figure will not change as the slider moves even
though AC-6 presents it as a per-scenario figure.
*Fix:* either compute the count with `COUNT(DISTINCT loan_application_id)` and state that this tile is
scenario-invariant, or move `revalue_by_year` off `recommendations` onto a per-application row.

**7. L302 versus L300 - adaptation-zone containment has two definitions and no reconciliation.**
`adaptation_projects.area` is a polygon and `collateral.adaptation_project_id` is a foreign key. The FK is what
the engine reads; nothing derives it from the polygon and no test asserts they agree. AC-2's 6.6% depends on
`SG-EC-014` being outside the Long Island zone while `SG-EC-041`, also East Coast, is inside it - a distinction
the FK encodes and the polygon would very likely contradict. This is the same defect class ADR-7 was written to
eliminate, at the one table ADR-7 does not cover, and here it touches a credit number rather than a triage score.
*Fix:* as in section 4 - drop the polygon and pin both fixtures' FK values in `adaptation-toggle.test.ts`, or
add `v_adaptation_membership` and derive the FK from it.

**8. L631 versus L974 - the z0-z6 fallback is claimed to cover city scale, and the rehearsal tests city zoom.**
The fallback row says the committed floor leaves "the map usable at country and city scale". At z6 a tile spans
about 5.6 degrees, and Protomaps z6 tiles carry country and major-road geometry only; MapLibre overzooming
keeps it crisp but cannot add features the tile does not contain. A Singapore-scale view from a z6 tile is
close to empty. Rehearsal step 6 asks the tester to "confirm the basemap renders at country **and city** zoom
with the interface disabled" (L974), which passes on the z0-z10 archive and would fail on the floor the
fallback describes.
*Fix:* restate the floor as country and regional scale only, and add one line to step 6 noting that city zoom
requires the fetched archive, so a tester who is exercising the fallback path knows what to expect.

**9. L163, L305, L456 - the "today" scenario resolves to 2025 in a September 2026 demo.**
`today_year = 2025` is well chosen for the probability arithmetic and for `revalue_by_year`, and the origination
-year justification is sound. But the slider's leftmost position is labelled "today" while resolving to a past
year, and `revalue_by_year = 2025` will render as a revaluation date that has already lapsed for the 10 to 35
Hong Kong and coastal China cases S17 expects (L780-784).
*Fix:* label the scenario "2025 (origination)" rather than "today" in the slider and the case screen, and add
one line to the demo script explaining that revaluation dates in the past mean overdue, which is a finding
rather than a defect. This costs nothing and removes the most likely unscripted question in demo step 3.

---

## 6. Improvement suggestions

1. Return a zeroed object from `floodHaircut`'s absent branch so the function has one shape and `valuate`
   compiles.
2. Correct "eight keys" to six top-level keys, or restate the allowlist as nine leaves to match the enum.
3. Add percent rendering to the citation tolerance in both `validate-score.ts` and `validate.ts`.
4. Fix the heat baseline so today and 2030 are measured against the same reference, or state the
   relative-to-now definition explicitly on the provenance panel.
5. Move the `building_type` to `damage_class` mapping into the seed or into `lib/valuation/damage.ts`.
6. Count the revaluation tile with `COUNT(DISTINCT loan_application_id)` and mark it scenario-invariant.
7. Drop `adaptation_projects.area` and pin both fixtures' `adaptation_project_id` in the AC-3 test.
8. Restate the z0-z6 fallback as country and regional scale, and note in rehearsal step 6 that city zoom needs
   the fetched archive.
9. Label the leftmost scenario "2025 (origination)" and script one line about overdue revaluation dates.
10. Move `tests/e2e/auth.spec.ts` from S18 on Day 3 to S3 or S4 on Day 1, so AC-1's test lands with AC-1 rather
    than two days later.
11. Add an assertion to `tests/db/hotspot-exposure.test.ts` covering a hotspot carrying **both** `area` and
    `radius_m`, since the OR predicate handles it correctly and nothing currently proves that.
12. State in ADR-3 what the presenter says in the `score_source = 'fixture'` branch, so demo step 1 has a script
    for both outcomes rather than only the divergent one.
13. Record in `docs/sources.md` that `exposure_share` values across hotspots do not sum to one, because a
    collateral inside two hotspots counts in both, before a director adds up the popups.

---

## 7. Final verdict

**SOUND WITH CHANGES.**

This is a good plan. Thirteen of my fourteen iteration-2 defects are genuinely fixed rather than acknowledged,
the fourteenth is declined with a better answer than the one I proposed, and every quantitative claim the team
lead asked me to check is correct: the horizon probabilities are true roundings of one formula at `n = 0, 5, 25`
on a 2025 base, the basemap is 15,183 regional tiles plus a 510-tile overlay inside a 94 to 236 MB budget, the
seeded curve interpolates to 0.30 at 0.50 m and 0.42 at 0.80 m, all four pinned fixtures reproduce by hand
including the 2.64 percentage-point effective credit where the zero floor binds, the three coverage states
separate measurement from policy consistently across the schema and both tests, ADR-7 makes PostGIS the single
owner of hotspot containment with the exposure view built on top of the membership view, and all thirty-five
test files named in section 6 have an authoring step with a day and an owner. The "17 of 17 with an authoring
step" claim is true as written, which is not something I could say of either previous iteration.

What holds it back from SOUND is a short list of definitional and type-level slips, three of which were
introduced by the iteration-2 fixes themselves. The adaptation-credit refactor left `floodHaircut` returning two
incompatible shapes, so the engine as written does not compile. The payload the projection test is specified to
match exactly is described with the wrong cardinality in three places. The tightened citation rule lost percent
rendering, which is the single most likely way a model will phrase an exposure share, and the cost is systematic
fallback on the dashboard that opens the demo. Alongside those, the heat term uses two different baselines
either side of one slider position, and ADR-7's containment principle stops one table short of the adaptation
zones that AC-2 and AC-3 both depend on.

None of these require rethinking anything. Fix defects 1, 2 and 3, decide the adaptation-containment authority
per section 4, and this plan is ready to build.
