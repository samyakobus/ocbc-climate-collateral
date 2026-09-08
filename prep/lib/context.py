"""S7 - the seven unscored context factors, one set of seven rows per pin.

Plan 4.6 lists `context_factors` among `sample_hazards.py`'s outputs: FIRMS,
Aqueduct 4.0, ERA5-Land CDD, Herrera-Garcia 2021, IPCC AR6 regional sea level and
Deltares Shoreline, seven rows per pin. Plan 1 (spec constraints) fixes what they
are for: seven context factors, UNSCORED. They are shown on the context panel and
never summed into a haircut.

ADR-2, stated rather than left implicit
---------------------------------------
Under `--source=live` this module samples, which is squarely Python's job. Under
`--source=synthetic` it must derive plausible values with nothing external, which
is a physical model and therefore a rule. That is the same exemption ADR-2 grants
`prep/lib/synthetic.py`, and it is claimed here on the same four grounds: the
derivation never runs in the same pass as a real sample, it is fully pinned by
`seed=20260907`, its outputs are committed to `data/synthetic/` and diffed in
review, and `synthetic` is the floor every acceptance test runs against when
Earth Engine is unavailable. Recorded in the plan changelog as an extension of
the existing exemption, not a new one.

What is still NOT here: no threshold, no flag and no haircut. In particular this
module stores the AR6 sea-level rise in metres and does NOT decide whether the
coastal inundation flag fires. That comparison is
`collateral.elevation_m < sea_level_inundation + rules.inundation_threshold_m`,
it lives in TypeScript, and it reads `rules` from the active rule set.
"""

from __future__ import annotations

import hashlib
import random
import struct
from typing import Dict, List, Optional, Sequence

SAMPLED_AT = "2026-09-07"
MASTER_SEED = 20260907
DATASET_VERSION_SYNTHETIC = "synthetic"

FACTORS = (
    "haze",
    "water_stress",
    "cooling_degree_days",
    "subsidence_susceptibility",
    "sea_level_inundation",
    "coastal_erosion",
    "wildfire",
)

UNITS = {
    "haze": "days_pm25_over_55_per_yr",
    "water_stress": "ratio",
    "cooling_degree_days": "degree_days_18C",
    "subsidence_susceptibility": "probability",
    "sea_level_inundation": "m",
    "coastal_erosion": "m_per_yr",
    "wildfire": "firms_detections_per_yr_50km",
}

DATASETS = {
    "haze": ("NASA FIRMS + GHAP", "https://firms.modaps.eosdis.nasa.gov/"),
    "water_stress": ("WRI Aqueduct 4.0", "https://www.wri.org/data/aqueduct-global-maps-40-data"),
    "cooling_degree_days": ("ERA5-Land", "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land"),
    "subsidence_susceptibility": (
        "Herrera-Garcia et al. 2021",
        "https://www.science.org/doi/10.1126/science.abb8549",
    ),
    "sea_level_inundation": (
        "IPCC AR6 regional sea level, SSP5-8.5 median at 2050",
        "https://sealevel.nasa.gov/ipcc-ar6-sea-level-projection-tool",
    ),
    "coastal_erosion": ("Deltares Shoreline Monitor", "https://shoreline.deltares.nl/"),
    "wildfire": ("NASA FIRMS", "https://firms.modaps.eosdis.nasa.gov/"),
}

# ---------------------------------------------------------------------------
# Regional constants. Judgemental synthetic stand-ins except where marked, and
# docs/sources.md says which is which.
# ---------------------------------------------------------------------------

#: IPCC AR6 regional MEDIAN sea-level rise at 2050 under SSP5-8.5, metres,
#: relative to the 1995-2014 baseline. Regional values across this basin sit in a
#: narrow band; these are the per-country figures the demo cites.
#:
#: The AC-8 pair is deliberately insensitive to this table. SG-MS-002 sits at
#: 0.6 m and SG-MS-003 at 2.6 m, so with the 0.50 m threshold the pair straddles
#: the boundary for any value between 0.10 m and 2.10 m. Changing this constant
#: cannot flip the fixture.
SLR_2050_M = {"SG": 0.30, "MY": 0.29, "ID": 0.32, "CN": 0.28, "HK": 0.29}

#: Aqueduct 4.0 baseline water stress, withdrawal over available supply.
WATER_STRESS = {"SG": 1.65, "MY": 0.28, "ID": 0.42, "CN": 1.10, "HK": 0.95}

#: Annual cooling degree days above 18 C. Equatorial sites run far higher than
#: subtropical ones, which is why Singapore and Jakarta dwarf Shanghai.
CDD_BASE = {"SG": 3400.0, "MY": 3300.0, "ID": 3450.0, "CN": 1450.0, "HK": 2100.0}

#: Days per year with PM2.5 above 55 ug/m3, the haze proxy.
HAZE_DAYS = {"SG": 8.0, "MY": 16.0, "ID": 34.0, "CN": 22.0, "HK": 6.0}

#: FIRMS detections per year within 50 km.
WILDFIRE_BASE = {"SG": 2.0, "MY": 41.0, "ID": 118.0, "CN": 9.0, "HK": 3.0}

#: Herrera-Garcia 2021 SUSCEPTIBILITY PROBABILITY, not a rate in cm/yr
#: (plan assumption 22). Jakarta and coastal China are the high-susceptibility
#: cases the context panel is there to show.
SUBSIDENCE_BASE = {"SG": 0.08, "MY": 0.12, "ID": 0.71, "CN": 0.44, "HK": 0.09}

#: Deltares shoreline change, metres per year. Negative is erosion.
EROSION_BASE = {"SG": -0.15, "MY": -0.60, "ID": -1.35, "CN": -0.45, "HK": -0.25}

#: Direction of travel shown beside each factor. Not a number and not scored.
DIRECTIONS = {
    "haze": ("worsening", "worsening"),
    "water_stress": ("stable", "worsening"),
    "cooling_degree_days": ("worsening", "worsening"),
    "subsidence_susceptibility": ("stable", "stable"),
    "sea_level_inundation": ("worsening", "worsening"),
    "coastal_erosion": ("worsening", "worsening"),
    "wildfire": ("stable", "worsening"),
}


# ---------------------------------------------------------------------------
# Terrain: slope and the landslide manual-review flag
# ---------------------------------------------------------------------------

#: Terrain ruggedness by market, a multiplier on the slope derived from
#: elevation. These reflect real topography rather than policy: Hong Kong's
#: granite hillsides above Tai Po and Sha Tin are genuinely steeper ground than
#: the Pudong and Nansha deltas at the same height above sea level. Under
#: `--source=live` this whole function is replaced by Copernicus DEM slope.
TERRAIN_RUGGEDNESS = {"SG": 0.60, "MY": 1.15, "ID": 1.00, "CN": 0.75, "HK": 1.35}

#: Slope in degrees at or above which the landslide flag is raised.
#:
#: 25 degrees, per the spec. An earlier version used 18, which is where NASA
#: LHASA susceptibility starts climbing, but the spec fixes the threshold and the
#: spec wins.
LANDSLIDE_SLOPE_DEG = 25.0

#: Scales elevation into a slope. Chosen so the 25-degree threshold flags 8 to 12
#: pins, and flags them in Malaysia, Indonesia and Hong Kong rather than
#: everywhere: at 1.20 only 5 flag, at 1.50 sixteen do and Indonesia starts
#: picking up pins that are not on hillsides. At 1.30 it is eleven, across MY, ID
#: and HK, with none in Singapore or coastal China, which is the right shape.
#:
#: This is a synthetic stand-in, not a measurement. `--source=live` replaces the
#: whole function with Copernicus DEM slope and docs/sources.md says so.
SLOPE_ELEVATION_COEFFICIENT = 1.30

SLOPE_MAX_DEG = 45.0


def slope_deg(elevation_m: float, country: str, rng: random.Random) -> float:
    """Derived slope in degrees. Rises with elevation, scaled by local ruggedness."""
    base = (
        TERRAIN_RUGGEDNESS.get(country, 1.0)
        * SLOPE_ELEVATION_COEFFICIENT
        * max(elevation_m, 0.0) ** 0.75
    )
    return round(min(max(base + _jitter(rng, 0.6), 0.0), SLOPE_MAX_DEG), 2)


def derive_collateral_updates(portfolio_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """Slope and the landslide flag for every pin.

    Plan 4.6 has `sample_hazards.py` write `collateral.slope_deg` and
    `landslide_flag` from Copernicus DEM slope and NASA LHASA. Under
    `--source=synthetic` there is no raster, so they are derived here under the
    same ADR-2 exemption this module already claims.

    **Landslide is a manual-review flag, never a number** (a binding spec
    constraint). It is returned as a boolean and nothing multiplies it into a
    haircut; `lib/valuation` never reads it. The case screen renders a badge and
    a human decides.

    `elevation_m` is passed through unchanged rather than recomputed, so this
    cannot move the AC-8 inundation pair.
    """
    out: List[Dict[str, object]] = []

    for row in portfolio_rows:
        cid = _s(row, "id") or _s(row, "collateral_id")
        country = _s(row, "country", "SG")
        elevation = _f(row, "elevation_m", 0.0)
        slope = slope_deg(elevation, country, rng_for(f"{cid}:slope"))

        out.append({
            "collateral_id": cid,
            "slope_deg": slope,
            "elevation_m": elevation,
            "landslide_flag": slope >= LANDSLIDE_SLOPE_DEG,
        })

    return out


def rng_for(key: str) -> random.Random:
    """A deterministic generator per (pin, factor), so a rerun never churns."""
    digest = hashlib.sha256(f"{MASTER_SEED}:{key}".encode("utf-8")).digest()
    return random.Random(struct.unpack("<Q", digest[:8])[0])


def _f(row: Dict[str, object], key: str, default: float = 0.0) -> float:
    raw = row.get(key)
    if raw is None or str(raw).strip() == "":
        return default
    return float(raw)


def _s(row: Dict[str, object], key: str, default: str = "") -> str:
    raw = row.get(key)
    return default if raw is None else str(raw)


def _jitter(rng: random.Random, spread: float) -> float:
    return rng.uniform(-spread, spread)


def derive(row: Dict[str, object]) -> List[Dict[str, object]]:
    """The seven context rows for one pin, from a `--source=synthetic` model."""
    cid = _s(row, "id") or _s(row, "collateral_id")
    country = _s(row, "country", "SG")
    lat = _f(row, "lat")
    dist = _f(row, "dist_to_coast_km", 5.0)
    elevation = _f(row, "elevation_m", 10.0)

    out: List[Dict[str, object]] = []

    def emit(factor: str, value: Optional[float]) -> None:
        name, url = DATASETS[factor]
        d2030, d2050 = DIRECTIONS[factor]
        out.append({
            "collateral_id": cid,
            "factor": factor,
            "value": None if value is None else round(value, 4),
            "unit": UNITS[factor],
            "direction_2030": d2030,
            "direction_2050": d2050,
            "dataset_name": f"{name} (synthetic stand-in)",
            "source_url": url,
            "sampled_at": SAMPLED_AT,
        })

    emit("haze", max(HAZE_DAYS.get(country, 10.0) + _jitter(rng_for(f"{cid}:haze"), 3.0), 0.0))
    emit("water_stress", max(WATER_STRESS.get(country, 0.5) + _jitter(rng_for(f"{cid}:ws"), 0.08), 0.0))

    # Cooling degree days fall with latitude away from the equator.
    cdd = CDD_BASE.get(country, 2500.0) - abs(lat) * 18.0 + _jitter(rng_for(f"{cid}:cdd"), 60.0)
    emit("cooling_degree_days", max(cdd, 0.0))

    # Subsidence susceptibility is highest on soft coastal ground: low elevation
    # close to the shore. Clamped to a probability.
    softness = max(0.0, 1.0 - elevation / 25.0) * max(0.0, 1.0 - dist / 20.0)
    subs = SUBSIDENCE_BASE.get(country, 0.2) * (0.55 + 0.75 * softness)
    emit("subsidence_susceptibility", min(max(subs + _jitter(rng_for(f"{cid}:subs"), 0.03), 0.0), 1.0))

    # The regional AR6 median. Deliberately NOT jittered: it is a published
    # regional figure, the same for every pin in a country, and the AC-8 pair
    # rests on it. A per-pin wobble would make the fixture's threshold move.
    emit("sea_level_inundation", SLR_2050_M.get(country, 0.30))

    # Erosion only means anything near a shoreline.
    erosion = EROSION_BASE.get(country, -0.4) * max(0.0, 1.0 - dist / 10.0)
    emit("coastal_erosion", erosion + _jitter(rng_for(f"{cid}:eros"), 0.05))

    emit("wildfire", max(WILDFIRE_BASE.get(country, 5.0) + _jitter(rng_for(f"{cid}:fire"), 4.0), 0.0))

    return out


def derive_all(portfolio_rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """Seven rows per pin, 1,400 for the seeded 200."""
    rows: List[Dict[str, object]] = []
    for row in portfolio_rows:
        rows.extend(derive(row))
    return rows


__all__ = [
    "FACTORS", "UNITS", "DATASETS", "SLR_2050_M", "derive", "derive_all", "SAMPLED_AT",
    "TERRAIN_RUGGEDNESS", "LANDSLIDE_SLOPE_DEG", "slope_deg", "derive_collateral_updates",
]
