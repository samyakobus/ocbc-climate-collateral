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

## Offline

No server component, layout or GET route makes an outbound call. Outbound calls live in exactly three
places: `app/api/refresh/*`, `app/api/narrative/regenerate` and `app/actions/rescore-hotspot.ts`, each with a
timeout and a cached fallback. `tests/unit/no-network-on-render.test.ts` enforces that by scanning call
sites. The one deliberate carve-out is the per-property satellite thumbnail.

The basemap is a Protomaps `.pmtiles` archive read locally. A z0-z6 floor is committed so a clean clone
renders at country scale; `npm run prep:basemap` fetches the two larger archives for city zoom.

## Data sources

`npm run db:seed` replays `data/frozen/`. If that is absent it falls back to `data/synthetic/`, which is
committed and needs nothing external. Prep scripts take `--source=live|frozen|synthetic`; `live` requires
Earth Engine credentials and rewrites `data/frozen/`.

Every dataset, version, licence and URL is recorded in `docs/sources.md`, including the six pinned fixture
rows, which are the only rows in the database that are not sampled.

## Tests

```bash
npm test                      # vitest: unit (node), component (jsdom), db (pg)
npm run test:e2e              # playwright against the running stack
npm run verify:dashboard      # recomputes the four headline figures, no browser
python -m pytest tests/prep -q
```

## Layout

`app/` routes, `lib/` engine and rules, `components/` UI, `db/` migrations and seed, `prep/` Python
sampling, `scripts/` TypeScript prep and admin jobs, `tests/` five projects, `docs/` sources and demo
script.
