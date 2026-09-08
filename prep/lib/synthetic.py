"""S6 - the synthetic hazard floor: a committed, credential-free `hazard_samples` set.

Plan: `.omc/plans/ocbc-climate-collateral-mvp.md` sections 2 (three-source rule),
4.6 (coverage model and `hazard_applicability`) and 5 (S6). Contributes to AC-13.

ADR-2 EXEMPTION, STATED EXPLICITLY
----------------------------------
ADR-2 puts every derived value and every validator in TypeScript and leaves Python
with raster and Earth Engine sampling only. This module breaks that rule on
purpose, and ADR-2 records the exemption in its own text: the functions below
derive plausible hazard values from elevation, distance to coast, latitude and
tropical-cyclone basin membership, which is a physical model and therefore a rule.

It stays in Python by exception because:
  * it never runs in the same pass as a real sample, so no rule is implemented twice;
  * it is fully pinned by ``seed=20260907``, so a run is reproducible by hand;
  * its outputs are committed to ``data/synthetic/`` and diffed in review;
  * ``synthetic`` is the floor every acceptance test runs against when Earth
    Engine is unavailable, so it must exist before any credential does.

What this module still does NOT do: it computes no haircut, no adaptation credit,
no band, no LTV and no reference index. Those are TypeScript's, without exception.

Contract for `prep/sample_hazards.py --source=synthetic` (worker A)
------------------------------------------------------------------
    from prep.lib.synthetic import sample, site_modifiers
    hazard_rows = sample(portfolio_rows)      # 5 hazards x 3 scenarios x 200 pins
    modifier_rows = site_modifiers(portfolio_rows)

`portfolio_rows` is the output of ``prep.gen_portfolio.generate()`` or the parsed
rows of ``data/synthetic/portfolio.csv``; string and numeric fields are both
accepted. Until that script lands this module has its own CLI:

    python -m prep.lib.synthetic          # writes data/synthetic/hazard_samples.csv
                                          # and  data/synthetic/site_modifiers.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import math
import os
import random
import struct
from typing import Dict, List, Optional, Sequence, Tuple

MASTER_SEED = 20260907
DATASET_VERSION = "synthetic"
SAMPLED_AT = "2026-09-07"          # constant, so a re-run never churns the diff

SCENARIOS = ("today", "y2030", "y2050")
HAZARDS = ("flood_riverine", "flood_coastal", "wind", "heat_days35", "pm25")

COVERAGE_SCORED = "scored"
COVERAGE_MEASURED_NOT_SCORED = "measured_not_scored"
COVERAGE_ABSENT = "absent"
COVERAGE_STATES = (COVERAGE_SCORED, COVERAGE_MEASURED_NOT_SCORED, COVERAGE_ABSENT)

COUNTRIES = ("SG", "MY", "ID", "CN", "HK")

# `hazard_applicability`, all 25 rows of plan 4.6. Policy, not measurement: this
# says whether a measured value is allowed to move a credit number, and nothing
# else. The six `False` cells are the plan's wind and PM2.5 exclusions.
SCORED_FOR = {
    "flood_riverine": {"SG": True, "MY": True, "ID": True, "CN": True, "HK": True},
    "flood_coastal": {"SG": True, "MY": True, "ID": True, "CN": True, "HK": True},
    "heat_days35": {"SG": True, "MY": True, "ID": True, "CN": True, "HK": True},
    "wind": {"SG": False, "MY": False, "ID": False, "CN": True, "HK": True},
    "pm25": {"SG": False, "MY": False, "ID": False, "CN": True, "HK": True},
}

FLOOD_DEPTH_CAP_M = 15.0            # tests/prep sanity bound
NEGLIGIBLE_DEPTH_M = 0.02           # below this, record a clean zero

# ---------------------------------------------------------------------------
# Physical model constants. Every one of these is a judgemental synthetic
# stand-in, not a published figure, and docs/sources.md says so.
# ---------------------------------------------------------------------------

# Coastal still-water level of a 100-year event, metres above local datum,
# including sea-level rise and subsidence. Rises with the scenario, which is what
# makes "watch flood exposure grow into 2050" true on the map.
# The 2030 level is 0.90 of the 2050 level and today's is 0.80, not because
# sea level rises that fast but because the surge itself dominates the still-water
# level and is nearly scenario-invariant; only the sea-level increment separates
# the three. Calibrated 2026-09-07, see docs/sources.md.
COASTAL_LEVEL_M = {"today": 4.40, "y2030": 4.95, "y2050": 5.50}

# Surge depth falls off faster than linearly with ground height: the shoreline
# strip floods deeply while a few metres of rise drains almost all of it. A
# linear head left the whole 2-6 m band in one undifferentiated orange mass.
# depth = (level - elevation)^gamma / level^(gamma - 1)
COASTAL_ELEVATION_GAMMA = 2.0

# Attenuation length inland. A pin 2 km from the shore sees 1/e of the level.
COASTAL_ATTENUATION_KM = 2.0

# Riverine / pluvial depth scale of a 100-year event, before terrain.
RIVERINE_LEVEL_M = {"today": 1.52, "y2030": 1.71, "y2050": 1.90}
# Terrain ramp rather than an exponential decay. A 100-year riverine flood does
# not reach a hillside: above RIVERINE_ZERO_ABOVE_M the depth is exactly zero,
# below RIVERINE_FULL_BELOW_M the full level applies, and it ramps linearly
# between. An exp(-z/20) decay instead left a measurable depth on a 60 m ridge,
# which put every inland pin over the 3% band edge at 2050.
RIVERINE_FULL_BELOW_M = 1.0
RIVERINE_ZERO_ABOVE_M = 5.5

# Days per year above 35 C at 2050, as a delta against the 2016-2035 reference
# window, anchored on absolute latitude. The curve peaks in the outer tropics,
# where the seasonal maximum already sits near the threshold so a given warming
# pushes the most days across it, and falls away at the equator (less seasonal
# spread) and in the subtropics (a shorter hot season).
# Calibrated so that a cool, green, high-ground pin with no flood exposure can
# still sit below the 3% band edge at 2050. Without that headroom every one of
# the 200 pins is amber-or-worse at 2050 on the plan's own heat elasticity, the
# map stops discriminating at the very position the demo dwells on, and AC-6's
# amber-or-worse share degenerates to 100%.
HEAT_2050_BY_ABS_LAT = (
    (0.0, 16.0), (5.0, 18.0), (10.0, 26.0), (15.0, 38.0),
    (20.0, 50.0), (22.0, 54.0), (25.0, 51.0), (30.0, 43.0), (35.0, 35.0),
)
# The 2021-2040 window against the same 2016-2035 reference. Those windows
# overlap by 15 of 20 years and their centres are only 5 years apart, against
# 24 years for the 2040-2059 window, so the 2030 delta is a small fraction of
# the 2050 delta. 0.30 is already generous: threshold exceedance is convex in
# warming, which argues for less. A larger value would buy a fuller 2030
# column at the cost of a claim the window spacing does not support.
HEAT_2030_FRACTION = 0.30

# 100-year 10-minute sustained wind, m/s, anchored on absolute latitude inside
# the North West Pacific basin. Peaks around 20-25 degrees, where the plan's
# "Hong Kong 100-year winds near 50-60 m/s" sits.
WIND_TODAY_BY_ABS_LAT = (
    (5.0, 33.0), (10.0, 40.0), (15.0, 48.0), (20.0, 55.0),
    (22.0, 57.0), (25.0, 55.0), (30.0, 48.0), (35.0, 43.0),
)
# STORM present-climate edition for today; climate-change edition for the horizons.
WIND_SCENARIO_FACTOR = {"today": 1.00, "y2030": 1.02, "y2050": 1.05}

# North West Pacific tropical-cyclone basin, as a coarse rectangle. STORM has no
# track density south or west of this, which is why Singapore, peninsular
# Malaysia and Indonesia read `absent` rather than zero. Kota Kinabalu falls
# inside it, so its wind is measured and then excluded by policy, which is the
# behaviour plan S5 keeps the cluster for.
WP_BASIN_MIN_LAT = 5.0
WP_BASIN_MIN_LON = 105.0

# GHAP annual-mean PM2.5, ug/m3, by cluster. Jakarta sits at roughly 41, the
# figure plan 4.6 names as the worked `measured_not_scored` case.
PM25_BY_CLUSTER = {
    ("SG", "MS"): 17.0, ("SG", "EC"): 17.0, ("SG", "SC"): 16.0, ("SG", "JI"): 19.0,
    ("SG", "KB"): 18.0, ("SG", "WL"): 17.0, ("SG", "BT"): 16.0,
    ("MY", "SA"): 25.0, ("MY", "KL"): 26.0, ("MY", "GT"): 21.0, ("MY", "DB"): 22.0,
    ("MY", "KK"): 13.0,
    ("ID", "PL"): 41.0, ("ID", "CJ"): 41.0, ("ID", "BS"): 38.0, ("ID", "SM"): 32.0,
    ("ID", "SB"): 33.0,
    ("CN", "PD"): 42.0, ("CN", "NS"): 37.5, ("CN", "QH"): 36.5, ("CN", "XM"): 32.0,
    ("CN", "NB"): 38.5,
    ("HK", "TK"): 37.0, ("HK", "HF"): 37.0, ("HK", "KT"): 37.5, ("HK", "TP"): 35.5,
    ("HK", "TC"): 36.5,
}
PM25_DEFAULT = 25.0

# Yale SUHI v4 and Sentinel-2 NDVI tertiles, 0-2, by cluster. SUHI 2 is the
# hottest tertile; NDVI 2 the greenest. Dense reclaimed and industrial clusters
# run hot and bare, ridge and resort clusters cool and green.
MODIFIER_BASE_BY_CLUSTER = {
    ("SG", "MS"): (2, 0), ("SG", "EC"): (1, 1), ("SG", "SC"): (0, 2),
    ("SG", "JI"): (2, 0), ("SG", "KB"): (2, 0), ("SG", "WL"): (1, 1),
    ("SG", "BT"): (0, 2),
    ("MY", "SA"): (1, 1), ("MY", "KL"): (2, 0), ("MY", "GT"): (1, 1),
    ("MY", "DB"): (1, 1), ("MY", "KK"): (0, 2),
    ("ID", "PL"): (2, 0), ("ID", "CJ"): (1, 1), ("ID", "BS"): (1, 2),
    ("ID", "SM"): (2, 0), ("ID", "SB"): (2, 0),
    ("CN", "PD"): (2, 0), ("CN", "NS"): (1, 1), ("CN", "QH"): (2, 0),
    ("CN", "XM"): (1, 1), ("CN", "NB"): (1, 1),
    ("HK", "TK"): (1, 1), ("HK", "HF"): (1, 1), ("HK", "KT"): (2, 0),
    ("HK", "TP"): (0, 2), ("HK", "TC"): (1, 1),
}

# Plan 4.3.2 names SUHI tertile 1 and NDVI tertile 1 for SG-EC-002. Pinned here
# so the synthetic floor agrees with the fixture without waiting for the seed.
FIXTURE_MODIFIERS = {
    "SG-EC-001": (1, 1),
    "SG-EC-002": (1, 1),
}

DATASETS = {
    "flood_riverine": ("Aqueduct Floods v2 riverine (synthetic stand-in)", "m", "rcp8p5", 100),
    "flood_coastal": ("Aqueduct Floods v2 coastal-wtsub (synthetic stand-in)", "m", "rcp8p5", 100),
    "wind": ("STORM v4 (synthetic stand-in)", "m/s", None, 100),
    "heat_days35": ("NEX-GDDP-CMIP6 vs ERA5-Land (synthetic stand-in)", "days/yr", "ssp585", None),
    "pm25": ("GHAP PM2.5 annual mean (synthetic stand-in)", "ug/m3", None, None),
}

MODIFIER_DATASET = "Yale SUHI v4 + Sentinel-2 NDVI (synthetic stand-in)"


# ---------------------------------------------------------------------------
# Deterministic draws
# ---------------------------------------------------------------------------
def rng_for(key: str) -> random.Random:
    """A sub-generator keyed by a stable string, seeded from the master seed.

    Keyed per pin and per hazard, NOT per scenario. One jitter multiplier is
    drawn per pin per hazard and reused across today / 2030 / 2050, so a pin's
    value is monotone in the scenario factor. Per-scenario jitter would let a
    2050 depth land below its own 2030 depth, which contradicts the map beat the
    demo is built on: move the slider and watch flood exposure grow.
    """
    digest = hashlib.blake2b(
        ("%d|%s" % (MASTER_SEED, key)).encode("utf-8"), digest_size=8
    ).digest()
    return random.Random(struct.unpack("<Q", digest)[0])


def jitter(rng: random.Random, spread: float) -> float:
    """A multiplier uniform in [1 - spread, 1 + spread]."""
    return 1.0 + rng.uniform(-spread, spread)


def interpolate(anchors: Sequence[Tuple[float, float]], x: float) -> float:
    """Piecewise-linear interpolation, clamped to the end anchors."""
    if x <= anchors[0][0]:
        return anchors[0][1]
    if x >= anchors[-1][0]:
        return anchors[-1][1]
    for i in range(len(anchors) - 1):
        x0, y0 = anchors[i]
        x1, y1 = anchors[i + 1]
        if x0 <= x <= x1:
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return anchors[-1][1]


# ---------------------------------------------------------------------------
# Per-hazard physical models
# ---------------------------------------------------------------------------
def in_wp_basin(lat: float, lon: float) -> bool:
    """North West Pacific tropical-cyclone basin membership."""
    return lat >= WP_BASIN_MIN_LAT and lon >= WP_BASIN_MIN_LON


def coastal_depth_m(elevation_m: float, dist_to_coast_km: float,
                    scenario: str, rng: random.Random) -> float:
    """Surge depth: still-water level over the ground, attenuated inland."""
    level = COASTAL_LEVEL_M[scenario]
    head = level - elevation_m
    if head <= 0.0:
        return 0.0
    shaped = (head ** COASTAL_ELEVATION_GAMMA) / (level ** (COASTAL_ELEVATION_GAMMA - 1.0))
    depth = shaped * math.exp(-max(dist_to_coast_km, 0.0) / COASTAL_ATTENUATION_KM)
    depth *= jitter(rng, 0.15)
    return _clean_depth(depth)


def riverine_depth_m(elevation_m: float, dist_to_coast_km: float,
                     scenario: str, rng: random.Random) -> float:
    """Riverine and pluvial depth: falls with terrain, rises away from the coast.

    The distance term stands in for catchment position: a near-shore pin drains
    to the sea quickly, an inland floodplain pin does not.
    """
    terrain = _terrain_ramp(elevation_m)
    catchment = 0.60 + 0.40 * min(max(dist_to_coast_km, 0.0) / 10.0, 1.0)
    depth = RIVERINE_LEVEL_M[scenario] * terrain * catchment * jitter(rng, 0.20)
    return _clean_depth(depth)


def _terrain_ramp(elevation_m: float) -> float:
    """1.0 on the floodplain, 0.0 above the cutoff, linear between."""
    if elevation_m <= RIVERINE_FULL_BELOW_M:
        return 1.0
    if elevation_m >= RIVERINE_ZERO_ABOVE_M:
        return 0.0
    span = RIVERINE_ZERO_ABOVE_M - RIVERINE_FULL_BELOW_M
    return (RIVERINE_ZERO_ABOVE_M - elevation_m) / span


def _clean_depth(depth: float) -> float:
    if depth < NEGLIGIBLE_DEPTH_M:
        return 0.0
    return round(min(depth, FLOOD_DEPTH_CAP_M), 2)


def heat_days_delta(lat: float, scenario: str, rng: random.Random) -> float:
    """Days above 35 C per year against the 2016-2035 reference window.

    `today` IS the reference window, so the delta is exactly zero by definition
    of the metric, not by an accident of labelling (plan 4.6).
    """
    if scenario == "today":
        return 0.0
    at_2050 = interpolate(HEAT_2050_BY_ABS_LAT, abs(lat)) * jitter(rng, 0.12)
    if scenario == "y2050":
        return float(round(at_2050))
    return float(round(at_2050 * HEAT_2030_FRACTION * jitter(rng, 0.08)))


def wind_speed_ms(lat: float, lon: float, scenario: str,
                  rng: random.Random) -> Optional[float]:
    """100-year wind, or None where the basin has no coverage at all.

    None is the `absent` case: STORM simply does not model this point, so there
    is no value to store. It is never coerced to zero.
    """
    if not in_wp_basin(lat, lon):
        return None
    base = interpolate(WIND_TODAY_BY_ABS_LAT, abs(lat)) * jitter(rng, 0.04)
    return round(base * WIND_SCENARIO_FACTOR[scenario], 1)


def pm25_ugm3(country: str, cluster_code: str, rng: random.Random) -> float:
    """Annual mean PM2.5. Scenario-invariant: GHAP carries no pathway."""
    base = PM25_BY_CLUSTER.get((country, cluster_code), PM25_DEFAULT)
    return round(base * jitter(rng, 0.03), 1)


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------
def coverage_for(hazard: str, country: str, value: Optional[float]) -> str:
    """The three states of plan 4.6, and only three.

    `absent` wins over `measured_not_scored` whenever both could apply, because
    there is no value to store. That precedence makes the two states disjoint.
    """
    if value is None:
        return COVERAGE_ABSENT
    if SCORED_FOR[hazard][country]:
        return COVERAGE_SCORED
    return COVERAGE_MEASURED_NOT_SCORED


# ---------------------------------------------------------------------------
# Row assembly
# ---------------------------------------------------------------------------
def _f(row: Dict[str, object], key: str) -> float:
    return float(row[key])


def _s(row: Dict[str, object], key: str) -> str:
    return str(row[key])


def _hazard_row(seq: int, collateral_id: str, hazard: str, scenario: str,
                value: Optional[float], country: str) -> Dict[str, object]:
    dataset_name, unit, pathway, return_period = DATASETS[hazard]
    if hazard == "wind":
        pathway = "present-climate" if scenario == "today" else "climate-change"
    coverage = coverage_for(hazard, country, value)
    return {
        "id": "HS-%05d" % seq,
        "collateral_id": collateral_id,
        "hazard": hazard,
        "scenario": scenario,
        "value": "" if value is None else value,
        "coverage": coverage,
        "scenario_invariant": "true" if hazard == "pm25" else "false",
        "unit": unit,
        "dataset_name": dataset_name,
        "dataset_version": DATASET_VERSION,
        "pathway": "" if pathway is None else pathway,
        "return_period_yrs": "" if return_period is None else return_period,
        "sampled_at": SAMPLED_AT,
    }


def sample(portfolio_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """One `hazard_samples` row per pin per hazard per scenario.

    200 pins x 5 hazards x 3 scenarios = 3000 rows. No row is ever omitted: a
    point the model does not cover is recorded as `absent` with a NULL value,
    never dropped and never coerced to zero.
    """
    rows: List[Dict[str, object]] = []
    seq = 0
    for pin in portfolio_rows:
        cid = _s(pin, "collateral_id")
        country = _s(pin, "country")
        cluster_code = _s(pin, "cluster_code")
        lat = _f(pin, "lat")
        lon = _f(pin, "lon")
        elevation = _f(pin, "elevation_m")
        dist = _f(pin, "dist_to_coast_km")

        pm25_value = pm25_ugm3(country, cluster_code, rng_for("pm25|" + cid))

        for scenario in SCENARIOS:
            values = {
                "flood_riverine": riverine_depth_m(
                    elevation, dist, scenario, rng_for("riverine|" + cid)),
                "flood_coastal": coastal_depth_m(
                    elevation, dist, scenario, rng_for("coastal|" + cid)),
                "wind": wind_speed_ms(
                    lat, lon, scenario, rng_for("wind|" + cid)),
                "heat_days35": heat_days_delta(
                    lat, scenario, rng_for("heat|" + cid)),
                "pm25": pm25_value,
            }
            for hazard in HAZARDS:
                seq += 1
                rows.append(_hazard_row(seq, cid, hazard, scenario,
                                        values[hazard], country))
    return rows


def site_modifiers(portfolio_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """One `site_modifiers` row per pin.

    Emitted alongside the hazard samples because `heatHaircut` cannot run
    without the two tertiles, and the synthetic floor has to be a complete input
    set or it is not a floor. Worker A's live sampler overwrites these.
    """
    rows: List[Dict[str, object]] = []
    for pin in portfolio_rows:
        cid = _s(pin, "collateral_id")
        key = (_s(pin, "country"), _s(pin, "cluster_code"))
        suhi_base, ndvi_base = MODIFIER_BASE_BY_CLUSTER.get(key, (1, 1))
        if cid in FIXTURE_MODIFIERS:
            suhi, ndvi = FIXTURE_MODIFIERS[cid]
        else:
            rng = rng_for("modifiers|" + cid)
            suhi = _nudge(rng, suhi_base)
            ndvi = _nudge(rng, ndvi_base)
        rows.append({
            "collateral_id": cid,
            "suhi_tertile": suhi,
            "ndvi_tertile": ndvi,
            "dataset_name": MODIFIER_DATASET,
            "dataset_version": DATASET_VERSION,
            "sampled_at": SAMPLED_AT,
        })
    return rows


def _nudge(rng: random.Random, base: int) -> int:
    draw = rng.random()
    if draw < 0.15:
        return max(base - 1, 0)
    if draw >= 0.85:
        return min(base + 1, 2)
    return base


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
HAZARD_COLUMNS = (
    "id", "collateral_id", "hazard", "scenario", "value", "coverage",
    "scenario_invariant", "unit", "dataset_name", "dataset_version", "pathway",
    "return_period_yrs", "sampled_at",
)

MODIFIER_COLUMNS = (
    "collateral_id", "suhi_tertile", "ndvi_tertile", "dataset_name",
    "dataset_version", "sampled_at",
)


def repo_root() -> str:
    here = os.path.abspath(__file__)
    return os.path.dirname(os.path.dirname(os.path.dirname(here)))


def load_portfolio(path: Optional[str] = None) -> List[Dict[str, object]]:
    """Read `data/synthetic/portfolio.csv`, or generate it in memory if absent."""
    if path is None:
        path = os.path.join(repo_root(), "data", "synthetic", "portfolio.csv")
    if os.path.exists(path):
        with io.open(path, encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))
    from prep import gen_portfolio
    return gen_portfolio.generate()


def _write_csv(path: str, columns: Sequence[str],
               records: Sequence[Dict[str, object]]) -> None:
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), lineterminator="\n")
        writer.writeheader()
        for record in records:
            writer.writerow(record)


def coverage_table(rows: Sequence[Dict[str, object]]) -> str:
    header = "%-15s  %-9s  %9s  %21s  %8s" % (
        "hazard", "scenario", "scored", "measured_not_scored", "absent")
    lines = [header, "-" * len(header)]
    for hazard in HAZARDS:
        for scenario in SCENARIOS:
            subset = [r for r in rows
                      if r["hazard"] == hazard and r["scenario"] == scenario]
            counts = dict((state, 0) for state in COVERAGE_STATES)
            for r in subset:
                counts[r["coverage"]] += 1
            lines.append("%-15s  %-9s  %9d  %21d  %8d" % (
                hazard, scenario, counts[COVERAGE_SCORED],
                counts[COVERAGE_MEASURED_NOT_SCORED], counts[COVERAGE_ABSENT]))
    lines.append("-" * len(header))
    lines.append("total rows: %d" % len(rows))
    return "\n".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write the synthetic hazard floor to data/synthetic/.")
    parser.add_argument("--portfolio", default=None,
                        help="path to portfolio.csv (default: data/synthetic/portfolio.csv)")
    parser.add_argument("--out-dir",
                        default=os.path.join(repo_root(), "data", "synthetic"),
                        help="directory for the generated CSVs")
    parser.add_argument("--print-only", action="store_true",
                        help="print the coverage table and write nothing")
    args = parser.parse_args(argv)

    portfolio = load_portfolio(args.portfolio)
    hazard_rows = sample(portfolio)
    modifier_rows = site_modifiers(portfolio)

    print(coverage_table(hazard_rows))
    print("")
    print("pins=%d  hazard_samples=%d  site_modifiers=%d  dataset_version=%s" % (
        len(portfolio), len(hazard_rows), len(modifier_rows), DATASET_VERSION))

    if args.print_only:
        return 0

    hazard_path = os.path.join(args.out_dir, "hazard_samples.csv")
    modifier_path = os.path.join(args.out_dir, "site_modifiers.csv")
    _write_csv(hazard_path, HAZARD_COLUMNS, hazard_rows)
    _write_csv(modifier_path, MODIFIER_COLUMNS, modifier_rows)
    print("")
    print("wrote %s" % hazard_path)
    print("wrote %s" % modifier_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
