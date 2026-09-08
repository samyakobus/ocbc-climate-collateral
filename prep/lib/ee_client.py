"""S7 - Earth Engine access for `prep/sample_hazards.py`.

Plan sections 2 (data-prep sub-decision), 4.6 (prep pipeline) and 5 (S7).

ADR-2 boundary
--------------
This module samples. It does not derive. Every constant below names a dataset,
an asset id, a scenario, a band or a window; none of them is a rule. No haircut,
no coverage policy, no threshold and no validator lives here. Coverage policy is
`hazard_applicability`, read by `sample_hazards.py`; arithmetic on the sampled
values is TypeScript's.

Earth Engine is optional at import time
---------------------------------------
`import ee` is deferred, so `--source=frozen` and `--source=synthetic` run on a
machine with no `earthengine-api` installed and no credentials. Only
`--source=live` touches this module's `initialise()`, and a missing credential
raises `EarthEngineUnavailable` with a message that names what to do about it.

Pinned choices, all of them load-bearing (plan 4.6)
--------------------------------------------------
* Aqueduct Floods v2, riverine and coastal-with-subsidence, 100-year return
  period, RCP 8.5, at three epochs. **Ensemble mean over the five GCMs** and
  **coastal sea-level-rise percentile 50**, because the raw collection is a
  per-GCM stack and an unpinned pick makes two runs disagree. Riverine baseline
  epoch **1980**.
* NEX-GDDP-CMIP6 ssp585, days above 35 C. All three deltas share **one**
  reference window, 2016-2035. `today` is that reference, so it is exactly zero
  by definition of the metric rather than by an accident of labelling. `y2030`
  is 2021-2040 minus the reference and `y2050` is 2040-2059 minus it. ERA5-Land
  validates the reference against observation and is never the subtrahend.
* GHAP PM2.5 annual mean, a community asset whose path is pinned here.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

# --- dataset pins -----------------------------------------------------------

AQUEDUCT_COLLECTION = "WRI/Aqueduct_Flood_Hazard_Maps/V2"
AQUEDUCT_RETURN_PERIOD = 100
AQUEDUCT_PATHWAY = "rcp8p5"
AQUEDUCT_SLR_PERCENTILE = 50          # coastal only; 50 = median
AQUEDUCT_RIVERINE_BASELINE_EPOCH = 1980
AQUEDUCT_EPOCHS = {"today": "hist", "y2030": "2030", "y2050": "2050"}
AQUEDUCT_VERSION = "v2 / ens-mean / slr-p50 / hist-epoch-1980"

NEX_GDDP_COLLECTION = "NASA/GDDP-CMIP6"
NEX_GDDP_SCENARIO = "ssp585"
NEX_GDDP_THRESHOLD_K = 308.15         # 35 C, the band is in kelvin
# One reference window for all three deltas. See the module docstring.
NEX_GDDP_WINDOWS = {
    "reference": (2016, 2035),
    "y2030": (2021, 2040),
    "y2050": (2040, 2059),
}
NEX_GDDP_VERSION = "CMIP6 ssp585 / ens-mean / ref-window-2016-2035"

ERA5_LAND_COLLECTION = "ECMWF/ERA5_LAND/DAILY_AGGR"
ERA5_LAND_VERSION = "daily-aggr"

GHAP_PM25_ASSET = "projects/sat-io/open-datasets/GHAP/GHAP_Y1K_PM25"
GHAP_VERSION = "GHAP Y1K annual mean"

YALE_SUHI_ASSET = "YALE/YCEO_UHI/UHI_yearly_averaged/v4"
YALE_SUHI_VERSION = "v4"

SENTINEL2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED"
NDVI_SCALE_M = 300
SENTINEL2_VERSION = "S2_SR_HARMONIZED / NDVI 300 m"

COPERNICUS_DEM_COLLECTION = "COPERNICUS/DEM/GLO30"
COPERNICUS_DEM_VERSION = "GLO30"

#: Sampling scale in metres, per dataset. Aqueduct is ~1 km, GHAP 1 km.
DEFAULT_SCALE_M = 1000


class EarthEngineUnavailable(RuntimeError):
    """Raised when `--source=live` is asked for and Earth Engine cannot be reached.

    `sample_hazards.py` turns this into a clear message and a non-zero exit. It
    never falls back silently: a run that claims to be live must be live, or the
    committed frozen and synthetic floors would be quietly relabelled.
    """


_ee = None
_initialised = False


def _import_ee():
    global _ee
    if _ee is None:
        try:
            import ee  # type: ignore
        except ImportError as exc:  # pragma: no cover - depends on the machine
            raise EarthEngineUnavailable(
                "earthengine-api is not installed. Install it with "
                "`pip install earthengine-api`, or run with --source=frozen or "
                "--source=synthetic, both of which need nothing external."
            ) from exc
        _ee = ee
    return _ee


def initialise(project: Optional[str] = None) -> None:
    """Authenticates against a registered Earth Engine cloud project.

    `project` defaults to the `EE_PROJECT` environment variable. Registration is
    on the Day-1 network dependency list (plan S1) because it cannot be done
    after the interface goes down.
    """
    global _initialised
    if _initialised:
        return

    import os

    ee = _import_ee()
    project = project or os.environ.get("EE_PROJECT")
    if not project:
        raise EarthEngineUnavailable(
            "EE_PROJECT is not set. Earth Engine needs a registered cloud project id. "
            "Run with --source=frozen or --source=synthetic instead."
        )

    try:
        ee.Initialize(project=project)
    except Exception as exc:  # pragma: no cover - depends on credentials
        raise EarthEngineUnavailable(
            f"Earth Engine refused to initialise for project {project!r}: {exc}. "
            "Run `earthengine authenticate`, or use --source=frozen."
        ) from exc

    _initialised = True


def is_available() -> bool:
    """True when a live sample could be attempted. Never raises."""
    try:
        _import_ee()
    except EarthEngineUnavailable:
        return False
    import os

    return bool(os.environ.get("EE_PROJECT"))


# --- point sampling ---------------------------------------------------------


def _feature_collection(points: Sequence[Tuple[str, float, float]]):
    ee = _import_ee()
    return ee.FeatureCollection([
        ee.Feature(ee.Geometry.Point([lon, lat]), {"cid": cid})
        for cid, lat, lon in points
    ])


def sample_image(
    image,
    points: Sequence[Tuple[str, float, float]],
    band: str,
    scale: int = DEFAULT_SCALE_M,
) -> Dict[str, Optional[float]]:
    """Samples one band at many points, returning `{collateral_id: value or None}`.

    A point the image does not cover comes back as `None`, which the caller turns
    into `coverage = 'absent'`. A point the image covers but whose pixel carries a
    nodata sentinel is a different thing entirely and is the caller's hard failure;
    Earth Engine masks nodata, so it also arrives here as `None`. `sample_hazards.py`
    therefore separates the two using dataset footprints, not pixel values, and
    never coerces either case to zero.
    """
    ee = _import_ee()
    fc = _feature_collection(points)
    sampled = image.select(band).reduceRegions(
        collection=fc, reducer=ee.Reducer.first(), scale=scale
    )

    out: Dict[str, Optional[float]] = {cid: None for cid, _, _ in points}
    for feature in sampled.getInfo().get("features", []):
        props = feature.get("properties", {})
        cid = props.get("cid")
        if cid is None:
            continue
        value = props.get("first")
        out[cid] = None if value is None else float(value)
    return out


# --- per-hazard image builders ---------------------------------------------
#
# Each returns (image, band, dataset_name, dataset_version). They select and
# reduce; they do not threshold, score or classify.


def aqueduct_flood(peril: str, scenario: str):
    """Aqueduct Floods v2 depth image for one peril and one scenario.

    `peril` is 'riverine' or 'coastal'. Coastal is the with-subsidence product,
    at sea-level-rise percentile 50. Both are the ENSEMBLE MEAN over the five
    GCMs, so a rerun cannot land on a different member.
    """
    ee = _import_ee()
    if peril not in ("riverine", "coastal"):
        raise ValueError(f"unknown flood peril {peril!r}")
    if scenario not in AQUEDUCT_EPOCHS:
        raise ValueError(f"unknown scenario {scenario!r}")

    epoch = AQUEDUCT_EPOCHS[scenario]
    collection = ee.ImageCollection(AQUEDUCT_COLLECTION)

    if peril == "riverine":
        filtered = collection.filter(ee.Filter.eq("floodtype", "inunriver"))
        if epoch == "hist":
            filtered = filtered.filter(ee.Filter.eq("year", AQUEDUCT_RIVERINE_BASELINE_EPOCH))
        else:
            filtered = (
                filtered.filter(ee.Filter.eq("year", int(epoch)))
                .filter(ee.Filter.eq("climatescenario", AQUEDUCT_PATHWAY))
            )
    else:
        filtered = collection.filter(ee.Filter.eq("floodtype", "inuncoast"))
        filtered = filtered.filter(ee.Filter.eq("subsidence", "wtsub"))
        if epoch == "hist":
            filtered = filtered.filter(ee.Filter.eq("year", 2010))
        else:
            filtered = (
                filtered.filter(ee.Filter.eq("year", int(epoch)))
                .filter(ee.Filter.eq("climatescenario", AQUEDUCT_PATHWAY))
                .filter(ee.Filter.eq("slrscenario", AQUEDUCT_SLR_PERCENTILE))
            )

    filtered = filtered.filter(ee.Filter.eq("returnperiod", AQUEDUCT_RETURN_PERIOD))

    # Ensemble MEAN across whatever members survive the filters above.
    image = filtered.mean()
    name = f"Aqueduct Floods v2 {'riverine' if peril == 'riverine' else 'coastal-wtsub'}"
    return image, "b1", name, AQUEDUCT_VERSION


def nex_gddp_days_over_35(window: str):
    """Mean annual count of days above 35 C over one NEX-GDDP-CMIP6 window.

    Returns the RAW count for the window. The delta against the 2016-2035
    reference is taken by the caller, so this function stays a sampler.
    """
    ee = _import_ee()
    if window not in NEX_GDDP_WINDOWS:
        raise ValueError(f"unknown window {window!r}")

    start, end = NEX_GDDP_WINDOWS[window]
    collection = (
        ee.ImageCollection(NEX_GDDP_COLLECTION)
        .filter(ee.Filter.eq("scenario", NEX_GDDP_SCENARIO))
        .filterDate(f"{start}-01-01", f"{end}-12-31")
        .select("tasmax")
    )
    years = end - start + 1
    hot_days = collection.map(lambda img: img.gt(NEX_GDDP_THRESHOLD_K)).sum().divide(years)
    return hot_days, "tasmax", "NEX-GDDP-CMIP6 days above 35C", NEX_GDDP_VERSION


def era5_land_days_over_35(start_year: int, end_year: int):
    """ERA5-Land observed hot-day count. Validation only, never the subtrahend."""
    ee = _import_ee()
    collection = (
        ee.ImageCollection(ERA5_LAND_COLLECTION)
        .filterDate(f"{start_year}-01-01", f"{end_year}-12-31")
        .select("temperature_2m_max")
    )
    years = end_year - start_year + 1
    hot_days = collection.map(lambda img: img.gt(NEX_GDDP_THRESHOLD_K)).sum().divide(years)
    return hot_days, "temperature_2m_max", "ERA5-Land days above 35C", ERA5_LAND_VERSION


def ghap_pm25():
    """GHAP PM2.5 annual mean. Scenario-invariant: one value, written three times."""
    ee = _import_ee()
    image = ee.ImageCollection(GHAP_PM25_ASSET).mean()
    return image, "b1", "GHAP PM2.5 annual mean", GHAP_VERSION


def yale_suhi():
    ee = _import_ee()
    image = ee.ImageCollection(YALE_SUHI_ASSET).select("Daytime").mean()
    return image, "Daytime", "Yale SUHI", YALE_SUHI_VERSION


def sentinel2_ndvi(start: str = "2024-01-01", end: str = "2025-01-01"):
    ee = _import_ee()
    collection = (
        ee.ImageCollection(SENTINEL2_COLLECTION)
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
    )
    ndvi = collection.map(lambda img: img.normalizedDifference(["B8", "B4"]).rename("ndvi")).mean()
    return ndvi, "ndvi", "Sentinel-2 NDVI", SENTINEL2_VERSION


def copernicus_dem():
    ee = _import_ee()
    dem = ee.ImageCollection(COPERNICUS_DEM_COLLECTION).select("DEM").mosaic()
    return dem, "DEM", "Copernicus DEM GLO-30", COPERNICUS_DEM_VERSION


def copernicus_slope():
    ee = _import_ee()
    dem, _, _, version = copernicus_dem()
    slope = _import_ee().Terrain.slope(dem).rename("slope")
    return slope, "slope", "Copernicus DEM GLO-30 slope", version


__all__ = [
    "EarthEngineUnavailable",
    "initialise",
    "is_available",
    "sample_image",
    "aqueduct_flood",
    "nex_gddp_days_over_35",
    "era5_land_days_over_35",
    "ghap_pm25",
    "yale_suhi",
    "sentinel2_ndvi",
    "copernicus_dem",
    "copernicus_slope",
    "AQUEDUCT_VERSION",
    "NEX_GDDP_VERSION",
    "GHAP_VERSION",
    "YALE_SUHI_VERSION",
    "SENTINEL2_VERSION",
    "NEX_GDDP_WINDOWS",
]
