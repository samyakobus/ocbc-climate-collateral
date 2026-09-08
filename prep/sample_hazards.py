"""S7 - hazard sampling into `hazard_samples`, `site_modifiers` and `context_factors`.

Plan `.omc/plans/ocbc-climate-collateral-mvp.md` sections 2 (three-source rule),
4.6 (prep pipeline and the coverage model), 4.3.2 (pinned fixtures) and 5 (S7).
Contributes to AC-2, AC-3, AC-8, AC-12 and AC-13.

    python -m prep.sample_hazards --source=synthetic     the unconditional floor
    python -m prep.sample_hazards --source=frozen        replay, no credentials
    python -m prep.sample_hazards --source=live          Earth Engine + rasterio
    python -m prep.sample_hazards --source=frozen --check dry run, validates only

Every mode writes `db/seed/04_samples.sql`. `live` additionally writes
`data/frozen/*.csv`, which is what a later `--source=frozen` replays.

ADR-2
-----
This script samples and writes raw values. It computes no haircut, no band, no
adaptation credit and no reference index. It does read `hazard_applicability`,
which is policy rather than arithmetic, and it reads exactly one copy of it,
imported from `prep.lib.synthetic`, so Python holds one table and not two. The
authoritative copy is the seeded `hazard_applicability` rows, and
`tests/db/applicability.test.ts` asserts against those.

The coverage model, in three states and only three (plan 4.6)
-------------------------------------------------------------
    scored               measured here AND scored for this country. Contributes.
    measured_not_scored  measured here, policy excludes it. Value STORED, contributes 0.
    absent               no coverage at this point at all. Value NULL, contributes 0.

`absent` wins over `measured_not_scored` whenever both could apply, because there
is no value to store. Singapore wind is `absent`, since STORM has no basin
coverage there. Kota Kinabalu wind and Jakarta PM2.5 are `measured_not_scored`:
a real value exists and policy excludes it, which is a stronger answer to a
director than "not applicable" and keeps the number on the context panel.

Nodata is a hard failure, never a zero
--------------------------------------
There is no `nodata` row state. A sentinel returned from INSIDE a raster's
coverage is a defect in the input. Every offending pin is collected and printed
as ONE batch, then the run exits non-zero, so a bad download is fixed in one
cycle rather than one pin at a time. A sentinel is never coerced to zero and
never persisted.

The six pinned fixtures (plan 4.3.2)
------------------------------------
`db/seed/04_samples.sql` ends with the six fixture sample sets, applied AFTER the
sampled rows in every source mode, so `--source=synthetic`, `--source=frozen` and
`--source=live` all leave those rows identical. Without this, synthetic depths
derived from elevation and distance to coast would never land on 0.50, 0.80 and
0.20 m, the unit tests would still pass because they read `tests/fixtures/cases.ts`,
and the figures walked on stage would diverge from the figures under test.
`tests/db/fixture-pinning.test.ts` asserts they do not.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from prep.lib import context as context_lib
from prep.lib import frozen as frozen_lib
from prep.lib import raster as raster_lib
from prep.lib.synthetic import SCORED_FOR, SCENARIOS, HAZARDS
from prep.lib.synthetic import load_portfolio, sample as synthetic_sample
from prep.lib.synthetic import site_modifiers as synthetic_site_modifiers

SOURCES = ("live", "frozen", "synthetic")

SAMPLED_AT = "2026-09-07"
SEED_SQL = os.path.join("db", "seed", "04_samples.sql")

UNITS = {
    "flood_riverine": "m",
    "flood_coastal": "m",
    "wind": "m/s",
    "heat_days35": "days",
    "pm25": "ug/m3",
}

#: PM2.5 carries one value written to all three scenarios (plan 4.6).
SCENARIO_INVARIANT = {"pm25"}

FIXTURE_DATASET_VERSION = "fixture: pinned"


# ===========================================================================
# The six pinned fixtures (plan 4.3.2)
# ===========================================================================
#
# Depths are metres of inundation at that scenario. Only the y2050 figures are
# load-bearing for the acceptance criteria; the other two are pinned as well so
# that no source mode can move the today and 2030 columns under the demo.
#
# flood_riverine is `absent` on every fixture ON PURPOSE. The engine takes
# max(riverine.net, coastal.net) and records which peril won in
# `valuations.winning_peril`. Leaving exactly one candidate peril means the
# stored depth, damage fraction and both credit columns are unambiguous, so the
# provenance panel cannot show a riverine depth beside a coastal haircut.
#
# heat_days35 is `scored` with a delta of 0.0 at `today` on every fixture,
# because the metric is warming RELATIVE to the 2016-2035 reference window and
# today IS that window. It is zero by definition of the metric, not by an
# accident of labelling, and `coverage = 'scored'` so `heatHaircut` actually runs
# and returns 0 rather than short-circuiting on an absent sample.
#
# wind is `absent` and pm25 is `measured_not_scored` on all six, because all six
# are Singapore pins: STORM has no basin coverage over Singapore, and PM2.5 is
# measured there but not scored.

FIXTURE_DEPTHS: Dict[str, Tuple[float, float, float]] = {
    #                    today  y2030  y2050
    "SG-EC-001": (0.10, 0.30, 0.50),   # AC-2 worked example: 0.50 m -> damage 0.30
    "SG-EC-002": (0.10, 0.30, 0.50),   # AC-2 realistic case: same flood, real heat
    "SG-EC-003": (0.05, 0.12, 0.20),   # ADR-4 zero floor: 0.20 m -> damage 0.12
    "SG-KB-003": (0.20, 0.45, 0.80),   # AC-3 adaptation: 0.80 m -> damage 0.42
    "SG-MS-002": (0.60, 1.10, 1.80),   # AC-8 inundation boundary, low side
    "SG-MS-003": (0.15, 0.40, 0.70),   # AC-8 inundation boundary, high side
}

FIXTURE_HEAT_DAYS: Dict[str, Tuple[float, float, float]] = {
    "SG-EC-001": (0.0, 0.0, 0.0),      # the isolation exhibit: heat held at zero
    "SG-EC-002": (0.0, 6.0, 28.0),     # 28 days -> min(0.028, 0.05) x 1.25 = 3.5%
    "SG-EC-003": (0.0, 5.0, 25.0),
    "SG-KB-003": (0.0, 6.0, 26.0),
    "SG-MS-002": (0.0, 6.0, 27.0),
    "SG-MS-003": (0.0, 6.0, 27.0),
}

#: Singapore annual mean PM2.5. Measured, and not scored in SG.
FIXTURE_PM25 = 14.0

#: SUHI and NDVI tertiles. Plan 4.3.2 fixes SG-EC-002 at 1 and 1, which is what
#: turns 28 days into 3.5% through the 1.25 multiplier. The rest are pinned to
#: the same pair so no fixture's chronic term can move with a reseed.
FIXTURE_TERTILES = (1, 1)

#: Elevations, re-asserted after sampling. SG-MS-002 and SG-MS-003 straddle the
#: coastal inundation threshold: the flag fires when
#: elevation_m < sea_level_inundation + rules.inundation_threshold_m (0.50).
#: At 0.30 m of AR6 regional rise that boundary is 0.80 m, so 0.6 fires and 2.6
#: does not, and the pair survives any SLR value between 0.10 m and 2.10 m.
FIXTURE_ELEVATIONS: Dict[str, float] = {
    "SG-EC-001": 3.2,
    "SG-EC-002": 3.2,
    "SG-EC-003": 4.8,
    "SG-KB-003": 3.4,
    "SG-MS-002": 0.6,
    "SG-MS-003": 2.6,
}

#: The pinned sea-level row. Pinned on all six rather than only on the Marina
#: South pair, so no comparison in the fixture set is left asymmetric.
FIXTURE_SLR_M = 0.30

FIXTURE_IDS = tuple(FIXTURE_DEPTHS.keys())


def fixture_hazard_rows() -> List[Dict[str, object]]:
    """The full `hazard_samples` set for all six fixtures: 6 x 5 x 3 = 90 rows."""
    rows: List[Dict[str, object]] = []

    for cid in FIXTURE_IDS:
        depths = FIXTURE_DEPTHS[cid]
        heat = FIXTURE_HEAT_DAYS[cid]

        for index, scenario in enumerate(SCENARIOS):
            rows.append(_row(cid, "flood_coastal", scenario, depths[index], "scored",
                             version=FIXTURE_DATASET_VERSION,
                             dataset="Aqueduct Floods v2 coastal-wtsub",
                             pathway="rcp8p5", return_period=100))
            rows.append(_row(cid, "flood_riverine", scenario, None, "absent",
                             version=FIXTURE_DATASET_VERSION,
                             dataset="Aqueduct Floods v2 riverine",
                             pathway="rcp8p5", return_period=100))
            rows.append(_row(cid, "heat_days35", scenario, heat[index], "scored",
                             version=FIXTURE_DATASET_VERSION,
                             dataset="NEX-GDDP-CMIP6 days above 35C",
                             pathway="ssp585"))
            rows.append(_row(cid, "wind", scenario, None, "absent",
                             version=FIXTURE_DATASET_VERSION,
                             dataset="STORM v4",
                             return_period=100))
            rows.append(_row(cid, "pm25", scenario, FIXTURE_PM25, "measured_not_scored",
                             version=FIXTURE_DATASET_VERSION,
                             dataset="GHAP PM2.5 annual mean",
                             invariant=True))

    return rows


def fixture_modifier_rows() -> List[Dict[str, object]]:
    suhi, ndvi = FIXTURE_TERTILES
    return [{
        "collateral_id": cid,
        "suhi_tertile": suhi,
        "ndvi_tertile": ndvi,
        "dataset_name": "Yale SUHI v4 + Sentinel-2 NDVI",
        "dataset_version": FIXTURE_DATASET_VERSION,
        "sampled_at": SAMPLED_AT,
    } for cid in FIXTURE_IDS]


def fixture_context_rows() -> List[Dict[str, object]]:
    name, url = context_lib.DATASETS["sea_level_inundation"]
    return [{
        "collateral_id": cid,
        "factor": "sea_level_inundation",
        "value": FIXTURE_SLR_M,
        "unit": context_lib.UNITS["sea_level_inundation"],
        "direction_2030": "worsening",
        "direction_2050": "worsening",
        "dataset_name": name,
        "source_url": url,
        "sampled_at": SAMPLED_AT,
    } for cid in FIXTURE_IDS]


# ===========================================================================
# Row construction and the coverage rule
# ===========================================================================


def _row(collateral_id: str, hazard: str, scenario: str, value: Optional[float],
         coverage: str, *, version: str, dataset: str,
         pathway: Optional[str] = None, return_period: Optional[int] = None,
         invariant: Optional[bool] = None) -> Dict[str, object]:
    return {
        "collateral_id": collateral_id,
        "hazard": hazard,
        "scenario": scenario,
        "value": None if value is None else round(float(value), 4),
        "coverage": coverage,
        "scenario_invariant": hazard in SCENARIO_INVARIANT if invariant is None else invariant,
        "unit": UNITS[hazard],
        "dataset_name": dataset,
        "dataset_version": version,
        "pathway": pathway,
        "return_period_yrs": return_period,
        "sampled_at": SAMPLED_AT,
    }


def pin_id(row: Dict[str, object]) -> str:
    """The collateral id, whichever key the caller used.

    `prep.gen_portfolio` emits `collateral_id`; a row read straight off
    `collateral.csv` uses `id`. Accepting both keeps this script working against
    either, rather than silently producing 0 rows against the wrong one.
    """
    for key in ("collateral_id", "id"):
        value = row.get(key)
        if value not in (None, ""):
            return str(value)
    raise KeyError("portfolio row carries neither 'collateral_id' nor 'id'")


def coverage_for(hazard: str, country: str, measured: bool) -> str:
    """The three-state rule, in one place.

    `measured` says whether the raster covers this point at all. `absent` wins
    over `measured_not_scored` whenever both could apply, because an uncovered
    point has no value to store.
    """
    if not measured:
        return "absent"
    return "scored" if SCORED_FOR[hazard].get(country, False) else "measured_not_scored"


class NodataBatch:
    """Collects every nodata hit so the run fails once, with the whole list."""

    def __init__(self) -> None:
        self.hits: List[Tuple[str, str, str, str]] = []

    def add(self, collateral_id: str, hazard: str, scenario: str, source: str) -> None:
        self.hits.append((collateral_id, hazard, scenario, source))

    def __bool__(self) -> bool:
        return bool(self.hits)

    def report(self) -> str:
        lines = [
            "",
            f"HARD FAILURE: {len(self.hits)} nodata sentinel(s) returned from inside a raster's coverage.",
            "",
            "A sentinel inside the footprint is a defect in the input, not a zero and not an",
            "absent sample. Nothing has been written. Re-download the offending rasters and",
            "rerun; every offending pin is listed here so this takes one cycle, not one pin.",
            "",
            f"  {'collateral':<14} {'hazard':<16} {'scenario':<9} source",
            f"  {'-' * 14} {'-' * 16} {'-' * 9} {'-' * 40}",
        ]
        for cid, hazard, scenario, source in self.hits:
            lines.append(f"  {cid:<14} {hazard:<16} {scenario:<9} {source}")
        lines.append("")
        return "\n".join(lines)


# ===========================================================================
# The three sources
# ===========================================================================


def sample_synthetic(portfolio: Sequence[Dict[str, object]]):
    """The unconditional floor. Needs nothing external (ADR-2 exemption)."""
    hazard_rows = synthetic_sample(portfolio)
    modifier_rows = synthetic_site_modifiers(portfolio)
    context_rows = context_lib.derive_all(portfolio)
    # Slope and the landslide manual-review flag. Plan 4.6 samples these from
    # Copernicus DEM and NASA LHASA on the live path; the synthetic floor has to
    # derive them or the case screen has no landslide badge to render (AC-7).
    collateral_rows = context_lib.derive_collateral_updates(portfolio)
    return hazard_rows, modifier_rows, context_rows, collateral_rows


def sample_frozen(portfolio: Sequence[Dict[str, object]]):
    """Replays the committed CSVs with no credentials.

    `context_factors` is optional on the frozen path: if a live run predates this
    step it will not have written one, and the derived set is a better answer
    than an empty context panel. That substitution is announced, never silent.
    """
    hazard_rows = frozen_lib.read("frozen", "hazard_samples")
    modifier_rows = frozen_lib.read("frozen", "site_modifiers")
    context_rows = frozen_lib.read("frozen", "context_factors", required=False)
    collateral_rows = frozen_lib.read("frozen", "collateral_updates", required=False)

    if not context_rows:
        print("[sample] data/frozen/context_factors.csv is absent; deriving the seven "
              "context factors instead. Rerun --source=live to freeze real ones.")
        context_rows = context_lib.derive_all(portfolio)

    for row in hazard_rows:
        row["value"] = frozen_lib.parse_value(row.get("value"))
        row["scenario_invariant"] = frozen_lib.parse_bool(row.get("scenario_invariant"))

    return hazard_rows, modifier_rows, context_rows, collateral_rows


def sample_live(portfolio: Sequence[Dict[str, object]]):
    """Earth Engine for the gridded climate products, rasterio for STORM and LHASA.

    Raises `EarthEngineUnavailable` or `RasterUnavailable` rather than falling
    back, because a run that claims to be live must be live.
    """
    from prep.lib import ee_client

    ee_client.initialise()

    points: List[Tuple[str, float, float]] = [
        (pin_id(row), float(row["lat"]), float(row["lon"])) for row in portfolio
    ]
    country_of = {pin_id(row): str(row["country"]) for row in portfolio}

    nodata = NodataBatch()
    hazard_rows: List[Dict[str, object]] = []

    # --- flood, both perils, three scenarios --------------------------------
    for peril, hazard in (("riverine", "flood_riverine"), ("coastal", "flood_coastal")):
        for scenario in SCENARIOS:
            image, band, dataset, version = ee_client.aqueduct_flood(peril, scenario)
            values = ee_client.sample_image(image, points, band)
            for cid, _, _ in points:
                value = values.get(cid)
                coverage = coverage_for(hazard, country_of[cid], value is not None)
                hazard_rows.append(_row(
                    cid, hazard, scenario, value, coverage,
                    version=version, dataset=dataset,
                    pathway=ee_client.AQUEDUCT_PATHWAY,
                    return_period=ee_client.AQUEDUCT_RETURN_PERIOD,
                ))

    # --- heat: both NEX-GDDP windows, against the one reference window ------
    reference_image, band, dataset, version = ee_client.nex_gddp_days_over_35("reference")
    reference = ee_client.sample_image(reference_image, points, band)

    for scenario in SCENARIOS:
        if scenario == "today":
            # today IS the reference window, so the delta is zero BY DEFINITION
            # of the metric. It is still `scored` wherever the reference is
            # covered, so heatHaircut runs and returns 0.
            for cid, _, _ in points:
                covered = reference.get(cid) is not None
                coverage = coverage_for("heat_days35", country_of[cid], covered)
                hazard_rows.append(_row(
                    cid, "heat_days35", scenario, 0.0 if covered else None, coverage,
                    version=version, dataset=dataset, pathway=ee_client.NEX_GDDP_SCENARIO,
                ))
            continue

        image, band, dataset, version = ee_client.nex_gddp_days_over_35(scenario)
        future = ee_client.sample_image(image, points, band)
        for cid, _, _ in points:
            base, projected = reference.get(cid), future.get(cid)
            covered = base is not None and projected is not None
            delta = round(projected - base, 4) if covered else None
            coverage = coverage_for("heat_days35", country_of[cid], covered)
            hazard_rows.append(_row(
                cid, "heat_days35", scenario, delta, coverage,
                version=version, dataset=dataset, pathway=ee_client.NEX_GDDP_SCENARIO,
            ))

    # --- wind: BOTH STORM editions -----------------------------------------
    for scenario in SCENARIOS:
        values = raster_lib.storm_wind(scenario, points)
        version = raster_lib.storm_version(scenario)
        for cid, _, _ in points:
            value = values.get(cid)
            if value is raster_lib.NODATA:
                nodata.add(cid, "wind", scenario, version)
                continue
            measured = value is not raster_lib.OUTSIDE
            coverage = coverage_for("wind", country_of[cid], measured)
            hazard_rows.append(_row(
                cid, "wind", scenario, value if measured else None, coverage,
                version=version, dataset="STORM v4", return_period=raster_lib.STORM_RETURN_PERIOD,
            ))

    # --- PM2.5: one value, written to all three scenarios -------------------
    image, band, dataset, version = ee_client.ghap_pm25()
    pm25 = ee_client.sample_image(image, points, band)
    for cid, _, _ in points:
        value = pm25.get(cid)
        coverage = coverage_for("pm25", country_of[cid], value is not None)
        for scenario in SCENARIOS:
            hazard_rows.append(_row(
                cid, "pm25", scenario, value, coverage,
                version=version, dataset=dataset, invariant=True,
            ))

    if nodata:
        print(nodata.report(), file=sys.stderr)
        raise SystemExit(1)

    # --- site modifiers -----------------------------------------------------
    suhi_image, suhi_band, _, suhi_version = ee_client.yale_suhi()
    ndvi_image, ndvi_band, _, ndvi_version = ee_client.sentinel2_ndvi()
    suhi = ee_client.sample_image(suhi_image, points, suhi_band)
    ndvi = ee_client.sample_image(ndvi_image, points, ndvi_band, scale=ee_client.NDVI_SCALE_M)

    modifier_rows = [{
        "collateral_id": cid,
        "suhi_tertile": _tertile(suhi.get(cid), suhi),
        "ndvi_tertile": _tertile(ndvi.get(cid), ndvi),
        "dataset_name": "Yale SUHI v4 + Sentinel-2 NDVI",
        "dataset_version": f"{suhi_version} + {ndvi_version}",
        "sampled_at": SAMPLED_AT,
    } for cid, _, _ in points]

    # Context factors stay derived until their six feeds are wired; the live
    # sampler announces that rather than pretending they were measured.
    print("[sample] context_factors are derived, not sampled, on this path. "
          "Wiring FIRMS, Aqueduct 4.0, ERA5-Land CDD, Herrera-Garcia, AR6 SLR and "
          "Deltares is the remaining live work.")
    context_rows = context_lib.derive_all(portfolio)

    return hazard_rows, modifier_rows, context_rows, []


def _tertile(value: Optional[float], population: Dict[str, Optional[float]]) -> int:
    """Rank one value into 0, 1 or 2 against the sampled population."""
    if value is None:
        return 1
    known = sorted(v for v in population.values() if v is not None)
    if not known:
        return 1
    lower = known[len(known) // 3]
    upper = known[2 * len(known) // 3]
    return 0 if value < lower else (1 if value < upper else 2)


# ===========================================================================
# Validation
# ===========================================================================


def validate(hazard_rows: Sequence[Dict[str, object]], portfolio: Sequence[Dict[str, object]]) -> List[str]:
    """Checks the invariants the schema also enforces, before the SQL is written.

    Failing here gives a list of offending rows; failing in Postgres gives one
    constraint violation and no context.
    """
    problems: List[str] = []
    expected = len(portfolio) * len(HAZARDS) * len(SCENARIOS)

    if len(hazard_rows) != expected:
        problems.append(
            f"expected {expected} hazard rows ({len(portfolio)} pins x {len(HAZARDS)} hazards "
            f"x {len(SCENARIOS)} scenarios), got {len(hazard_rows)}"
        )

    seen = set()
    for row in hazard_rows:
        key = (row["collateral_id"], row["hazard"], row["scenario"])
        if key in seen:
            problems.append(f"duplicate sample {key}")
        seen.add(key)

        coverage = row["coverage"]
        value = row["value"]
        if coverage not in ("scored", "measured_not_scored", "absent"):
            problems.append(f"{key}: unknown coverage {coverage!r}")
        elif coverage == "absent" and value is not None:
            problems.append(f"{key}: absent carries a value ({value})")
        elif coverage != "absent" and value is None:
            problems.append(f"{key}: {coverage} carries no value")

    country_of = {pin_id(r): str(r["country"]) for r in portfolio}
    for row in hazard_rows:
        country = country_of.get(str(row["collateral_id"]))
        if country is None:
            problems.append(f"{row['collateral_id']} is not in the portfolio")
            continue
        if row["coverage"] == "scored" and not SCORED_FOR[row["hazard"]].get(country, False):
            problems.append(
                f"{row['collateral_id']} {row['hazard']}: scored in {country}, "
                f"which hazard_applicability forbids"
            )
        if row["coverage"] == "measured_not_scored" and SCORED_FOR[row["hazard"]].get(country, False):
            problems.append(
                f"{row['collateral_id']} {row['hazard']}: measured_not_scored in {country}, "
                f"which hazard_applicability scores"
            )

    return problems


def normalise(rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """Coerces every source's rows into one shape before they are validated.

    The three samplers disagree on how they spell an absent value: one emits
    `None`, a CSV replay emits an empty string, and a bool arrives as either.
    Normalising once here means the validator and the SQL emitter each see one
    shape, so `coverage = 'absent'` really does carry SQL NULL and not the empty
    string, which the schema's coverage CHECK would reject anyway.
    """
    out: List[Dict[str, object]] = []
    for row in rows:
        row = dict(row)
        row["value"] = frozen_lib.parse_value(row.get("value"))
        raw = row.get("scenario_invariant")
        row["scenario_invariant"] = raw if isinstance(raw, bool) else frozen_lib.parse_bool(raw)
        for key in ("pathway", "return_period_yrs"):
            if row.get(key) in ("", None):
                row[key] = None
        out.append(row)
    return out


def coverage_summary(rows: Sequence[Dict[str, object]]) -> str:
    counts: Dict[Tuple[str, str], int] = {}
    for row in rows:
        counts[(str(row["hazard"]), str(row["coverage"]))] = (
            counts.get((str(row["hazard"]), str(row["coverage"])), 0) + 1
        )

    lines = [f"  {'hazard':<16} {'scored':>8} {'measured':>10} {'absent':>8}"]
    for hazard in HAZARDS:
        lines.append(
            f"  {hazard:<16} {counts.get((hazard, 'scored'), 0):>8}"
            f" {counts.get((hazard, 'measured_not_scored'), 0):>10}"
            f" {counts.get((hazard, 'absent'), 0):>8}"
        )
    return "\n".join(lines)


# ===========================================================================
# SQL emission
# ===========================================================================


def _sql(value: object) -> str:
    if value is None or (isinstance(value, str) and value == ""):
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value)
    if text.lower() in ("true", "false") :
        return text.lower()
    return "'" + text.replace("'", "''") + "'"


def _values(rows: Sequence[Dict[str, object]], columns: Sequence[str], batch: int = 200) -> Iterable[str]:
    """Multi-row VALUES in batches, so one statement is not megabytes long."""
    for start in range(0, len(rows), batch):
        chunk = rows[start:start + batch]
        yield ",\n".join("  (" + ", ".join(_sql(r.get(c)) for c in columns) + ")" for r in chunk)


def emit_sql(path: str, source: str,
             hazard_rows: Sequence[Dict[str, object]],
             modifier_rows: Sequence[Dict[str, object]],
             context_rows: Sequence[Dict[str, object]],
             collateral_rows: Sequence[Dict[str, object]]) -> str:
    """Writes `db/seed/04_samples.sql`: sampled rows first, pinned fixtures last.

    Order inside the file is the guarantee. The fixture block is the last thing
    the file does, in every source mode, so nothing sampled can survive on top of
    a fixture row.
    """
    out: List[str] = []
    add = out.append

    add(f"""-- db/seed/04_samples.sql
--
-- GENERATED by `python -m prep.sample_hazards --source={source}`. Do not hand-edit;
-- rerun the generator instead.
--
-- hazard_samples, site_modifiers and context_factors for every pin (plan 4.6),
-- followed by the six PINNED FIXTURE sample sets of plan 4.3.2.
--
-- The fixture block is last, deliberately and in every source mode, so
-- --source=synthetic, --source=frozen and --source=live all leave those rows
-- identical. tests/db/fixture-pinning.test.ts asserts exactly that.
--
-- Coverage is three-valued and only three-valued: `scored` contributes,
-- `measured_not_scored` keeps its measured value and contributes zero, `absent`
-- has no value at all. No nodata sentinel is ever persisted.
""")

    # Fail with a sentence rather than a foreign-key violation. This file is
    # meaningless without the pins 03_portfolio.sql loads, and an opaque
    # `hazard_samples_collateral_id_fkey` error sends the reader to the wrong file.
    add("""-- The pins must be loaded first. Without this guard the first INSERT below fails on
-- hazard_samples_collateral_id_fkey, which names this file and not the missing one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM collateral) THEN
    RAISE EXCEPTION
      '04_samples.sql needs the portfolio: db/seed/03_portfolio.sql has not loaded any collateral. '
      'Generate it from prep/gen_portfolio.py (plan 4.1, S5) and seed again.';
  END IF;
END $$;
""")

    add(f"-- {len(hazard_rows)} sampled hazard rows")
    columns = list(frozen_lib.HAZARD_SAMPLE_COLUMNS)
    for chunk in _values(hazard_rows, columns):
        add(f"INSERT INTO hazard_samples ({', '.join(columns)}) VALUES")
        add(chunk)
        add("""ON CONFLICT (collateral_id, hazard, scenario) DO UPDATE SET
  value = EXCLUDED.value, coverage = EXCLUDED.coverage,
  scenario_invariant = EXCLUDED.scenario_invariant, unit = EXCLUDED.unit,
  dataset_name = EXCLUDED.dataset_name, dataset_version = EXCLUDED.dataset_version,
  pathway = EXCLUDED.pathway, return_period_yrs = EXCLUDED.return_period_yrs,
  sampled_at = EXCLUDED.sampled_at;
""")

    add(f"-- {len(modifier_rows)} site_modifiers rows")
    columns = list(frozen_lib.SITE_MODIFIER_COLUMNS)
    for chunk in _values(modifier_rows, columns):
        add(f"INSERT INTO site_modifiers ({', '.join(columns)}) VALUES")
        add(chunk)
        add("""ON CONFLICT (collateral_id) DO UPDATE SET
  suhi_tertile = EXCLUDED.suhi_tertile, ndvi_tertile = EXCLUDED.ndvi_tertile,
  dataset_name = EXCLUDED.dataset_name, dataset_version = EXCLUDED.dataset_version,
  sampled_at = EXCLUDED.sampled_at;
""")

    add(f"-- {len(context_rows)} context_factors rows, seven per pin, all UNSCORED")
    columns = list(frozen_lib.CONTEXT_FACTOR_COLUMNS)
    for chunk in _values(context_rows, columns):
        add(f"INSERT INTO context_factors ({', '.join(columns)}) VALUES")
        add(chunk)
        add("""ON CONFLICT (collateral_id, factor) DO UPDATE SET
  value = EXCLUDED.value, unit = EXCLUDED.unit,
  direction_2030 = EXCLUDED.direction_2030, direction_2050 = EXCLUDED.direction_2050,
  dataset_name = EXCLUDED.dataset_name, source_url = EXCLUDED.source_url,
  sampled_at = EXCLUDED.sampled_at;
""")

    if collateral_rows:
        add(f"-- {len(collateral_rows)} sampled collateral columns (slope, elevation, landslide flag)")
        for row in collateral_rows:
            add(
                "UPDATE collateral SET "
                f"slope_deg = {_sql(row.get('slope_deg'))}, "
                f"elevation_m = {_sql(row.get('elevation_m'))}, "
                f"landslide_flag = {_sql(row.get('landslide_flag'))} "
                f"WHERE id = {_sql(row.get('collateral_id'))};"
            )
        add("")

    # ---- the pinned fixture block, LAST in every mode ----------------------
    add("""
-- ===========================================================================
-- PINNED FIXTURES (plan 4.3.2). Applied AFTER sampling, in every source mode.
--
-- These are the only rows in the database that are not sampled, and
-- docs/sources.md discloses them rather than leaving them to be discovered.
-- The demo says so out loud: "this one's heat sample is pinned", before a
-- director reads dataset_version = 'fixture: pinned' off the provenance panel.
--
-- Without this block the synthetic depths derived from elevation and distance to
-- coast would never land on 0.50, 0.80 and 0.20 m, the unit tests would still
-- pass because they read tests/fixtures/cases.ts, and the figures walked on
-- stage would diverge from the figures under test.
-- ===========================================================================
""")

    fixture_hazards = fixture_hazard_rows()
    add(f"-- {len(fixture_hazards)} pinned hazard rows: 6 fixtures x 5 hazards x 3 scenarios")
    columns = list(frozen_lib.HAZARD_SAMPLE_COLUMNS)
    for chunk in _values(fixture_hazards, columns):
        add(f"INSERT INTO hazard_samples ({', '.join(columns)}) VALUES")
        add(chunk)
        add("""ON CONFLICT (collateral_id, hazard, scenario) DO UPDATE SET
  value = EXCLUDED.value, coverage = EXCLUDED.coverage,
  scenario_invariant = EXCLUDED.scenario_invariant, unit = EXCLUDED.unit,
  dataset_name = EXCLUDED.dataset_name, dataset_version = EXCLUDED.dataset_version,
  pathway = EXCLUDED.pathway, return_period_yrs = EXCLUDED.return_period_yrs,
  sampled_at = EXCLUDED.sampled_at;
""")

    fixture_mods = fixture_modifier_rows()
    add(f"-- {len(fixture_mods)} pinned site_modifiers rows. SG-EC-002 at SUHI 1 / NDVI 1 is what")
    add("-- turns a 28-day delta into 3.5% through the 1.25 multiplier.")
    columns = list(frozen_lib.SITE_MODIFIER_COLUMNS)
    for chunk in _values(fixture_mods, columns):
        add(f"INSERT INTO site_modifiers ({', '.join(columns)}) VALUES")
        add(chunk)
        add("""ON CONFLICT (collateral_id) DO UPDATE SET
  suhi_tertile = EXCLUDED.suhi_tertile, ndvi_tertile = EXCLUDED.ndvi_tertile,
  dataset_name = EXCLUDED.dataset_name, dataset_version = EXCLUDED.dataset_version,
  sampled_at = EXCLUDED.sampled_at;
""")

    fixture_context = fixture_context_rows()
    add(f"-- {len(fixture_context)} pinned sea_level_inundation rows. The AC-8 pair compares")
    add("-- collateral.elevation_m against this value plus rules.inundation_threshold_m, so")
    add("-- pinning one side and sampling the other would leave the comparison asymmetric.")
    columns = list(frozen_lib.CONTEXT_FACTOR_COLUMNS)
    for chunk in _values(fixture_context, columns):
        add(f"INSERT INTO context_factors ({', '.join(columns)}) VALUES")
        add(chunk)
        add("""ON CONFLICT (collateral_id, factor) DO UPDATE SET
  value = EXCLUDED.value, unit = EXCLUDED.unit,
  direction_2030 = EXCLUDED.direction_2030, direction_2050 = EXCLUDED.direction_2050,
  dataset_name = EXCLUDED.dataset_name, source_url = EXCLUDED.source_url,
  sampled_at = EXCLUDED.sampled_at;
""")

    add("-- pinned elevations. SG-MS-002 and SG-MS-003 straddle the coastal inundation")
    add(f"-- threshold: {FIXTURE_SLR_M} m of AR6 rise plus a 0.50 m threshold puts the boundary at")
    add(f"-- {FIXTURE_SLR_M + 0.5:.2f} m, so 0.6 fires and 2.6 does not.")
    for cid, elevation in FIXTURE_ELEVATIONS.items():
        add(f"UPDATE collateral SET elevation_m = {elevation} WHERE id = {_sql(cid)};")
    add("")

    text = "\n".join(out)
    directory = os.path.dirname(os.path.join(frozen_lib.repo_root(), path))
    os.makedirs(directory, exist_ok=True)
    full = os.path.join(frozen_lib.repo_root(), path)
    with open(full, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return full


# ===========================================================================
# CLI
# ===========================================================================


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m prep.sample_hazards",
        description="Sample hazards into hazard_samples, site_modifiers and context_factors.",
    )
    parser.add_argument("--source", choices=SOURCES, default="synthetic",
                        help="live samples and freezes; frozen replays; synthetic is the floor")
    parser.add_argument("--check", action="store_true",
                        help="validate the three coverage states and write nothing")
    parser.add_argument("--out-sql", default=SEED_SQL, help="where to write the seed file")
    args = parser.parse_args(argv)

    portfolio = load_portfolio()
    print(f"[sample] source={args.source}, {len(portfolio)} pins")

    if args.source == "live":
        try:
            hazard_rows, modifier_rows, context_rows, collateral_rows = sample_live(portfolio)
        except Exception as exc:
            print(f"\n[sample] live sampling failed: {exc}", file=sys.stderr)
            print("[sample] Nothing was written. --source=frozen replays the committed CSVs and "
                  "--source=synthetic needs nothing external; both are complete input sets.",
                  file=sys.stderr)
            return 1
    elif args.source == "frozen":
        try:
            hazard_rows, modifier_rows, context_rows, collateral_rows = sample_frozen(portfolio)
        except frozen_lib.FrozenUnavailable as exc:
            print(f"\n[sample] frozen replay unavailable: {exc}", file=sys.stderr)
            print("[sample] Nothing was written. --source=synthetic is the unconditional floor "
                  "and needs nothing external.", file=sys.stderr)
            return 1
    else:
        hazard_rows, modifier_rows, context_rows, collateral_rows = sample_synthetic(portfolio)

    hazard_rows = normalise(hazard_rows)
    problems = validate(hazard_rows, portfolio)
    print(f"[sample] {len(hazard_rows)} hazard rows, {len(modifier_rows)} site modifiers, "
          f"{len(context_rows)} context factors")
    print(coverage_summary(hazard_rows))

    if problems:
        print(f"\n[sample] {len(problems)} validation problem(s):", file=sys.stderr)
        for problem in problems[:40]:
            print(f"  {problem}", file=sys.stderr)
        if len(problems) > 40:
            print(f"  ... and {len(problems) - 40} more", file=sys.stderr)
        return 1

    if args.check:
        print("[sample] --check: coverage states valid, nothing written")
        return 0

    if args.source == "live":
        for name, rows in (("hazard_samples", hazard_rows),
                           ("site_modifiers", modifier_rows),
                           ("context_factors", context_rows)):
            path = frozen_lib.write("frozen", name, rows)
            print(f"[sample] froze {path}")

    written = emit_sql(args.out_sql, args.source, hazard_rows, modifier_rows,
                       context_rows, collateral_rows)
    print(f"[sample] wrote {written}")
    print(f"[sample] pinned fixtures applied last: {', '.join(FIXTURE_IDS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
