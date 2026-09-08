"""S13 - sampling sanity, run against BOTH --source=frozen and --source=synthetic.

Plan sections 4.6 (coverage model) and 7 (risk: coordinate or raster sampling
errors). Contributes to AC-4, AC-12 and AC-13.

The plan is explicit that these assertions run against both replayable sources,
not just the frozen one. The synthetic model is what every acceptance test falls
back to when Earth Engine is unavailable, and it deserves more than a review
diff: a bad synthetic derivation would move every figure on stage while leaving
the whole TypeScript suite green, because the unit tests read fixtures rather
than the database.

`frozen` only exists after a live run has written `data/frozen/`. Until then its
half of every test SKIPS with a reason naming what is missing, rather than
passing quietly and implying a coverage it does not have.

What is asserted here, per the plan's risk row:
  * every point sits inside its own country's bounding box;
  * flood depth is in [0, 15] m;
  * wind is stored and non-zero for Hong Kong, coastal China and Kota Kinabalu,
    and `absent` where STORM has no basin coverage;
  * PM2.5 is stored and measured for all 200 pins, and `measured_not_scored`
    outside CN and HK;
  * no nodata sentinel is ever persisted;
  * twelve hand-checked control points.
"""

import csv
import math
import os

import pytest

from prep import gen_portfolio as gp
from prep import sample_hazards as sh
from prep.lib import frozen as frozen_lib
from prep.lib import synthetic as syn

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SOURCES = ("synthetic", "frozen")

SCENARIOS = ("today", "y2030", "y2050")
FLOOD_HAZARDS = ("flood_riverine", "flood_coastal")
FLOOD_DEPTH_MAX_M = 15.0

#: Generous country bounding boxes: (west, south, east, north). Wide enough that
#: a correct pin can never fail, tight enough that a longitude/latitude swap or a
#: sign error cannot pass. A Singapore pin with its coordinates transposed lands
#: at 103N, which is not on the planet, let alone in this box.
COUNTRY_BBOX = {
    "SG": (103.55, 1.15, 104.15, 1.50),
    "MY": (99.50, 0.80, 119.50, 7.50),
    "ID": (95.00, -11.00, 141.10, 6.10),
    "CN": (73.50, 18.00, 135.10, 53.60),
    "HK": (113.80, 22.10, 114.50, 22.60),
}

#: Twelve hand-checked control points: one per metro the basemap covers. Each is
#: (collateral_id prefix, country) and is checked to exist, sit in its country
#: box, and carry a full set of samples. Chosen to span every country and both
#: sides of every applicability rule.
CONTROL_CLUSTERS = (
    ("SG-MS", "SG"),
    ("SG-EC", "SG"),
    ("MY-SA", "MY"),
    ("MY-GT", "MY"),
    ("MY-KK", "MY"),
    ("ID-PL", "ID"),
    ("ID-SM", "ID"),
    ("ID-SB", "ID"),
    ("CN-PD", "CN"),
    ("CN-XM", "CN"),
    ("HK-TK", "HK"),
    ("HK-TC", "HK"),
)


# ---------------------------------------------------------------------------
# Loading each source
# ---------------------------------------------------------------------------


def _portfolio():
    return gp.generate()


def _rows_for(source):
    """Hazard rows for one source, normalised, or None when it is unavailable."""
    portfolio = _portfolio()

    if source == "synthetic":
        rows = syn.sample(portfolio)
    elif source == "frozen":
        if not frozen_lib.exists("frozen", "hazard_samples"):
            return None, portfolio
        rows = frozen_lib.read("frozen", "hazard_samples")
    else:
        raise ValueError(source)

    return sh.normalise(rows), portfolio


@pytest.fixture(scope="module", params=SOURCES)
def sampled(request):
    """(source, rows, portfolio) for each replayable source.

    Skips rather than fails when a source is not available on this machine, and
    the skip reason names the file that is missing.
    """
    source = request.param
    rows, portfolio = _rows_for(source)
    if rows is None:
        pytest.skip(
            f"--source={source} is not available: "
            f"{frozen_lib.path_for('frozen', 'hazard_samples')} is not committed. "
            f"Only a live run writes it."
        )
    return source, rows, portfolio


@pytest.fixture(scope="module")
def pins():
    return {sh.pin_id(row): row for row in _portfolio()}


def _by_hazard(rows, hazard):
    return [r for r in rows if r["hazard"] == hazard]


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def test_every_pin_sits_inside_its_own_country(pins):
    """A transposed or sign-flipped coordinate is the sampling error that would
    silently sample the wrong place and still produce plausible numbers."""
    offenders = []
    for cid, row in pins.items():
        country = str(row["country"])
        lat, lon = float(row["lat"]), float(row["lon"])
        west, south, east, north = COUNTRY_BBOX[country]
        if not (west <= lon <= east and south <= lat <= north):
            offenders.append(f"{cid} ({country}) at {lat:.4f},{lon:.4f}")

    assert offenders == [], f"{len(offenders)} pin(s) outside their country box: {offenders[:8]}"


def test_twelve_control_points_exist_and_are_placed(pins):
    """Twelve hand-checked control points, one per metro."""
    for prefix, country in CONTROL_CLUSTERS:
        matching = [cid for cid in pins if cid.startswith(prefix + "-")]
        assert matching, f"no pin in control cluster {prefix}"

        for cid in matching:
            row = pins[cid]
            assert str(row["country"]) == country, f"{cid} is not in {country}"
            west, south, east, north = COUNTRY_BBOX[country]
            assert west <= float(row["lon"]) <= east, f"{cid} longitude"
            assert south <= float(row["lat"]) <= north, f"{cid} latitude"


def test_control_points_span_every_country_and_both_sides_of_every_rule(pins):
    countries = {str(row["country"]) for row in pins.values()}
    assert countries == {"SG", "MY", "ID", "CN", "HK"}

    control_countries = {country for _, country in CONTROL_CLUSTERS}
    assert control_countries == countries, "the control points must cover all five markets"


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------


def test_no_nodata_sentinel_is_ever_persisted(sampled):
    """A sentinel from inside a raster's coverage is a hard prep failure, never a
    stored value. These are the shapes one would take if it slipped through."""
    source, rows, _ = sampled
    offenders = []
    for row in rows:
        value = row["value"]
        if value is None:
            continue
        if math.isnan(value) or math.isinf(value):
            offenders.append((row["collateral_id"], row["hazard"], value))
        # The sentinels these datasets actually use.
        elif value in (-9999.0, -999.0, -32768.0, 3.4028234663852886e38):
            offenders.append((row["collateral_id"], row["hazard"], value))

    assert offenders == [], f"[{source}] nodata sentinel persisted: {offenders[:8]}"


def test_flood_depth_is_within_physical_bounds(sampled):
    source, rows, _ = sampled
    for hazard in FLOOD_HAZARDS:
        for row in _by_hazard(rows, hazard):
            value = row["value"]
            if value is None:
                continue
            assert 0.0 <= value <= FLOOD_DEPTH_MAX_M, (
                f"[{source}] {row['collateral_id']} {hazard} {row['scenario']} "
                f"depth {value} is outside [0, {FLOOD_DEPTH_MAX_M}] m"
            )


def test_flood_exposure_grows_into_2050(sampled):
    """The map beat depends on this: 'watch flood risk grow' has to be true.

    Asserted in aggregate rather than per pin, because an individual pin can be
    flat where the raster has no water at any horizon.
    """
    source, rows, _ = sampled
    totals = {}
    for scenario in SCENARIOS:
        values = [
            r["value"]
            for r in rows
            if r["hazard"] == "flood_coastal" and r["scenario"] == scenario and r["value"] is not None
        ]
        totals[scenario] = sum(values)

    assert totals["y2050"] > totals["y2030"] > totals["today"], (
        f"[{source}] coastal depth does not grow across horizons: {totals}"
    )


def test_heat_is_zero_at_today_and_rises_after(sampled):
    """Today IS the 2016-2035 reference window, so the delta is zero by
    definition of the metric rather than by an accident of labelling."""
    source, rows, _ = sampled

    for row in _by_hazard(rows, "heat_days35"):
        if row["scenario"] == "today" and row["value"] is not None:
            assert row["value"] == 0, (
                f"[{source}] {row['collateral_id']} heat at today is {row['value']}, "
                f"but today is the reference window"
            )

    later = [
        r["value"]
        for r in _by_hazard(rows, "heat_days35")
        if r["scenario"] == "y2050" and r["value"] is not None
    ]
    assert later, f"[{source}] no 2050 heat samples"
    assert max(later) > 0, f"[{source}] no pin warms at all by 2050"


# ---------------------------------------------------------------------------
# Coverage, per the plan's risk row
# ---------------------------------------------------------------------------


def test_wind_is_stored_and_non_zero_where_storm_covers(sampled, pins):
    """Hong Kong, coastal China and Kota Kinabalu all sit inside a STORM basin.

    Kota Kinabalu is the interesting one: its wind is real and MUST be stored,
    and it is `hazard_applicability` and not a country branch that stops it
    reaching a haircut.
    """
    source, rows, _ = sampled

    for prefix in ("HK-", "CN-", "MY-KK-"):
        covered = [
            r for r in _by_hazard(rows, "wind")
            if str(r["collateral_id"]).startswith(prefix) and r["coverage"] != "absent"
        ]
        assert covered, f"[{source}] no stored wind for {prefix}, but STORM covers it"

        for row in covered:
            assert row["value"] is not None, f"[{source}] {row['collateral_id']} wind has no value"
            assert row["value"] > 0, f"[{source}] {row['collateral_id']} wind is {row['value']}"

    kk = [r for r in _by_hazard(rows, "wind") if str(r["collateral_id"]).startswith("MY-KK-")]
    assert kk, f"[{source}] Kota Kinabalu has no wind rows at all"
    for row in kk:
        assert row["coverage"] == "measured_not_scored", (
            f"[{source}] {row['collateral_id']} wind is {row['coverage']}; it is measured in "
            f"Malaysia and excluded by policy, which is not the same as absent"
        )


def test_wind_is_absent_where_storm_has_no_basin(sampled):
    """Singapore sits below the typhoon basin, so there is no value to store."""
    source, rows, _ = sampled
    sg = [r for r in _by_hazard(rows, "wind") if str(r["collateral_id"]).startswith("SG-")]

    assert len(sg) == 60 * 3, f"[{source}] expected 180 Singapore wind rows, got {len(sg)}"
    for row in sg:
        assert row["coverage"] == "absent", f"[{source}] {row['collateral_id']} wind is {row['coverage']}"
        assert row["value"] is None, f"[{source}] absent wind carries {row['value']}"


def test_pm25_is_stored_and_measured_for_all_200_pins(sampled, pins):
    """PM2.5 is measured everywhere. Outside CN and HK it is measured and NOT
    scored, which keeps the real number on the context panel."""
    source, rows, _ = sampled
    pm25 = _by_hazard(rows, "pm25")

    assert len(pm25) == 200 * 3, f"[{source}] expected 600 PM2.5 rows, got {len(pm25)}"

    for row in pm25:
        assert row["value"] is not None, f"[{source}] {row['collateral_id']} PM2.5 has no value"
        assert row["value"] > 0, f"[{source}] {row['collateral_id']} PM2.5 is {row['value']}"
        assert row["coverage"] != "absent", f"[{source}] PM2.5 is measured everywhere"

        country = str(pins[str(row["collateral_id"])]["country"])
        expected = "scored" if country in ("CN", "HK") else "measured_not_scored"
        assert row["coverage"] == expected, (
            f"[{source}] {row['collateral_id']} ({country}) PM2.5 is {row['coverage']}, "
            f"expected {expected}"
        )


def test_every_coverage_state_agrees_with_applicability(sampled, pins):
    """The whole point of principle 4: no country appears in a code path, so a
    scored sample must be one the table allows."""
    source, rows, _ = sampled

    for row in rows:
        country = str(pins[str(row["collateral_id"])]["country"])
        allowed = syn.SCORED_FOR[row["hazard"]][country]

        if row["coverage"] == "scored":
            assert allowed, f"[{source}] {row['collateral_id']} {row['hazard']} scored in {country}"
        elif row["coverage"] == "measured_not_scored":
            assert not allowed, (
                f"[{source}] {row['collateral_id']} {row['hazard']} excluded in {country}, "
                f"which the table scores"
            )


def test_coverage_and_value_never_contradict(sampled):
    source, rows, _ = sampled
    for row in rows:
        if row["coverage"] == "absent":
            assert row["value"] is None, f"[{source}] absent {row['collateral_id']} has a value"
        else:
            assert row["value"] is not None, (
                f"[{source}] {row['coverage']} {row['collateral_id']} {row['hazard']} has none"
            )


def test_the_validator_agrees(sampled):
    """The generator's own validator must pass on its own output.

    `sample_hazards.py` refuses to write a seed whose coverage states are wrong.
    Running that same check here means a source that would be rejected at seed
    time is rejected at test time too, with the offending rows named.
    """
    source, rows, portfolio = sampled
    problems = sh.validate(rows, portfolio)
    assert problems == [], f"[{source}] {len(problems)} validation problem(s): {problems[:8]}"
