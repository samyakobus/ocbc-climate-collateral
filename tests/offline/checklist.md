# Offline rehearsal checklist

**Status: the Day-5 rehearsal script (S26). S29 runs it twice, on the demo laptop.**

Covers AC-11, AC-13, AC-14 and AC-16. Every step here is a physical clause no test runner can
observe. Work it top to bottom without skipping: the value of a rehearsal is that it is done the
way the demo will be done, and a step taken out of order is a step not rehearsed.

Print this page or open it on a second device. The laptop under test has no network from step 3
onward, so a checklist that lives only on that laptop is fine, but anything you need to look up is
not.

---

## What the automated half already covers

These must be green before a rehearsal starts. If any is red, fix it first: a rehearsal is for the
clauses a runner cannot see, not for finding ones it can.

- `tests/unit/no-network-on-render.test.ts` - the static scan. It owns `OUTBOUND_ALLOWED`, the
  single constant naming the only places an outbound call may live. Do not restate that list here.
- `tests/unit/no-literal-env-reads.test.ts` - fails on a literal `process.env.X` outside
  `lib/config/env.ts`. This is what keeps the offline overrides working at run time rather than
  being folded into the bundle at build time.
- `tests/unit/refresh-fallback.test.ts` - what a failed refresh says, and that it promises nothing
  changed.
- `tests/e2e/offline.spec.ts` - **the automated offline run.** Every screen, both refresh buttons,
  the cached tiles, and a request listener asserting that nothing left the origin.
- `tests/e2e/refresh.spec.ts` - its `AC-11` block, which is the same mechanism applied to the two
  routes on their own.

Both e2e files need the server pointed at a dead port, and neither passes without it. They refuse
differently, and the difference is deliberate.

`offline.spec.ts` lives in its own Playwright project, `offline`, which
`playwright.config.ts` puts in the projects array ONLY when all three hosts are overridden.
Without them the file is not collected at all: never listed, never counted, never a skip that
someone reads as coverage. `refresh.spec.ts`'s former AC-11 block was moved into the offline project
too (2026-09-09), so a default run reports **0 skipped**; a non-zero skipped count in either project
is a failure, not a quirk.

Simplest way to run everything, including both Playwright projects, is one command:

```bash
npm run verify:all
```

It fails the gate if the offline project skips even one test, and prints a skipped count per step.
To run the offline suite alone:

```bash
npm run build
FEED_EONET_BASE=http://127.0.0.1:9 \
FEED_GIBS_BASE=http://127.0.0.1:9 \
THUMB_BASE=http://127.0.0.1:9 \
npx playwright test --project offline
```

Expect **8 passed, 0 skipped**. `npx playwright test --project=default` runs everything else and
does not list the offline file at all; **neither project may skip a single test**, and `verify:all`
fails the gate if either does.

Two harness facts, both learned the hard way, both worth reading before you believe a red run.

**Twenty failures that all say `ERR_CONNECTION_REFUSED` are one failure, and it is the server.**
Observed on 2026-09-09: a run reported 19 passed and 20 failed, every failure a connection refusal
rather than an assertion, because the web server process died partway through. The same build passed
39 of 39 on an immediate re-run. Read the first failure's message before diagnosing anything: if it
is a connection refusal, re-run once and say so in the notes. If it fails the same way twice, then
it is real.

**A leaked server from a previous run poisons the next one.** Before a full run, check for strays
and stop them:

```powershell
netstat -ano | findstr LISTENING | findstr ":31 :32 :33 :34 :35 :36 :37"
taskkill /T /F /PID <pid>      # for each one in the 3100-3800 range
```

A leaked `next start` keeps serving while a later build rewrites `.next/static` underneath it, so
pages come back unstyled and map specs time out waiting for a canvas.

Port 9 is the discard port. Nothing listens there, so every connection is refused at once instead
of hanging until a timeout.

Why not block in the browser: Playwright's `page.route` intercepts what the BROWSER requests, and
the refresh routes call out from the SERVER inside the Next handler, so a browser-level block sails
straight past them. Pointing the hosts at a dead port is what makes the server itself offline.

The hosts are read per request through `lib/config/env.ts`, so **no rebuild is needed** to change
them. Passing them to `npm run build` as well is harmless and costs nothing; do it if you want the
question closed. What is NOT optional is that they be set on the process that starts the server.

---

## Runs

| Run | Date | Operator | Result | Notes |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |

---

## Steps

Each step records **pass / fail** and, where a figure is fixed, the value actually seen. Write the
observed figure down even when it matches: a column of ticks with no numbers is not evidence.

### 1. Reset the rule set, before anything else

```bash
npm run db:reset-rules
```

| Pass / fail | Expected | Seen |
|---|---|---|
|  | keeps the seeded rule set, deletes every test-created one, recomputes 600 valuations, `verify:dashboard` agrees to the cent |  |

**Why this is step one.** `/rules` writes a NEW active rule set on every save and
`tests/e2e/rule-edit.spec.ts` saves on every Playwright run. Without this, the dashboard describes
a rule set nobody chose and every figure below is wrong for a reason that has nothing to do with
being offline. `-- --dry-run` reports without changing anything if you want to look first.

**And check the image cache while you are here.**

```bash
npm run cache:prune                 # reports, deletes nothing
npm run cache:prune -- --delete     # removes what nothing points at
```

Every successful refresh writes a NEW hashed file and deliberately leaves the old one, which is
what makes a rollback need no file restore. The Playwright suite presses those buttons, so a run
against a live feed leaves up to twelve orphans under `public/cache/tiles`. They are untracked and
a hurried `git add -A` sweeps them into a commit. Run this before any checkpoint.

| Pass / fail | Expected | Seen |
|---|---|---|
|  | 12 tiles and 200 thumbnails on disk, all referenced, 0 orphaned |  |

### 2. Bring the stack up and confirm it answers

```bash
npm run db:up            # leave running: PGlite with PostGIS, no Docker needed
npm run db:migrate       # first run on this machine only
npm run db:seed          # first run on this machine only
npm run db:recompute     # first run on this machine only
npm run prep:reference
npm run build
npm run start
```

| Pass / fail | Expected | Seen |
|---|---|---|
|  | `http://localhost:3000` answers; the login form renders |  |

Serve the **built** app, not `next dev`. The build is what the demo runs, and it is where the map
behaves differently: a production bundle is how the missing-pins defect surfaced at all.

### 3. Disable the host network interface

Do this physically. A proxy, a `hosts` file entry or a browser-level block all prove something
weaker than what AC-11 claims.

On Windows, in an **elevated** PowerShell:

```powershell
Get-NetAdapter                                   # note the Name of every Up adapter
Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false
Disable-NetAdapter -Name "Ethernet" -Confirm:$false
Get-NetAdapter                                   # confirm: every adapter reads Disabled
```

Disable **every** adapter that is Up, not only the one you think is carrying traffic. A laptop on
Wi-Fi with a dock plugged in has two, and a rehearsal that leaves one enabled proves nothing.

Then confirm the box is actually offline before continuing:

```powershell
Test-NetConnection eonet.gsfc.nasa.gov -Port 443   # expect: TcpTestSucceeded : False
```

| Pass / fail | Expected | Seen |
|---|---|---|
|  | every adapter Disabled; `TcpTestSucceeded : False` |  |

Loopback survives an adapter being disabled, so the app and the database keep talking. That is the
whole point: the machine can serve itself and cannot reach anything else.

### 4. Login and landing routes (AC-1)

Log in as each of the three seeded users. Password `Demo!2026`.

| Account | Lands on | Pass / fail |
|---|---|---|
| `officer@ocbc.demo` | `/cases?segment=personal` |  |
| `corp@ocbc.demo` | `/cases?segment=corporate` |  |
| `risk@ocbc.demo` | `/ai` |  |

Also confirm, as the risk manager, that `/portfolio` is one click away in the top navigation, and
that `/signup` returns 404. There is no sign-up in this application.

| Pass / fail | Expected | Seen |
|---|---|---|
|  | `/portfolio` reachable in one click from `/ai`; `/signup` -> 404 |  |

### 5. The six pinned fixtures (AC-2, AC-12)

Open each case screen at its default scenario, **2050**. These six rows are the only ones in the
database that are not sampled, and they are the numbers the demo says out loud, so they are checked
individually rather than by spot check.

| Case | Address | Haircut | Adjusted value | Band | Conditions | Seen |
|---|---|---|---|---|---|---|
| `SG-EC-001` | 12 Amber Road, Katong | 6.6% | S$934,000 | amber | no revaluation |  |
| `SG-EC-002` | 88 Marine Parade Road | 10.1% | S$899,000 | orange | revalue by 2050 |  |
| `SG-EC-003` | 215 East Coast Road | 3.1% | S$1,453,125 | amber | no revaluation |  |
| `SG-KB-003` | 31 Stadium Boulevard, Kallang Basin | 11.0% | S$1,068,120 | orange | revalue by 2050 |  |
| `SG-MS-002` | 8 Marina View | 18.3% | S$1,469,970 | orange | **refer to risk**, revalue by 2050 |  |
| `SG-MS-003` | 10 Marina View | 11.7% | S$1,588,770 | orange | revalue by 2050 |  |

`SG-EC-001` is the AC-2 worked example: a 0.50 m coastal depth reads 0.30 off the published curve,
times the 2050 probability of 0.22, gives 6.6%. It is the one figure a director can check on paper
while you talk, so have the derivation ready.

On every one of the six, confirm the **provenance panel** lists a row per hazard with its dataset,
version and coverage state, and that the **context panel** renders. Nothing on these screens is
fetched: every value is a stored column.

| Pass / fail | Expected | Seen |
|---|---|---|
|  | six provenance panels, each with a row per hazard and no blank source |  |

### 6. Five cases, one per country (AC-12)

One case from each market, so the rehearsal covers a screen from each. Suggested:
`SG-EC-001`, `MY-KK-001`, `ID-CJ-001`, `CN-NB-002`, `HK-TP-001`.

Two of these carry the measured-but-not-scored clause, and they are the ones worth showing:

| Case | Clause | Expected on screen | Seen |
|---|---|---|---|
| `MY-KK-001` | Kota Kinabalu wind | wind **measured at 34.7 m/s** (today; 36.4 at 2050), marked **not scored in Malaysia**, with its reason and source, contributing zero |  |
| `ID-CJ-001` | Jakarta PM2.5 | PM2.5 **measured at 40.5 ug/m3**, marked **not scored in Indonesia**, with its reason and source, contributing zero |  |

Singapore wind is a third thing again: `absent`, because STORM has no basin coverage there, so
there is no value to show at all. `absent` and `measured_not_scored` are not two spellings of "no",
and a rehearsal that shows both is what makes that point without a slide.

**Confirm what the satellite thumbnail looks like while the interface is disabled.** All 200 rows
carry a `satellite_thumb_path` pointing at a committed file under `public/cache/thumbs/`, and the
case screen renders that path rather than fetching anything, so **there is no degraded view: the
thumbnail looks exactly as it does online.** That is the answer to rehearse, and the thing to check
is that it is true rather than that a placeholder appears.

Two things to say out loud if anyone asks about the image. Without a Maps Static key the source is
NASA GIBS **HLS Sentinel-2 at zoom 12, about 30 m per pixel**, so it is a **district view centred
on the property, not a picture of the building**: 200 pins resolve to 33 distinct images and
neighbouring properties in the same district share one. And the refresh is per property, behind a
button, never on a render path.

**No thumbnail should be a blank square, black or white.** Three ways an image can be blank were
found and are now rejected by the pipeline and by the refresh route alike, so a blank one on screen
means something regressed rather than that the imagery is poor. Spot-check `SG-EC-001`, which was
the black one: it should show Singapore's east coast.

| Pass / fail | Expected | Seen |
|---|---|---|
|  | five case screens render; no broken image, no spinner that never resolves |  |

### 7. Scenario slider (AC-5)

On `/map`, move through all three positions, labelled **2025 (origination)**, 2030 and 2050.

| Pass / fail | Expected | Seen |
|---|---|---|
|  | at 2025: SG, MY and ID pins green; Hong Kong and coastal China amber |  |
|  | pins recolour as the slider moves; flood exposure grows into 2050 |  |
|  | a sampled pin's colour equals the band on its own case screen |  |

The 2025 band distribution, from `docs/demo-script.md`, if you want to count: 60 green in SG,
40 in MY, 40 in ID, 35 amber in CN, 25 amber in HK.

### 8. Basemap (AC-11)

| Pass / fail | Expected | Seen |
|---|---|---|
|  | the map renders at country zoom and at city zoom with the interface disabled |  |

If this laptop is running the **committed z0-z6 floor** rather than the two fetched archives,
expect country and regional geometry only: a Singapore-scale view is close to empty and the map
says so on screen. **That is the documented fallback, not a failure.** A clean clone has only the
floor, because the two large archives are gitignored; `npm run prep:basemap` fetches them and needs
a network, so it is done before step 3 or not at all.

### 9. Portfolio dashboard (AC-6)

Open `/portfolio` and compare against `npm run verify:dashboard`, which reads the database directly
and needs no browser.

| Scenario | Amber or worse, by value | Total haircut | Revaluation due by 2030 | Seen |
|---|---|---|---|---|
| 2025 (origination) | 34.76% (S$832,980,000) | S$39,942,725 | 3 |  |
| 2030 | 37.77% (S$905,180,000) | S$77,191,205 | 3 |  |
| 2050 | **66.01%** (S$1,581,830,000) | **S$175,376,417** | **3** |  |

Collateral total: **S$2,396,510,000** across **200** properties in five markets.

**The revaluation count is 3 and it does not move with the scenario.** It counts DISTINCT
applications, and the tile says "scenario-invariant" on screen so a figure that stays put while the
others change does not read as a bug. Nine `recommendations` rows carry a year of 2030 or earlier,
three per application.

| Pass / fail | Expected | Seen |
|---|---|---|
|  | the four headline tiles match the 2050 row above and `verify:dashboard` agrees |  |

If the figures look wrong, you skipped step 1.

### 10. AI Dashboard (AC-14, AC-15, AC-16, AC-17)

| Pass / fail | Expected | Seen |
|---|---|---|
|  | the satellite strip renders **12 cached regions** from `public/cache/tiles`, no broken image |  |
|  | the news list shows **at least 10** items, newest first (58 are seeded) |  |
|  | the hotspot list shows **16 hotspots** ordered by exposure |  |
|  | a hotspot popup shows name, summary, S$ exposure and share |  |
|  | the popup shows score, drivers, rationale, the stored input list and the reference index |  |

The last row is the one to watch. Whether it shows a model score or the reference index depends on
whether `prep:scores` was run with an API key BEFORE going offline: with a key (the demo laptop as
of 2026-09-09: 16 of 16 model-scored, 21 of 21 narratives model-written) the stored model output
renders offline exactly as it was stored; without one, **a fallback badge is the correct offline
answer, not a failure.** What would be a failure is a blank panel or a spinner.

### 11. Refresh buttons (AC-14, AC-16)

Press each. This is the clause the whole offline story rests on.

| Button | Expected message | Content after | Seen |
|---|---|---|---|
| Refresh tiles | "Could not reach ... **Showing cached imagery.**" | all 12 tiles still rendered |  |
| Refresh news | "Could not reach ... **Showing cached items.**" | the same item count, nothing removed |  |

Press each one twice. The second press must say the same thing as the first: identical messages are
how you can see from the outside that nothing was written.

### 12. Narrative regenerate (AC-10)

| Pass / fail | Expected | Seen |
|---|---|---|
|  | pressing regenerate on one case reports "The stored narrative is unchanged." and the narrative on screen is the SAME text as before the press (a failed live attempt never overwrites stored model output; only `prep:narratives` may) |  |

### 13. Hotspot rescore (AC-17)

| Pass / fail | Expected | Seen |
|---|---|---|
|  | pressing rescore reports "... Keeping the stored score." and the score, drivers and rationale on screen are unchanged (if the row was already a fallback, it says so and shows the reference index with the badge) |  |
|  | **the stored score is not overwritten** - note it before and after; a failed live attempt never clears a model score, only `prep:scores` may |  |

Write the score down before you press the button. "It looks the same" is not an observation.

### 14. Illustrative ribbon

| Pass / fail | Expected | Seen |
|---|---|---|
|  | "Synthetic portfolio, illustrative figures" visible on `/ai`, `/portfolio`, `/cases`, a case screen, `/map` and `/rules` |  |

### 15. Network back up

Re-enable the interface and repeat steps 10, 12 and 13.

```powershell
Enable-NetAdapter -Name "Wi-Fi" -Confirm:$false
Enable-NetAdapter -Name "Ethernet" -Confirm:$false
Test-NetConnection eonet.gsfc.nasa.gov -Port 443   # expect: TcpTestSucceeded : True
```

| Pass / fail | Expected | Seen |
|---|---|---|
|  | refresh news succeeds and reports what changed; the three curated events survive |  |
|  | refresh tiles succeeds or reports honestly; the strip never goes blank |  |
|  | regenerate and rescore succeed if an API key is present, fall back cleanly if not |  |

The news upsert keys on `dedupe_key` and never deletes, so the BSD river pollution, Borneo forest
fire and NTT earthquake rows survive every refresh. Confirm they are still in the list.

---

## Before you start: no leaked web server

A rehearsal that begins on top of a leaked `next start` measures the leaked server, not this build.
It holds `.next/static` open, so any build since it started leaves it serving HTML whose stylesheet
and client bundle 404: the map does not render and the AI dashboard looks broken for a reason that
has nothing to do with the network being down.

```powershell
netstat -ano | Select-String LISTENING | Where-Object { $_ -match ':(3[1-7]\d\d)\s' }
```

| Pass / fail | Expected | Seen |
|---|---|---|
|  | nothing listening in 3100-3800 before the first run |  |
|  | nothing listening in 3100-3800 after the last run |  |

`scripts/e2e-server.ts` refuses to start when it finds one and names the pid and the kill command,
so this is a confirmation rather than a hunt. If the second row fails, the run leaked one and #47
has regressed: `taskkill /T /F /PID <pid>` clears it.

---

## Failures found

| Run | Step | What happened | Fixed in |
|---|---|---|---|
|  |  |  |  |
