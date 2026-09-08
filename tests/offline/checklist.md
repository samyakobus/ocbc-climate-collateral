# Offline rehearsal checklist

**Status: skeleton (S4, Day 1). S26 fleshes out the expected values on Day 5, and S29 runs it twice.**

Covers AC-11, AC-13, AC-14 and AC-16. Every step here is a physical clause no test runner can observe.
The automated half already exists and must be green first:

- `tests/unit/no-network-on-render.test.ts` — the static scan. It owns `OUTBOUND_ALLOWED`, the single
  constant naming the only three places an outbound call may live. Do not restate that list here.
- `tests/e2e/offline.spec.ts` — S26, with every outbound route blocked in the browser context.

Run this on the demo laptop, with the **host network interface physically disabled**
(`Disable-NetAdapter` on Windows), not with a proxy or a browser-level block. Record each run below.

| Run | Date | Operator | Result | Notes |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |

---

## Steps

Each step records **pass / fail** and, where the plan fixes a number, the value actually seen.

1. **Stack up.** `docker compose up -d` (or `npm run db:up` on the embedded path). Confirm the app answers
   on `http://localhost:3000`. — [ ]
2. **Disable the host network interface.** Confirm it is down before continuing; a rehearsal on a live
   interface proves nothing. — [ ]
3. **Login and landing routes (AC-1).** Log in as each of the three seeded users. Confirm each lands on its
   amended home route, that the risk manager reaches `/portfolio` in one click from `/ai`, and that
   `/signup` returns 404. — [ ]
   - `officer@ocbc.demo` -> `/cases?segment=personal`
   - `corp@ocbc.demo` -> `/cases?segment=corporate`
   - `risk@ocbc.demo` -> `/ai`
4. **Five cases, one per country (AC-12).** Confirm numbers, conditions, provenance rows and narratives
   render. Confirm a Kota Kinabalu case shows wind **measured, with its stored value, marked not scored in
   Malaysia**, with its reason. **Confirm what the satellite thumbnail looks like while the interface is
   disabled**, so the degraded view is rehearsed before demo step 4 might show it. — [ ]
5. **Scenario slider (AC-5).** Move through all three positions, labelled **2025 (origination)**, 2030 and
   2050. Confirm SG, MY and ID pins are green at 2025 while Hong Kong and coastal China pins are amber, that
   pins recolour as the slider moves, and that a sampled pin's colour equals its case band. Watch flood
   exposure grow into 2050. — [ ]
6. **Basemap (AC-11).** Confirm the map renders at country and city zoom with the interface disabled. If
   exercising the committed z0-z6 floor rather than the fetched archives, expect country and regional
   geometry only: a Singapore-scale view from the floor is close to empty, and that is the documented
   fallback, not a failure. — [ ]
7. **Portfolio dashboard (AC-6).** Confirm the four headline figures render and match
   `npm run verify:dashboard`, and that the revaluation count matches the number recorded in
   `docs/demo-script.md`. — [ ]  Expected count: `____` (S17 fills this in)
8. **AI Dashboard (AC-14, AC-15, AC-16, AC-17).** Confirm the satellite strip renders from cache, the
   hotspot popup shows summary, exposure, score, drivers, rationale, the stored input list and the reference
   index, and the news list shows at least 10 items newest first. — [ ]
9. **Refresh buttons (AC-14, AC-16).** Press each. Confirm a failure toast appears and **no content
   disappears**. — [ ]
10. **Narrative regenerate (AC-10).** Press regenerate on one case. Confirm the rule text renders in place
    of the narrative. — [ ]
11. **Hotspot rescore (AC-17).** Press regenerate score on one hotspot. Confirm the reference index renders
    with a fallback badge and the **stored score is not overwritten**. — [ ]
12. **Illustrative ribbon.** Confirm it is visible on every screen. — [ ]
13. **Network back up.** Re-enable the interface and repeat steps 8, 10 and 11. Confirm refresh, regenerate
    and rescore all succeed, and that the `SG-EC-002` thumbnail fetches live. — [ ]

---

## Failures found

| Run | Step | What happened | Fixed in |
|---|---|---|---|
|  |  |  |  |
