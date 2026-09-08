"""S20 - satellite imagery for the AI Dashboard tile strip.

Plan sections 4.6 (prep pipeline), 4.9 (caching and refresh) and 5 (S20).
Contributes to AC-11 and AC-14.

    python -m prep.fetch_tiles --source=live       NASA GIBS, downloads the JPEGs
    python -m prep.fetch_tiles --source=frozen     replay the committed manifest
    python -m prep.fetch_tiles --source=synthetic  generate placeholders offline

Offline-first, and this is the file where that is won or lost
-------------------------------------------------------------
`satellite_tiles.cached_path` points at a committed file under
`public/cache/tiles/`, and **the strip always renders from `cached_path`**. The
refresh button writes a NEW file with a hash suffix and updates `fetched_at`; a
failed refresh returns a toast and changes nothing. So the strip renders with the
interface disabled, which is what `tests/e2e/offline.spec.ts` asserts.

The per-property satellite THUMBNAIL is a different thing and is not this script:
it is the one deliberate live call the spec requires, with a cached fallback, and
its degraded view is rehearsed in offline checklist step 4.

Imagery
-------
NASA GIBS, MODIS Terra corrected-reflectance true colour, served as ready-made
256px JPEG tiles over WMTS. No key, no quota, and the licence is open. One tile
per metro at a zoom that frames the city region.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from prep.lib import frozen as frozen_lib

SOURCES = ("live", "frozen", "synthetic")

CACHE_DIR = os.path.join("public", "cache", "tiles")

PROVIDER = "NASA GIBS"
LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
TILE_MATRIX_SET = "GoogleMapsCompatible_Level9"
GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"

#: GIBS publishes a day at a time and the most recent day can lag, so step back
#: until one answers. Two days is the usual lag.
CAPTURE_LOOKBACK_DAYS = 6
DEFAULT_CAPTURE = date(2026, 9, 5)

#: z6 frames a city and its surrounding coast in one 256px tile, which is what
#: the strip wants. Level9 tops out at z9 for this layer.
TILE_ZOOM = 6

#: One tile per metro. Same twelve metros the basemap cities archive covers, so
#: the strip and the map agree about what a metro is.
REGIONS: Sequence[Tuple[str, str, float, float]] = (
    ("singapore", "Singapore", 1.34, 103.80),
    ("klang-valley", "Klang Valley", 2.98, 101.60),
    ("penang", "Penang", 5.41, 100.33),
    ("johor-bahru", "Johor Bahru", 1.47, 103.73),
    ("kota-kinabalu", "Kota Kinabalu", 5.98, 116.07),
    ("jakarta", "Jakarta and BSD", -6.20, 106.74),
    ("semarang", "Semarang", -6.97, 110.42),
    ("surabaya", "Surabaya", -7.25, 112.75),
    ("shanghai", "Shanghai and Ningbo", 30.55, 121.55),
    ("pearl-river-delta", "Guangzhou and Shenzhen", 22.66, 113.71),
    ("xiamen", "Xiamen", 24.48, 118.09),
    ("hong-kong", "Hong Kong", 22.35, 114.17),
)

#: A 1x1 JPEG. Used only by `--source=synthetic`, and the row says so, so nobody
#: mistakes a placeholder for imagery.
PLACEHOLDER_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300ffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffc20011080001000101"
    "011100ffc40014000100000000000000000000000000000009ffda0008010100013f10"
)


class TilesUnavailable(RuntimeError):
    """Raised when `--source=live` cannot reach NASA GIBS."""


# ---------------------------------------------------------------------------
# Web Mercator
# ---------------------------------------------------------------------------


def tile_xy(lat: float, lon: float, zoom: int) -> Tuple[int, int]:
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    clamped = max(min(lat, 85.0511), -85.0511)
    r = math.radians(clamped)
    y = int((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n)
    return x, y


def tile_bbox(x: int, y: int, zoom: int) -> Tuple[float, float, float, float]:
    """(west, south, east, north) of one tile, for the row's `bbox` column."""
    n = 2 ** zoom

    def lon_of(xi: int) -> float:
        return xi / n * 360.0 - 180.0

    def lat_of(yi: int) -> float:
        t = math.pi * (1 - 2 * yi / n)
        return math.degrees(math.atan(math.sinh(t)))

    return lon_of(x), lat_of(y + 1), lon_of(x + 1), lat_of(y)


def tile_url(capture: date, x: int, y: int, zoom: int = TILE_ZOOM) -> str:
    return (
        f"{GIBS_BASE}/{LAYER}/default/{capture.isoformat()}/"
        f"{TILE_MATRIX_SET}/{zoom}/{y}/{x}.jpg"
    )


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def _download(url: str, timeout: int = 30) -> bytes:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status != 200:
                raise TilesUnavailable(f"{url} returned HTTP {response.status}")
            return response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise TilesUnavailable(f"{url} is unreachable: {exc}") from exc


def resolve_capture_date(today: Optional[date] = None) -> date:
    """The most recent day GIBS actually serves. It usually lags by a day or two."""
    probe_x, probe_y = tile_xy(1.34, 103.80, TILE_ZOOM)
    start = today or date.today()

    for back in range(1, CAPTURE_LOOKBACK_DAYS + 1):
        candidate = start - timedelta(days=back)
        try:
            _download(tile_url(candidate, probe_x, probe_y), timeout=20)
            return candidate
        except TilesUnavailable:
            continue

    raise TilesUnavailable(
        f"NASA GIBS served no tile for any of the last {CAPTURE_LOOKBACK_DAYS} days. "
        f"Run --source=synthetic, which needs nothing external."
    )


def _write(path: str, payload: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(payload)


def fetch_live(root: str) -> List[Dict[str, object]]:
    capture = resolve_capture_date()
    print(f"[tiles] NASA GIBS capture date {capture.isoformat()}")

    rows: List[Dict[str, object]] = []
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    for slug, name, lat, lon in REGIONS:
        x, y = tile_xy(lat, lon, TILE_ZOOM)
        url = tile_url(capture, x, y)
        payload = _download(url)

        # Hash suffix, so a refresh writes a NEW file and never overwrites the
        # one the strip is currently rendering (plan 4.9).
        digest = hashlib.sha256(payload).hexdigest()[:10]
        relative = f"{CACHE_DIR}/{slug}-{capture.isoformat()}-{digest}.jpg".replace("\\", "/")
        _write(os.path.join(root, relative), payload)

        west, south, east, north = tile_bbox(x, y, TILE_ZOOM)
        rows.append({
            "id": f"TILE-{slug.upper()}",
            "region": name,
            "bbox": f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}",
            "capture_date": capture.isoformat(),
            "cached_path": "/" + relative[len("public/"):] if relative.startswith("public/") else relative,
            "live_url": url,
            "fetched_at": fetched_at,
            "provider": PROVIDER,
        })
        print(f"[tiles] {name}: {len(payload) // 1024} kB")

    return rows


def synthetic_tiles(root: str, write_files: bool = True) -> List[Dict[str, object]]:
    """Placeholders so the strip has rows and files with nothing external.

    The provider says `placeholder` rather than NASA GIBS, so a reader can tell
    at a glance that this is not imagery.

    `write_files=False` builds the rows without touching the disk, which is what
    a `--print` or `--check` run needs: a dry run that leaves twelve files behind
    is not a dry run.
    """
    rows: List[Dict[str, object]] = []
    capture = DEFAULT_CAPTURE

    for slug, name, lat, lon in REGIONS:
        x, y = tile_xy(lat, lon, TILE_ZOOM)
        relative = f"{CACHE_DIR}/{slug}-placeholder.jpg".replace("\\", "/")
        if write_files:
            _write(os.path.join(root, relative), PLACEHOLDER_JPEG)

        west, south, east, north = tile_bbox(x, y, TILE_ZOOM)
        rows.append({
            "id": f"TILE-{slug.upper()}",
            "region": name,
            "bbox": f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}",
            "capture_date": capture.isoformat(),
            "cached_path": "/" + relative[len("public/"):],
            "live_url": tile_url(capture, x, y),
            "fetched_at": None,
            "provider": "placeholder",
        })

    return rows


def collect(source: str, write_files: bool = True) -> List[Dict[str, object]]:
    root = frozen_lib.repo_root()

    if source == "live":
        rows = fetch_live(root)
        frozen_lib.write("frozen", "satellite_tiles", rows)
        return rows

    if source == "frozen":
        rows = frozen_lib.read("frozen", "satellite_tiles")
        missing = [
            r["id"] for r in rows
            if not os.path.exists(os.path.join(root, "public", str(r["cached_path"]).lstrip("/")))
        ]
        if missing:
            raise frozen_lib.FrozenUnavailable(
                f"{len(missing)} cached tile file(s) named by the manifest are not on disk: "
                f"{missing[:4]}. The strip renders from cached_path, so a row without its file "
                f"is worse than no row. Rerun --source=live, or --source=synthetic."
            )
        return rows

    return synthetic_tiles(root, write_files=write_files)


def validate(rows: Sequence[Dict[str, object]]) -> List[str]:
    problems: List[str] = []
    root = frozen_lib.repo_root()

    if len(rows) != len(REGIONS):
        problems.append(f"{len(rows)} tiles, expected one per metro ({len(REGIONS)})")

    for row in rows:
        cached = str(row.get("cached_path", ""))
        if not cached.startswith("/cache/tiles/"):
            problems.append(f"{row.get('id')}: cached_path {cached!r} is not a public URL path")
            continue
        on_disk = os.path.join(root, "public", cached.lstrip("/"))
        if not os.path.exists(on_disk):
            problems.append(f"{row.get('id')}: {cached} is not on disk, so the strip cannot render it")
        elif os.path.getsize(on_disk) == 0:
            problems.append(f"{row.get('id')}: {cached} is empty")

    ids = [str(r["id"]) for r in rows]
    if len(set(ids)) != len(ids):
        problems.append("duplicate tile id")

    return problems


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


def _sql(value: object) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def tiles_sql(rows: Sequence[Dict[str, object]]) -> str:
    """The `satellite_tiles` section of `db/seed/05_regional.sql`."""
    out: List[str] = []
    add = out.append

    add(f"""-- {len(rows)} satellite tiles, one per metro. The strip ALWAYS renders from
-- cached_path, which points at a committed file under public/cache/tiles/, so it renders
-- with the interface disabled (AC-11, AC-14). Refresh writes a NEW file with a hash suffix
-- and updates fetched_at; a failed refresh returns a toast and changes nothing.""")

    add("INSERT INTO satellite_tiles (id, region, bbox, capture_date, cached_path, live_url, fetched_at, provider) VALUES")
    values = []
    for row in rows:
        fetched = row.get("fetched_at")
        fetched_sql = "NULL" if fetched in (None, "") else f"{_sql(fetched)}::timestamptz"
        values.append(
            f"  ({_sql(row['id'])}, {_sql(row['region'])}, {_sql(row['bbox'])},"
            f" {_sql(row['capture_date'])}::date, {_sql(row['cached_path'])},"
            f" {_sql(row['live_url'])}, {fetched_sql}, {_sql(row['provider'])})"
        )
    add(",\n".join(values))

    add("""ON CONFLICT (id) DO UPDATE SET
  region = EXCLUDED.region, bbox = EXCLUDED.bbox, capture_date = EXCLUDED.capture_date,
  cached_path = EXCLUDED.cached_path, live_url = EXCLUDED.live_url,
  fetched_at = EXCLUDED.fetched_at, provider = EXCLUDED.provider;
""")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m prep.fetch_tiles",
        description="Fetch satellite tiles for the AI Dashboard strip.",
    )
    parser.add_argument("--source", choices=SOURCES, default="synthetic")
    parser.add_argument("--check", action="store_true", help="validate and write no SQL")
    args = parser.parse_args(argv)

    try:
        rows = collect(args.source)
    except (TilesUnavailable, frozen_lib.FrozenUnavailable) as exc:
        print(f"\n[tiles] {exc}", file=sys.stderr)
        print("[tiles] --source=synthetic writes placeholders and needs nothing external.",
              file=sys.stderr)
        return 1

    print(f"[tiles] source={args.source}, {len(rows)} tiles")

    problems = validate(rows)
    if problems:
        print(f"\n[tiles] {len(problems)} problem(s):", file=sys.stderr)
        for problem in problems[:20]:
            print(f"  {problem}", file=sys.stderr)
        return 1

    if args.check:
        print("[tiles] --check: valid")
        return 0

    print("[tiles] run `python -m prep.build_regional` to write db/seed/05_regional.sql")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
