"""S7 - the frozen replay: read and write `data/frozen/*.csv`.

Plan section 2, "Three-source rule". Every prep script accepts
`--source=live|frozen|synthetic`:

    live       samples Earth Engine and rasterio, and WRITES data/frozen/
    frozen     replays the committed CSV with no credentials
    synthetic  derives plausible values from a seeded model, needing nothing

`frozen` is the preferred replay and `synthetic` is the unconditional floor. This
module is the seam between them: one CSV shape, written by the live path and read
by the frozen path, so a frozen run is byte-for-byte what the live run produced.

ADR-2 boundary: this module moves rows. It computes nothing.
"""

from __future__ import annotations

import csv
import os
from typing import Dict, Iterable, List, Optional, Sequence

FROZEN_DIR = os.path.join("data", "frozen")
SYNTHETIC_DIR = os.path.join("data", "synthetic")

#: The CSV shapes S7 owns. Column order is the schema's, so a diff reads cleanly.
HAZARD_SAMPLE_COLUMNS = (
    "collateral_id",
    "hazard",
    "scenario",
    "value",
    "coverage",
    "scenario_invariant",
    "unit",
    "dataset_name",
    "dataset_version",
    "pathway",
    "return_period_yrs",
    "sampled_at",
)

SITE_MODIFIER_COLUMNS = (
    "collateral_id",
    "suhi_tertile",
    "ndvi_tertile",
    "dataset_name",
    "dataset_version",
    "sampled_at",
)

CONTEXT_FACTOR_COLUMNS = (
    "collateral_id",
    "factor",
    "value",
    "unit",
    "direction_2030",
    "direction_2050",
    "dataset_name",
    "source_url",
    "sampled_at",
)

#: Extra `collateral` columns the sampler is allowed to write back (plan 4.6).
COLLATERAL_UPDATE_COLUMNS = ("collateral_id", "slope_deg", "elevation_m", "landslide_flag")

#: S20 regional feeds. `hotspot_id` is absent on purpose: associating an event
#: with a hotspot is a spatial decision that PostGIS owns (ADR-7).
ENVIRONMENTAL_EVENT_COLUMNS = (
    "id", "title", "event_type", "occurred_on", "lon", "lat",
    "source_feed", "source_url", "dedupe_key",
)

SATELLITE_TILE_COLUMNS = (
    "id", "region", "bbox", "capture_date", "cached_path", "live_url", "fetched_at", "provider",
)

FILES = {
    "hazard_samples": HAZARD_SAMPLE_COLUMNS,
    "site_modifiers": SITE_MODIFIER_COLUMNS,
    "context_factors": CONTEXT_FACTOR_COLUMNS,
    "collateral_updates": COLLATERAL_UPDATE_COLUMNS,
    "environmental_events": ENVIRONMENTAL_EVENT_COLUMNS,
    "satellite_tiles": SATELLITE_TILE_COLUMNS,
}


class FrozenUnavailable(RuntimeError):
    """Raised when `--source=frozen` is asked for and the CSV is not committed."""


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def directory_for(source: str) -> str:
    """`data/frozen` for live and frozen, `data/synthetic` for synthetic."""
    root = repo_root()
    if source == "synthetic":
        return os.path.join(root, SYNTHETIC_DIR)
    return os.path.join(root, FROZEN_DIR)


def path_for(source: str, name: str) -> str:
    return os.path.join(directory_for(source), f"{name}.csv")


def exists(source: str, name: str) -> bool:
    return os.path.exists(path_for(source, name))


def read(source: str, name: str, required: bool = True) -> List[Dict[str, str]]:
    """Reads one committed CSV. Returns [] for an optional file that is absent."""
    path = path_for(source, name)
    if not os.path.exists(path):
        if required:
            raise FrozenUnavailable(
                f"{path} is not committed, so --source={source} cannot replay {name}. "
                f"Run --source=live to produce it, or --source=synthetic, which needs nothing."
            )
        return []

    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write(source: str, name: str, rows: Sequence[Dict[str, object]]) -> str:
    """Writes one CSV in the declared column order, with LF endings.

    Endings are forced to LF and the column order is fixed so that a re-run on a
    Windows machine and a re-run in the container produce the same bytes. These
    files are committed and diffed in review; a line-ending churn would bury the
    one row that actually changed.
    """
    columns = FILES.get(name)
    if columns is None:
        raise ValueError(f"unknown frozen file {name!r}")

    directory = directory_for(source)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{name}.csv")

    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({c: _render(row.get(c)) for c in columns})

    return path


def _render(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def parse_value(raw: object) -> Optional[float]:
    """Empty string means SQL NULL, which is what `coverage = 'absent'` carries."""
    if raw is None:
        return None
    text = str(raw).strip()
    if text == "":
        return None
    return float(text)


def parse_bool(raw: object) -> bool:
    return str(raw).strip().lower() in ("true", "t", "1", "yes")


__all__ = [
    "FrozenUnavailable",
    "FILES",
    "HAZARD_SAMPLE_COLUMNS",
    "SITE_MODIFIER_COLUMNS",
    "CONTEXT_FACTOR_COLUMNS",
    "COLLATERAL_UPDATE_COLUMNS",
    "ENVIRONMENTAL_EVENT_COLUMNS",
    "SATELLITE_TILE_COLUMNS",
    "directory_for",
    "path_for",
    "exists",
    "read",
    "write",
    "parse_value",
    "parse_bool",
    "repo_root",
]
