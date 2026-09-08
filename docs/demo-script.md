# Demo script

Twelve minutes, six beats. Owner: A, through S31.

**Status: skeleton.** Beats 1, 5 and 6 are outlined from plan section 8 and firm up as the AI
Dashboard (S23), the narratives (S25) and the threshold editor (S18) land. The figures in beat 3
are real, recorded from the seeded database on 2026-09-08, and are re-recorded whenever the
portfolio or the rule set changes.

Every screen carries the ribbon: **synthetic portfolio, illustrative figures**. Say it once at
the start and let the ribbon carry it after that.

---

## Recorded figures

Regenerate with `npm run verify:dashboard`, which reads the database directly and needs no
browser. It recomputes each figure a second way from the base tables and fails if the view and
the base tables disagree.

Seeded on 2026-09-08 against the active rule set: 200 properties, S$2,396,510,000 of collateral.

| Scenario | Amber or worse, by value | Total haircut | Revaluation due by 2030 |
|---|---|---|---|
| 2025 (origination) | 34.76% (S$832,980,000) | S$39,942,725 | 3 |
| 2030 | 37.77% (S$905,180,000) | S$77,191,205 | 3 |
| 2050 | 66.01% (S$1,581,830,000) | S$175,376,417 | 3 |

**The revaluation count is 3 and it does not move with the scenario.** It counts DISTINCT
applications, because `revalue_by_year` is a property of the application, evaluated once over the
literal years [2025, 2030, 2050] and stored identically on all three `recommendations` rows.
Nine recommendation rows carry a year of 2030 or earlier, three per application. The tile is
labelled scenario-invariant on screen so a figure that stays put while the others change does not
read as a bug.

Three is lower than the plan's original "roughly 10 to 35" estimate in S17. That text is
superseded; see plan section 10. If a director asks why so few, the answer is that crossing the
10% mid band by 2030 needs wind plus a chronic term, and only the most exposed Chinese pins get
there at that horizon.

## Band distribution, by market

This is the table behind beat 2, and it is the single best evidence that the method has no
country branch in it.

| Scenario | SG | MY | ID | CN | HK |
|---|---|---|---|---|---|
| 2025 | 60 green | 40 green | 40 green | 35 amber | 25 amber |
| 2030 | 57 green, 3 amber | 39 green, 1 amber | 26 green, 14 amber | 32 amber, 3 orange | 25 amber |
| 2050 | 30 green, 19 amber, 11 orange | 32 green, 3 amber, 5 orange | 11 green, 10 amber, 11 orange, 8 red | 17 amber, 13 orange, 5 red | 13 amber, 12 orange |

---

## 1. AI Dashboard, landing as the risk manager (2.5 min)

Log in as `risk@ocbc.demo`. The risk manager lands here, with the portfolio dashboard one click
away in the top navigation.

Satellite strip, one hotspot popup, one news item, one insight. State the scoped exception in one
sentence: the model assigns this triage score, the deterministic reference index sits beside it,
and no credit number is model-assigned.

Show a divergent hotspot. **If the Day-4 run produced none, say so plainly**: "the model and the
formula agreed on every hotspot this run, so here is the badge on a worked example", pointing at
the `score_source = 'fixture'` row. Both branches are scripted; neither is a surprise.

> To fill in after S23: which hotspot, its score, its reference index, and the observed divergence
> rate from the Day-4 pre-generation run.

## 2. The map at 2025 (2 min)

Open `/map` at the leftmost slider position, labelled **2025 (origination)**, not "today". The
base year is the origination year of every seeded loan, which is what makes the probability
arithmetic clean, but the demo runs in September 2026 and a position labelled "today" resolving
to a past year invites the wrong question.

Point out that **Singapore, Malaysia and Indonesia are green while every Hong Kong and Chinese pin
is already amber**. 35 of 35 and 25 of 25. That is not a rule about countries; it is the
applicability table. Wind and PM2.5 are scored for China and Hong Kong only, and only the flood
term carries a horizon probability, which is zero at 2025. So a Hong Kong pin carries its full
present-climate typhoon wind and its chronic air quality on day one.

Then move the slider to 2050 and watch flood exposure grow across the coastal clusters: Indonesia
goes from 40 green to 8 red, Singapore from 60 green to 30.

## 3. Portfolio dashboard (1.5 min)

`/portfolio`, which defaults to 2050. Four headline figures and the ten most exposed cases.

Read the three numbers off the table above. Note two things without being asked:

- The revaluation tile is **scenario-invariant** and says so.
- Revaluation dates in the past mean **overdue**, which is a finding rather than a clock bug.

The top-ten list is ordered by the S$ the haircut removes, not by percentage, because a small
haircut on a large corporate property is a bigger hole in the book than a large one on a flat.

## 4. The case screen (3.5 min)

Open **`SG-EC-002`, 88 Marine Parade Road, first**, so the board sees a real case before it sees
a demonstration one: flood 6.6% plus heat 3.5% for a **10.1%** total and **S$899,000** adjusted.
That is what a Singapore mortgage actually looks like. Open the provenance panel and let the live
satellite thumbnail load.

Then open **`SG-EC-001`, 12 Amber Road**, as the isolation exhibit: the same flood exposure with
the heat term held at zero. Walk depth, curve and probability to the spec's **6.6%** and
**S$934,000**, and a maximum loan of **S$700,500** at 75% against an unadjusted S$750,000.

> 0.50 m of water, 0.30 damage on the seeded residential curve, times a 22% chance of at least one
> such flood before 2050. 0.30 x 0.22 = 6.6%.

**Say "this one's heat sample is pinned" out loud in the same breath**, before a director reads
`dataset_version = 'fixture: pinned'` off the provenance panel. Six rows in the database are
pinned rather than sampled and `docs/sources.md` lists all six.

Switch to **`SG-KB-003`** and toggle the adaptation preview: the Marina Barrage catchment credit
moves the flood haircut from 9.24% to 7.74%, a delta of exactly **1.50 percentage points**. The
toggle is a preview and writes nothing.

## 5. Conditions and the narrative (1 min)

Conditions and the revalue-by year, then the narrative. State plainly that on this screen the
model wrote the sentence and none of the numbers.

> To fill in after S25: which case reads best, and its exact condition strings.

## 6. Editing a threshold, live (1.5 min)

`/rules`: raise `band_mid` from 10% to 12%, save, return to the map. Pins recolour with no
restart. One server action, one transaction, one revalidate.

> To fill in after S18: how many pins change band at 2050 when the mid band moves to 12%.

---

## If something goes wrong

- **The map is empty at city zoom.** The committed z0-z6 floor carries country and regional
  geometry only. Say so; it is the documented fallback, not a failure. The fetched archives give
  city detail.
- **A thumbnail does not load.** That is the one live call the spec asks for, and its degraded
  view was rehearsed. Everything else on the screen is local.
- **A refresh button fails.** It shows a toast and changes nothing. That is the designed
  behaviour offline.
