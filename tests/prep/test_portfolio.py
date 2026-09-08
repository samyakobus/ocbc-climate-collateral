"""S5 acceptance: the synthetic portfolio is exactly the plan's 200 pins.

The expected cluster table below is transcribed from plan section 5 (S5) by
hand and is deliberately NOT imported from `prep.gen_portfolio.CLUSTERS`. If it
were, a typo in the generator would silently rewrite its own acceptance
criterion. Contributes to AC-13.
"""

import csv
import io
import os
import re

import pytest

from prep import gen_portfolio as gp

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORTFOLIO_CSV = os.path.join(REPO_ROOT, "data", "synthetic", "portfolio.csv")

# Plan section 5, S5. `total = fixtures + generated` for the three SG clusters
# that host a fixture; every other cluster is entirely generated.
EXPECTED_CLUSTERS = {
    ("SG", "MS"): 10, ("SG", "EC"): 12, ("SG", "SC"): 8, ("SG", "JI"): 6,
    ("SG", "KB"): 8, ("SG", "WL"): 6, ("SG", "BT"): 10,
    ("MY", "SA"): 10, ("MY", "KL"): 8, ("MY", "GT"): 7, ("MY", "DB"): 8,
    ("MY", "KK"): 7,
    ("ID", "PL"): 12, ("ID", "CJ"): 6, ("ID", "BS"): 8, ("ID", "SM"): 7,
    ("ID", "SB"): 7,
    ("CN", "PD"): 10, ("CN", "NS"): 8, ("CN", "QH"): 7, ("CN", "XM"): 5,
    ("CN", "NB"): 5,
    ("HK", "TK"): 6, ("HK", "HF"): 5, ("HK", "KT"): 5, ("HK", "TP"): 5,
    ("HK", "TC"): 4,
}

EXPECTED_COUNTRIES = {"SG": 60, "MY": 40, "ID": 40, "CN": 35, "HK": 25}

# Plan section 4.3.2: id, address fragment, appraised value, adaptation FK.
EXPECTED_FIXTURES = {
    "SG-MS-002": ("Marina View", 1_800_000, None),
    "SG-MS-003": ("Marina View", 1_800_000, None),
    "SG-EC-001": ("Amber Road", 1_000_000, None),
    "SG-EC-002": ("Marine Parade Road", 1_000_000, None),
    "SG-EC-003": ("East Coast", 1_500_000, "sg-long-island"),
    "SG-KB-003": ("Stadium Boulevard", 1_200_000, "sg-marina-barrage"),
}

ID_PATTERN = re.compile(r"^(SG|MY|ID|CN|HK)-[A-Z]{2}-\d{3}$")


@pytest.fixture(scope="module")
def rows():
    return gp.generate()


@pytest.fixture(scope="module")
def by_id(rows):
    return dict((r["collateral_id"], r) for r in rows)


# ---------------------------------------------------------------------------
# Counts
# ---------------------------------------------------------------------------
def test_exactly_200_pins(rows):
    assert len(rows) == 200


def test_cluster_counts_match_the_plan(rows):
    counted = {}
    for r in rows:
        key = (r["country"], r["cluster_code"])
        counted[key] = counted.get(key, 0) + 1
    assert counted == EXPECTED_CLUSTERS


def test_cluster_counts_sum_to_200():
    assert sum(EXPECTED_CLUSTERS.values()) == 200


def test_country_totals(rows):
    counted = {}
    for r in rows:
        counted[r["country"]] = counted.get(r["country"], 0) + 1
    assert counted == EXPECTED_COUNTRIES


def test_segment_split_is_140_personal_60_corporate(rows):
    personal = [r for r in rows if r["segment"] == "personal"]
    corporate = [r for r in rows if r["segment"] == "corporate"]
    assert len(personal) == 140
    assert len(corporate) == 60


# ---------------------------------------------------------------------------
# Identifiers
# ---------------------------------------------------------------------------
def test_ids_are_unique_and_well_formed(rows):
    ids = [r["collateral_id"] for r in rows]
    assert len(set(ids)) == 200
    for cid in ids:
        assert ID_PATTERN.match(cid), cid


def test_ids_use_a_contiguous_per_cluster_index_from_001(rows):
    """Plan 4.3.2: NNN is a per-cluster running index from 001, so the highest
    index in a cluster equals that cluster's pin count."""
    seen = {}
    for r in rows:
        key = (r["country"], r["cluster_code"])
        seen.setdefault(key, []).append(int(r["collateral_id"].split("-")[2]))
    for key, indices in seen.items():
        expected = list(range(1, EXPECTED_CLUSTERS[key] + 1))
        assert sorted(indices) == expected, key


# ---------------------------------------------------------------------------
# Fixtures are members, not additions
# ---------------------------------------------------------------------------
def test_all_six_fixtures_are_members_of_the_portfolio(by_id):
    for cid in EXPECTED_FIXTURES:
        assert cid in by_id, "%s missing from the 200" % cid
        assert by_id[cid]["is_fixture"] == "true"


def test_fixture_values_and_adaptation_keys(by_id):
    for cid, (fragment, value, adaptation) in EXPECTED_FIXTURES.items():
        row = by_id[cid]
        assert fragment in row["address_line"], (cid, row["address_line"])
        assert row["appraised_value_sgd"] == value
        assert row["adaptation_project_id"] == adaptation


def test_ac2_fixtures_have_no_adaptation_project(by_id):
    """AC-2 rests on SG-EC-001 and SG-EC-002 carrying no adaptation credit,
    while SG-EC-003 in the same cluster points at Long Island."""
    assert by_id["SG-EC-001"]["adaptation_project_id"] is None
    assert by_id["SG-EC-002"]["adaptation_project_id"] is None
    assert by_id["SG-EC-003"]["adaptation_project_id"] == "sg-long-island"


def test_fixtures_occupy_their_named_slot(by_id):
    """SG-EC-003 is the third of twelve East Coast pins; SG-KB-003 the third of
    eight in Kallang Basin; the Marina South pair the second and third of ten."""
    assert by_id["SG-EC-003"]["cluster_code"] == "EC"
    assert by_id["SG-KB-003"]["cluster_code"] == "KB"
    assert by_id["SG-MS-002"]["cluster_code"] == "MS"
    assert by_id["SG-MS-003"]["cluster_code"] == "MS"


def test_fixture_split_per_cluster(rows):
    """Marina South 10 = 2 + 8, East Coast 12 = 3 + 9, Kallang Basin 8 = 1 + 7."""
    expected = {("SG", "MS"): 2, ("SG", "EC"): 3, ("SG", "KB"): 1}
    counted = {}
    for r in rows:
        if r["is_fixture"] == "true":
            key = (r["country"], r["cluster_code"])
            counted[key] = counted.get(key, 0) + 1
    assert counted == expected


def test_inundation_boundary_pair_sits_either_side_of_the_threshold(by_id):
    """AC-8. The flag fires below (AR6 regional median SLR 2050 SSP5-8.5) + 0.5 m.
    The pair holds for any SLR between 0.10 m and 2.10 m."""
    low = by_id["SG-MS-002"]["elevation_m"]
    high = by_id["SG-MS-003"]["elevation_m"]
    assert low < 0.60 + 1e-9
    assert high > 2.50
    for slr in (0.15, 0.25, 0.30, 0.40, 0.60):
        threshold = slr + 0.5
        assert low < threshold
        assert high >= threshold


# ---------------------------------------------------------------------------
# Value envelopes and loan plausibility
# ---------------------------------------------------------------------------
def test_personal_values_between_0_6m_and_4m(rows):
    for r in rows:
        if r["segment"] == "personal":
            assert 600_000 <= r["appraised_value_sgd"] <= 4_000_000, r["collateral_id"]


def test_corporate_values_between_8m_and_120m(rows):
    for r in rows:
        if r["segment"] == "corporate":
            assert 8_000_000 <= r["appraised_value_sgd"] <= 120_000_000, r["collateral_id"]


def test_requested_amounts_sit_at_a_plausible_ltv(rows):
    """Base LTV is 75% personal / 60% corporate on the ADJUSTED value, so a
    request above the unadjusted limit would be implausible on day one."""
    for r in rows:
        ratio = float(r["requested_amount_sgd"]) / float(r["appraised_value_sgd"])
        if r["segment"] == "personal":
            assert 0.50 <= ratio <= 0.75, (r["collateral_id"], ratio)
        else:
            assert 0.35 <= ratio <= 0.60, (r["collateral_id"], ratio)


def test_every_loan_is_originated_in_2025(rows):
    for r in rows:
        assert r["originated_year"] == 2025
        assert r["opened_at"].startswith("2025-")


# ---------------------------------------------------------------------------
# ADR-2: building_type yes, damage_class no
# ---------------------------------------------------------------------------
def test_building_types_are_the_six_named_values(rows):
    assert len(gp.BUILDING_TYPES) == 6
    for r in rows:
        assert r["building_type"] in gp.BUILDING_TYPES


def test_all_six_building_types_are_used(rows):
    used = set(r["building_type"] for r in rows)
    assert used == set(gp.BUILDING_TYPES)


def test_generator_never_emits_damage_class(rows):
    for r in rows:
        assert "damage_class" not in r
    assert "damage_class" not in gp.PORTFOLIO_COLUMNS
    assert "damage_class" not in gp.COLLATERAL_COLUMNS


def test_occupancy_class_is_one_of_two_values(rows):
    for r in rows:
        assert r["occupancy_class"] in ("rc_highrise", "lowrise_industrial")


# ---------------------------------------------------------------------------
# Geography
# ---------------------------------------------------------------------------
def test_every_pin_sits_inside_its_cluster_box(rows):
    clusters = dict(((c.country, c.code), c) for c in gp.CLUSTERS)
    for r in rows:
        c = clusters[(r["country"], r["cluster_code"])]
        assert abs(r["lat"] - c.lat) <= c.box_deg + 1e-6, r["collateral_id"]
        assert abs(r["lon"] - c.lon) <= c.box_deg + 1e-6, r["collateral_id"]


def test_coastal_clusters_are_low_lying_and_inland_ones_are_not(rows):
    """Low-lying coastal clusters must carry low elevation, or the synthetic
    flood floor produces nothing to show."""
    def elevations(country, code):
        return [r["elevation_m"] for r in rows
                if r["country"] == country and r["cluster_code"] == code]

    assert max(elevations("ID", "PL")) <= 2.5          # Pluit, subsiding
    assert max(elevations("ID", "SM")) <= 3.5          # Semarang north coast
    assert max(elevations("SG", "MS")) <= 6.0          # Marina South, reclaimed
    assert max(elevations("SG", "EC")) <= 7.0          # East Coast
    assert min(elevations("SG", "BT")) >= 20.0         # Bukit Timah ridge
    assert min(elevations("MY", "KL")) >= 25.0         # KL city centre


def test_near_shore_clusters_are_near_the_coast(rows):
    for r in rows:
        if (r["country"], r["cluster_code"]) in (("SG", "SC"), ("HK", "HF")):
            assert r["dist_to_coast_km"] <= 2.0, r["collateral_id"]
        if (r["country"], r["cluster_code"]) == ("MY", "KL"):
            assert r["dist_to_coast_km"] >= 20.0, r["collateral_id"]


def test_kota_kinabalu_is_retained(rows):
    """Plan S5: KK is deliberately kept so `hazard_applicability`, not a country
    branch, is what excludes its real STORM wind reading."""
    kk = [r for r in rows if r["country"] == "MY" and r["cluster_code"] == "KK"]
    assert len(kk) == 7


# ---------------------------------------------------------------------------
# Applicants
# ---------------------------------------------------------------------------
def test_applicant_kind_follows_segment(rows):
    for r in rows:
        expected = "person" if r["segment"] == "personal" else "company"
        assert r["applicant_kind"] == expected, r["collateral_id"]


def test_one_applicant_and_one_application_per_pin(rows):
    assert len(set(r["applicant_id"] for r in rows)) == 200
    assert len(set(r["loan_application_id"] for r in rows)) == 200


def test_every_applicant_has_a_non_empty_name(rows):
    for r in rows:
        assert r["applicant_name"].strip(), r["collateral_id"]


# ---------------------------------------------------------------------------
# Determinism and committed output
# ---------------------------------------------------------------------------
def test_generation_is_reproducible():
    assert gp.generate() == gp.generate()


def test_committed_csv_matches_a_fresh_run(rows):
    assert os.path.exists(PORTFOLIO_CSV), (
        "run `python -m prep.gen_portfolio` and commit data/synthetic/")
    with io.open(PORTFOLIO_CSV, encoding="utf-8", newline="") as handle:
        stored = list(csv.DictReader(handle))
    assert len(stored) == 200
    stored_by_id = dict((r["collateral_id"], r) for r in stored)
    for r in rows:
        s = stored_by_id[r["collateral_id"]]
        assert int(s["appraised_value_sgd"]) == r["appraised_value_sgd"]
        assert s["building_type"] == r["building_type"]
        assert s["segment"] == r["segment"]
        assert (s["adaptation_project_id"] or None) == r["adaptation_project_id"]
