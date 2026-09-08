"""S19 - hotspot geometry. Polygons and radii ONLY.

Plan sections 4.2 (`hotspots`), 4.4 (reference index) and 5 (S19). Contributes
to AC-15.

ADR-7, which is the whole point of this file
--------------------------------------------
This script decides **no membership**. It writes a shape per hotspot and stops.
Which collateral belongs to which hotspot is `v_hotspot_membership` in
`db/migrations/0002_views.sql`, evaluated by PostGIS, and that view is the single
definition. `scripts/compute-reference.ts` reads membership from the view, the
popup reads it from the view, and `tests/db/hotspot-exposure.test.ts` asserts the
two agree.

That matters because an earlier design had Python cluster the pins AND a PostGIS
predicate recompute the same thing. A pin inside the radius but outside the
polygon, or a point exactly on a boundary, would have made `score_inputs` and the
popup disagree about a S$ figure on stage.

So the member list this script computes is used for ONE thing: deriving a shape
that contains those members. It is never written anywhere. After the shape is
written the view is free to disagree at the margin, and the view wins.

Exactly one shape per hotspot
-----------------------------
`hotspots` carries `CHECK ((area IS NULL) <> (radius_m IS NULL))`, so a hotspot
has a polygon or a radius and never both. The membership view is therefore a
UNION of two mutually exclusive branches and can never emit a duplicate pair.

The choice is made by the data, not by hand: a group whose members all sit within
`RADIUS_MAX_M` of their centroid gets a radius, because a circle describes it
honestly. A group spread wider than that gets a bounding polygon, because a
circle large enough to hold it would sweep in a great deal of empty ground.

Usage
-----
    python -m prep.build_hotspots            show the table
    python -m prep.build_hotspots --print    the same; this script writes no file

`prep/build_regional.py` composes `db/seed/05_regional.sql` from this module's
`hotspots_sql`, plus the events and the tiles. One file, one writer.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from typing import Dict, List, Optional, Sequence, Tuple

from prep.lib import frozen as frozen_lib
from prep.lib.synthetic import load_portfolio

SEED_SQL = os.path.join("db", "seed", "05_regional.sql")

#: A group whose members all sit within this distance of the centroid gets a
#: radius; anything wider gets a bounding polygon.
RADIUS_MAX_M = 4000.0

#: Padding so a member on the edge is unambiguously inside its own shape. The
#: view still decides membership; this only stops a shape from excluding the very
#: pins it was derived from through floating-point noise at the boundary.
RADIUS_PAD_FRACTION = 0.15
RADIUS_MIN_M = 800.0
POLYGON_PAD_DEG = 0.004

#: Plan S19 asks for 12 to 16 hotspots.
MAX_HOTSPOTS = 16
MIN_HOTSPOTS = 12

EARTH_RADIUS_M = 6_371_008.8


# ---------------------------------------------------------------------------
# Admin-area aggregation: the 27 seeded clusters group into candidate hotspots.
#
# Grouping is by contiguous metro area, the same grouping the basemap's twelve
# metro boxes use, except where two clusters in one metro describe genuinely
# separate exposures. Every cluster appears exactly once, so the candidate set
# covers the whole portfolio and the selection below is a ranking rather than a
# quiet omission.
# ---------------------------------------------------------------------------

GROUPS: Sequence[Tuple[str, str, str, Tuple[str, ...], str]] = (
    # id, country, name, cluster codes, summary
    ("HS-SG-MARINA", "SG", "Marina Bay and Kallang Basin", ("MS", "KB"),
     "Reclaimed waterfront and the Kallang river mouth. Low ground behind the "
     "Marina Barrage, where the coastal and riverine perils overlap."),
    ("HS-SG-EASTCOAST", "SG", "East Coast and Katong", ("EC",),
     "A dense residential strip on reclaimed land between the East Coast Parkway "
     "and the sea, inside the Long Island protection study area."),
    ("HS-SG-SOUTHWEST", "SG", "Sentosa Cove and Jurong Island", ("SC", "JI"),
     "Two very different waterfronts on one exposure: high-value resort housing "
     "and a petrochemical estate, both on reclaimed coastal land."),
    ("HS-SG-NORTH", "SG", "Woodlands", ("WL",),
     "Inland northern residential district on the Johor Strait."),
    ("HS-SG-CENTRAL", "SG", "Bukit Timah", ("BT",),
     "Elevated central catchment. The highest ground in the portfolio and the "
     "least coastal exposure in Singapore."),

    ("HS-MY-KLANG", "MY", "Klang Valley", ("SA", "KL"),
     "The Kuala Lumpur conurbation from the city centre down the Klang valley to "
     "Kuala Langat, drained by the SMART tunnel catchment."),
    ("HS-MY-PENANG", "MY", "George Town coastal", ("GT",),
     "Colonial-era waterfront and reclaimed frontage on the Penang Strait."),
    ("HS-MY-JOHOR", "MY", "Danga Bay, Johor Bahru", ("DB",),
     "Reclaimed waterfront development on the Johor Strait facing Singapore."),
    ("HS-MY-SABAH", "MY", "Kota Kinabalu", ("KK",),
     "Coastal Sabah. STORM records a real 100-year typhoon wind here that "
     "Malaysian policy does not score, which the provenance panel shows."),

    ("HS-ID-NJAKARTA", "ID", "North Jakarta", ("PL",),
     "Pluit, Muara Baru and Ancol. The most subsident ground in the portfolio, "
     "behind the NCICD coastal wall, much of it already below sea level."),
    ("HS-ID-JAKARTA", "ID", "Central Jakarta and BSD", ("CJ", "BS"),
     "The inland half of the Jakarta exposure, from the central business "
     "district out to the BSD City satellite development."),
    ("HS-ID-SEMARANG", "ID", "Semarang north coast", ("SM",),
     "Subsiding north-coast Java, protected by the Banger polder scheme."),
    ("HS-ID-SURABAYA", "ID", "Surabaya", ("SB",),
     "East Java port city on the Madura Strait."),

    ("HS-CN-SHANGHAI", "CN", "Pudong and Lujiazui", ("PD",),
     "The Huangpu financial district on the Yangtze delta, behind the Shanghai "
     "200-year seawall standard."),
    ("HS-CN-NINGBO", "CN", "Ningbo", ("NB",),
     "Hangzhou Bay port exposure, squarely in the West Pacific typhoon basin."),
    ("HS-CN-PRD", "CN", "Pearl River Delta", ("NS", "QH"),
     "Nansha and Qianhai, two reclaimed delta developments carrying both "
     "typhoon wind and chronic air quality."),
    ("HS-CN-XIAMEN", "CN", "Xiamen", ("XM",),
     "Island city on the Taiwan Strait, one of the most typhoon-exposed points "
     "in the portfolio."),

    ("HS-HK-HARBOUR", "HK", "Victoria Harbour east", ("TK", "HF", "KT"),
     "Tseung Kwan O, Heng Fa Chuen and Kai Tak: three reclaimed harbourfront "
     "developments with high-rise reinforced-concrete stock."),
    ("HS-HK-NT", "HK", "New Territories and Lantau", ("TP", "TC"),
     "Tai Po, Sha Tin and Tung Chung. Hillside development where the landslide "
     "manual-review flag concentrates."),
)


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def centroid_of(points: Sequence[Tuple[float, float]]) -> Tuple[float, float]:
    """Mean latitude and longitude. Adequate at these spans, and stable."""
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def bounding_ring(points: Sequence[Tuple[float, float]], pad: float) -> List[Tuple[float, float]]:
    """A closed, counter-clockwise bounding ring as (lon, lat) pairs."""
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    west, east = min(lons) - pad, max(lons) + pad
    south, north = min(lats) - pad, max(lats) + pad
    return [(west, south), (east, south), (east, north), (west, north), (west, south)]


# ---------------------------------------------------------------------------
# Hazard labelling
# ---------------------------------------------------------------------------

HAZARD_LABEL = {
    "flood_coastal": "flood_coastal",
    "flood_riverine": "flood_riverine",
    "wind": "wind",
    "heat_days35": "heat",
    "pm25": "pm25",
}


def hazard_scales(samples: Sequence[Dict[str, object]]) -> Dict[str, float]:
    """The portfolio-wide MEAN of each hazard, used as its scale.

    Four hazards in four units cannot be compared until they are on one scale,
    and a hand-picked divisor per unit decides the answer before the data does.
    An earlier version used round numbers and labelled thirteen of sixteen
    hotspots "heat", which said more about the divisors than about the map.

    Dividing by the portfolio mean turns the label into a statement of RELATIVE
    EXCESS: not "which hazard is biggest here", which heat wins everywhere
    because it is scored on all 200 pins and flood is zero on half of them, but
    **which hazard is this area unusually high in compared with the rest of the
    book**. That is what the word hotspot means.

    Only `scored` samples at 2050 count. A measured-but-excluded reading is real
    and is shown on the context panel, but it is not what an area is a hotspot
    FOR, and a hazard's scale is computed over the pins that score it, so
    Singapore's unscored PM2.5 does not drag down Shanghai's.

    This is a LABEL on a map pointer. Nothing multiplies it, `hazard_type` never
    enters a haircut, and the reference index of plan 4.4 is computed in
    TypeScript from the view rather than here.
    """
    values: Dict[str, List[float]] = {}
    for row in samples:
        if row.get("scenario") != "y2050" or row.get("coverage") != "scored":
            continue
        value = row.get("value")
        if value in (None, ""):
            continue
        values.setdefault(str(row.get("hazard")), []).append(float(value))

    scales: Dict[str, float] = {}
    for hazard, series in values.items():
        mean = sum(series) / len(series) if series else 0.0
        # A hazard that is zero everywhere carries no signal; guard the division.
        scales[hazard] = mean if mean > 0 else 1.0
    return scales


def dominant_hazard(
    member_ids: Sequence[str],
    samples: Sequence[Dict[str, object]],
    scales: Dict[str, float],
) -> str:
    """Names the hazard a hotspot's members stand out in, against the portfolio."""
    members = set(member_ids)
    totals: Dict[str, List[float]] = {}

    for row in samples:
        if str(row.get("collateral_id")) not in members:
            continue
        if row.get("scenario") != "y2050" or row.get("coverage") != "scored":
            continue
        value = row.get("value")
        if value in (None, ""):
            continue
        hazard = str(row.get("hazard"))
        scale = scales.get(hazard)
        if not scale:
            continue
        totals.setdefault(hazard, []).append(float(value) / scale)

    if not totals:
        return "flood_coastal"

    means = {h: sum(v) / len(v) for h, v in totals.items()}
    best = max(means, key=lambda h: means[h])
    return HAZARD_LABEL.get(best, best)


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------


class Hotspot:
    def __init__(self, hid: str, country: str, name: str, summary: str,
                 members: Sequence[Dict[str, object]], hazard_type: str) -> None:
        self.id = hid
        self.country = country
        self.name = name
        self.summary = summary
        self.member_ids = [str(m["collateral_id"]) for m in members]
        self.hazard_type = hazard_type
        self.exposure_sgd = sum(float(m.get("requested_amount_sgd") or 0) for m in members)

        points = [(float(m["lat"]), float(m["lon"])) for m in members]
        self.centroid_lat, self.centroid_lon = centroid_of(points)

        spread = max(
            haversine_m(self.centroid_lat, self.centroid_lon, lat, lon) for lat, lon in points
        )
        self.spread_m = spread

        if spread <= RADIUS_MAX_M:
            self.radius_m: Optional[float] = round(
                max(spread * (1 + RADIUS_PAD_FRACTION), RADIUS_MIN_M), 1
            )
            self.ring: Optional[List[Tuple[float, float]]] = None
        else:
            self.radius_m = None
            self.ring = bounding_ring(points, POLYGON_PAD_DEG)

    @property
    def shape(self) -> str:
        return "radius" if self.radius_m is not None else "polygon"


def build(portfolio: Sequence[Dict[str, object]],
          samples: Sequence[Dict[str, object]]) -> List[Hotspot]:
    """Aggregates the seeded clusters into hotspots, then keeps the largest 16.

    Every cluster belongs to exactly one candidate, so the cap is a documented
    ranking by aggregate loan exposure rather than a quiet omission. The clusters
    that fall out are the inland, least exposed ones, which is the right answer
    for something called a hotspot.
    """
    by_code: Dict[str, List[Dict[str, object]]] = {}
    for row in portfolio:
        cid = str(row.get("collateral_id") or row.get("id"))
        by_code.setdefault(cid.split("-")[1], []).append(row)

    covered = {code for _, _, _, codes, _ in GROUPS for code in codes}
    missing = set(by_code) - covered
    if missing:
        raise SystemExit(
            f"cluster code(s) {sorted(missing)} belong to no hotspot group. "
            f"Add them to GROUPS; every cluster must be a candidate."
        )

    scales = hazard_scales(samples)

    hotspots: List[Hotspot] = []
    for hid, country, name, codes, summary in GROUPS:
        members = [row for code in codes for row in by_code.get(code, [])]
        if not members:
            continue
        hotspots.append(
            Hotspot(hid, country, name, summary, members, dominant_hazard(
                [str(m["collateral_id"]) for m in members], samples, scales))
        )

    hotspots.sort(key=lambda h: h.exposure_sgd, reverse=True)
    kept = hotspots[:MAX_HOTSPOTS]
    dropped = hotspots[MAX_HOTSPOTS:]

    if len(kept) < MIN_HOTSPOTS:
        raise SystemExit(f"only {len(kept)} hotspots built; plan S19 requires at least {MIN_HOTSPOTS}")

    for h in dropped:
        print(f"[hotspots] not a hotspot (ranked {MAX_HOTSPOTS + 1}+ by exposure): "
              f"{h.name} ({h.country}), {len(h.member_ids)} pins, S${h.exposure_sgd:,.0f}")

    kept.sort(key=lambda h: (h.country, h.id))
    return kept


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------


def _sql_text(value: object) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def _ring_sql(ring: Sequence[Tuple[float, float]]) -> str:
    points = ", ".join(f"{lon:.6f} {lat:.6f}" for lon, lat in ring)
    return (
        "ST_SetSRID(ST_MakePolygon(ST_GeomFromText("
        f"'LINESTRING({points})')), 4326)::geography"
    )


def hotspots_sql(hotspots: Sequence[Hotspot]) -> str:
    """The `hotspots` section of `db/seed/05_regional.sql`.

    Returns SQL rather than writing a file. `prep/build_regional.py` is the only
    writer of that seed file, because it also carries the events and the tiles,
    and one file with three writers is a race waiting to happen.
    """
    out: List[str] = []
    add = out.append

    add(f"""-- {len(hotspots)} hotspots, POLYGONS AND RADII ONLY (ADR-7). This section writes no
-- membership and no exposure. `v_hotspot_membership` is the single definition of
-- which collateral belongs to which hotspot, and `v_hotspot_exposure` computes
-- the S$ on top of it, so `hotspots` carries neither a loan_exposure_sgd nor an
-- exposure_share column and nothing here tries to supply one.
--
-- Exactly one shape each: the CHECK constraint rejects a hotspot carrying both a
-- polygon and a radius, which is what makes the membership UNION incapable of
-- emitting a duplicate pair.""")

    add("INSERT INTO hotspots (id, name, country, centroid, area, radius_m, hazard_type, summary) VALUES")

    rows: List[str] = []
    for h in hotspots:
        centroid = (
            f"ST_SetSRID(ST_MakePoint({h.centroid_lon:.6f}, {h.centroid_lat:.6f}), 4326)::geography"
        )
        area = _ring_sql(h.ring) if h.ring else "NULL"
        radius = "NULL" if h.radius_m is None else f"{h.radius_m}"
        rows.append(
            f"  ({_sql_text(h.id)}, {_sql_text(h.name)}, {_sql_text(h.country)}, {centroid},"
            f" {area}, {radius}, {_sql_text(h.hazard_type)}, {_sql_text(h.summary)})"
        )
    add(",\n".join(rows))

    add("""ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, country = EXCLUDED.country, centroid = EXCLUDED.centroid,
  area = EXCLUDED.area, radius_m = EXCLUDED.radius_m,
  hazard_type = EXCLUDED.hazard_type, summary = EXCLUDED.summary;
""")

    add("""-- Any hotspot this run no longer claims is removed, so a regenerated file is
-- authoritative rather than merely additive. environmental_events.hotspot_id is
-- ON DELETE SET NULL, so an event outlives a retired hotspot.
DELETE FROM hotspots WHERE id NOT IN (""" + ", ".join(_sql_text(h.id) for h in hotspots) + ");\n")

    add(f"""-- The count AC-15 and plan S19 rest on.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM hotspots;
  IF n <> {len(hotspots)} THEN
    RAISE EXCEPTION '05_regional.sql expected {len(hotspots)} hotspots, found %', n;
  END IF;
END $$;
""")

    return "\n".join(out)


def table(hotspots: Sequence[Hotspot]) -> str:
    lines = [
        f"  {'id':<18} {'country':<8} {'shape':<8} {'members':>8} {'spread m':>9} "
        f"{'exposure S$':>16}  hazard",
        f"  {'-' * 18} {'-' * 8} {'-' * 8} {'-' * 8} {'-' * 9} {'-' * 16}  {'-' * 14}",
    ]
    for h in hotspots:
        lines.append(
            f"  {h.id:<18} {h.country:<8} {h.shape:<8} {len(h.member_ids):>8} "
            f"{h.spread_m:>9.0f} {h.exposure_sgd:>16,.0f}  {h.hazard_type}"
        )
    return "\n".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m prep.build_hotspots",
        description="Build hotspot polygons and radii. Writes no membership (ADR-7).",
    )
    parser.add_argument("--print", action="store_true", dest="print_only",
                        help="show the table and write nothing")
    parser.add_argument("--source", default="synthetic", choices=("synthetic", "frozen"),
                        help="which sampled hazard set to read for the hazard_type label")
    args = parser.parse_args(argv)

    portfolio = load_portfolio()
    samples = frozen_lib.read(args.source, "hazard_samples", required=False)
    if not samples:
        print(f"[hotspots] no {args.source} hazard samples; hazard_type falls back to flood_coastal")

    hotspots = build(portfolio, samples)

    print(f"\n[hotspots] {len(hotspots)} hotspots")
    print(table(hotspots))

    members = sum(len(h.member_ids) for h in hotspots)
    shapes = {"polygon": 0, "radius": 0}
    for h in hotspots:
        shapes[h.shape] += 1
    print(f"\n[hotspots] {shapes['polygon']} polygon, {shapes['radius']} radius; "
          f"{members} of {len(portfolio)} pins are in a hotspot group")
    print("[hotspots] membership is decided by v_hotspot_membership, not by this script (ADR-7)")

    if not args.print_only:
        print("[hotspots] run `python -m prep.build_regional` to write db/seed/05_regional.sql")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
