"""S6 acceptance: the synthetic hazard floor is complete, covered and pinned.

Plan sections 4.6 (coverage model, `hazard_applicability`) and 5 (S6).
Contributes to AC-13: `--source=synthetic` populates exactly 200 pins with
flood, wind, heat and PM2.5 for all three horizons, with no credentials.
"""

import csv
import io
import os

import pytest

from prep import gen_portfolio as gp
from prep.lib import synthetic as syn

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SYNTHETIC_DIR = os.path.join(REPO_ROOT, "data", "synthetic")
HAZARD_CSV = os.path.join(SYNTHETIC_DIR, "hazard_samples.csv")
MODIFIER_CSV = os.path.join(SYNTHETIC_DIR, "site_modifiers.csv")

FIXTURE_IDS = ("SG-MS-002", "SG-MS-003", "SG-EC-001", "SG-EC-002", "SG-EC-003",
               "SG-KB-003")


@pytest.fixture(scope="module")
def portfolio():
    return gp.generate()


@pytest.fixture(scope="module")
def rows(portfolio):
    return syn.sample(portfolio)


@pytest.fixture(scope="module")
def modifiers(portfolio):
    return syn.site_modifiers(portfolio)


def value_of(row):
    return None if row["value"] == "" else float(row["value"])


# ---------------------------------------------------------------------------
# Shape: one row per pin per hazard per scenario
# ---------------------------------------------------------------------------
def test_one_row_per_pin_per_hazard_per_scenario(rows, portfolio):
    assert len(rows) == 200 * 5 * 3 == 3000
    expected = set()
    for pin in portfolio:
        for hazard in syn.HAZARDS:
            for scenario in syn.SCENARIOS:
                expected.add((pin["collateral_id"], hazard, scenario))
    actual = set((r["collateral_id"], r["hazard"], r["scenario"]) for r in rows)
    assert actual == expected


def test_no_row_is_ever_dropped(rows):
    """A point the model does not cover is recorded `absent`, not omitted."""
    per_pin = {}
    for r in rows:
        per_pin[r["collateral_id"]] = per_pin.get(r["collateral_id"], 0) + 1
    assert len(per_pin) == 200
    assert set(per_pin.values()) == {15}


def test_row_ids_are_unique(rows):
    assert len(set(r["id"] for r in rows)) == len(rows)


def test_every_row_is_tagged_synthetic(rows):
    for r in rows:
        assert r["dataset_version"] == "synthetic"
        assert r["sampled_at"] == syn.SAMPLED_AT
        assert r["dataset_name"], r["id"]


def test_all_six_fixture_pins_have_samples(rows):
    present = set(r["collateral_id"] for r in rows)
    for cid in FIXTURE_IDS:
        assert cid in present, cid
        assert len([r for r in rows if r["collateral_id"] == cid]) == 15


# ---------------------------------------------------------------------------
# The three coverage states, and only three
# ---------------------------------------------------------------------------
def test_coverage_values_are_one_of_exactly_three(rows):
    assert len(syn.COVERAGE_STATES) == 3
    for r in rows:
        assert r["coverage"] in syn.COVERAGE_STATES, r["id"]


def test_hazard_applicability_is_25_rows_with_6_exclusions():
    cells = [(h, c) for h in syn.SCORED_FOR for c in syn.SCORED_FOR[h]]
    assert len(cells) == 25
    excluded = [(h, c) for (h, c) in cells if not syn.SCORED_FOR[h][c]]
    assert len(excluded) == 6
    assert set(excluded) == {
        ("wind", "SG"), ("wind", "MY"), ("wind", "ID"),
        ("pm25", "SG"), ("pm25", "MY"), ("pm25", "ID"),
    }


def test_absent_means_null_and_null_means_absent(rows):
    for r in rows:
        if r["coverage"] == syn.COVERAGE_ABSENT:
            assert r["value"] == "", r["id"]
        else:
            assert r["value"] != "", r["id"]


def test_scored_exactly_where_policy_allows_and_a_value_exists(rows):
    for r in rows:
        country = r["collateral_id"].split("-")[0]
        allowed = syn.SCORED_FOR[r["hazard"]][country]
        if r["coverage"] == syn.COVERAGE_SCORED:
            assert allowed, r["id"]
        elif r["coverage"] == syn.COVERAGE_MEASURED_NOT_SCORED:
            assert not allowed, r["id"]
            assert value_of(r) is not None


def test_absent_wins_over_measured_not_scored():
    """Plan 4.6 precedence: with no value there is nothing to store."""
    assert syn.coverage_for("wind", "MY", None) == syn.COVERAGE_ABSENT
    assert syn.coverage_for("wind", "MY", 40.0) == syn.COVERAGE_MEASURED_NOT_SCORED
    assert syn.coverage_for("wind", "HK", 55.0) == syn.COVERAGE_SCORED
    assert syn.coverage_for("pm25", "ID", 41.0) == syn.COVERAGE_MEASURED_NOT_SCORED


def test_only_wind_is_ever_absent(rows):
    """Aqueduct, NEX-GDDP and GHAP are global; STORM is basin-limited."""
    absent = set(r["hazard"] for r in rows if r["coverage"] == syn.COVERAGE_ABSENT)
    assert absent == {"wind"}


def test_no_nodata_sentinel_is_ever_persisted(rows):
    for r in rows:
        v = value_of(r)
        if v is not None:
            assert v >= 0.0, r["id"]
            assert v not in (-9999.0, -999.0, 9999.0), r["id"]


# ---------------------------------------------------------------------------
# The two worked coverage cases the plan names
# ---------------------------------------------------------------------------
def test_singapore_wind_is_absent_not_zero(rows):
    sg_wind = [r for r in rows
               if r["hazard"] == "wind" and r["collateral_id"].startswith("SG-")]
    assert len(sg_wind) == 60 * 3
    for r in sg_wind:
        assert r["coverage"] == syn.COVERAGE_ABSENT
        assert r["value"] == ""


def test_kota_kinabalu_wind_is_measured_and_not_scored(rows):
    kk = [r for r in rows
          if r["hazard"] == "wind" and r["collateral_id"].startswith("MY-KK-")]
    assert len(kk) == 7 * 3
    for r in kk:
        assert r["coverage"] == syn.COVERAGE_MEASURED_NOT_SCORED
        assert value_of(r) > 0.0, r["id"]


def test_jakarta_pm25_is_measured_near_41_and_not_scored(rows):
    jakarta = [r for r in rows
               if r["hazard"] == "pm25" and r["collateral_id"].startswith("ID-PL-")]
    assert len(jakarta) == 12 * 3
    for r in jakarta:
        assert r["coverage"] == syn.COVERAGE_MEASURED_NOT_SCORED
        assert 38.0 <= value_of(r) <= 44.0, r["id"]


def test_hong_kong_and_china_wind_is_scored_and_non_zero(rows):
    scored = [r for r in rows if r["hazard"] == "wind"
              and r["collateral_id"][:2] in ("HK", "CN")]
    assert len(scored) == (25 + 35) * 3
    for r in scored:
        assert r["coverage"] == syn.COVERAGE_SCORED
        assert value_of(r) > 30.0, r["id"]


def test_pm25_is_measured_for_all_200_pins(rows):
    pm = [r for r in rows if r["hazard"] == "pm25"]
    assert len(pm) == 600
    for r in pm:
        assert r["coverage"] != syn.COVERAGE_ABSENT
        assert value_of(r) > 0.0


# ---------------------------------------------------------------------------
# Scenario semantics
# ---------------------------------------------------------------------------
def test_heat_at_today_is_exactly_zero_by_definition(rows):
    """`today` IS the 2016-2035 reference window (plan 4.6)."""
    for r in rows:
        if r["hazard"] == "heat_days35" and r["scenario"] == "today":
            assert value_of(r) == 0.0, r["id"]


def test_heat_grows_at_both_horizons(rows):
    by_pin = {}
    for r in rows:
        if r["hazard"] == "heat_days35":
            by_pin.setdefault(r["collateral_id"], {})[r["scenario"]] = value_of(r)
    for cid, series in by_pin.items():
        assert series["y2050"] > series["y2030"] > 0.0, cid


def test_pm25_is_scenario_invariant(rows):
    by_pin = {}
    for r in rows:
        if r["hazard"] == "pm25":
            assert r["scenario_invariant"] == "true"
            by_pin.setdefault(r["collateral_id"], set()).add(r["value"])
    for cid, values in by_pin.items():
        assert len(values) == 1, cid


def test_only_pm25_is_marked_scenario_invariant(rows):
    for r in rows:
        expected = "true" if r["hazard"] == "pm25" else "false"
        assert r["scenario_invariant"] == expected, r["id"]


def test_every_hazard_series_is_monotone_across_the_slider(rows):
    """The map beat is "move the slider and watch exposure grow". A 2050 value
    below its own 2030 value would contradict it on screen."""
    series = {}
    for r in rows:
        series.setdefault((r["collateral_id"], r["hazard"]), {})[r["scenario"]] = value_of(r)
    for key, s in series.items():
        if any(v is None for v in s.values()):
            continue
        assert s["today"] <= s["y2030"] <= s["y2050"] + 1e-9, key


def test_wind_pathway_names_the_right_storm_edition(rows):
    for r in rows:
        if r["hazard"] == "wind":
            expected = "present-climate" if r["scenario"] == "today" else "climate-change"
            assert r["pathway"] == expected, r["id"]


# ---------------------------------------------------------------------------
# Physical sanity
# ---------------------------------------------------------------------------
def test_flood_depths_stay_within_0_to_15_metres(rows):
    for r in rows:
        if r["hazard"].startswith("flood_"):
            assert 0.0 <= value_of(r) <= 15.0, r["id"]


def test_low_lying_coastal_pins_flood_and_ridge_pins_do_not(rows):
    depths = {}
    for r in rows:
        if r["hazard"] == "flood_coastal" and r["scenario"] == "y2050":
            depths[r["collateral_id"]] = value_of(r)
    pluit = [v for cid, v in depths.items() if cid.startswith("ID-PL-")]
    ridge = [v for cid, v in depths.items() if cid.startswith("SG-BT-")]
    assert min(pluit) > 0.5      # subsiding, at or below sea level
    assert max(ridge) == 0.0     # Bukit Timah, 28 m and up


def test_basin_membership_matches_the_plan(rows):
    assert syn.in_wp_basin(22.30, 114.17) is True     # Hong Kong
    assert syn.in_wp_basin(31.23, 121.50) is True     # Shanghai
    assert syn.in_wp_basin(5.975, 116.07) is True     # Kota Kinabalu
    assert syn.in_wp_basin(1.30, 103.90) is False     # Singapore
    assert syn.in_wp_basin(3.15, 101.71) is False     # Kuala Lumpur
    assert syn.in_wp_basin(5.42, 100.33) is False     # George Town
    assert syn.in_wp_basin(-6.12, 106.79) is False    # Jakarta


# ---------------------------------------------------------------------------
# Site modifiers
# ---------------------------------------------------------------------------
def test_one_site_modifier_row_per_pin(modifiers):
    assert len(modifiers) == 200
    assert len(set(m["collateral_id"] for m in modifiers)) == 200


def test_tertiles_are_in_range(modifiers):
    for m in modifiers:
        assert m["suhi_tertile"] in (0, 1, 2), m["collateral_id"]
        assert m["ndvi_tertile"] in (0, 1, 2), m["collateral_id"]


def test_sg_ec_002_modifiers_match_the_plan_fixture(modifiers):
    """Plan 4.3.2 names SUHI tertile 1 and NDVI tertile 1 for the realistic case."""
    row = [m for m in modifiers if m["collateral_id"] == "SG-EC-002"][0]
    assert row["suhi_tertile"] == 1
    assert row["ndvi_tertile"] == 1


# ---------------------------------------------------------------------------
# ADR-2: no credit arithmetic leaks into Python
# ---------------------------------------------------------------------------
def test_module_computes_no_haircut_band_or_ltv():
    forbidden = ("haircut", "band", "ltv", "adjusted_value", "reference_index",
                 "damage_fraction", "adaptation_credit")
    names = [n.lower() for n in dir(syn)]
    for name in names:
        for token in forbidden:
            assert token not in name, "%s looks like a rule ADR-2 assigns to TypeScript" % name


def test_emitted_columns_carry_no_derived_credit_field():
    for column in syn.HAZARD_COLUMNS:
        assert column in (
            "id", "collateral_id", "hazard", "scenario", "value", "coverage",
            "scenario_invariant", "unit", "dataset_name", "dataset_version",
            "pathway", "return_period_yrs", "sampled_at")


# ---------------------------------------------------------------------------
# Determinism and committed output
# ---------------------------------------------------------------------------
def test_sampling_is_reproducible(portfolio):
    assert syn.sample(portfolio) == syn.sample(portfolio)
    assert syn.site_modifiers(portfolio) == syn.site_modifiers(portfolio)


def test_string_and_numeric_portfolio_rows_agree(portfolio, rows):
    """`sample()` must accept both `generate()` output and parsed CSV rows."""
    stringified = [dict((k, str(v)) for k, v in pin.items()) for pin in portfolio]
    assert syn.sample(stringified) == rows


def test_committed_hazard_csv_matches_a_fresh_run(rows):
    assert os.path.exists(HAZARD_CSV), (
        "run `python -m prep.lib.synthetic` and commit data/synthetic/")
    with io.open(HAZARD_CSV, encoding="utf-8", newline="") as handle:
        stored = list(csv.DictReader(handle))
    assert len(stored) == 3000
    fresh = dict(((r["collateral_id"], r["hazard"], r["scenario"]), r) for r in rows)
    for s in stored:
        f = fresh[(s["collateral_id"], s["hazard"], s["scenario"])]
        assert s["coverage"] == f["coverage"]
        assert s["value"] == ("" if f["value"] == "" else str(f["value"]))
        assert s["dataset_version"] == "synthetic"


def test_committed_modifier_csv_matches_a_fresh_run(modifiers):
    assert os.path.exists(MODIFIER_CSV)
    with io.open(MODIFIER_CSV, encoding="utf-8", newline="") as handle:
        stored = list(csv.DictReader(handle))
    assert len(stored) == 200
    fresh = dict((m["collateral_id"], m) for m in modifiers)
    for s in stored:
        f = fresh[s["collateral_id"]]
        assert int(s["suhi_tertile"]) == f["suhi_tertile"]
        assert int(s["ndvi_tertile"]) == f["ndvi_tertile"]


# ---------------------------------------------------------------------------
# Calibration guard (task S6b)
#
# These assert on the hazard INPUT distribution, not on bands. `lib/valuation`
# is the one true implementation of the haircut, and the band figures belong to
# the TypeScript db tests. The depth and heat thresholds below are derived once
# from plan 4.3 and written here as constants with their derivation, so this
# file never evaluates a curve or a haircut of its own.
#
# Derivations, residential curve of plan 4.3.1 with p_2050 = 0.22:
#   DRY_M      a pin under 0.10 m has damage < 0.06, so flood < 1.4% and the pin
#              is green whenever its chronic term is under the 3% band edge.
#   DEEP_M     at 1.75 m damage is about 0.68, so flood is about 15%; with the
#              5% chronic cap that clears the 20% red edge.
#   CROSS_2030_M  at 0.33 m damage is about 0.20, so at p_2030 = 0.05 flood is
#              about 1.0%, which is what a 6% wind pin in CN/HK needs to cross
#              band_mid at 2030 and earn revalue_by_year = 2030.
# ---------------------------------------------------------------------------
DRY_M = 0.10
DEEP_M = 1.75
CROSS_2030_M = 0.33

LOWEST_LYING_COASTAL = {("SG", "MS"), ("ID", "PL"), ("ID", "SM"),
                        ("CN", "NS"), ("CN", "NB"), ("HK", "HF"), ("HK", "TK")}

WHOLLY_DRY_AT_2050 = {("SG", "WL"), ("SG", "BT"), ("MY", "SA"), ("MY", "KL"),
                      ("ID", "BS")}


def max_depth(rows_by_pin, cid, scenario):
    return max(
        float(rows_by_pin[cid][("flood_riverine", scenario)]["value"] or 0.0),
        float(rows_by_pin[cid][("flood_coastal", scenario)]["value"] or 0.0))


@pytest.fixture(scope="module")
def by_pin(rows):
    index = {}
    for r in rows:
        index.setdefault(r["collateral_id"], {})[(r["hazard"], r["scenario"])] = r
    return index


def test_enough_pins_are_dry_at_2050_to_leave_a_green_band(portfolio, by_pin):
    """Without a large dry population the 2050 map is uniformly non-green and
    the scenario slider stops discriminating at the position the demo dwells on."""
    dry = [p for p in portfolio
           if max_depth(by_pin, p["collateral_id"], "y2050") < DRY_M]
    assert 90 <= len(dry) <= 125, len(dry)


def test_the_deepest_2050_pins_are_few_and_all_in_the_lowest_lying_clusters(
        portfolio, by_pin):
    deep = [p for p in portfolio
            if max_depth(by_pin, p["collateral_id"], "y2050") >= DEEP_M]
    assert 8 <= len(deep) <= 20, len(deep)
    for p in deep:
        assert (p["country"], p["cluster_code"]) in LOWEST_LYING_COASTAL, \
            "%s is deep enough for the red band but is not a low-lying coastal cluster" \
            % p["collateral_id"]


def test_enough_cn_hk_pins_are_wet_at_2030_to_populate_the_revaluation_tile(
        portfolio, by_pin):
    """AC-6's revaluation tile counts revalue_by_year <= 2030, and only CN and HK
    can reach it: an SG/MY/ID pin at 2030 tops out at 5% water plus the 5%
    chronic cap, which ties band_mid and never exceeds it.

    This asserts the size of the CANDIDATE pool, not the number that actually
    cross. Crossing also needs the 6% wind band, which only the CN/HK
    lowrise_industrial pins reach, so the tile is smaller than this pool. The
    plan anticipates that: its risk table accepts a thin 2030 column and scripts
    the demo around it."""
    wet = [p for p in portfolio
           if p["country"] in ("CN", "HK")
           and max_depth(by_pin, p["collateral_id"], "y2030") >= CROSS_2030_M]
    assert 10 <= len(wet) <= 35, len(wet)


def test_ridge_and_inland_clusters_are_completely_dry_at_2050(portfolio, by_pin):
    for p in portfolio:
        if (p["country"], p["cluster_code"]) in WHOLLY_DRY_AT_2050:
            assert max_depth(by_pin, p["collateral_id"], "y2050") == 0.0, \
                p["collateral_id"]


def test_equatorial_heat_stays_below_the_band_edge(portfolio, by_pin):
    """An SG/MY/ID pin with no flood must be able to stay green, so its heat
    delta has to leave room under the 3% edge after the tertile multiplier."""
    for p in portfolio:
        if p["country"] not in ("SG", "MY", "ID"):
            continue
        days = float(by_pin[p["collateral_id"]][("heat_days35", "y2050")]["value"])
        assert days <= 26.0, (p["collateral_id"], days)
    singapore = [float(by_pin[p["collateral_id"]][("heat_days35", "y2050")]["value"])
                 for p in portfolio if p["country"] == "SG"]
    assert max(singapore) <= 20.0


def test_subtropical_heat_reaches_the_chronic_cap(portfolio, by_pin):
    """CN and HK carry wind and PM2.5 all the way to 2025, and ADR-5 requires
    them amber at the leftmost slider position. Their heat must be large enough
    that the chronic term saturates by 2050."""
    for p in portfolio:
        if p["country"] not in ("CN", "HK"):
            continue
        days = float(by_pin[p["collateral_id"]][("heat_days35", "y2050")]["value"])
        assert days >= 33.0, (p["collateral_id"], days)


def test_calibration_constants_are_the_reviewed_values():
    """A deliberate change here should be a visible diff, not a silent drift.
    docs/sources.md records why each of these carries the value it does."""
    assert syn.COASTAL_LEVEL_M == {"today": 4.40, "y2030": 4.95, "y2050": 5.50}
    assert syn.COASTAL_ATTENUATION_KM == 2.0
    assert syn.COASTAL_ELEVATION_GAMMA == 2.0
    assert syn.RIVERINE_LEVEL_M == {"today": 1.52, "y2030": 1.71, "y2050": 1.90}
    assert syn.RIVERINE_FULL_BELOW_M == 1.0
    assert syn.RIVERINE_ZERO_ABOVE_M == 5.5
    assert syn.HEAT_2030_FRACTION == 0.30
