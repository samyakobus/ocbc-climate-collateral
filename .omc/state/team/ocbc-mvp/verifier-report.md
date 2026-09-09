# Independent Verification Report — team ocbc-mvp

Environment confirmed before running anything: DB (PGlite/PostGIS) already listening on
127.0.0.1:5432; no stray Playwright/Next listeners in 3100-3800 (the two `netstat` hits at
34531/35541 were VS Code's own ports, a substring false match); one clean `verify:all` run,
no re-run needed.

## `npm run verify:all` — verbatim summary table

```
  Step                          Result  Count                                   Skipped  Time
  ----------------------------  ------  --------------------------------------  -------  ------
  TypeScript                    PASS    no errors                               -        9.8s
  ESLint                        PASS    clean                                   -        16.2s
  Vitest (unit, component, db)  PASS    505 passed (505), 44 passed (44) files  -        62.2s
  Python prep suite             PASS    119 passed, 12 skipped                  -        8.2s
  Production build              PASS    routes emitted                          -        19.5s
  Playwright, default project   PASS    39 passed                               0        134.4s
  Playwright, offline project   PASS    8 passed                                0        51.1s
  Dashboard figures             PASS    view and base tables agree              -        1.8s

  8 of 8 steps green.
```
No re-run was needed for either documented flake pattern (server-death wall, live-EONET flake).

## AC-1..AC-17

| AC | Evidence observed | Verdict |
|---|---|---|
| AC-1 | `auth.spec.ts` 10/10 passed, incl. risk manager → `/ai` with `/portfolio` one click away, `/signup` → 404 | PASS |
| AC-2 | Direct DB query, `SG-EC-001`@y2050: depth 0.500, damage 0.30, flood_haircut 0.0660, adjusted S$934,000.00, `application_valuations.max_loan_sgd` S$700,500.00 at ltv 0.750 against S$1,000,000 appraised. Exact match to spec | PASS |
| AC-3 | `adaptation-toggle.test.ts` etc. in the 505-test vitest run; ADR-4 zero-floor case (`SG-EC-003`) is documented design, not a defect | PASS |
| AC-4 | `caps-and-zeros.test.ts`, `applicability.test.ts` in vitest run; docs/sources.md confirms Jakarta PM2.5 (~41) and Kota Kinabalu wind stored as measured-not-scored | PASS |
| AC-5 | `slider.spec.ts` 7/7 passed | PASS |
| AC-6 | `npm run verify:dashboard` output matches docs/demo-script.md and README.md to the cent for all three scenarios (34.76%/S$832,980,000 … 66.01%/S$1,581,830,000; revaluation 3, scenario-invariant) | PASS |
| AC-7 | `pin-click.spec.ts` 4/4 passed; landslide tests in vitest run | PASS |
| AC-8 | `bands.fixtures.test.ts` in vitest run | PASS |
| AC-9 | `rule-edit.spec.ts` 5/5 passed | PASS |
| AC-10 | `narrative-assertions.test.ts`/`narrative-fallback.test.ts` in vitest run; e2e boot log shows 21 narratives, all fallback (no API key) | PASS |
| AC-11 | Automated: offline Playwright project 8/8 passed, request-listener asserts nothing leaves origin. Physical: `tests/offline/checklist.md` "Runs" table is blank (task #38 still flagged `[USER ACTION]`) | PASS-WITH-DEVIATION (physical rehearsal not yet run; automated half fully green) |
| AC-12 | `provenance-panel.test.ts` in vitest run | PASS |
| AC-13 | pytest 119 passed/12 skipped, incl. `test_clean_machine.py`; skips are the documented `frozen`-source skips (no EE credentials here) | PASS-WITH-DEVIATION (second-machine re-run since checkpoint 38aabde not re-verified here — needs the user's physical second laptop, per plan S30 note) |
| AC-14 | `tiles-cache.test.ts` in vitest run; offline spec's dashboard render test (#16/#17) passed with routes blocked | PASS |
| AC-15 | `hotspot-exposure.test.ts` in vitest run; `hotspot-popup.spec.ts` 5/5 passed | PASS |
| AC-16 | `news-list.test.ts`/`.test.tsx` in vitest run; offline news-refresh test passed | PASS |
| AC-17 | `hotspot-score.test.ts`, `reference-index.test.ts` (unit+db), `score-validate.test.ts`, `score-badges.test.ts`, `prompt-payload.test.ts` all in the 505-test run; e2e boot log confirms all 16 hotspots computed with fallback badges (no API key on this machine) | PASS-WITH-DEVIATION (docs/sources.md §12: no model-written score has ever been produced on this build; only the fallback path is exercised) |

## Five spot-checks

1. **Dashboard figures vs demo-script.md** — exact match, all three scenarios, to the cent. PASS.
2. **`SG-EC-001`@2050 worked example, queried directly against `valuations`/`application_valuations`** — 6.60% haircut, S$934,000 adjusted, S$700,500 max loan at 75% LTV. PASS, matches AC-2 exactly.
3. **200 satellite thumbnails** — `data/frozen/satellite_thumbs.csv` has 200 data rows; all 200 files present on disk under `public/cache/thumbs/`, none zero-byte; CSV luminance range 48.7–242.9, 0 rows outside the documented [12,245] bounds. Independently decoded 5 sample files with `sharp`: all real 256×256 JPEGs, computed means matched the CSV. PASS.
4. **`git status --short`** — 115 changed paths, all expected mid-checkpoint churn (source, docs, new `lib/config/`, `lib/index/`, `lib/narrative/`, thumbnails/tiles, one deletion of `scripts/gen-portfolio-sql.ts` per task #46). Nothing under `.omc/state/sessions` is tracked or staged; `.gitignore` line 36 explicitly excludes "OMC ephemeral session state". `data/pglite*/` is gitignored and the running instance is healthy (all DB queries above succeeded against it). PASS, nothing unexpected.
5. **Literal `process.env.` reads and `@anthropic-ai/sdk` imports** — grep of `app/`, `lib/`, `components/` for `process.env.` found only `NODE_ENV` (explicitly exempted) plus comments referencing the pattern. `@anthropic-ai/sdk` imports found in exactly four files: `app/api/narrative/regenerate/route.ts`, `app/actions/rescore-hotspot.ts`, `scripts/gen-narratives.ts`, `scripts/gen-hotspot-scores.ts` — all documented entry points, none elsewhere. PASS.

## Findings not called out in the changelog

None found. Specifically checked and clean:
- `grep -rn "TODO\|FIXME"` across `app lib components scripts prep tests` (`.ts/.tsx/.py`) — zero hits.
- No skipped tests without a stated reason: the 12 pytest skips are the documented `frozen`-source skips (no Earth Engine credentials on this machine); the 0/0 skip counts on both Playwright projects are asserted by the gate itself.
- No stub/dead code noticed while reading `AGENTS.md`-adjacent docs, plan, changelog and running the suite.
- One item worth flagging even though it's not a defect: task list `tasks.md` #38 (offline rehearsal) is still `[USER ACTION]` and the checklist's "Runs" table is blank — the physical rehearsal genuinely has not happened yet, consistent with the handoff's own "Remaining" list.

## Verdict

**NOT APPROVED for unconditional sign-off — approved for rehearsal, with two open items that are the user's to close, not code defects:**

1. The physical offline rehearsal (`tests/offline/checklist.md`, task #38) has not been run. All automated proxies for AC-11 are green, but the spec itself carries this as a physical clause no runner can observe, and it hasn't been exercised yet on this machine.
2. AC-13's second-physical-machine clean-clone re-run (task #39, "re-run the clone after the Day-5 checkpoint commit") has not been re-verified since checkpoint `38aabde`; the automated `test_clean_machine.py` half is green here.
3. AC-17 has never produced a live model-assigned score on this build (no `ANTHROPIC_API_KEY` anywhere in this environment) — only the fallback path is proven. This is disclosed in `docs/sources.md` §12 and is a known, accepted risk, not a code defect, but the user should not present a "the model scored these" claim without first running `npm run prep:scores` with a real key and re-checking the divergence rate.

Everything mechanically verifiable from this machine — all 8 `verify:all` steps, all 17 ACs' automated evidence, and all five spot-checks — is green with no undisclosed gaps. Nothing in the code, tests, or docs contradicts the team's own changelog.
