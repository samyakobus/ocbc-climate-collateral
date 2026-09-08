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

## 12. The hotspot score is the one LLM-assigned number

The displayed hotspot score is assigned by the model through structured output. A
deterministic reference index is computed from the same data and is **withheld from the
prompt**, so the model has no anchor. Divergence beyond 25 points raises a badge; an
unreachable API, a missing tool block or a failed validation renders the reference
instead with a fallback badge. No haircut, LTV or loan condition is model-assigned.

**Observed divergence rate: to be recorded after the Day-4 pre-generation run.**
Rubric tightening is time-boxed to 45 minutes, after which the observed rate is accepted
and reported as-is.

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

**This section is missing and needs restoring by worker C.** I overwrote it on
2026-09-08 by rewriting this whole file rather than editing around the section, which
was my error. The delimiters above and below are here so it has a home to come back to,
and nothing else in this file belongs to worker C.

What it recorded, from the note in the team task list: the calibration of the synthetic
hazard floor, and the resulting 2050 band distribution of **green 74 / amber 61 /
orange 51 / red 14**, amber-or-worse **63%** by count.

Two figures measured from the seeded database on 2026-09-08 for cross-reference, which
do **not** replace worker C's account of how the calibration was chosen:

- 2050 bands by count: green 73, amber 62, orange 52, red 13, which matches the
  end-to-end browser check recorded in plan section 10.
- Amber-or-worse **by collateral value**, which is what AC-6 reports and is a different
  measure from the count: **66.01%**, S$1,581,830,000 of S$2,396,510,000.

<!-- END worker-c: Synthetic data calibration -->

## Environment deviations

The full list, with dates and the demo-day target for each, is in section 10 of
`.omc/plans/ocbc-climate-collateral-mvp.md` under "Execution deviations". The one worth
knowing here: the plan targets `postgis/postgis:16-3.4` under docker compose, and the
build host has no Docker, so local development runs PGlite with the real PostGIS
extension over the ordinary Postgres wire protocol. It is a container substitution and
not an ADR-7 deviation: PostGIS 3.6 evaluates every spatial predicate, and the SQL is
identical on both.
