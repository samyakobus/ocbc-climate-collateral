"""S43 - the per-property satellite thumbnail on the case screen.

Spec Constraints, "Data at demo"; plan sections 4.6 and 4.9. AC-11 and AC-12.

    python -m prep.fetch_thumbs --source=live       fetch, cache and freeze
    python -m prep.fetch_thumbs --source=frozen     replay the committed manifest
    python -m prep.fetch_thumbs --source=synthetic  placeholders, nothing external
    python -m prep.fetch_thumbs --print             report and write nothing

WHY THIS FILE WAS REWRITTEN
---------------------------
The first version fetched one MODIS Terra tile per pin at zoom 8, and it was
wrong in two ways that only a pair of human eyes caught.

**It was too coarse to be a per-property thumbnail.** One MODIS tile at z8 spans
about 156 km, so the 200 pins resolved to 13 pictures and all 60 Singapore
properties plus the 8 in Johor Bahru showed the identical image. On a case screen
that reads as a stub rather than as imagery.

**One of those tiles was pure black.** The 2026-09-08 capture of z8/x201/y127,
the tile shared by all 68 of those pins including the fixture `SG-EC-001` the
demo opens first, decodes as a uniformly black 256x256 JPEG: mean luminance 0.0,
against 78.7 to 204.6 for the other eleven. Every guard in the pipeline passed
it, because it is a perfectly valid JPEG of the correct size. A file check cannot
tell you an image is blank; only decoding it can.

WHAT IT DOES NOW
----------------
A LAYER LADDER, finest first, and the first layer that yields a LIT tile wins:

  1. HLS Sentinel-2 (`HLS_S30_...`) at zoom 12, roughly 30 m per pixel
  2. HLS Landsat    (`HLS_L30_...`) at zoom 12
  3. MODIS Terra true colour at zoom 8, the coarse fallback

Both HLS products are served by GIBS over WMTS with **no token and no key**,
which was the open question: they are, and they answer for this region. They are
sparse in time rather than daily, because they are real satellite passes, so the
capture date is stepped back up to 14 days per layer until a scene exists.

A MEAN-LUMINANCE FLOOR is applied to every candidate before it is accepted. A
tile below `LUMINANCE_FLOOR` is treated exactly like a missing one: step back a
day and try again. That is what makes the black-tile defect unrepeatable rather
than merely fixed.

NORMALISATION, and why the bytes are re-encoded. GIBS serves the HLS layers as
**PNG** despite the `.jpg` in the WMTS path, at about 158 kB per 256-pixel tile.
Committing 200 of those is 30 MB, and the rest of the pipeline, the refresh route
and the tests all check for JPEG magic. Every accepted tile is therefore decoded,
flattened onto white, and re-encoded as a 256x256 RGB JPEG at quality 82, which
lands around 20 kB. The manifest records the layer and the capture date, so the
provenance panel can say what the picture actually is.

MEASURED, 2026-09-09. Largest shared image: 68 pins of 200 (34%) before, 26 of
200 (13%) after. Distinct images: 13 before, and the run reports the figure after.

ONE WRITER
----------
This module returns SQL and writes no seed file, the same contract
`fetch_events.py` and `fetch_tiles.py` have with `build_regional.py`, which is the
only writer of `db/seed/05_regional.sql`. It writes the manifest
`data/frozen/satellite_thumbs.csv`, which `prep/gen_portfolio.py`'s emitter reads
to put `satellite_thumb_path` into `03_portfolio.sql`; that column has one writer
and this file's SQL block writes only `satellite_thumb_url`.

PILLOW is required for `--source=live` only, and it is in `requirements-dev.txt`.
The synthetic floor and the frozen replay need nothing beyond the standard
library, so a clean clone still seeds with no wheels to build (AC-13).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, NamedTuple, Optional, Sequence, Tuple

from prep import fetch_tiles
from prep.lib import frozen as frozen_lib
from prep.lib.synthetic import load_portfolio

SOURCES = ("live", "frozen", "synthetic")

CACHE_DIR = os.path.join("public", "cache", "thumbs")

GIBS_WMTS = "wmts/epsg3857/best"


class ThumbLayer(NamedTuple):
    """One rung of the ladder."""

    #: The GIBS layer identifier.
    layer: str
    #: Its tile matrix set. The name lies about its maximum zoom; see `zoom`.
    matrix_set: str
    #: The zoom actually used. MEASURED, not read off the matrix-set name:
    #: `GoogleMapsCompatible_Level9` reads like it serves zoom 9 and does not.
    zoom: int
    #: What the provenance panel calls it.
    provider: str
    #: Roughly how wide one 256-pixel tile is, for the docs and the log.
    km_per_tile: float


#: Finest first. The first rung that yields a LIT tile wins, so a property only
#: falls back to MODIS when neither HLS product has a usable recent scene over it.
LAYERS: Tuple[ThumbLayer, ...] = (
    ThumbLayer(
        "HLS_S30_Nadir_BRDF_Adjusted_Reflectance",
        "GoogleMapsCompatible_Level12", 12,
        "NASA GIBS / HLS Sentinel-2", 9.8,
    ),
    ThumbLayer(
        "HLS_L30_Nadir_BRDF_Adjusted_Reflectance",
        "GoogleMapsCompatible_Level12", 12,
        "NASA GIBS / HLS Landsat", 9.8,
    ),
    ThumbLayer(
        fetch_tiles.LAYER, fetch_tiles.TILE_MATRIX_SET, 8,
        "NASA GIBS / MODIS Terra", 156.0,
    ),
)

# ---------------------------------------------------------------------------
# What counts as a usable image
# ---------------------------------------------------------------------------
#
# THREE CHECKS, and each one was added because a real tile failed it. A blank
# square on a case screen is a blank square whichever way it got there, and the
# first version of this file rejected only one of the three ways.
#
# Measured on the 2026-09-09 run over all 200 pins:
#
#   check              blanks read            real imagery reads
#   -----------------  ---------------------  ---------------------
#   mean luminance     0.0   (black MODIS)    48.7 to 242.9
#   alpha coverage     0.0%  (HLS no-data)    99.8% to 100.0%
#   mean luminance     251.0-255.0 (cloud)    48.7 to 242.9

#: Below this an image is blank black. The MODIS tile shared by all 60 Singapore
#: pins and the 8 in Johor Bahru read exactly 0.0 on 2026-09-08, and it was a
#: perfectly valid JPEG of the right size, so every file-level guard passed it.
LUMINANCE_FLOOR = 12.0

#: Above this an image is blank white. Over the Pearl River Delta, HLS returned
#: fully opaque tiles at 251.0 to 254.0: real imagery, total cloud, and useless
#: as a thumbnail. The brightest usable scene measured 242.9, so this sits
#: between them.
LUMINANCE_CEILING = 245.0

#: Below this fraction of opaque pixels the tile is mostly NO DATA. HLS is a real
#: satellite pass, so a tile outside the swath comes back fully transparent;
#: composited onto white it becomes a pure white square that sails past a
#: luminance floor. The separation is absolute rather than marginal: no-data
#: tiles measure 0.0% and every real scene measured 99.8% or better.
COVERAGE_FLOOR = 0.90

#: How far back to look for a scene. HLS is real satellite passes, not a daily
#: product: Sentinel-2 revisits every few days and Landsat every eight or so, so
#: two weeks is the window that reliably contains one of each.
LOOKBACK_DAYS = 14

#: The committed thumbnail's shape. 256 square is what the case screen renders.
THUMB_PX = 256
JPEG_QUALITY = 82

#: Google Maps Static, used only when a key is present: a genuinely per-property
#: image at the property's own coordinates rather than a shared tile.
MAPS_PROVIDER = "Google Maps Static"
MAPS_PATH = "/maps/api/staticmap"
MAPS_ZOOM = 17
MAPS_SIZE = "256x256"

#: Retried, with a pause. A public service answering 200 requests will
#: occasionally return one of these; a whole run dying on a single transient 504
#: is not a useful outcome. Measured on the first live run: GIBS returned exactly
#: one 504 across 13 tiles.
RETRYABLE_STATUS = (500, 502, 503, 504)
ATTEMPTS = 3
BACKOFF_SECONDS = 2


class ThumbsUnavailable(RuntimeError):
    """Raised when `--source=live` cannot produce a usable image for a pin."""


# ---------------------------------------------------------------------------
# Hosts, taken from the environment the same way the application takes them
# ---------------------------------------------------------------------------


def gibs_base() -> str:
    """`FEED_GIBS_BASE` or the real service.

    Read here for the same reason `lib/feeds/bases.ts` reads it in the
    application: the offline rehearsal points it at a dead port, and a prep
    script that ignored the override would quietly reach the real feed during a
    run that claims to be offline.
    """
    return (os.environ.get("FEED_GIBS_BASE") or "https://gibs.earthdata.nasa.gov").rstrip("/")


def thumb_base() -> str:
    """`THUMB_BASE` or the real service. Used only on the Maps Static path."""
    return (os.environ.get("THUMB_BASE") or "https://maps.googleapis.com").rstrip("/")


def maps_key() -> Optional[str]:
    key = (os.environ.get("GOOGLE_MAPS_STATIC_KEY") or "").strip()
    return key or None


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def tile_url(rung: ThumbLayer, capture: date, x: int, y: int) -> str:
    return (
        f"{gibs_base()}/{GIBS_WMTS}/{rung.layer}/default/{capture.isoformat()}/"
        f"{rung.matrix_set}/{rung.zoom}/{y}/{x}.jpg"
    )


def maps_thumb_url(lat: float, lon: float, key: str) -> str:
    query = urllib.parse.urlencode({
        "center": f"{lat},{lon}",
        "zoom": MAPS_ZOOM,
        "size": MAPS_SIZE,
        "maptype": "satellite",
        "format": "jpg",
        "key": key,
    })
    return f"{thumb_base()}{MAPS_PATH}?{query}"


def redact(url: str) -> str:
    """The Maps URL carries a key, and manifests are committed."""
    return url.split("&key=")[0].split("?key=")[0] if "key=" in url else url


# ---------------------------------------------------------------------------
# Fetching, decoding and the luminance floor
# ---------------------------------------------------------------------------


class NotServed(Exception):
    """This layer has no tile here on this date. Try the day before."""


def _download(url: str, timeout: int = 30) -> bytes:
    """One tile, retried on the transient failures a public service really makes.

    A 404 is NOT retried and is not an error: for the HLS layers it is the
    ordinary answer on a day with no satellite pass, which is most days. It
    raises `NotServed` so the caller steps back rather than giving up.
    """
    last: Optional[Exception] = None

    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                if response.status != 200:
                    raise NotServed(f"HTTP {response.status}")
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise NotServed("404") from exc
            if exc.code not in RETRYABLE_STATUS:
                raise ThumbsUnavailable(
                    f"{redact(url)} returned HTTP {exc.code}: {exc.reason}"
                ) from exc
            last = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc

        if attempt < ATTEMPTS:
            print(f"[thumbs] attempt {attempt}/{ATTEMPTS} failed ({last}); retrying")
            time.sleep(BACKOFF_SECONDS * attempt)

    raise ThumbsUnavailable(f"{redact(url)} is unreachable after {ATTEMPTS} attempts: {last}")


def _require_pillow():
    try:
        from PIL import Image  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise ThumbsUnavailable(
            "--source=live needs Pillow to check that a tile is not blank. "
            "`python -m pip install -r requirements-dev.txt`. The frozen replay "
            "and the synthetic floor need nothing beyond the standard library."
        ) from exc
    return Image


def _mean(image) -> float:
    """Mean pixel value of a single-band image, across Pillow versions."""
    data = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    pixels = list(data)
    return sum(pixels) / float(len(pixels)) if pixels else 0.0


class Measured(NamedTuple):
    jpeg: bytes
    luminance: float
    coverage: float

    def usable(self) -> Optional[str]:
        """None when the image is fine, else why it is not."""
        if self.coverage < COVERAGE_FLOOR:
            return f"no data over {100 * (1 - self.coverage):.0f}% of the tile"
        if self.luminance < LUMINANCE_FLOOR:
            return f"blank black, luminance {self.luminance:.1f}"
        if self.luminance > LUMINANCE_CEILING:
            return f"blank white, luminance {self.luminance:.1f}, probably total cloud"
        return None


def normalise(payload: bytes) -> Measured:
    """Decode, measure, and re-encode as a 256x256 RGB JPEG.

    Re-encoding is not cosmetic. GIBS serves the HLS layers as PNG despite the
    `.jpg` in the WMTS path, at about 158 kB per tile; 200 of those is 30 MB in
    the repository, and every downstream guard in this project checks for JPEG
    magic.

    Alpha is measured BEFORE compositing and the composite is onto WHITE, and
    both halves matter. A tile outside the satellite swath comes back fully
    transparent; onto white it becomes a pure white square that a luminance floor
    waves through, and onto black it would become exactly the blank the floor
    exists to catch. Measuring coverage separately is what tells the two apart.
    """
    Image = _require_pillow()

    with Image.open(io.BytesIO(payload)) as opened:
        image = opened.convert("RGBA")

        alpha = image.getchannel("A")
        opaque = _mean(alpha) / 255.0

        background = Image.new("RGBA", image.size, (255, 255, 255, 255))
        flat = Image.alpha_composite(background, image).convert("RGB")

        mean = _mean(flat.convert("L"))

        if flat.size != (THUMB_PX, THUMB_PX):
            flat = flat.resize((THUMB_PX, THUMB_PX), Image.LANCZOS)

        buffer = io.BytesIO()
        flat.save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
        return Measured(buffer.getvalue(), mean, opaque)


class Resolved(NamedTuple):
    """A usable image for one map tile, shared by every pin inside it."""

    rung: ThumbLayer
    capture: date
    x: int
    y: int
    url: str
    payload: bytes
    luminance: float
    coverage: float


def resolve_tile(lat: float, lon: float, today: date, log: bool = True) -> Resolved:
    """Walk the ladder until a LIT tile is found, or give up loudly.

    The order is layer-major, not date-major: every date is tried on the finest
    layer before dropping to the next. A 30 m Sentinel-2 scene from twelve days
    ago is a better thumbnail than a 156 km MODIS tile from yesterday.
    """
    rejected: List[str] = []

    for rung in LAYERS:
        x, y = fetch_tiles.tile_xy(lat, lon, rung.zoom)

        for back in range(1, LOOKBACK_DAYS + 1):
            capture = today - timedelta(days=back)
            url = tile_url(rung, capture, x, y)

            try:
                payload = _download(url)
            except NotServed:
                continue

            measured = normalise(payload)
            problem = measured.usable()

            if problem is not None:
                # The defect this whole ladder exists to make unrepeatable.
                rejected.append(f"{rung.layer[:20]} {capture}: {problem}")
                continue

            if log:
                print(f"[thumbs]   {rung.provider} {capture} z{rung.zoom}/{x}/{y} "
                      f"luminance {measured.luminance:.1f}, "
                      f"coverage {100 * measured.coverage:.0f}%, "
                      f"{len(measured.jpeg) // 1024} kB")

            return Resolved(rung, capture, x, y, url, measured.jpeg,
                            measured.luminance, measured.coverage)

    raise ThumbsUnavailable(
        f"no usable tile for {lat:.4f},{lon:.4f} on any layer within {LOOKBACK_DAYS} days.\n"
        + "\n".join(f"  rejected: {r}" for r in rejected[:8])
        + ("\n  (nothing was served at all)" if not rejected else "")
    )


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _write(path: str, payload: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(payload)


def cached_path_for(collateral_id: str, payload: bytes) -> str:
    """`public/cache/thumbs/<collateral_id>-<hash>.jpg`, POSIX separators.

    The hash suffix is what lets a refresh write a NEW file rather than
    overwriting the one the case screen is rendering, so a failure at any stage
    leaves the previous image intact and a rollback needs no file restore.
    """
    digest = hashlib.sha256(payload).hexdigest()[:10]
    return f"{CACHE_DIR}/{collateral_id}-{digest}.jpg".replace("\\", "/")


def public_url(relative: str) -> str:
    return "/" + relative[len("public/"):] if relative.startswith("public/") else relative


def fetch_live(
    portfolio: Sequence[Dict[str, object]], root: str, write_files: bool = True
) -> List[Dict[str, object]]:
    """One thumbnail per pin, from Maps Static with a key or the ladder without.

    TWO PHASES, and the order is the design. Every download completes before any
    file is written. The first live run failed on a transient 504 partway through
    and left 44 files on disk with no manifest naming them, which is the worst of
    both states: a cache nothing points at, and a rerun that has to know to clean
    it up. This is the ordering the tile refresh route already uses.
    """
    key = maps_key()
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    today = date.today()

    if key is None:
        print(f"[thumbs] no GOOGLE_MAPS_STATIC_KEY: layer ladder, finest first "
              f"({', '.join(r.provider.split('/')[-1].strip() for r in LAYERS)}), "
              f"luminance floor {LUMINANCE_FLOOR}")
    else:
        print(f"[thumbs] GOOGLE_MAPS_STATIC_KEY present: {MAPS_PROVIDER} at z{MAPS_ZOOM}")

    rows: List[Dict[str, object]] = []
    pending: List[Tuple[str, bytes]] = []

    #: Resolved once per map tile, so two pins in the same tile agree on the
    #: layer AND the capture date, and the download happens once. 200 pins
    #: become 33 requests at z12, which is the difference between a polite
    #: script and one that hammers a public service.
    by_tile: Dict[Tuple[str, int, int], Resolved] = {}

    for index, pin in enumerate(portfolio, start=1):
        collateral_id = str(pin["collateral_id"])
        lat = float(pin["lat"])
        lon = float(pin["lon"])

        if key is not None:
            url = maps_thumb_url(lat, lon, key)
            measured = normalise(_download(url))
            problem = measured.usable()
            if problem is not None:
                raise ThumbsUnavailable(f"{collateral_id}: Maps Static returned {problem}")
            payload, mean = measured.jpeg, measured.luminance
            provider, layer_name = MAPS_PROVIDER, "staticmap"
            zoom, x, y = MAPS_ZOOM, "", ""
            capture_date = today.isoformat()
            stored_url = redact(url)
        else:
            probe = fetch_tiles.tile_xy(lat, lon, LAYERS[0].zoom)
            cache_key = (LAYERS[0].layer, probe[0], probe[1])

            if cache_key not in by_tile:
                print(f"[thumbs] {collateral_id} ({index}/{len(portfolio)}) resolving")
                by_tile[cache_key] = resolve_tile(lat, lon, today)

            found = by_tile[cache_key]
            payload, mean = found.payload, found.luminance
            provider, layer_name = found.rung.provider, found.rung.layer
            zoom, x, y = found.rung.zoom, found.x, found.y
            capture_date = found.capture.isoformat()
            stored_url = found.url

        relative = cached_path_for(collateral_id, payload)
        pending.append((os.path.join(root, relative), payload))

        rows.append({
            "collateral_id": collateral_id,
            "cached_path": public_url(relative),
            "live_url": stored_url,
            "capture_date": capture_date,
            "provider": provider,
            "layer": layer_name,
            "tile_z": zoom,
            "tile_x": x,
            "tile_y": y,
            "mean_luminance": f"{mean:.1f}",
            "fetched_at": fetched_at,
        })

    # Phase two. Nothing above this line touched the disk.
    if write_files:
        for path, payload in pending:
            _write(path, payload)

    report(rows, pending)
    return rows


def report(rows: Sequence[Dict[str, object]], pending: Sequence[Tuple[str, bytes]]) -> None:
    """The two figures that say whether this is a thumbnail or a stub."""
    hashes: Dict[str, int] = {}
    for _path, payload in pending:
        digest = hashlib.sha256(payload).hexdigest()
        hashes[digest] = hashes.get(digest, 0) + 1

    total = len(rows) or 1
    worst = max(hashes.values()) if hashes else 0
    by_layer: Dict[str, int] = {}
    for row in rows:
        name = str(row["provider"])
        by_layer[name] = by_layer.get(name, 0) + 1

    print(f"[thumbs] {len(rows)} thumbnails, {len(hashes)} distinct images")
    print(f"[thumbs] most-shared image covers {worst} pins ({100.0 * worst / total:.1f}%)")
    for name, count in sorted(by_layer.items(), key=lambda kv: -kv[1]):
        print(f"[thumbs]   {name}: {count}")


def fetch_synthetic(
    portfolio: Sequence[Dict[str, object]], root: str, write_files: bool = True
) -> List[Dict[str, object]]:
    """The unconditional floor: a placeholder per pin, labelled as one.

    Deliberately NOT imagery. A synthetic run that produced something
    photograph-like would put a generated image on a provenance panel next to
    real dataset names, which is the one thing this pipeline must never do.
    Needs no Pillow, so a clean clone can run it with the standard library.
    """
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    payload = fetch_tiles.PLACEHOLDER_JPEG
    rows: List[Dict[str, object]] = []

    for pin in portfolio:
        collateral_id = str(pin["collateral_id"])
        relative = cached_path_for(collateral_id, payload)
        if write_files:
            _write(os.path.join(root, relative), payload)
        rows.append({
            "collateral_id": collateral_id,
            "cached_path": public_url(relative),
            "live_url": "",
            "capture_date": "",
            "provider": "synthetic placeholder",
            "layer": "",
            "tile_z": "",
            "tile_x": "",
            "tile_y": "",
            "mean_luminance": "",
            "fetched_at": fetched_at,
        })

    print(f"[thumbs] {len(rows)} placeholder thumbnails (no imagery, and the rows say so)")
    return rows


def fetch_frozen(portfolio: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """Replay the committed manifest, and check the files are actually there.

    A manifest whose files were never committed is the exact failure AC-13 exists
    to catch, and it would otherwise surface as a broken image on the case screen
    during a demo.
    """
    if not frozen_lib.exists("frozen", "satellite_thumbs"):
        raise frozen_lib.FrozenUnavailable(
            "data/frozen/satellite_thumbs.csv is not committed. Run "
            "`python -m prep.fetch_thumbs --source=live` with a network, or "
            "--source=synthetic, which needs nothing external."
        )

    rows = frozen_lib.read("frozen", "satellite_thumbs")
    root = frozen_lib.repo_root()

    missing = [
        r["collateral_id"] for r in rows
        if not os.path.exists(os.path.join(root, "public", str(r["cached_path"]).lstrip("/")))
    ]
    if missing:
        raise frozen_lib.FrozenUnavailable(
            f"{len(missing)} thumbnail file(s) named by the manifest are not on disk, "
            f"starting with {missing[:3]}. The manifest was committed and the images "
            "were not."
        )

    expected = {str(p["collateral_id"]) for p in portfolio}
    covered = {str(r["collateral_id"]) for r in rows}
    if expected - covered:
        raise frozen_lib.FrozenUnavailable(
            f"{len(expected - covered)} pin(s) have no thumbnail in the manifest, "
            f"starting with {sorted(expected - covered)[:3]}."
        )

    print(f"[thumbs] frozen replay: {len(rows)} thumbnails, every file present")
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


def _sql(value: object) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def thumbs_sql(rows: Sequence[Dict[str, object]]) -> str:
    """UPDATE statements for `collateral.satellite_thumb_url`.

    ONE WRITER PER COLUMN. `satellite_thumb_path` belongs to
    `03_portfolio.sql`, which reads the same manifest this block was composed
    from, so the two cannot drift. The source URL is written here and nowhere
    else: the path is a property of the portfolio, the source is a property of
    the fetch.
    """
    if not rows:
        return "-- no thumbnails\n"

    out: List[str] = []
    out.append("-- Per-property satellite thumbnail SOURCES (S43).")
    out.append("-- GENERATED by prep/fetch_thumbs.py through prep/build_regional.py.")
    out.append("--")
    out.append("-- `satellite_thumb_path` is written by 03_portfolio.sql from the same")
    out.append("-- manifest (data/frozen/satellite_thumbs.csv), so the path has exactly")
    out.append("-- one writer. This block writes only the source URL, which is what")
    out.append("-- /api/refresh/thumbs re-fetches rather than composing a URL of its own.")
    out.append("--")
    out.append("-- The case screen renders the PATH and never this URL, so the thumbnail")
    out.append("-- survives a disabled interface.")
    out.append("UPDATE collateral AS c")
    out.append("SET satellite_thumb_url = t.url")
    out.append("FROM (VALUES")

    values = [
        f"  ({_sql(r['collateral_id'])}, {_sql(r.get('live_url'))})"
        for r in rows
    ]
    out.append(",\n".join(values))
    out.append(") AS t(id, url)")
    out.append("WHERE c.id = t.id;")
    out.append("")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def collect(source: str, write_files: bool = True) -> List[Dict[str, object]]:
    """The rows for one source mode. `build_regional.py` calls this."""
    portfolio = load_portfolio()
    root = frozen_lib.repo_root()

    if source == "live":
        rows = fetch_live(portfolio, root, write_files=write_files)
        if write_files:
            path = frozen_lib.write("frozen", "satellite_thumbs", rows)
            print(f"[thumbs] froze {path}")
        return rows

    if source == "synthetic":
        return fetch_synthetic(portfolio, root, write_files=write_files)

    return fetch_frozen(portfolio)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m prep.fetch_thumbs",
        description="Cache one satellite thumbnail per collateral pin.",
    )
    parser.add_argument("--source", choices=SOURCES, default="frozen",
                        help="live fetches and freezes; frozen replays; synthetic is the floor")
    parser.add_argument("--print", action="store_true", dest="print_only",
                        help="report what would be written and write nothing")
    args = parser.parse_args(argv)

    try:
        rows = collect(args.source, write_files=not args.print_only)
    except (ThumbsUnavailable, frozen_lib.FrozenUnavailable) as exc:
        print(f"\n[thumbs] {exc}", file=sys.stderr)
        print("[thumbs] Nothing was written. --source=synthetic needs nothing external.",
              file=sys.stderr)
        return 1

    providers = sorted({str(r["provider"]) for r in rows})
    print(f"[thumbs] source={args.source}: {len(rows)} thumbnails, provider(s) {providers}")

    if args.print_only:
        print(f"[thumbs] --print: {len(thumbs_sql(rows)):,} bytes of SQL would be composed")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
