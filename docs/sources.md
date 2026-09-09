# Sources, versions and disclosures

Owner: A (S31). Every dataset behind a number on screen, what version of it, under
what licence, and where to check it. Then the things a director should be told before
they find them: the deviations, the curated values and the rows that are pinned rather
than sampled.

**Synthetic portfolio, illustrative figures.** Every applicant, loan and appraisal is
generated. Hazard values are sampled from the published datasets below; the credit
figures derived from them are a demonstration, not advice.

**Read the disclosures section.** It is not an appendix. Three of the numbers on the
case screen are curated judgements rather than measurements, six rows in the database
are pinned rather than sampled, and one of the two Hong Kong figures in the pitch
deck cannot currently be sourced.

---

## 1. Hazard datasets

The `hazard_samples.dataset_version` column on every row records which of these
produced it, and the provenance panel shows it. A row reading `synthetic` was derived
by a seeded model with no network access; a row reading `fixture: pinned` was written
by hand. Neither is presented as a measurement.

| Hazard | Dataset | Version pinned | Access | Licence |
|---|---|---|---|---|
| flood_riverine | Aqueduct Floods v2, `WRI/Aqueduct_Flood_Hazard_Maps/V2` | `v2 / ens-mean / slr-p50 / hist-epoch-1980`, 100-year, RCP 8.5, riverine baseline epoch 1980 | Earth Engine | CC BY 4.0 (WRI) |
| flood_coastal | Aqueduct Floods v2, coastal **with subsidence** | as above, **sea-level-rise percentile 50** | Earth Engine | CC BY 4.0 (WRI) |
| wind | STORM v4, 100-year return period, West Pacific and North Indian basins | **two editions**: present-climate [10.4121/12705164](https://doi.org/10.4121/12705164) for `today`, climate-change [10.4121/14510817](https://doi.org/10.4121/14510817) for 2030 and 2050 | download, rasterio | CC0 (4TU.ResearchData) |
| heat_days35 | NEX-GDDP-CMIP6, `NASA/GDDP-CMIP6`, ssp585, days above 35 C | `CMIP6 ssp585 / ens-mean / ref-window-2016-2035` | Earth Engine | public domain (NASA) |
| heat validation | ERA5-Land, `ECMWF/ERA5_LAND/DAILY_AGGR` | daily aggregates; validates the reference window, **never the subtrahend** | Earth Engine | Copernicus licence |
| pm25 | GHAP PM2.5 annual mean, `projects/sat-io/open-datasets/GHAP/GHAP_Y1K_PM25` | GHAP Y1K | Earth Engine (community catalogue) | CC BY 4.0 |

Two pinning choices are load-bearing and are recorded in the version string so a
reviewer can check them rather than take them on trust. Aqueduct publishes a per-GCM
stack, so an unpinned pick makes two runs disagree: the **ensemble mean over the five
GCMs** is taken, and coastal reads **sea-level-rise percentile 50**. STORM's
present-climate product is not a scenario of the climate-change product, so the two
editions are downloaded separately and `today` reads the first while 2030 and 2050
read the second.

### Site modifiers and terrain

| Field | Dataset | Notes |
|---|---|---|
| `site_modifiers.suhi_tertile` | Yale SUHI v4, `YALE/YCEO_UHI/UHI_yearly_averaged/v4` | daytime, ranked into tertiles 0/1/2 against the portfolio |
| `site_modifiers.ndvi_tertile` | Sentinel-2 `COPERNICUS/S2_SR_HARMONIZED`, NDVI at 300 m | as above |
| `collateral.slope_deg`, `landslide_flag` | Copernicus DEM GLO-30 slope, plus NASA LHASA | see disclosure 6 |

### Context factors, all seven unscored

They are shown on the context panel and never summed into a haircut.

| Factor | Dataset | Unit |
|---|---|---|
| haze | NASA FIRMS + GHAP | days above 55 ug/m3 per year |
| water_stress | [WRI Aqueduct 4.0](https://www.wri.org/data/aqueduct-global-maps-40-data) | withdrawal over supply |
| cooling_degree_days | [ERA5-Land](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land) | degree days above 18 C |
| subsidence_susceptibility | [Herrera-Garcia et al. 2021](https://www.science.org/doi/10.1126/science.abb8549) | **probability, not cm/yr** |
| sea_level_inundation | [IPCC AR6 regional projections](https://sealevel.nasa.gov/ipcc-ar6-sea-level-projection-tool), SSP5-8.5 median at 2050 | metres |
| coastal_erosion | [Deltares Shoreline Monitor](https://shoreline.deltares.nl/) | metres per year, negative is erosion |
| wildfire | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) | detections per year within 50 km |

## 2. Reference data

**Depth-damage curves.** Labelled on screen as `seeded curve, curated fit (JRC Asia)`.
Source: [Huizinga, De Moel and Szewczyk 2017, JRC EUR 28552](https://publications.jrc.ec.europa.eu/repository/handle/JRC105688),
Asia curves. See disclosure 2: this is a curated fit, not a transcription.

**Adaptation projects.** Curated judgements traceable to named programmes, not published
protection values. See disclosure 3.

| Project | Country | Credit (pp) | Source |
|---|---|---|---|
| Marina Barrage catchment | SG | 1.50 | [PUB](https://www.pub.gov.sg/Public/WaterLoop/OurWaterStory/MarinaBarrage) |
| Long Island / City-East Coast | SG | 3.00 | [NCCS Coastal Protection](https://www.nccs.gov.sg/singapores-climate-action/coastal-protection/) |
| SMART tunnel catchment | MY | 2.00 | [DID Malaysia / SMART](https://smarttunnel.com.my/) |
| NCICD coastal wall phase A | ID | 2.50 | [NCICD programme](https://www.deltares.nl/en/projects/national-capital-integrated-coastal-development) |
| Banger polder, Semarang | ID | 1.50 | [Banger polder project](https://www.deltares.nl/en/projects/banger-polder-semarang) |
| Happy Valley + Tsuen Wan drainage tunnels | HK | 2.25 | [HK DSD](https://www.dsd.gov.hk/EN/Our_Services/Stormwater_Drainage/index.html) |
| Shanghai 200-yr seawall standard | CN | 2.50 | [Shanghai Water Authority](http://swj.sh.gov.cn/) |

## 3. Regional layer

**Environmental events.** 58 rows. 55 are live from [NASA EONET](https://eonet.gsfc.nasa.gov/),
which aggregates GDACS among other feeds, filtered to the regional bounding box and the
90-day window, frozen to `data/frozen/environmental_events.csv`. Three are curated; see
disclosure 5. GDELT and NASA FIRMS were considered and not used: FIRMS needs an API key
and returns HTTP 400 without one, and GDELT adds volume rather than signal at this scale.

**Satellite tiles.** 12 rows, one per metro, from
[NASA GIBS](https://gibs.earthdata.nasa.gov/) MODIS Terra corrected-reflectance true
colour at zoom 6, captured 2026-09-07, committed under `public/cache/tiles/`. NASA GIBS
imagery is in the public domain. The strip renders from the committed file, so it works
with the interface disabled.

**Per-property thumbnails.** 200 files, one per collateral pin, committed under
`public/cache/thumbs/` and listed in `data/frozen/satellite_thumbs.csv` with the layer,
capture date and measured luminance of each. Public domain, as above.

The source is chosen per property by a **layer ladder, finest first**, and the first rung
that yields a usable scene wins:

| Rung | Layer | Zoom | Ground resolution | Tile span |
|---|---|---|---|---|
| 1 | HLS Sentinel-2 (`HLS_S30_Nadir_BRDF_Adjusted_Reflectance`) | 12 | ~30 m | ~9.8 km |
| 2 | HLS Landsat (`HLS_L30_Nadir_BRDF_Adjusted_Reflectance`) | 12 | ~30 m | ~9.8 km |
| 3 | MODIS Terra true colour | 8 | ~250 m | ~156 km |

Both HLS products are served by GIBS over WMTS with **no token and no key**, which was the
open question when this was built. On the 2026-09-09 run **all 200 pins resolved on rung 1**,
so MODIS was never needed. They are sparse in time rather than daily, because they are real
satellite passes, so the fetcher steps the capture date back up to 14 days per rung.

**Fidelity, stated because it is visible.** 200 pins resolve to **33 distinct images**, and
the most-shared covers **26 pins, 13% of the book**. Neighbouring properties in the same
district share a picture; properties in different districts do not. Each pin still gets its
own FILE, named for its collateral id, so a refresh moves one property without touching
another's. Setting `GOOGLE_MAPS_STATIC_KEY` and rerunning `npm run prep:thumbs` switches the
source to Google Maps Static at the property's own coordinates, which is a genuinely
per-property image; no code changes.

**Three ways an image can be blank, and all three are rejected.** This is worth recording
because the first version of the pipeline caught none of them and shipped a black square onto
the case screen the demo opens first.

| Failure | How it reads | Where it was found |
|---|---|---|
| Blank black | mean luminance 0.0 | MODIS z8/x201/y127 on 2026-09-08, shared by all 60 Singapore and 8 Johor Bahru pins including the fixture `SG-EC-001` |
| Blank white | mean luminance 251-255, fully opaque | total cloud over the Pearl River Delta |
| No data | 0% opaque, becomes pure white when composited | HLS tiles outside the satellite swath, north Jakarta |

Real imagery measured **48.7 to 242.9 mean luminance at 99.8% coverage or better**, so the
thresholds (floor 12, ceiling 245, coverage 90%) sit in wide gaps rather than on boundaries.
A tile failing any of the three is treated exactly like a missing one: step back a day, and
drop a rung when the days run out. The same three checks run in `/api/refresh/thumbs`, so a
live refresh cannot replace a good image with a blank one.

**Two notes on the mechanics.** GIBS serves the HLS layers as **PNG** despite the `.jpg` in
the WMTS path, at about 158 kB per tile, so every accepted tile is re-encoded as a 256x256 RGB
JPEG at quality 82, which is what makes 200 committed thumbnails 3.6 MB rather than 30 MB.
And the MODIS zoom was measured rather than read off the layer name: the matrix set is called
`GoogleMapsCompatible_Level9`, which suggests zoom 9 and does not deliver it, returning 12 of
14 tiles there against 13 of 13 at zoom 8.

**Basemap.** [Protomaps](https://protomaps.com/) basemap built from OpenStreetMap data,
**ODbL**, attribution rendered on the map. Three `.pmtiles` archives, all cut with
`go-pmtiles` v1.22.0.

| Archive | Tiles | Size | SHA-256 | Cut from |
|---|---|---|---|---|
| `asia-region-z0-z10.pmtiles` | 15,216 | 168.6 MB | `ce9521a7d9358d0e1bb6f32782c184a3ec69d09cb828566c1e5a528ed3370490` | build.protomaps.com/20260901 |
| `asia-cities-z0-z12.pmtiles` | 982 | 34.0 MB | `76c1c1fb7bafca7e557b93652ea131437ae8ba5a44f4d4630a4662b64adf39af` | build.protomaps.com/20260901 |
| `asia-z0-z6.pmtiles` (committed floor) | 96 | 3.3 MB | `1a33272e582513a3fe8390606beb3e7973c45a6495c9dfc5b990c23162f36272` | build.protomaps.com/20260906 |

Only the floor is committed. `npm run prep:basemap -- --verify` re-checks all three
against these values with no network at all, which is what the Day-5 rehearsal needs.
The Protomaps daily builds are retained about a week, so a re-cut from a later build
produces different bytes; that is expected and the script says so rather than failing
silently.

The `go-pmtiles` project publishes no `checksums.txt`, so the binary hashes were
computed from the downloaded assets on 2026-09-07 and pinned in
`scripts/fetch-basemap.ts` and `Dockerfile.web`:
Linux x86_64 `a3a206d8fc7c2692f21747ec7d3cef2d34e6977fb3ca0209ae7d8d40c5c99161`,
Windows x86_64 `d285d88989d23e81602a5651a60c5db37a75f287129c3d94da405d5a7227ca5a`.

## 4. Licences excluded

The Arup / GFDRR global landslide hazard map is **CC BY-NC** and is therefore not
shipped. Landslide input is Copernicus DEM slope plus NASA LHASA only.

---

# Disclosures

## 1. The horizon probability is a stored constant

`P = 1 - 0.99^n`, base year **2025**, `n = 0 / 5 / 25`, giving 0.0000 / 0.0490 / 0.2222,
stored as **0.00 / 0.05 / 0.22**. The stored values are authoritative and nothing derives
them at runtime. A director can check every one by hand.

Only the flood term is multiplied by `P`. Wind and the chronic perils are unconditional
return-period bands, and heat is zero at 2025 because the metric is warming relative to
the present and 2025 is inside the reference window. That is why **every Hong Kong and
Chinese pin is already amber at the leftmost slider position while Singapore, Malaysia
and Indonesia are green**: it is the applicability table, not a rule about countries.

`rule_sets.return_period` is a descriptive label, read-only in the editor, and does
**not** drive `P`.

## 2. The depth-damage curves are a curated fit, not a transcription

The published JRC Asia residential curve sits near **0.32** at 0.5 m. The seeded table
uses **0.30**, so that AC-2's 6.6% and AC-3's 1.50 point delta are mutually consistent
round numbers. The case screen labels the curve "seeded curve, curated fit (JRC Asia)".
This is a deliberate deviation from the published source and it is the reason the worked
example lands on a clean figure.

## 3. The adaptation credits are curated judgements

Every value in the adaptation table is a judgement traceable to a named programme. None
of them is a published protection value, and no source states a haircut credit in
percentage points, because no source is in the business of stating one. The rows carry
`curated = true` and the panel labels them as curated.

Adaptation is a credit in haircut units, not a depth reduction (ADR-4). The spec is
internally inconsistent here: its formula line subtracts a credit while its adaptation
bullet describes a depth reduction. Only the credit form makes the AC-3 delta a
documented constant rather than a curve-dependent one.

The credit is floored at zero, so a shallow-flooding property inside a high-credit zone
shows an **effective** credit smaller than the documented one. Both figures are rendered
side by side. `SG-EC-003` is the pinned case where the floor binds: documented 3.00 pp,
effective 2.64 pp, flood haircut 0.00%.

**Adaptation membership is a curated foreign key with no polygon.** Nothing derives it
from geometry, so no spatial join can produce a second opinion on a credit-relevant
number.

## 4. Six rows in the database are pinned, not sampled

These are the **only** unsampled rows, and the demo says so out loud before a director
reads `dataset_version = 'fixture: pinned'` off the provenance panel.

| Fixture | What is pinned |
|---|---|
| `SG-EC-001` | coastal depth 0.10 / 0.30 / **0.50** m; heat delta **0** at every horizon; wind absent; PM2.5 measured, not scored |
| `SG-EC-002` | same flood; heat delta 0 / 6 / **28** days; SUHI and NDVI tertile **1** |
| `SG-EC-003` | coastal depth 0.05 / 0.12 / **0.20** m; Long Island credit 3.00 pp |
| `SG-KB-003` | coastal depth 0.20 / 0.45 / **0.80** m; Marina Barrage credit 1.50 pp |
| `SG-MS-002` | elevation **0.6 m**, below the inundation boundary |
| `SG-MS-003` | elevation **2.6 m**, above it |

All six also pin their `sea_level_inundation` context row at 0.30 m. Pinning the two
Marina South elevations while sampling the sea level would leave that comparison with
one side fixed and the other free to move under it.

`flood_riverine` is pinned `absent` on all six, so exactly one flood peril can win the
maximum and the stored depth, damage fraction and both credit columns are unambiguous.

`db/seed/04_samples.sql` applies these **after** sampling in every source mode, and
`tests/db/fixture-pinning.test.ts` asserts they are identical under each. Without that,
synthetic depths derived from elevation and distance to coast would never land on 0.50,
0.80 and 0.20 m, the unit tests would still pass because they read the fixture
constants, and the figures walked on stage would diverge from the figures under test.

## 5. Three environmental events are curated

The spec names three by hand, and no live feed can be relied on to carry them on demo
day: the Cisadane river pollution incident near BSD City, a Central Kalimantan peatland
fire, and an earthquake off Flores in East Nusa Tenggara. They are present in every
source mode, carry real source URLs, and no live row shares their `dedupe_key`, so no
refresh can overwrite or drop them. The other 55 events are live from EONET.

## 6. The landslide flag and slope are derived under the synthetic floor

Plan 4.6 samples `collateral.slope_deg` and `landslide_flag` from Copernicus DEM slope
and NASA LHASA. Under `--source=synthetic` there is no raster, so slope is derived from
elevation scaled by a per-market terrain ruggedness factor, and the flag fires at the
spec's **25 degrees**.

It flags **10 of 200 pins**: 6 on the Kuala Lumpur hillsides, 3 in Tai Po / Sha Tin and
1 in BSD City. None in Singapore, none in coastal China, and no fixture. The scaling
coefficient was chosen to land in that range and in those markets: at a lower value only
5 pins flag, at a higher one sixteen do and Indonesia starts picking up pins that are not
on hillsides.

**Landslide is a manual-review flag, never a number.** Nothing multiplies it into a
haircut; the case screen renders a badge and a human decides.

## 7. Measured but not scored: the two cases worth showing

`hazard_applicability` has 25 rows and six of them read `scored = false`. Two of those
produce a genuinely useful answer rather than "not applicable".

**Jakarta PM2.5.** GHAP measures roughly 41 micrograms per cubic metre over Jakarta. The
value is **stored**, the coverage state is `measured_not_scored`, and the panel says
"measured at 41 ug/m3; not scored in Indonesia" with the reason and the source URL. It
contributes zero to the haircut.

**Kota Kinabalu wind.** STORM returns a real 100-year wind over coastal Sabah. Same
treatment. The plan retains Kota Kinabalu in the portfolio deliberately, because what
excludes its reading is a row in a table rather than a branch in the engine.

Singapore wind is different again: STORM has no basin coverage there at all, so the
state is `absent` and there is no value to store. `absent` and `measured_not_scored` are
not two spellings of "no", and the schema keeps them apart.

## 8. The 2030 heat column is small and noisy by construction

All three heat deltas are measured against one reference window, 2016-2035. The 2030
window is 2021-2040, which **overlaps the reference by fifteen of its twenty years**, so
the 2030 delta is small and noisy. Combined with `p_2030 = 0.05` on the flood term, 2030
is the least informative of the three columns, and the demo script says so rather than
letting the room infer that something is broken.

## 9. Hotspot exposure: what the shares mean

`v_hotspot_exposure` computes each hotspot's exposure as a share of the sum over all
hotspots, so **the shares sum to exactly 1.0 by construction**. That is a normalisation,
not a statement about the book.

The caveat usually worth stating is that collateral inside two hotspots is counted in
both, so hotspot exposures sum to more than the portfolio total and each share
understates its hotspot's true fraction. **That is not true of this seed.** The 16
hotspots do not overlap: 181 membership rows over 181 distinct pins. Their exposures sum
to S$1,182,061,000 against a S$1,219,706,000 loan book, which is **less**, because 19
pins sit in no hotspot at all. The caveat remains the right thing to write down, because
it is a property of the view rather than of this seed, but as seeded the figures
understate rather than overstate.

`exposure_share` has one home and two readers: the popup reads the view live, and the
prompt reads a snapshot taken into `score_inputs` at `prep:reference` time. **A reseed
moves the view before it moves the snapshot**, so `npm run prep:reference` must be rerun
after any change to the portfolio or to loan amounts.

## 10. Events attach to hotspots at 400 km

An event attaches to the nearest hotspot within 400 km and to nothing beyond. The radius
is calibrated on transboundary haze, the real regional-pressure mechanism in this basin,
and it was chosen by measurement: at 75 km one event of 58 attached to one hotspot,
leaving the reference index's event term at zero for fifteen of sixteen; at 400 km, 11
events attach across 7 hotspots; at 600 km, 35 attach across 10, but that has a Borneo
fire bearing on Shanghai. The 47 unattached events render on the news list and weigh
nothing.

## 11. Earthquakes move a number labelled climate risk

The reference index's event term weights by type: fire, flood and storm 1.0, haze and
pollution 0.8, **earthquake 0.3**. An earthquake is not a climate hazard, and giving it
a non-zero weight means a geophysical event moves a number the dashboard labels climate
risk. That is deliberate: the AI Dashboard's score is a triage signal about regional
pressure on a book, not an attribution claim, and the weight is the lowest of the six.

Two limits on how far that reaches, both worth stating before anyone asks.

**An earthquake can never enter a haircut.** The event weight lives only in the
reference index's event-pressure term. The valuation engine reads `hazard_samples`, and
the hazard enum has no member for seismic activity at all, so there is no path by which
an earthquake changes a collateral value, an LTV or a loan condition. The separation is
structural rather than a rule someone remembered to write.

**On the seeded data the effect is nil.** One earthquake is seeded, off Flores in East
Nusa Tenggara on 2026-08-05. Events attach to the nearest hotspot within 400 km and it
attaches to none, so its weight multiplies nothing. It still renders on the news list,
which is the correct reading: it happened, and it moved no number.

## 12. The hotspot score is the one LLM-assigned number

The displayed hotspot score is assigned by the model through structured output. A
deterministic reference index is computed from the same data and is **withheld from the
prompt**, so the model has no anchor. Divergence beyond 25 points raises a badge; an
unreachable API, a missing tool block or a failed validation renders the reference
instead with a fallback badge. No haircut, LTV or loan condition is model-assigned.

The model is **`claude-opus-5`** through the Anthropic SDK **0.124.0**, called with
`tool_choice` forcing `assign_hotspot_score`, an **8 second timeout and one retry**.

### The calibration scale, verbatim

Reproduced from `CALIBRATION_RUBRIC` in `lib/index/llm-score.ts`, because plan 4.5 asks
for the scale a reader can check a score against rather than a description of it:

```
1-20 minimal: little modelled hazard at 2050, a small share of the book, and no recent events.
21-40 low: modest hazard or a modest share, and at most isolated recent events.
41-60 moderate: clear hazard at 2050 or a material share of the book, with some recent event pressure.
61-80 elevated: high hazard at 2050 together with a material share, or sustained recent event pressure.
81-100 severe: hazard at or near the total cap, a leading share of the book, and repeated recent events.
```

### Nothing on this build is model-written, and that is the tested state

**There is no measured divergence rate, and that is a statement about this build rather
than a missing number.** No `ANTHROPIC_API_KEY` exists here, so every LLM path took its
fallback, and both fallbacks are asserted rather than assumed:

| Path | With no key | Rows |
|---|---|---|
| `npm run prep:scores` | the deterministic reference index renders with a **fallback badge**, and no model score is stored | all **16** hotspots |
| `npm run prep:narratives` | the **rule text** is stored, with `fallback_used = true` | all **21** narratives |

So a divergence rate needs two numbers to differ and only one of them exists. What the
build does prove is the failure path, which is the half a demo is more likely to need: the
fallback is the tested state, not an untried branch, and the offline suite asserts the
score half of it end to end. Rubric tightening was time-boxed to 45 minutes against a live
key; unspent, because the key never arrived.

If a key is supplied before the demo, rerun both prep steps and re-record the divergence
rate here. Nothing else changes: no haircut, LTV or loan condition is model-assigned in
either state.

### The reference index on the seeded data

The deterministic index runs **7 to 64** across the sixteen hotspots. The floor is
Woodlands and Bukit Timah, inland Singapore with little coastal exposure; the ceiling is
Pudong and Lujiazui. **11 events attach across 7 hotspots** at the 400 km radius, so nine
hotspots carry no event pressure at all and are ranked on hazard and exposure alone.

## 13. The borrowed heat elasticity

Every heat figure carries a "borrowed elasticity" chip on screen. No hedonic study links
temperature to property values in Singapore, Malaysia or Indonesia, so the elasticity is
borrowed from a Chinese study and applied across all five markets. The 5% inner cap on
the elasticity term is a judgemental overlay, not a published bound. Heat alone can
therefore reach 7.5% after the urban-heat multiplier, and it is the 5% chronic cap that
binds.

## 14. Two Hong Kong figures: STRIKE, not verified

The spec's Technical Context flags two figures for re-verification before the pitch:
**9.2% electricity per degree Celsius** and a **24.8% urban-heat-island cooling load**
increase. The spec itself records that the skeptic pass on the source briefing "returned
empty, so its figures are unverified".

**I could not verify either against a primary source.** The recommendation is therefore
the one the plan states as the alternative: **strike both from the pitch.**

Neither figure feeds the product. No haircut, band, LTV or score reads them; they appear
only in pitch narrative. Striking them costs nothing and removes the two numbers most
likely to be challenged and least able to be defended. If someone wants to keep them,
they need a citation to a named study with a year, and this section should record it.

---

<!-- BEGIN worker-c: Synthetic data calibration -->
## Synthetic data calibration

`prep/lib/synthetic.py` is a physical stand-in, not a dataset. It writes the hazard floor
that every acceptance test runs against when `--source=synthetic` is passed, and every
number in it is judgemental. It claims the same ADR-2 exemption `prep/lib/context.py`
claims, on the same grounds: it never runs in the same pass as a real sample, it is
pinned by `MASTER_SEED = 20260907`, and its output is committed to `data/synthetic/` and
diffed like code. Nothing here is a published figure and nothing here may be cited as one.

### What was calibrated for, and why

The generator was not tuned to reproduce any external distribution. It was tuned to make
the map **discriminate**, because a map on which every pin is the same colour tests
nothing and shows nothing:

1. **A green floor must survive to 2050.** A cool, green, high-ground pin with no flood
   exposure has to stay under the 3% band edge at 2050. On the plan's own heat elasticity
   an untuned floor put all 200 pins at amber-or-worse at 2050, which collapses AC-6's
   amber-or-worse share to 100% and stops the slider saying anything at the one position
   the demo dwells on.
2. **All four bands must be occupied at 2050,** with red confined to the lowest coastal
   clusters rather than sprayed across the book.
3. **Origination must not already be alarming.** 2025 is the baseline the case screens
   argue away from.
4. **Every colour change must have a mechanism behind it** that survives being asked
   about: elevation, distance to shore, latitude, cluster heat and greenness. Not noise.

The target for (2) was roughly 30-40% green, 30-35% amber, 20-25% orange and 5-10% red at
2050, giving an amber-or-worse share near 60% **by pin count**.

### The seven pinned constants

Each was chosen by measuring the resulting distribution, not by feel. The comment beside
each in `prep/lib/synthetic.py` records the reasoning; this is the summary.

| Constant | Value | Why this value |
|---|---|---|
| `COASTAL_LEVEL_M` | today 4.40, 2030 4.95, 2050 5.50 m | 100-year still-water level. The three are close together on purpose: the surge dominates and is nearly scenario-invariant, so only the sea-level increment separates them |
| `COASTAL_ELEVATION_GAMMA` | 2.0 | Depth falls off faster than linearly with ground height. A linear head left the entire 2-6 m elevation band in one undifferentiated orange mass |
| `COASTAL_ATTENUATION_KM` | 2.0 | A pin 2 km inland sees 1/e of the level. Gives the shoreline strip its own band without flooding the second row of clusters |
| `RIVERINE_LEVEL_M` | today 1.52, 2030 1.71, 2050 1.90 m | 100-year riverine/pluvial depth scale before terrain |
| `RIVERINE_FULL_BELOW_M` / `RIVERINE_ZERO_ABOVE_M` | 1.0 / 5.5 m | A terrain ramp, not an exponential decay. An `exp(-z/20)` decay left a measurable depth on a 60 m ridge, which pushed every inland pin over the 3% edge at 2050 |
| `HEAT_2050_BY_ABS_LAT` | peaks at 54 days/yr near 22 deg | Days above 35 C at 2050 against the 2016-2035 reference. Peaks in the outer tropics, where the seasonal maximum already sits near the threshold, and falls away at the equator and in the subtropics. This is the constant that buys requirement (1) |
| `HEAT_2030_FRACTION` | 0.30 | See below |
| `WIND_TODAY_BY_ABS_LAT` / `WIND_SCENARIO_FACTOR` | peak 57 m/s near 22 deg; x1.00 / x1.02 / x1.05 | Anchored on the plan's "Hong Kong 100-year winds near 50-60 m/s". Only inside the North West Pacific basin rectangle, which is why SG, peninsular MY and ID read `absent` rather than zero |

### `HEAT_2030_FRACTION = 0.30`

The 2030 heat delta is taken as 0.30 of the 2050 delta. This is a **window-overlap
argument, not a tuning knob**. The 2021-2040 window and the 2016-2035 reference window
overlap by 15 of their 20 years and their centres are only 5 years apart, against 24 years
for the 2040-2059 window. Threshold exceedance is convex in warming, which argues for a
smaller fraction still, so 0.30 is already the generous end of what the window spacing
supports.

Raising it to 0.55 would fill out the 2030 column and lift the 2030 revaluation count from
3 to 14, which reads better on stage. It was not raised. The NEX-GDDP window spacing does
not support it, and a figure chosen because it demos well is exactly the figure that does
not survive a question. The lead accepted the count of 3 and amended S17 instead; see plan
section 10.

### Resulting band distribution

Measured on 2026-09-08 from a freshly migrated, seeded and recomputed database against the
seeded active rule set, 200 pins, 600 valuations.

**2025 (origination).** Grouped by country, pin counts:

| Country | Green | Amber | Orange | Red | Total |
|---|---|---|---|---|---|
| SG | 60 | 0 | 0 | 0 | 60 |
| MY | 40 | 0 | 0 | 0 | 40 |
| ID | 40 | 0 | 0 | 0 | 40 |
| CN | 0 | 35 | 0 | 0 | 35 |
| HK | 0 | 25 | 0 | 0 | 25 |
| **All** | **140** | **60** | **0** | **0** | **200** |

The CN/HK block is amber at origination and everything else is green. That is the wind
term: those are the only two markets inside the North West Pacific basin rectangle, so
they are the only ones carrying a wind haircut before any horizon effect exists.

**2030.**

| Country | Green | Amber | Orange | Red | Total |
|---|---|---|---|---|---|
| SG | 57 | 3 | 0 | 0 | 60 |
| MY | 39 | 1 | 0 | 0 | 40 |
| ID | 26 | 14 | 0 | 0 | 40 |
| CN | 0 | 32 | 3 | 0 | 35 |
| HK | 0 | 25 | 0 | 0 | 25 |
| **All** | **122** | **75** | **3** | **0** | **200** |

Only three pins reach orange by 2030, all Chinese. This is arithmetic rather than
calibration: SG, MY and ID cap at 5% water plus 5% chronic at 2030, which ties `band_mid`
and never exceeds it, so only the 6% wind band can carry a pin past it.

**2050.**

| Country | Green | Amber | Orange | Red | Total |
|---|---|---|---|---|---|
| SG | 30 | 19 | 11 | 0 | 60 |
| MY | 32 | 3 | 5 | 0 | 40 |
| ID | 11 | 10 | 11 | 8 | 40 |
| CN | 0 | 17 | 13 | 5 | 35 |
| HK | 0 | 13 | 12 | 0 | 25 |
| **All** | **73** | **62** | **52** | **13** | **200** |

Against the target of roughly 30-40 / 30-35 / 20-25 / 5-10 per cent, the seeded floor
gives 36.5 / 31.0 / 26.0 / 6.5. Red is confined to the lowest coastal clusters, eight in
Indonesia and five in China, and touches no fixture.

### The two amber-or-worse figures are different measures

They are quoted for different purposes and must not be swapped:

- **63% amber-or-worse at 2050 by pin count** (127 of 200). This is the calibration
  target above. It is a property of the synthetic floor.
- **66.01% amber-or-worse at 2050 by collateral value**, S$1,581,830,000 of
  S$2,396,510,000. This is the AC-6 dashboard figure and the number to use in the pitch.
  It is higher than the count figure because the affected pins are on average the more
  valuable ones, which is a real portfolio effect and worth saying out loud rather than
  glossing.

An end-to-end check in the browser against the rendered map agreed with the database
counts **within one pin per band**, the difference being pins outside the viewport at the
opening zoom rather than any disagreement about the data.

<!-- END worker-c: Synthetic data calibration -->

## Environment deviations

The full list, with dates and the demo-day target for each, is in section 10 of
`.omc/plans/ocbc-climate-collateral-mvp.md` under "Execution deviations". The one worth
knowing here: the plan targets `postgis/postgis:16-3.4` under docker compose, and the
build host has no Docker, so local development runs PGlite with the real PostGIS
extension over the ordinary Postgres wire protocol. It is a container substitution and
not an ADR-7 deviation: PostGIS 3.6 evaluates every spatial predicate, and the SQL is
identical on both.
