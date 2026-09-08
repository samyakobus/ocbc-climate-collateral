"""S20 - environmental events for the AI Dashboard news list and the V term.

Plan sections 4.4 (reference index), 4.6 (prep pipeline), 4.9 (caching and
refresh) and 5 (S20). Contributes to AC-14 and AC-16.

    python -m prep.fetch_events --source=live       NASA EONET, filtered to the region
    python -m prep.fetch_events --source=frozen     replay the committed CSV
    python -m prep.fetch_events --source=synthetic  the unconditional floor

AC-16 needs at least 10 items with a source and a date; the plan seeds at least
30 so there is headroom. The reference index's V term counts events in a 90-day
window weighted by type, so an event outside that window is stored and shown but
contributes nothing, which is correct rather than a bug.

ADR-7, and why this script assigns no hotspot
---------------------------------------------
`environmental_events.hotspot_id` is written by a PostGIS statement at the end of
`db/seed/05_regional.sql`, not here. Associating an event with a hotspot is a
spatial decision, and spatial decisions have one owner. This script writes a
point and stops, exactly as `build_hotspots.py` writes a shape and stops.

Three curated events
--------------------
The spec names three by hand: the BSD river pollution incident, a Borneo forest
fire and an East Nusa Tenggara earthquake. A live feed on any given day may carry
none of them, so they are curated rows, always present in every source mode,
carrying a real source URL and flagged in `docs/sources.md` alongside the six
pinned hazard fixtures. They are the only curated events; everything else is
sampled or synthesised.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import struct
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from prep.lib import frozen as frozen_lib

SOURCES = ("live", "frozen", "synthetic")

#: The regional bounding box, the same one the basemap region archive uses.
BBOX = (95.0, -11.0, 125.0, 33.0)

#: Anything older than this is stored and shown but contributes nothing to V.
RECENT_WINDOW_DAYS = 90

#: AC-16's floor is 10; the plan seeds at least 30.
MIN_EVENTS = 30

MASTER_SEED = 20260907
TODAY = date(2026, 9, 8)

EVENT_TYPES = ("fire", "flood", "pollution", "earthquake", "storm", "haze")

#: EONET category ids mapped onto the `event_type` enum. A category with no
#: sensible home here is dropped rather than forced into one.
EONET_CATEGORY = {
    "wildfires": "fire",
    "floods": "flood",
    "severeStorms": "storm",
    "earthquakes": "earthquake",
    "dustHaze": "haze",
    "manmade": "pollution",
    "waterColor": "pollution",
    "landslides": "flood",
}

EONET_URL = (
    "https://eonet.gsfc.nasa.gov/api/v3/events"
    f"?status=all&limit=200&days={RECENT_WINDOW_DAYS}"
    f"&bbox={BBOX[0]},{BBOX[3]},{BBOX[2]},{BBOX[1]}"
)

EVENT_COLUMNS = (
    "id",
    "title",
    "event_type",
    "occurred_on",
    "lon",
    "lat",
    "source_feed",
    "source_url",
    "dedupe_key",
)


# ---------------------------------------------------------------------------
# The three curated events the spec names
# ---------------------------------------------------------------------------

CURATED: Sequence[Dict[str, object]] = (
    {
        "id": "EV-CURATED-BSD-POLLUTION",
        "title": "Cisadane river pollution incident near BSD City, Tangerang",
        "event_type": "pollution",
        "days_ago": 12,
        "lon": 106.6512,
        "lat": -6.3009,
        "source_feed": "curated",
        "source_url": "https://www.gdacs.org/",
    },
    {
        "id": "EV-CURATED-BORNEO-FIRE",
        "title": "Peatland forest fire, Central Kalimantan, Borneo",
        "event_type": "fire",
        "days_ago": 21,
        "lon": 113.9214,
        "lat": -2.2088,
        "source_feed": "curated",
        "source_url": "https://firms.modaps.eosdis.nasa.gov/",
    },
    {
        "id": "EV-CURATED-NTT-EARTHQUAKE",
        "title": "Earthquake off Flores, East Nusa Tenggara",
        "event_type": "earthquake",
        "days_ago": 34,
        "lon": 122.9765,
        "lat": -8.5211,
        "source_feed": "curated",
        "source_url": "https://earthquake.usgs.gov/earthquakes/map/",
    },
)


def curated_rows() -> List[Dict[str, object]]:
    rows = []
    for spec in CURATED:
        occurred = TODAY - timedelta(days=int(spec["days_ago"]))
        rows.append({
            "id": spec["id"],
            "title": spec["title"],
            "event_type": spec["event_type"],
            "occurred_on": occurred.isoformat(),
            "lon": spec["lon"],
            "lat": spec["lat"],
            "source_feed": spec["source_feed"],
            "source_url": spec["source_url"],
            "dedupe_key": str(spec["id"]),
        })
    return rows


# ---------------------------------------------------------------------------
# Synthetic
# ---------------------------------------------------------------------------

#: Places a plausible regional event can sit, one per market plus the wider basin.
SYNTHETIC_PLACES: Sequence[Tuple[str, float, float, str]] = (
    ("Johor Strait", 103.75, 1.46, "MY"),
    ("Klang valley", 101.60, 3.09, "MY"),
    ("Penang Strait", 100.33, 5.41, "MY"),
    ("Sabah coast", 116.07, 5.97, "MY"),
    ("North Jakarta", 106.79, -6.11, "ID"),
    ("Tangerang", 106.66, -6.29, "ID"),
    ("Semarang", 110.42, -6.95, "ID"),
    ("Surabaya", 112.74, -7.23, "ID"),
    ("Central Kalimantan", 113.50, -2.30, "ID"),
    ("Riau peatland", 101.70, 0.50, "ID"),
    ("Singapore Strait", 103.85, 1.22, "SG"),
    ("Yangtze delta", 121.50, 31.20, "CN"),
    ("Hangzhou Bay", 121.55, 29.90, "CN"),
    ("Pearl River delta", 113.60, 22.70, "CN"),
    ("Taiwan Strait", 118.10, 24.48, "CN"),
    ("Victoria Harbour", 114.17, 22.30, "HK"),
    ("Lantau", 113.95, 22.29, "HK"),
    ("New Territories", 114.17, 22.44, "HK"),
    ("Luzon Strait", 121.00, 20.50, "PH"),
    ("Mekong delta", 106.20, 9.80, "VN"),
)

SYNTHETIC_TITLES = {
    "fire": "Forest and peatland fires detected near {place}",
    "flood": "Monsoon flooding reported around {place}",
    "storm": "Tropical cyclone warning issued for {place}",
    "haze": "Transboundary haze advisory over {place}",
    "pollution": "Water quality incident reported at {place}",
    "earthquake": "Earthquake recorded near {place}",
}

#: Which event types plausibly occur where. Typhoons do not reach Singapore, and
#: the map should not claim they do.
PLAUSIBLE = {
    "SG": ("flood", "haze", "pollution"),
    "MY": ("fire", "flood", "haze", "pollution", "earthquake"),
    "ID": ("fire", "flood", "haze", "pollution", "earthquake"),
    "CN": ("storm", "flood", "pollution"),
    "HK": ("storm", "flood", "pollution"),
    "PH": ("storm", "earthquake"),
    "VN": ("storm", "flood"),
}


def rng_for(key: str) -> random.Random:
    digest = hashlib.sha256(f"{MASTER_SEED}:{key}".encode("utf-8")).digest()
    return random.Random(struct.unpack("<Q", digest[:8])[0])


def synthetic_rows(count: int = 36) -> List[Dict[str, object]]:
    """A seeded, committed floor. Needs nothing external."""
    rows: List[Dict[str, object]] = []

    for index in range(count):
        rng = rng_for(f"event:{index}")
        place, lon, lat, market = SYNTHETIC_PLACES[index % len(SYNTHETIC_PLACES)]
        event_type = rng.choice(PLAUSIBLE[market])

        # Spread across the recent window so the V term has something to weigh,
        # with a tail beyond it so "recent" is a real filter rather than a label.
        days_ago = rng.randint(1, RECENT_WINDOW_DAYS + 40)
        occurred = TODAY - timedelta(days=days_ago)

        rows.append({
            "id": f"EV-SYN-{index + 1:03d}",
            "title": SYNTHETIC_TITLES[event_type].format(place=place),
            "event_type": event_type,
            "occurred_on": occurred.isoformat(),
            "lon": round(lon + rng.uniform(-0.25, 0.25), 5),
            "lat": round(lat + rng.uniform(-0.25, 0.25), 5),
            "source_feed": "synthetic",
            "source_url": "https://eonet.gsfc.nasa.gov/",
            "dedupe_key": f"synthetic:{index + 1:03d}",
        })

    return rows


# ---------------------------------------------------------------------------
# Live
# ---------------------------------------------------------------------------


class FeedUnavailable(RuntimeError):
    """Raised when `--source=live` cannot reach a feed."""


def _centroid(coordinates: object) -> Optional[Tuple[float, float]]:
    """Reduces any EONET geometry to one point. Returns (lon, lat)."""
    if isinstance(coordinates, (int, float)):
        return None
    if (
        isinstance(coordinates, list)
        and len(coordinates) == 2
        and all(isinstance(c, (int, float)) for c in coordinates)
    ):
        return float(coordinates[0]), float(coordinates[1])

    points: List[Tuple[float, float]] = []

    def walk(node: object) -> None:
        if (
            isinstance(node, list)
            and len(node) == 2
            and all(isinstance(c, (int, float)) for c in node)
        ):
            points.append((float(node[0]), float(node[1])))
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(coordinates)
    if not points:
        return None
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def fetch_eonet(timeout: int = 30) -> List[Dict[str, object]]:
    """NASA EONET, already filtered to the region and the recent window by the API."""
    try:
        with urllib.request.urlopen(EONET_URL, timeout=timeout) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FeedUnavailable(f"NASA EONET is unreachable: {exc}") from exc

    rows: List[Dict[str, object]] = []
    west, south, east, north = BBOX

    for event in payload.get("events", []):
        categories = [c.get("id") for c in event.get("categories", [])]
        event_type = next((EONET_CATEGORY[c] for c in categories if c in EONET_CATEGORY), None)
        if event_type is None:
            continue

        geometries = event.get("geometry") or []
        if not geometries:
            continue
        latest = geometries[-1]

        point = _centroid(latest.get("coordinates"))
        if point is None:
            continue
        lon, lat = point
        if not (west <= lon <= east and south <= lat <= north):
            continue

        raw_date = str(latest.get("date", ""))
        try:
            occurred = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).date()
        except ValueError:
            continue

        sources = event.get("sources") or []
        source_url = sources[0].get("url") if sources else "https://eonet.gsfc.nasa.gov/"

        rows.append({
            "id": str(event.get("id")),
            "title": str(event.get("title", "")).strip()[:200],
            "event_type": event_type,
            "occurred_on": occurred.isoformat(),
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "source_feed": "NASA EONET",
            "source_url": source_url or "https://eonet.gsfc.nasa.gov/",
            "dedupe_key": f"eonet:{event.get('id')}",
        })

    return rows


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def merge(rows: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """Deduplicates on `dedupe_key`, keeping the first occurrence.

    Refresh upserts on this key and never deletes (plan 4.9), so the key has to
    be stable across runs. The curated rows are added last and win on a clash,
    because their wording is the one the demo reads out.
    """
    seen: Dict[str, Dict[str, object]] = {}
    for row in rows:
        key = str(row["dedupe_key"])
        if key not in seen:
            seen[key] = row
    return list(seen.values())


def recent(rows: Sequence[Dict[str, object]], window_days: int = RECENT_WINDOW_DAYS) -> int:
    cutoff = TODAY - timedelta(days=window_days)
    return sum(1 for r in rows if date.fromisoformat(str(r["occurred_on"])) >= cutoff)


def collect(source: str) -> List[Dict[str, object]]:
    if source == "live":
        live = fetch_eonet()
        print(f"[events] NASA EONET returned {len(live)} usable events in the region")
        rows = merge(list(live) + curated_rows())
        if len(rows) < MIN_EVENTS:
            print(
                f"[events] only {len(rows)} live events; topping up from the synthetic floor "
                f"to reach {MIN_EVENTS}. The added rows carry source_feed = 'synthetic'."
            )
            rows = merge(rows + synthetic_rows())
    elif source == "frozen":
        stored = frozen_lib.read("frozen", "environmental_events")
        rows = merge(list(stored) + curated_rows())
    else:
        rows = merge(synthetic_rows() + curated_rows())

    rows.sort(key=lambda r: str(r["occurred_on"]), reverse=True)
    return rows


def validate(rows: Sequence[Dict[str, object]]) -> List[str]:
    problems: List[str] = []

    if len(rows) < MIN_EVENTS:
        problems.append(f"{len(rows)} events, plan S20 asks for at least {MIN_EVENTS}")

    keys = [str(r["dedupe_key"]) for r in rows]
    if len(set(keys)) != len(keys):
        problems.append("duplicate dedupe_key; the refresh upsert would collide")

    for row in rows:
        label = row.get("id")
        if row.get("event_type") not in EVENT_TYPES:
            problems.append(f"{label}: unknown event_type {row.get('event_type')!r}")
        if not str(row.get("title", "")).strip():
            problems.append(f"{label}: empty title")
        if not str(row.get("source_url", "")).startswith("http"):
            problems.append(f"{label}: source_url is not a URL")
        try:
            date.fromisoformat(str(row["occurred_on"]))
        except (ValueError, KeyError):
            problems.append(f"{label}: bad occurred_on {row.get('occurred_on')!r}")

    for spec in CURATED:
        if not any(r["id"] == spec["id"] for r in rows):
            problems.append(f"curated event {spec['id']} is missing")

    if recent(rows) == 0:
        problems.append("no event falls in the 90-day window, so the V term would be zero everywhere")

    return problems


def summary(rows: Sequence[Dict[str, object]]) -> str:
    counts: Dict[str, int] = {}
    for row in rows:
        counts[str(row["event_type"])] = counts.get(str(row["event_type"]), 0) + 1
    parts = [f"{t} {counts.get(t, 0)}" for t in EVENT_TYPES]
    return (
        f"  {len(rows)} events, {recent(rows)} inside the {RECENT_WINDOW_DAYS}-day window\n"
        f"  by type: {', '.join(parts)}"
    )


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


def _sql(value: object) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def events_sql(rows: Sequence[Dict[str, object]]) -> str:
    """The `environmental_events` section of `db/seed/05_regional.sql`.

    Writes NO hotspot_id. The association is spatial, and the PostGIS statement
    at the end of the composed file owns it (ADR-7).
    """
    out: List[str] = []
    add = out.append

    add(f"""-- {len(rows)} environmental events, newest first. AC-16 asks for at least 10 with a
-- source and a date; this seeds {len(rows)}. {recent(rows)} fall inside the {RECENT_WINDOW_DAYS}-day window the
-- reference index's V term counts; the rest are shown on the news list and weigh nothing,
-- which is a correct reading rather than a missing one.
--
-- hotspot_id is deliberately absent here. Associating an event with a hotspot is a
-- spatial decision and PostGIS owns it, in the statement at the end of this file.""")

    add("INSERT INTO environmental_events (id, title, event_type, occurred_on, location, source_feed, source_url, dedupe_key) VALUES")
    values = []
    for row in rows:
        location = (
            f"ST_SetSRID(ST_MakePoint({float(row['lon']):.5f}, {float(row['lat']):.5f}), 4326)::geography"
        )
        values.append(
            f"  ({_sql(row['id'])}, {_sql(row['title'])}, {_sql(row['event_type'])},"
            f" {_sql(row['occurred_on'])}::date, {location}, {_sql(row['source_feed'])},"
            f" {_sql(row['source_url'])}, {_sql(row['dedupe_key'])})"
        )
    add(",\n".join(values))

    add("""ON CONFLICT (dedupe_key) DO UPDATE SET
  title = EXCLUDED.title, event_type = EXCLUDED.event_type,
  occurred_on = EXCLUDED.occurred_on, location = EXCLUDED.location,
  source_feed = EXCLUDED.source_feed, source_url = EXCLUDED.source_url;
""")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m prep.fetch_events",
        description="Fetch environmental events for the AI Dashboard news list.",
    )
    parser.add_argument("--source", choices=SOURCES, default="synthetic")
    parser.add_argument("--check", action="store_true", help="validate and write nothing")
    args = parser.parse_args(argv)

    try:
        rows = collect(args.source)
    except (FeedUnavailable, frozen_lib.FrozenUnavailable) as exc:
        print(f"\n[events] {exc}", file=sys.stderr)
        print("[events] Nothing was written. --source=synthetic is the unconditional floor.",
              file=sys.stderr)
        return 1

    print(f"[events] source={args.source}")
    print(summary(rows))

    problems = validate(rows)
    if problems:
        print(f"\n[events] {len(problems)} problem(s):", file=sys.stderr)
        for problem in problems[:20]:
            print(f"  {problem}", file=sys.stderr)
        return 1

    if args.check:
        print("[events] --check: valid, nothing written")
        return 0

    if args.source == "live":
        path = frozen_lib.write("frozen", "environmental_events", rows)
        print(f"[events] froze {path}")

    print("[events] run `python -m prep.build_regional` to write db/seed/05_regional.sql")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
