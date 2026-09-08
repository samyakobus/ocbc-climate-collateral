"""S7 - local GeoTIFF sampling for the datasets Earth Engine cannot serve.

Plan sections 2 (data-prep sub-decision), 4.6 and 5 (S7).

Pure Earth Engine dies on the STORM and NASA LHASA asset-ingest quota, so those
are downloaded once into the gitignored `data/raw/` and sampled here with
rasterio. Only the 200 sampled values are committed.

ADR-2 boundary: this module reads pixels. It applies no threshold, computes no
haircut and decides no coverage policy.

Nodata is a hard failure, not a zero
------------------------------------
`sample()` returns one of three things per point, and the three are kept apart
deliberately (plan 4.6):

    OUTSIDE   the point lies outside the raster's footprint. There is no
              measurement here, and the caller records `coverage = 'absent'`.
    NODATA    the point lies INSIDE the footprint and the pixel carries the
              raster's nodata sentinel. This is a defect in the input, never a
              zero. The caller collects every such point and fails the whole run
              as one batch, so a bad download is fixed in one cycle rather than
              one pin at a time.
    a float   a real measurement.

Nothing here ever coerces a sentinel to zero and nothing persists one.

STORM, both editions (plan 4.6)
-------------------------------
`today` reads the PRESENT-CLIMATE edition, 4TU DOI 10.4121/12705164. `y2030` and
`y2050` read the CLIMATE-CHANGE edition, 4TU DOI 10.4121/14510817. Two editions,
not one file reused, because the present-climate product is not a scenario of the
other. Only the West Pacific and North Indian basins are downloaded.
"""

from __future__ import annotations

import math
import os
from typing import Dict, List, Optional, Sequence, Tuple

# Sentinels. `OUTSIDE` and `NODATA` are distinct objects, never equal to a float
# and never equal to each other, so a caller cannot conflate them by accident.
OUTSIDE = object()
NODATA = object()

RAW_DIR = os.path.join("data", "raw")

# --- STORM ------------------------------------------------------------------

STORM_PRESENT_DOI = "10.4121/12705164"
STORM_CLIMATE_DOI = "10.4121/14510817"
STORM_RETURN_PERIOD = 100
STORM_BASINS = ("WP", "NI")           # West Pacific, North Indian

STORM_PRESENT_VERSION = f"STORM v4 present-climate (DOI {STORM_PRESENT_DOI}) / RP100"
STORM_CLIMATE_VERSION = f"STORM v4 climate-change (DOI {STORM_CLIMATE_DOI}) / RP100"

#: Which edition each scenario reads. Present climate is NOT reused for 2030/2050.
STORM_EDITION_FOR_SCENARIO = {
    "today": "present",
    "y2030": "climate",
    "y2050": "climate",
}


def storm_path(edition: str, basin: str) -> str:
    """Expected on-disk path of one STORM return-period raster."""
    if edition not in ("present", "climate"):
        raise ValueError(f"unknown STORM edition {edition!r}")
    return os.path.join(
        RAW_DIR, "storm", edition, f"STORM_FIXED_RETURN_PERIODS_{basin}_{STORM_RETURN_PERIOD}_YR_RP.tif"
    )


def storm_version(scenario: str) -> str:
    edition = STORM_EDITION_FOR_SCENARIO[scenario]
    return STORM_PRESENT_VERSION if edition == "present" else STORM_CLIMATE_VERSION


# --- NASA LHASA -------------------------------------------------------------

LHASA_PATH = os.path.join(RAW_DIR, "lhasa", "LHASA_global_landslide_susceptibility.tif")
LHASA_VERSION = "NASA LHASA global susceptibility"

# --- Herrera-Garcia 2021 subsidence ----------------------------------------
#
# A SUSCEPTIBILITY PROBABILITY, not a rate in cm/yr. Plan assumption 22 states
# this explicitly, because reading it as a rate would put a plausible-looking
# but wrong number on the context panel.
SUBSIDENCE_PATH = os.path.join(RAW_DIR, "subsidence", "herrera_garcia_2021_susceptibility.tif")
SUBSIDENCE_VERSION = "Herrera-Garcia 2021 susceptibility probability"


class RasterUnavailable(RuntimeError):
    """Raised when `--source=live` needs a raster that is not on disk."""


_rasterio = None


def _import_rasterio():
    global _rasterio
    if _rasterio is None:
        try:
            import rasterio  # type: ignore
        except ImportError as exc:  # pragma: no cover - depends on the machine
            raise RasterUnavailable(
                "rasterio is not installed. Install it with `pip install rasterio`, or run "
                "with --source=frozen or --source=synthetic, both of which need nothing external."
            ) from exc
        _rasterio = rasterio
    return _rasterio


def is_available(path: str) -> bool:
    """True when this raster could be sampled. Never raises."""
    try:
        _import_rasterio()
    except RasterUnavailable:
        return False
    return os.path.exists(path)


def sample(path: str, points: Sequence[Tuple[str, float, float]]) -> Dict[str, object]:
    """Samples one raster at many points.

    `points` is a sequence of `(collateral_id, lat, lon)`. Returns
    `{collateral_id: float | OUTSIDE | NODATA}`. See the module docstring for
    why those three cases are kept apart.
    """
    rasterio = _import_rasterio()

    if not os.path.exists(path):
        raise RasterUnavailable(
            f"{path} is not on disk. Download it into data/raw/ first; it is on the Day-1 "
            f"network dependency list (plan S1)."
        )

    out: Dict[str, object] = {}
    with rasterio.open(path) as src:
        nodata = src.nodata
        bounds = src.bounds
        coords = [(lon, lat) for _, lat, lon in points]
        values = list(src.sample(coords, indexes=1))

        for (cid, lat, lon), value in zip(points, values):
            inside = bounds.left <= lon <= bounds.right and bounds.bottom <= lat <= bounds.top
            if not inside:
                out[cid] = OUTSIDE
                continue

            raw = float(value[0])
            if math.isnan(raw):
                out[cid] = NODATA
            elif nodata is not None and raw == float(nodata):
                out[cid] = NODATA
            else:
                out[cid] = raw

    return out


def sample_first_available(
    paths: Sequence[str], points: Sequence[Tuple[str, float, float]]
) -> Dict[str, object]:
    """Samples several rasters covering different footprints and merges them.

    STORM ships one file per basin, and a point outside every basin is genuinely
    `OUTSIDE`, which is why Singapore wind is `absent` rather than zero. A NODATA
    hit in ANY basin that covers the point stays NODATA and is never masked by a
    later file's OUTSIDE.
    """
    merged: Dict[str, object] = {cid: OUTSIDE for cid, _, _ in points}

    for path in paths:
        if not os.path.exists(path):
            continue
        partial = sample(path, points)
        for cid, value in partial.items():
            if value is OUTSIDE:
                continue
            if merged[cid] is OUTSIDE or value is NODATA:
                merged[cid] = value

    return merged


def storm_wind(scenario: str, points: Sequence[Tuple[str, float, float]]) -> Dict[str, object]:
    """100-year 10-minute sustained wind, from the edition this scenario reads."""
    edition = STORM_EDITION_FOR_SCENARIO[scenario]
    paths = [storm_path(edition, basin) for basin in STORM_BASINS]
    if not any(os.path.exists(p) for p in paths):
        raise RasterUnavailable(
            f"No STORM {edition}-edition raster found under {os.path.join(RAW_DIR, 'storm', edition)}. "
            f"Download the West Pacific and North Indian basins from 4TU "
            f"(DOI {STORM_PRESENT_DOI} present, {STORM_CLIMATE_DOI} climate change)."
        )
    return sample_first_available(paths, points)


__all__ = [
    "OUTSIDE",
    "NODATA",
    "RasterUnavailable",
    "is_available",
    "sample",
    "sample_first_available",
    "storm_wind",
    "storm_path",
    "storm_version",
    "STORM_EDITION_FOR_SCENARIO",
    "STORM_PRESENT_VERSION",
    "STORM_CLIMATE_VERSION",
    "LHASA_PATH",
    "LHASA_VERSION",
    "SUBSIDENCE_PATH",
    "SUBSIDENCE_VERSION",
]
