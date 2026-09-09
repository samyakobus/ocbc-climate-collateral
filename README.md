# OCBC Climate Risk Platform with Collateral Decision Tool

A five-day MVP: a climate-adjusted collateral valuation engine, a portfolio hazard map, a risk-manager
dashboard and an AI Dashboard, over a synthetic 200-property portfolio across SG, MY, ID, CN and HK.

**Synthetic portfolio, illustrative figures.** Every applicant, loan and appraisal in this repository is
generated. Hazard values are sampled from published datasets; the credit figures derived from them are a
demonstration, not advice.

Authoritative plan: `.omc/plans/ocbc-climate-collateral-mvp.md`. Specification:
`.omc/specs/deep-interview-ocbc-climate-collateral.md`. Read section 3 (ADRs) before changing anything
numeric.

## What is deterministic

Every credit figure is reproducible by hand from stored inputs and a published formula. The single scoped
exception is the AI Dashboard hotspot score 1-100, which the LLM assigns; it is fenced by a deterministic
reference index shown beside it, a divergence badge past 25 points, and a fallback. No haircut, LTV or loan
condition is model-assigned.

## Quick start

```bash
cp .env.example .env          # fill AUTH_SECRET; the LLM and Maps keys are optional
npm install

npm run db:up                 # leave running: local Postgres 18 + PostGIS 3.6 on 127.0.0.1:5432
npm run db:migrate            # db/migrations/0001_schema.sql, 0002_views.sql
npm run db:seed               # frozen replay, falling back to synthetic
npm run db:recompute          # valuations, application_valuations, recommendations
npm run prep:reference        # score_inputs and reference_index

npm run dev                   # http://localhost:3000
```

Seeded users, password `Demo!2026`: `officer@ocbc.demo` (loan officer), `corp@ocbc.demo` (corporate credit
officer), `risk@ocbc.demo` (risk manager).

## The database

The app and every test speak the ordinary Postgres wire protocol through `pg` and `DATABASE_URL`. Two
servers satisfy that contract and the SQL is identical on both.

| | Command | Server |
|---|---|---|
| Local development | `npm run db:up` | PGlite with the PostGIS extension, in process, served on a socket |
| Demo day | `docker compose up -d` | `postgis/postgis:16-3.4` |

Docker is not installed on the Day-1 build host, which is why the local path exists. It is a container
substitution only: PostGIS still owns spatial containment, so `v_hotspot_membership` is the single
definition of which collateral belongs to which hotspot (ADR-7). See plan section 10.

`npm run db:up -- --fresh` discards the local data directory. It **refuses to run when
something is already listening on the port**, because deleting the directory while a server
holds it corrupts the store: the running process keeps accepting connections and serves an
empty, damaged directory, and every later migration fails with "unexpected data beyond EOF".
Stop the running server first. To bring up a second instance instead, give it its own port
and directory, `PGLITE_PORT=5433 PGLITE_DATA_DIR=./data/pglite-alt npm run db:up -- --fresh`,
or use `--memory`, which persists nothing.

`npm run db:migrate -- --reset` drops every view, table and enum the migrations own and
reapplies them, leaving the PostGIS extension in place.

`/rules` writes a NEW active rule set on every save, which is what AC-9 requires, so a
Playwright run leaves the shared database with a test-created rule set active and the
seeded one dormant. `npm run db:reset-rules` deletes every test-created rule set, resets
the seeded one to the defaults in `lib/rules/bands.ts`, reactivates it and recomputes.
Run it after any Playwright run against the shared instance, and before reading the
dashboard figures. `-- --dry-run` reports what it would do.

Seeding may insert explicit ids into identity columns, which leaves their sequences behind. Run
`npm run db:migrate -- --sync-sequences` at the end of seeding, or the first id-less insert
collides. That first insert is the risk manager saving a threshold edit, which is AC-9.

## Configuration

Every environment variable the running app reads goes through `lib/config/env.ts`, and
`tests/unit/no-literal-env-reads.test.ts` fails if a literal `process.env.SOMETHING`
appears anywhere in `app/`, `lib/` or `components/`.

That is not tidiness. **Turbopack replaces a literal `process.env.SOMETHING` in the
production bundle with that variable's value at BUILD time.** A variable absent from the
build folds to `undefined`, so any default behind it wins for ever and nothing supplied
at run time is ever seen. It cost a real bug: the refresh routes read their feed host
directly, the offline specs pointed that host at a dead port, and the routes reached NASA
anyway and reported success. Reading by variable key at call time defeats the
substitution. `NODE_ENV` is exempt, because inlining it is the point.

The three outbound hosts are overridable, defaulting to the real services, which is what
makes the offline rehearsal testable:

```bash
FEED_EONET_BASE=http://127.0.0.1:9 FEED_GIBS_BASE=http://127.0.0.1:9   THUMB_BASE=http://127.0.0.1:9 npx playwright test
```

No rebuild is needed to change one.

## Offline

No server component, layout or GET route makes an outbound call. Outbound calls live in exactly five files,
each behind a POST or a server action, each with a timeout and a cached fallback:
`app/api/refresh/{tiles,news,thumbs}`, `app/api/narrative/regenerate` and `app/actions/rescore-hotspot.ts`.
`tests/unit/no-network-on-render.test.ts` enforces the list by scanning call sites, and asserts its length,
so adding a sixth is a decision rather than a one-line diff.

**There is no carve-out.** The per-property satellite thumbnail was the one the spec seemed to ask for, and
it is not one: the case screen renders `collateral.satellite_thumb_path`, a committed file under
`public/cache/thumbs/`, so nothing is fetched at render time and there is no degraded view to rehearse.
Refreshing one property's image is a POST like the others.

The basemap is a Protomaps `.pmtiles` archive read locally. A z0-z6 floor is committed so a clean clone
renders at country scale; `npm run prep:basemap` fetches the two larger archives for city zoom.

## Data sources

`npm run db:seed` replays `data/frozen/`. If that is absent it falls back to `data/synthetic/`, which is
committed and needs nothing external. Prep scripts take `--source=live|frozen|synthetic`; `live` requires
Earth Engine credentials and rewrites `data/frozen/`.

Every dataset, version, licence and URL is recorded in `docs/sources.md`, including the six pinned fixture
rows, which are the only rows in the database that are not sampled.

## Clean machine (AC-13)

The whole thing runs from a fresh clone with **no Earth Engine account, no API key and no network**. This
is the sequence to prove it on a second laptop, and it is what `tests/prep/test_clean_machine.py` asserts
the automatable half of.

```bash
git clone <repo> && cd <repo>
cp .env.example .env           # set AUTH_SECRET to any 32+ character string
                               # leave every other key blank: the app starts without them
npm install
python -m pip install pytest

npm run prep:basemap           # OPTIONAL, and the last step that may use the network
```

`prep:basemap` fetches the two large `.pmtiles` archives, which are gitignored. **Skip it** and the
committed z0-z6 floor renders country and regional geometry only. A Singapore-scale view from the floor is
close to empty, the map says so on screen, and that is the documented fallback rather than a failure.

**Disable the network interface here.** On Windows, in an elevated PowerShell:

```powershell
Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false
Test-NetConnection eonet.gsfc.nasa.gov -Port 443    # expect TcpTestSucceeded : False
```

Everything below runs with the interface down. Loopback survives, so the app and the database keep talking.

```bash
npm run db:up                  # leave running. -- --memory persists nothing; -- --fresh discards a
                               # previous data directory
npm run db:migrate
npm run db:seed                # the five committed seed files
npm run db:recompute           # 600 valuations, 200 pins x three horizons
npm run prep:reference         # score_inputs and reference_index, no API key
npm run verify:dashboard
python -m pytest tests/prep -q
npm run build
npm run start                  # http://localhost:3000
```

Expected output, against the seeded rule set:

| Figure | Value |
|---|---|
| Collateral | S$2,396,510,000 over 200 properties |
| 2050 amber or worse, by value | 66.01% (S$1,581,830,000) |
| 2050 total haircut | S$175,376,417 |
| Revaluation due by 2030 | 3 |

`verify:dashboard` recomputes each figure a second way from the base tables and fails if the view and the
base tables disagree, so it is the one step that proves the numbers rather than displaying them.

Two things to know before you start.

**Nothing here regenerates a seed file.** The seeds are committed artefacts, and
`tests/prep/test_clean_machine.py` asserts that each generator reproduces its file byte for byte, which
is a different job from a fresh clone doing it again. Regenerating is safe now that each seed file has
exactly one writer, but it is not part of this sequence: what AC-13 is testing is that a clone can seed
from what is committed.

**If `db:seed` fails**, the cause is a seed file that was generated but never committed. That is exactly
the failure AC-13 exists to catch, and it is why this sequence is run on a machine that has never built
anything.

Then work `tests/offline/checklist.md` end to end. It covers the clauses no test runner can observe.

## Tests

```bash
npm run verify:all            # everything below, in order, one summary table
```

That is the gate: tsc, eslint, vitest, pytest, a production build, both Playwright projects and
`verify:dashboard`. It runs every step even after one fails, prints a result, a count, a skipped
count and a duration per step, and **fails if either Playwright project skips a single test**.
`-- --skip=playwright`, `-- --only=vitest,pytest`, `-- --bail` and `-- --list` narrow it.

The pieces on their own:

```bash
npm test                              # vitest: unit (node), component (jsdom), db (pg)
npx playwright test --project=default # everything except the offline suite
npm run verify:dashboard              # recomputes the four headline figures, no browser
python -m pytest tests/prep -q
```

**Playwright projects.** There are two, `default` and `offline`, and the second is added to the
config only when all three feed hosts are overridden, so the offline suite is never collected in an
ordinary run rather than skipped in one. Two invocation quirks worth knowing: a bare
`npx playwright test` exits 127 by design, so always name a project; and the flag needs its equals
form, since `--project default <file>` misparses the filename as a project name.

```bash
FEED_EONET_BASE=http://127.0.0.1:9 FEED_GIBS_BASE=http://127.0.0.1:9 \
THUMB_BASE=http://127.0.0.1:9 npx playwright test --project=offline
```

**Cached imagery.** Both refresh routes write a new hashed file and leave the old one in place, so
a Playwright run against a live feed leaves orphans under `public/cache/`. `npm run cache:prune`
reports what nothing points at; `-- --delete` removes it. Run it before any commit.

### If the map suddenly fails to render under Playwright

Check for a leaked web server before anything else:

```powershell
netstat -ano | Select-String LISTENING | Where-Object { $_ -match ':(3[1-7]\d\d)\s' }   # PowerShell
lsof -nP -iTCP -sTCP:LISTEN | awk '$9 ~ /:3[1-7][0-9][0-9]$/'             # macOS, Linux
```

`playwright.config.ts` derives the application port as `3100 + (pid % 700)`, so a leaked
`next start` sits somewhere in 3100-3800. It holds `.next/static` open; the next `npm run build`
rewrites those files underneath it, and it then serves HTML whose stylesheet and client bundle
404. The map never mounts and the canvas wait times out, which reads as a rendering bug in
whichever spec ran first and gets worse with every run since the last cleanup.

`scripts/e2e-server.ts` now refuses to start when it finds a listener in that range and names the
pids and the command to kill them (`taskkill /T /F /PID <pid>` on Windows, `kill -9` elsewhere).
It also kills the whole process tree on every exit path and starts the Next binary directly rather
than through `npm run start`, so there is no shell left to orphan. `E2E_SKIP_PORT_SCAN=1` bypasses
the check when the listener is something else of yours.

## Layout

`app/` routes, `lib/` engine and rules, `components/` UI, `db/` migrations and seed, `prep/` Python
sampling, `scripts/` TypeScript prep and admin jobs, `tests/` five projects, `docs/` sources and demo
script.
