"""S5 - synthetic portfolio generator: exactly 200 collateral pins.

Plan: `.omc/plans/ocbc-climate-collateral-mvp.md` sections 4.3.2, 4.6 and 5 (S5).

What this writes
----------------
`applicants`, `loan_applications` (``originated_year = 2025``) and `collateral`
including ``building_type``, ``elevation_m`` and ``dist_to_coast_km``.

What this deliberately does NOT write
-------------------------------------
``damage_class``. The six-to-three building classification is a *rule*; per ADR-2
it lives in ``lib/rules/curves.ts`` and the seeded ``building_damage_class`` table,
not in this generator. Nothing here computes a haircut, an LTV or a band.

Determinism
-----------
Master seed 20260907. Every per-pin draw comes from a sub-generator seeded from
``blake2b(master_seed || collateral_id)``, so the values of one pin never depend on
how many pins were generated before it and a change to one cluster cannot shift
another. Python's built-in ``hash`` is deliberately avoided: it is salted per
process and would break reproducibility.

Fixtures
--------
The six pinned fixtures of plan 4.3.2 are *members* of their clusters, not
additions. They occupy their slot by the per-cluster running index (``SG-EC-003``
is the third of twelve East Coast pins) and the generator produces only the
remaining pins in those clusters, so every published cluster count and the 200
total are unchanged.

Usage
-----
    python -m prep.gen_portfolio            # writes data/synthetic/*.csv
    python -m prep.gen_portfolio --print-only
"""

from __future__ import annotations

import argparse
import csv
import datetime
import hashlib
import io
import os
import random
import struct
from typing import Dict, List, NamedTuple, Optional, Sequence, Tuple

MASTER_SEED = 20260907
ORIGINATED_YEAR = 2025
TOTAL_PINS = 200
PERSONAL_PINS = 140
CORPORATE_PINS = 60

# Segment value envelopes, plan section 5 (S5). Hard bounds, asserted on output.
PERSONAL_VALUE_MIN = 600_000
PERSONAL_VALUE_MAX = 4_000_000
CORPORATE_VALUE_MIN = 8_000_000
CORPORATE_VALUE_MAX = 120_000_000

# The six building types. The six-to-three damage classification is NOT here.
BUILDING_TYPES = (
    "residential_highrise_rc",
    "residential_landed",
    "shophouse_mixed",
    "office_tower",
    "retail_podium",
    "industrial_warehouse",
)

# collateral.occupancy_class ENUM(rc_highrise, lowrise_industrial). A recorded
# structural attribute of the pin, not a derived credit rule: it feeds the wind
# band multiplier in TypeScript, which owns the arithmetic.
OCCUPANCY_BY_TYPE = {
    "residential_highrise_rc": "rc_highrise",
    "office_tower": "rc_highrise",
    "retail_podium": "rc_highrise",
    "residential_landed": "lowrise_industrial",
    "shophouse_mixed": "lowrise_industrial",
    "industrial_warehouse": "lowrise_industrial",
}

FLOOR_RANGE_BY_TYPE = {
    "residential_highrise_rc": (2, 40),
    "office_tower": (1, 35),
    "retail_podium": (1, 5),
    "shophouse_mixed": (1, 3),
    "residential_landed": (1, 3),
    "industrial_warehouse": (1, 2),
}

# Curated adaptation project ids. These must match db/seed/02_reference.sql
# (plan section 5, S8, seven rows). Slugs so the seed can use them verbatim as
# the primary key of `adaptation_projects`.
ADAPT_MARINA_BARRAGE = "sg-marina-barrage"
ADAPT_LONG_ISLAND = "sg-long-island"
ADAPT_SMART_TUNNEL = "my-smart-tunnel"
ADAPT_NCICD_A = "id-ncicd-phase-a"
ADAPT_BANGER_POLDER = "id-banger-polder"
ADAPT_HK_DRAINAGE = "hk-drainage-tunnels"
ADAPT_SH_SEAWALL = "cn-shanghai-seawall"

# Must match the CHECK on loan_applications.status in db/migrations/0001_schema.sql.
LOAN_STATUSES = (
    ("in_review", 0.45),
    ("approved", 0.28),
    ("open", 0.15),
    ("conditionally_approved", 0.12),
)


class Cluster(NamedTuple):
    code: str            # the <CLUSTER> segment of <CC>-<CLUSTER>-<NNN>
    name: str            # collateral.cluster_name
    country: str         # CHAR(2)
    lat: float
    lon: float
    box_deg: float       # half-width of the uniform lat/lon box around the centre
    n: int               # total pins in the cluster, fixtures included
    corp: int            # how many of those pins are corporate
    elev: Tuple[float, float]
    coast: Tuple[float, float]
    pers_value: Tuple[int, int]
    corp_value: Tuple[int, int]
    landed_share: float
    corp_types: Sequence[Tuple[str, float]]
    adaptation: Optional[str]
    adaptation_share: float
    locality: str
    streets: Sequence[str]


# ---------------------------------------------------------------------------
# The 27 seeded clusters. Counts are the plan's S5 table and are load-bearing:
# SG 60, MY 40, ID 40, CN 35, HK 25 -> 200.
# Coastal and reclaimed clusters carry deliberately low elevation envelopes:
# Nansha, Qianhai, Pudong, Ningbo, Tseung Kwan O, Heng Fa Chuen, Kai Tak and
# Tung Chung are engineered fill a few metres above chart datum, not hillside.
# ---------------------------------------------------------------------------
CLUSTERS: List[Cluster] = [
    # -- Singapore, 60 ------------------------------------------------------
    Cluster("MS", "Marina Bay / Marina South", "SG", 1.2760, 103.8620, 0.008,
            10, 3, (1.8, 5.5), (0.15, 1.10), (1_600_000, 3_800_000),
            (30_000_000, 120_000_000), 0.00,
            (("office_tower", 0.7), ("retail_podium", 0.3)),
            ADAPT_MARINA_BARRAGE, 0.40, "Marina South, Singapore",
            ("Marina Boulevard", "Marina View", "Marina Way", "Central Boulevard",
             "Straits Boulevard")),
    Cluster("EC", "East Coast / Katong / Marine Parade", "SG", 1.3020, 103.9050, 0.012,
            12, 1, (2.0, 6.5), (0.25, 1.60), (1_100_000, 2_800_000),
            (10_000_000, 28_000_000), 0.25,
            (("retail_podium", 0.5), ("shophouse_mixed", 0.5)),
            ADAPT_LONG_ISLAND, 0.40, "Katong, Singapore",
            ("Amber Road", "Marine Parade Road", "Tanjong Katong Road", "East Coast Road",
             "Meyer Road", "Still Road")),
    Cluster("SC", "Sentosa Cove", "SG", 1.2450, 103.8380, 0.006,
            8, 1, (2.0, 6.0), (0.05, 0.55), (2_400_000, 4_000_000),
            (12_000_000, 34_000_000), 0.60,
            (("retail_podium", 0.6), ("office_tower", 0.4)),
            None, 0.0, "Sentosa Cove, Singapore",
            ("Ocean Drive", "Cove Drive", "Paradise Island", "Treasure Island",
             "Coral Island")),
    Cluster("JI", "Jurong Island", "SG", 1.2650, 103.7000, 0.014,
            6, 6, (3.0, 8.0), (0.10, 0.90), (1_000_000, 1_500_000),
            (18_000_000, 90_000_000), 0.00,
            (("industrial_warehouse", 1.0),),
            None, 0.0, "Jurong Island, Singapore",
            ("Jurong Island Highway", "Tembusu Crescent", "Sakra Crescent",
             "Ayer Merbau Road", "Banyan Avenue")),
    Cluster("KB", "Kallang Basin", "SG", 1.3050, 103.8710, 0.009,
            8, 2, (2.5, 7.0), (0.70, 2.40), (900_000, 2_000_000),
            (9_000_000, 26_000_000), 0.05,
            (("industrial_warehouse", 0.5), ("retail_podium", 0.3), ("shophouse_mixed", 0.2)),
            ADAPT_MARINA_BARRAGE, 0.40, "Kallang Basin, Singapore",
            ("Kallang Road", "Stadium Boulevard", "Geylang Road", "Sims Avenue",
             "Crawford Lane")),
    Cluster("WL", "Woodlands", "SG", 1.4360, 103.7860, 0.012,
            6, 2, (9.0, 26.0), (0.90, 3.20), (600_000, 1_100_000),
            (8_000_000, 22_000_000), 0.05,
            (("industrial_warehouse", 0.8), ("retail_podium", 0.2)),
            None, 0.0, "Woodlands, Singapore",
            ("Woodlands Drive 62", "Woodlands Avenue 6", "Marsiling Rise",
             "Admiralty Road", "Woodlands Crescent")),
    Cluster("BT", "Bukit Timah", "SG", 1.3380, 103.7760, 0.014,
            10, 0, (28.0, 92.0), (5.50, 10.00), (2_000_000, 4_000_000),
            (8_000_000, 20_000_000), 0.70,
            (("shophouse_mixed", 0.6), ("retail_podium", 0.4)),
            None, 0.0, "Bukit Timah, Singapore",
            ("Bukit Timah Road", "Dunearn Road", "Sixth Avenue", "Holland Road",
             "Chancery Lane", "Namly Avenue")),
    # -- Malaysia, 40 -------------------------------------------------------
    Cluster("SA", "Shah Alam / Kuala Langat", "MY", 3.0730, 101.5180, 0.030,
            10, 5, (7.0, 30.0), (18.0, 34.0), (600_000, 1_100_000),
            (8_000_000, 34_000_000), 0.50,
            (("industrial_warehouse", 0.85), ("office_tower", 0.15)),
            ADAPT_SMART_TUNNEL, 0.30, "Shah Alam, Selangor",
            ("Persiaran Kayangan", "Jalan Kemajuan", "Persiaran Sultan",
             "Jalan Batu Tiga", "Jalan Klang Lama")),
    Cluster("KL", "Kuala Lumpur city centre", "MY", 3.1530, 101.7130, 0.014,
            8, 4, (34.0, 72.0), (33.0, 45.0), (900_000, 2_200_000),
            (18_000_000, 85_000_000), 0.10,
            (("office_tower", 0.7), ("retail_podium", 0.3)),
            ADAPT_SMART_TUNNEL, 0.35, "Kuala Lumpur",
            ("Jalan Ampang", "Jalan Sultan Ismail", "Jalan Raja Chulan",
             "Jalan Bukit Bintang", "Jalan Tun Razak")),
    Cluster("GT", "George Town coastal", "MY", 5.4160, 100.3320, 0.012,
            7, 1, (1.5, 9.5), (0.15, 1.50), (600_000, 1_400_000),
            (8_000_000, 22_000_000), 0.35,
            (("shophouse_mixed", 0.6), ("retail_podium", 0.4)),
            None, 0.0, "George Town, Pulau Pinang",
            ("Lebuh Pantai", "Jalan Sultan Ahmad Shah", "Jalan Macalister",
             "Persiaran Gurney", "Lebuh Light")),
    Cluster("DB", "Danga Bay, Johor Bahru", "MY", 1.4700, 103.7100, 0.016,
            8, 2, (2.5, 12.0), (0.20, 2.20), (600_000, 1_200_000),
            (8_000_000, 26_000_000), 0.50,
            (("industrial_warehouse", 0.6), ("retail_podium", 0.4)),
            None, 0.0, "Johor Bahru, Johor",
            ("Jalan Skudai", "Jalan Danga", "Persiaran Danga", "Jalan Abdul Samad",
             "Jalan Tebrau")),
    Cluster("KK", "Kota Kinabalu", "MY", 5.9750, 116.0720, 0.016,
            7, 1, (1.5, 14.0), (0.15, 2.00), (600_000, 1_100_000),
            (8_000_000, 18_000_000), 0.45,
            (("retail_podium", 0.5), ("shophouse_mixed", 0.5)),
            None, 0.0, "Kota Kinabalu, Sabah",
            ("Jalan Tun Fuad Stephens", "Jalan Coastal", "Jalan Sembulan",
             "Jalan Lintas", "Jalan Tuaran")),
    # -- Indonesia, 40 ------------------------------------------------------
    Cluster("PL", "Pluit / Muara Baru / Ancol", "ID", -6.1180, 106.7900, 0.016,
            12, 3, (-0.40, 2.00), (0.20, 2.00), (600_000, 1_500_000),
            (9_000_000, 30_000_000), 0.30,
            (("industrial_warehouse", 0.6), ("retail_podium", 0.4)),
            ADAPT_NCICD_A, 0.45, "Penjaringan, Jakarta Utara",
            ("Jalan Pluit Karang Ayu", "Jalan Muara Baru Raya", "Jalan Lodan Raya",
             "Jalan Pluit Selatan", "Jalan Ancol Barat")),
    Cluster("CJ", "Central Jakarta", "ID", -6.1860, 106.8280, 0.014,
            6, 3, (4.0, 12.0), (5.0, 9.0), (1_000_000, 2_600_000),
            (16_000_000, 70_000_000), 0.25,
            (("office_tower", 0.75), ("retail_podium", 0.25)),
            ADAPT_NCICD_A, 0.30, "Menteng, Jakarta Pusat",
            ("Jalan M.H. Thamrin", "Jalan Kebon Sirih", "Jalan Cikini Raya",
             "Jalan Menteng Raya", "Jalan Sudirman")),
    Cluster("BS", "BSD City, Tangerang", "ID", -6.2900, 106.6640, 0.020,
            8, 2, (24.0, 56.0), (21.0, 30.0), (700_000, 1_600_000),
            (10_000_000, 32_000_000), 0.55,
            (("office_tower", 0.5), ("retail_podium", 0.5)),
            None, 0.0, "BSD City, Tangerang Selatan",
            ("Jalan Grand Boulevard", "Jalan Pahlawan Seribu", "Jalan Raya Serpong",
             "Jalan Letnan Sutopo", "Jalan Edutown")),
    Cluster("SM", "Semarang north coast", "ID", -6.9500, 110.4200, 0.016,
            7, 2, (0.0, 3.0), (0.30, 3.00), (600_000, 1_000_000),
            (8_000_000, 20_000_000), 0.50,
            (("industrial_warehouse", 0.7), ("shophouse_mixed", 0.3)),
            ADAPT_BANGER_POLDER, 0.55, "Semarang Utara, Jawa Tengah",
            ("Jalan Ronggowarsito", "Jalan Yos Sudarso", "Jalan Kaligawe Raya",
             "Jalan Tanah Mas", "Jalan Arteri Utara")),
    Cluster("SB", "Surabaya", "ID", -7.2300, 112.7370, 0.020,
            7, 2, (1.5, 10.0), (1.80, 8.00), (600_000, 1_200_000),
            (8_000_000, 24_000_000), 0.45,
            (("industrial_warehouse", 0.6), ("retail_podium", 0.4)),
            None, 0.0, "Surabaya, Jawa Timur",
            ("Jalan Kenjeran", "Jalan Basuki Rahmat", "Jalan Mayjen Sungkono",
             "Jalan Rungkut Industri", "Jalan Perak Barat")),
    # -- China, 35 ----------------------------------------------------------
    Cluster("PD", "Pudong / Lujiazui", "CN", 31.2350, 121.5050, 0.016,
            10, 5, (3.0, 6.5), (11.0, 25.0), (1_800_000, 3_900_000),
            (25_000_000, 120_000_000), 0.05,
            (("office_tower", 0.8), ("retail_podium", 0.2)),
            ADAPT_SH_SEAWALL, 0.50, "Pudong, Shanghai",
            ("Century Avenue", "Lujiazui Ring Road", "Dongyuan Road",
             "Yincheng Middle Road", "Pudong South Road")),
    Cluster("NS", "Nansha, Guangzhou", "CN", 22.7700, 113.5400, 0.020,
            8, 3, (1.0, 5.0), (1.50, 12.00), (800_000, 1_800_000),
            (10_000_000, 40_000_000), 0.15,
            (("industrial_warehouse", 0.6), ("office_tower", 0.4)),
            None, 0.0, "Nansha, Guangzhou",
            ("Fengze Road", "Haibin Road", "Jinmao Avenue", "Huangge Avenue",
             "Nansha Avenue")),
    Cluster("QH", "Qianhai, Shenzhen", "CN", 22.5300, 113.8900, 0.012,
            7, 3, (2.0, 8.0), (0.25, 3.00), (1_400_000, 3_200_000),
            (18_000_000, 80_000_000), 0.05,
            (("office_tower", 0.8), ("retail_podium", 0.2)),
            None, 0.0, "Qianhai, Shenzhen",
            ("Qianwan First Road", "Linhai Avenue", "Menghai Avenue",
             "Guiwan Fourth Road", "Baohua Road")),
    Cluster("XM", "Xiamen", "CN", 24.4800, 118.0900, 0.016,
            5, 1, (3.0, 22.0), (0.30, 3.00), (1_000_000, 2_400_000),
            (9_000_000, 28_000_000), 0.15,
            (("retail_podium", 0.5), ("office_tower", 0.5)),
            None, 0.0, "Siming, Xiamen",
            ("Huandao Road", "Hubin South Road", "Lujiang Road", "Xianyue Road",
             "Jiahe Road")),
    Cluster("NB", "Ningbo", "CN", 29.8700, 121.5500, 0.016,
            5, 1, (2.0, 8.5), (7.00, 20.00), (800_000, 1_700_000),
            (8_000_000, 24_000_000), 0.20,
            (("industrial_warehouse", 0.6), ("retail_podium", 0.4)),
            None, 0.0, "Yinzhou, Ningbo",
            ("Zhongshan East Road", "Baizhang Road", "Ningchuan Road",
             "Heyi Avenue", "Sanjiangkou Road")),
    # -- Hong Kong, 25 ------------------------------------------------------
    Cluster("TK", "Tseung Kwan O", "HK", 22.3170, 114.2600, 0.010,
            6, 2, (3.5, 12.0), (0.25, 2.00), (1_200_000, 2_600_000),
            (10_000_000, 32_000_000), 0.05,
            (("industrial_warehouse", 0.5), ("retail_podium", 0.5)),
            ADAPT_HK_DRAINAGE, 0.35, "Tseung Kwan O, New Territories",
            ("Tong Chun Street", "Po Yap Road", "Chui Ling Road", "Wan Po Road",
             "Pui Shing Road")),
    Cluster("HF", "Heng Fa Chuen / Chai Wan", "HK", 22.2770, 114.2380, 0.008,
            5, 1, (2.5, 7.0), (0.10, 1.20), (1_100_000, 2_300_000),
            (9_000_000, 26_000_000), 0.05,
            (("industrial_warehouse", 0.5), ("shophouse_mixed", 0.5)),
            ADAPT_HK_DRAINAGE, 0.35, "Chai Wan, Hong Kong Island",
            ("Heng Fa Chuen Road", "Chai Wan Road", "Wan Tsui Road",
             "Sheung On Street", "Hong Man Street")),
    Cluster("KT", "Kai Tak", "HK", 22.3300, 114.2000, 0.008,
            5, 2, (3.0, 8.5), (0.20, 1.50), (1_600_000, 3_400_000),
            (20_000_000, 95_000_000), 0.00,
            (("office_tower", 0.7), ("retail_podium", 0.3)),
            ADAPT_HK_DRAINAGE, 0.35, "Kai Tak, Kowloon",
            ("Muk On Street", "Shing Kai Road", "Sheung Yuet Road", "Concorde Road",
             "Olympic Avenue")),
    Cluster("TP", "Tai Po / Sha Tin", "HK", 22.4450, 114.1700, 0.020,
            5, 1, (6.0, 42.0), (0.50, 4.00), (1_300_000, 2_900_000),
            (9_000_000, 24_000_000), 0.25,
            (("industrial_warehouse", 0.6), ("retail_podium", 0.4)),
            ADAPT_HK_DRAINAGE, 0.35, "Tai Po, New Territories",
            ("Ting Kok Road", "On Chee Road", "Tai Po Tai Wo Road",
             "Sha Tin Rural Committee Road", "Yuen Wo Road")),
    Cluster("TC", "Tung Chung", "HK", 22.2890, 113.9420, 0.010,
            4, 1, (3.0, 15.0), (0.20, 1.60), (1_000_000, 2_200_000),
            (8_000_000, 22_000_000), 0.05,
            (("retail_podium", 0.6), ("office_tower", 0.4)),
            ADAPT_HK_DRAINAGE, 0.35, "Tung Chung, Lantau",
            ("Yu Tung Road", "Tat Tung Road", "Mei Tung Street", "Ying Tung Road",
             "Chung Yan Road")),
]


# ---------------------------------------------------------------------------
# The six pinned fixtures of plan 4.3.2. Members of their clusters, occupying
# the slot named by their per-cluster running index. Every field below is
# authoritative and overrides the generated draw.
#
# SG-MS-002 / SG-MS-003 are the AC-8 inundation-boundary pair. The flag fires
# when elevation_m < (IPCC AR6 regional median SLR at 2050, SSP5-8.5) +
# rules.inundation_threshold_m (0.50). At 0.6 m and 2.6 m the pair sits either
# side of that threshold for any SLR value between 0.10 m and 2.10 m, which
# covers every plausible AR6 figure with a wide margin, so the pair cannot be
# flipped by a later change to the seeded sea-level constant.
# ---------------------------------------------------------------------------
FIXTURES: Dict[str, Dict[str, object]] = {
    "SG-MS-002": {
        "address_line": "8 Marina View",
        "building_type": "residential_highrise_rc",
        "floor_level": 12,
        "appraised_value_sgd": 1_800_000,
        "adaptation_project_id": None,
        "segment": "personal",
        "elevation_m": 0.6,
        "dist_to_coast_km": 0.35,
        "lat": 1.27510,
        "lon": 103.86020,
        "applicant_name": "Tan Wei Ling",
        "note": "AC-8 inundation boundary, low side: the flag fires",
    },
    "SG-MS-003": {
        "address_line": "10 Marina View",
        "building_type": "residential_highrise_rc",
        "floor_level": 21,
        "appraised_value_sgd": 1_800_000,
        "adaptation_project_id": None,
        "segment": "personal",
        "elevation_m": 2.6,
        "dist_to_coast_km": 0.35,
        "lat": 1.27540,
        "lon": 103.86060,
        "applicant_name": "Rajesh Kumaran",
        "note": "AC-8 inundation boundary, high side: the flag does not fire",
    },
    "SG-EC-001": {
        "address_line": "12 Amber Road",
        "building_type": "residential_highrise_rc",
        "floor_level": 8,
        "appraised_value_sgd": 1_000_000,
        "adaptation_project_id": None,
        "segment": "personal",
        "elevation_m": 3.2,
        "dist_to_coast_km": 0.45,
        "lat": 1.30020,
        "lon": 103.89610,
        "applicant_name": "Lim Hui Shan",
        "note": "AC-2 worked example, flood-only. adaptation_project_id IS NULL",
    },
    "SG-EC-002": {
        "address_line": "88 Marine Parade Road",
        "building_type": "residential_highrise_rc",
        "floor_level": 14,
        "appraised_value_sgd": 1_000_000,
        "adaptation_project_id": None,
        "segment": "personal",
        "elevation_m": 3.2,
        "dist_to_coast_km": 0.45,
        "lat": 1.30190,
        "lon": 103.90580,
        "applicant_name": "Nurul Aisyah Binte Hamid",
        "note": "AC-2 realistic Singapore case. adaptation_project_id IS NULL",
    },
    "SG-EC-003": {
        "address_line": "215 East Coast Road",
        "building_type": "residential_landed",
        "floor_level": 2,
        "appraised_value_sgd": 1_500_000,
        "adaptation_project_id": ADAPT_LONG_ISLAND,
        "segment": "personal",
        "elevation_m": 4.8,
        "dist_to_coast_km": 0.70,
        "lat": 1.30560,
        "lon": 103.90910,
        "applicant_name": "Goh Cheng Hock",
        "note": "ADR-4 zero floor, Long Island credit 3.00 pp",
    },
    "SG-KB-003": {
        "address_line": "31 Stadium Boulevard",
        "building_type": "residential_highrise_rc",
        "floor_level": 11,
        "appraised_value_sgd": 1_200_000,
        "adaptation_project_id": ADAPT_MARINA_BARRAGE,
        "segment": "personal",
        "elevation_m": 3.4,
        "dist_to_coast_km": 1.10,
        "lat": 1.30410,
        "lon": 103.87280,
        "applicant_name": "Priya Ramanathan",
        "note": "AC-3 adaptation, Marina Barrage credit 1.50 pp",
    },
}


# ---------------------------------------------------------------------------
# Applicant name pools. Synthetic throughout; `applicants.synthetic` is true on
# every row and the app renders the illustrative-data ribbon over all of it.
# ---------------------------------------------------------------------------
GIVEN = {
    "SG": ("Wei Ming", "Hui Shan", "Jun Hao", "Xin Yi", "Kai Wen", "Siti Nurhaliza",
           "Aisyah", "Farid", "Arjun", "Meera", "Daniel", "Rachel", "Terence",
           "Priya", "Zulkifli", "Cheryl", "Marcus", "Shalini", "Jerome", "Yan Ling"),
    "MY": ("Ahmad", "Nurul", "Faizal", "Siti", "Amirul", "Hafiz", "Kamarul", "Zarina",
           "Chee Keong", "Mei Ling", "Sivakumar", "Devi", "Wan Azman", "Nadia",
           "Rosli", "Hasnah", "Yew Cheong", "Suriani", "Anand", "Lai Peng"),
    "ID": ("Budi", "Siti", "Agus", "Dewi", "Rizky", "Andi", "Putri", "Bambang",
           "Ratna", "Hendra", "Sri", "Wahyu", "Yuni", "Dian", "Eko", "Nurhayati",
           "Iwan", "Lestari", "Fajar", "Ayu"),
    "CN": ("Wei", "Jing", "Hao", "Xiaoming", "Yan", "Lei", "Fang", "Chen", "Min",
           "Qiang", "Li", "Hui", "Jun", "Ying", "Peng", "Xue", "Tao", "Na", "Bin",
           "Mei"),
    "HK": ("Ka Ming", "Wai Yee", "Chun Kit", "Hoi Ching", "Ho Yin", "Sze Wing",
           "Ka Yan", "Man Ho", "Tsz Kwan", "Yuen Man", "Kwok Wai", "Pui Shan",
           "Chi Wai", "Wing Sze", "Cheuk Yin", "Lok Yiu", "Siu Fung", "Mei Fong",
           "Tin Lok", "Hiu Tung"),
}

FAMILY = {
    "SG": ("Tan", "Lim", "Lee", "Ng", "Wong", "Chan", "Goh", "Koh", "Ong", "Teo",
           "Rahman", "Ibrahim", "Kumar", "Nair", "Pillai", "Chia", "Sim", "Yeo",
           "Loh", "Toh"),
    "MY": ("bin Abdullah", "binti Hassan", "Ismail", "Ibrahim", "Yusof", "Tan",
           "Lim", "Chong", "Rajendran", "Subramaniam", "Mohd Noor", "Zainal",
           "Cheah", "Khoo", "Ooi", "Rahim", "Salleh", "Wong", "Gopal", "Aziz"),
    "ID": ("Santoso", "Wijaya", "Setiawan", "Halim", "Kusuma", "Nugroho", "Pratama",
           "Suryadi", "Hartono", "Gunawan", "Simanjuntak", "Siahaan", "Rahmawati",
           "Permana", "Saputra", "Widodo", "Mulyani", "Hidayat", "Sinaga",
           "Anggraini"),
    "CN": ("Zhang", "Wang", "Li", "Chen", "Liu", "Yang", "Huang", "Zhao", "Wu",
           "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "He", "Lin", "Gao",
           "Luo"),
    "HK": ("Chan", "Wong", "Cheung", "Lau", "Lee", "Ng", "Ho", "Leung", "Yeung",
           "Tsang", "Kwok", "Chow", "Lai", "Fung", "Mak", "Tam", "So", "Yip",
           "Hui", "Poon"),
}

COMPANY_STEM = {
    "SG": ("Straits", "Keppel Bay", "Raffles Quay", "Tanjong", "Merlion", "Anson",
           "Fullerton", "Changi", "Seletar", "Buona Vista", "Pandan", "Tuas Link",
           "Bencoolen", "Sembawang", "Pasir Ris", "Novena"),
    "MY": ("Kayangan", "Klang Valley", "Selatan", "Bukit Jalil", "Perdana",
           "Nusantara", "Sinar", "Cemerlang", "Wawasan", "Gemilang", "Damansara",
           "Tebrau", "Seberang", "Bayan", "Likas", "Sepanggar"),
    "ID": ("Nusantara", "Bahari", "Cakrawala", "Samudera", "Kencana", "Anugerah",
           "Graha", "Cipta", "Wijaya Kusuma", "Pelita", "Harapan", "Semesta",
           "Adhi Bumi", "Serpong Jaya", "Tanjung Priok", "Kaligawe"),
    "CN": ("Lujiazui", "Huangpu", "Nansha", "Qianhai", "Xiamen Gulf", "Yongjiang",
           "Jinqiao", "Zhangjiang", "Baoshan", "Songjiang", "Yinzhou", "Beilun",
           "Haizhu", "Futian", "Hongqiao", "Xinghai"),
    "HK": ("Victoria Harbour", "Kowloon Bay", "Tsuen Wan", "Kwun Tong", "Aberdeen",
           "Sai Kung", "Lantau", "Causeway", "Wanchai", "Tai Kok Tsui", "Yau Tong",
           "Fo Tan", "Cheung Sha Wan", "Shek Mun", "Hung Hom", "Quarry Bay"),
}

COMPANY_SUFFIX = {
    "SG": ("Pte Ltd", "Holdings Pte Ltd", "Industries Pte Ltd", "Properties Pte Ltd",
           "Logistics Pte Ltd"),
    "MY": ("Sdn Bhd", "Holdings Sdn Bhd", "Industries Sdn Bhd", "Properties Sdn Bhd",
           "Logistik Sdn Bhd"),
    "ID": ("Sejahtera", "Mandiri", "Utama", "Persada", "Logistik", "Properti"),
    "CN": ("Development Co. Ltd", "Industrial Co. Ltd", "Property Group Co. Ltd",
           "Logistics Co. Ltd", "Holdings Co. Ltd"),
    "HK": ("Limited", "Holdings Limited", "Industrial Limited", "Properties Limited",
           "Logistics Limited"),
}


# ---------------------------------------------------------------------------
# Deterministic draws
# ---------------------------------------------------------------------------
def rng_for(key: str) -> random.Random:
    """A sub-generator keyed by a stable string.

    ``hashlib.blake2b`` rather than ``hash()``: the built-in is salted per
    process, so a run would not reproduce across machines or invocations.
    """
    digest = hashlib.blake2b(
        ("%d|%s" % (MASTER_SEED, key)).encode("utf-8"), digest_size=8
    ).digest()
    return random.Random(struct.unpack("<Q", digest)[0])


def weighted_pick(rng: random.Random, pairs: Sequence[Tuple[str, float]]) -> str:
    total = sum(w for _, w in pairs)
    x = rng.random() * total
    upto = 0.0
    for value, weight in pairs:
        upto += weight
        if x <= upto:
            return value
    return pairs[-1][0]


def collateral_id(country: str, code: str, index: int) -> str:
    return "%s-%s-%03d" % (country, code, index)


def person_name(rng: random.Random, country: str) -> str:
    return "%s %s" % (rng.choice(GIVEN[country]), rng.choice(FAMILY[country]))


def company_name(rng: random.Random, country: str) -> str:
    stem = rng.choice(COMPANY_STEM[country])
    suffix = rng.choice(COMPANY_SUFFIX[country])
    if country == "ID":
        return "PT %s %s" % (stem, suffix)
    return "%s %s" % (stem, suffix)


def round_to(value: float, step: int) -> int:
    return int(round(value / step) * step)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------
def corporate_slots(cluster: Cluster) -> set:
    """Which per-cluster indices are corporate.

    All six fixtures are personal, so corporate slots are drawn only from the
    cluster's non-fixture indices. The draw is seeded from the cluster code, so
    adding a pin to one cluster cannot move another cluster's segments.
    """
    free = [
        i for i in range(1, cluster.n + 1)
        if collateral_id(cluster.country, cluster.code, i) not in FIXTURES
    ]
    if cluster.corp > len(free):
        raise ValueError(
            "cluster %s wants %d corporate pins but has only %d non-fixture slots"
            % (cluster.code, cluster.corp, len(free))
        )
    rng = rng_for("segments|" + cluster.country + cluster.code)
    return set(rng.sample(free, cluster.corp))


def build_pin(cluster: Cluster, index: int, seq: int, is_corporate: bool) -> Dict[str, object]:
    cid = collateral_id(cluster.country, cluster.code, index)
    fx = FIXTURES.get(cid)
    rng = rng_for("pin|" + cid)

    segment = "corporate" if is_corporate else "personal"

    # Site geometry. One shared draw ties elevation to distance from the coast,
    # so the low-lying pins in a coastal cluster are also the near-shore ones.
    u_site = rng.random()
    v_site = rng.random()
    elev_lo, elev_hi = cluster.elev
    coast_lo, coast_hi = cluster.coast
    elevation = elev_lo + u_site * (elev_hi - elev_lo)
    dist = coast_lo + (0.65 * u_site + 0.35 * v_site) * (coast_hi - coast_lo)
    lat = cluster.lat + rng.uniform(-cluster.box_deg, cluster.box_deg)
    lon = cluster.lon + rng.uniform(-cluster.box_deg, cluster.box_deg)

    if is_corporate:
        building_type = weighted_pick(rng, cluster.corp_types)
        lo, hi = cluster.corp_value
        value = round_to(lo + rng.random() * (hi - lo), 100_000)
        value = min(max(value, CORPORATE_VALUE_MIN), CORPORATE_VALUE_MAX)
    else:
        building_type = (
            "residential_landed" if rng.random() < cluster.landed_share
            else "residential_highrise_rc"
        )
        lo, hi = cluster.pers_value
        value = round_to(lo + rng.random() * (hi - lo), 10_000)
        value = min(max(value, PERSONAL_VALUE_MIN), PERSONAL_VALUE_MAX)

    floor_lo, floor_hi = FLOOR_RANGE_BY_TYPE[building_type]
    floor_level = rng.randint(floor_lo, floor_hi)

    adaptation = None
    if cluster.adaptation is not None and rng.random() < cluster.adaptation_share:
        adaptation = cluster.adaptation

    street = rng.choice(cluster.streets)
    address = "%d %s" % (rng.randint(1, 399), street)

    applicant_kind = "person" if segment == "personal" else "company"
    applicant_name = (
        person_name(rng, cluster.country) if applicant_kind == "person"
        else company_name(rng, cluster.country)
    )

    if fx is not None:
        segment = str(fx["segment"])
        building_type = str(fx["building_type"])
        value = int(fx["appraised_value_sgd"])
        floor_level = int(fx["floor_level"])
        adaptation = fx["adaptation_project_id"]
        elevation = float(fx["elevation_m"])
        dist = float(fx["dist_to_coast_km"])
        lat = float(fx["lat"])
        lon = float(fx["lon"])
        address = str(fx["address_line"])
        applicant_kind = "person"
        applicant_name = str(fx["applicant_name"])

    if segment == "personal":
        requested = round_to(value * rng.uniform(0.55, 0.75), 1_000)
    else:
        requested = round_to(value * rng.uniform(0.40, 0.60), 10_000)

    status = weighted_pick(rng, LOAN_STATUSES)
    opened_at = datetime.date(ORIGINATED_YEAR, rng.randint(1, 12), rng.randint(1, 28))

    return {
        "collateral_id": cid,
        "country": cluster.country,
        "cluster_code": cluster.code,
        "cluster_name": cluster.name,
        "address_line": "%s, %s" % (address, cluster.locality),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "elevation_m": round(elevation, 1),
        "dist_to_coast_km": round(dist, 2),
        "building_type": building_type,
        "occupancy_class": OCCUPANCY_BY_TYPE[building_type],
        "floor_level": floor_level,
        "appraised_value_sgd": value,
        "adaptation_project_id": adaptation,
        "segment": segment,
        "applicant_id": "AP-%03d" % seq,
        "applicant_name": applicant_name,
        "applicant_kind": applicant_kind,
        "loan_application_id": "LA-%03d" % seq,
        "requested_amount_sgd": requested,
        "originated_year": ORIGINATED_YEAR,
        "status": status,
        "opened_at": opened_at.isoformat(),
        "is_fixture": "true" if fx is not None else "false",
    }


def generate() -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    seq = 0
    for cluster in CLUSTERS:
        corp = corporate_slots(cluster)
        for index in range(1, cluster.n + 1):
            seq += 1
            rows.append(build_pin(cluster, index, seq, index in corp))
    validate(rows)
    return rows


def validate(rows: Sequence[Dict[str, object]]) -> None:
    """Assertions the plan's numbers depend on. Fail loudly, not silently."""
    if len(rows) != TOTAL_PINS:
        raise AssertionError("expected %d pins, generated %d" % (TOTAL_PINS, len(rows)))

    ids = [r["collateral_id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise AssertionError("duplicate collateral ids")

    personal = [r for r in rows if r["segment"] == "personal"]
    corporate = [r for r in rows if r["segment"] == "corporate"]
    if len(personal) != PERSONAL_PINS or len(corporate) != CORPORATE_PINS:
        raise AssertionError(
            "segment split is %d personal / %d corporate, expected %d / %d"
            % (len(personal), len(corporate), PERSONAL_PINS, CORPORATE_PINS)
        )

    for r in personal:
        v = r["appraised_value_sgd"]
        if not (PERSONAL_VALUE_MIN <= v <= PERSONAL_VALUE_MAX):
            raise AssertionError("%s personal value %s out of range" % (r["collateral_id"], v))
    for r in corporate:
        v = r["appraised_value_sgd"]
        if not (CORPORATE_VALUE_MIN <= v <= CORPORATE_VALUE_MAX):
            raise AssertionError("%s corporate value %s out of range" % (r["collateral_id"], v))

    by_id = dict((r["collateral_id"], r) for r in rows)
    for cid, fx in FIXTURES.items():
        if cid not in by_id:
            raise AssertionError("fixture %s is not a member of the portfolio" % cid)
        row = by_id[cid]
        if row["appraised_value_sgd"] != fx["appraised_value_sgd"]:
            raise AssertionError("fixture %s value drifted" % cid)
        if row["adaptation_project_id"] != fx["adaptation_project_id"]:
            raise AssertionError("fixture %s adaptation_project_id drifted" % cid)

    for cluster in CLUSTERS:
        got = len([r for r in rows if r["cluster_code"] == cluster.code
                   and r["country"] == cluster.country])
        if got != cluster.n:
            raise AssertionError(
                "cluster %s-%s has %d pins, expected %d"
                % (cluster.country, cluster.code, got, cluster.n)
            )

    for r in rows:
        if r["building_type"] not in BUILDING_TYPES:
            raise AssertionError("unknown building_type %s" % r["building_type"])
        if "damage_class" in r:
            raise AssertionError("ADR-2: the generator must not emit damage_class")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
PORTFOLIO_COLUMNS = (
    "collateral_id", "country", "cluster_code", "cluster_name", "address_line",
    "lat", "lon", "elevation_m", "dist_to_coast_km", "building_type",
    "occupancy_class", "floor_level", "appraised_value_sgd",
    "adaptation_project_id", "segment", "applicant_id", "applicant_name",
    "applicant_kind", "loan_application_id", "requested_amount_sgd",
    "originated_year", "status", "opened_at", "is_fixture",
)

COLLATERAL_COLUMNS = (
    "id", "address_line", "cluster_name", "country", "lat", "lon",
    "building_type", "occupancy_class", "appraised_value_sgd", "floor_level",
    "elevation_m", "dist_to_coast_km", "adaptation_project_id",
)

APPLICANT_COLUMNS = ("id", "name", "kind", "country", "synthetic")

LOAN_COLUMNS = (
    "id", "applicant_id", "collateral_id", "segment", "requested_amount",
    "originated_year", "base_ltv_override", "status", "opened_at",
)


def _write_csv(path: str, columns: Sequence[str], records: Sequence[Dict[str, object]]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns), lineterminator="\n")
        writer.writeheader()
        for record in records:
            writer.writerow(record)


def write_outputs(rows: Sequence[Dict[str, object]], out_dir: str) -> List[str]:
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)

    portfolio_path = os.path.join(out_dir, "portfolio.csv")
    _write_csv(portfolio_path, PORTFOLIO_COLUMNS,
               [dict((c, r[c]) for c in PORTFOLIO_COLUMNS) for r in rows])

    collateral_path = os.path.join(out_dir, "collateral.csv")
    _write_csv(collateral_path, COLLATERAL_COLUMNS, [{
        "id": r["collateral_id"],
        "address_line": r["address_line"],
        "cluster_name": r["cluster_name"],
        "country": r["country"],
        "lat": r["lat"],
        "lon": r["lon"],
        "building_type": r["building_type"],
        "occupancy_class": r["occupancy_class"],
        "appraised_value_sgd": r["appraised_value_sgd"],
        "floor_level": r["floor_level"],
        "elevation_m": r["elevation_m"],
        "dist_to_coast_km": r["dist_to_coast_km"],
        "adaptation_project_id": r["adaptation_project_id"],
    } for r in rows])

    applicants_path = os.path.join(out_dir, "applicants.csv")
    _write_csv(applicants_path, APPLICANT_COLUMNS, [{
        "id": r["applicant_id"],
        "name": r["applicant_name"],
        "kind": r["applicant_kind"],
        "country": r["country"],
        "synthetic": "true",
    } for r in rows])

    loans_path = os.path.join(out_dir, "loan_applications.csv")
    _write_csv(loans_path, LOAN_COLUMNS, [{
        "id": r["loan_application_id"],
        "applicant_id": r["applicant_id"],
        "collateral_id": r["collateral_id"],
        "segment": r["segment"],
        "requested_amount": r["requested_amount_sgd"],
        "originated_year": r["originated_year"],
        "base_ltv_override": "",
        "status": r["status"],
        "opened_at": r["opened_at"],
    } for r in rows])

    return [portfolio_path, collateral_path, applicants_path, loans_path]


def cluster_table(rows: Sequence[Dict[str, object]]) -> str:
    header = "%-3s  %-36s  %-4s  %5s  %8s  %8s  %9s" % (
        "CC", "Cluster", "Code", "Pins", "Fixtures", "Personal", "Corporate")
    lines = [header, "-" * len(header)]
    country_order = []
    for cluster in CLUSTERS:
        if cluster.country not in country_order:
            country_order.append(cluster.country)

    grand = [0, 0, 0, 0]
    for country in country_order:
        sub = [0, 0, 0, 0]
        for cluster in CLUSTERS:
            if cluster.country != country:
                continue
            members = [r for r in rows
                       if r["country"] == country and r["cluster_code"] == cluster.code]
            fixtures = len([r for r in members if r["is_fixture"] == "true"])
            personal = len([r for r in members if r["segment"] == "personal"])
            corporate = len([r for r in members if r["segment"] == "corporate"])
            lines.append("%-3s  %-36s  %-4s  %5d  %8d  %8d  %9d" % (
                country, cluster.name, cluster.code, len(members), fixtures,
                personal, corporate))
            sub[0] += len(members)
            sub[1] += fixtures
            sub[2] += personal
            sub[3] += corporate
        lines.append("%-3s  %-36s  %-4s  %5d  %8d  %8d  %9d" % (
            country, "  subtotal", "", sub[0], sub[1], sub[2], sub[3]))
        lines.append("")
        for i in range(4):
            grand[i] += sub[i]

    lines.append("-" * len(header))
    lines.append("%-3s  %-36s  %-4s  %5d  %8d  %8d  %9d" % (
        "ALL", "TOTAL", "", grand[0], grand[1], grand[2], grand[3]))
    return "\n".join(lines)


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out-dir",
        default=os.path.join(repo_root(), "data", "synthetic"),
        help="directory for the generated CSVs (default: data/synthetic)")
    parser.add_argument(
        "--print-only", action="store_true",
        help="print the cluster table and write nothing")
    args = parser.parse_args(argv)

    rows = generate()
    print(cluster_table(rows))
    print("")
    print("seed=%d  pins=%d  personal=%d  corporate=%d  fixtures=%d" % (
        MASTER_SEED, len(rows),
        len([r for r in rows if r["segment"] == "personal"]),
        len([r for r in rows if r["segment"] == "corporate"]),
        len([r for r in rows if r["is_fixture"] == "true"])))

    if args.print_only:
        return 0

    written = write_outputs(rows, args.out_dir)
    written.append(write_seed_sql(rows, repo_root()))
    print("")
    for path in written:
        print("wrote %s" % path)
    return 0



# ---------------------------------------------------------------------------
# db/seed/03_portfolio.sql
#
# Plan 4.1 lists this file as "from gen_portfolio.py", and scripts/seed.ts
# applies it third, after 02_reference.sql has created the adaptation projects
# that collateral.adaptation_project_id points at.
#
# Insert order is applicants, then collateral, then loan_applications, because
# a loan application references both of the others.
# ---------------------------------------------------------------------------
def sql_literal(value: object) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def derived_columns(rows):
    """`slope_deg` and `landslide_flag` for every pin, keyed by collateral id.

    IMPORTED, NOT REIMPLEMENTED. `prep/lib/context.py` is the single definition
    of both, it claims the ADR-2 exemption for deriving them under
    `--source=synthetic`, and it is pinned by the same `MASTER_SEED`. A second
    copy of the slope model here would be two rules for one column, which is
    exactly the duplication ADR-2 exists to prevent, and it would drift the
    first time the threshold moved. It has already moved once, from 18 degrees
    to 25.

    The import is local rather than module-level so this file still runs
    standalone from a checkout where `prep.lib` is not importable: the cluster
    table and the CSVs need none of it. Only the SQL emitter does, and it fails
    loudly rather than emitting a narrower file in silence.
    """
    from prep.lib.context import derive_collateral_updates

    updates = derive_collateral_updates([
        {"id": r["collateral_id"], "country": r["country"],
         "elevation_m": r["elevation_m"]}
        for r in rows
    ])
    return {str(u["collateral_id"]): u for u in updates}


def thumb_paths(repo):
    """`satellite_thumb_path` per pin, from the committed thumbnail manifest.

    The manifest is `data/frozen/satellite_thumbs.csv`, written by
    `prep/fetch_thumbs.py`, with columns `collateral_id` and `cached_path`.
    `prep/fetch_thumbs.py` names it the single source of truth for this column
    precisely so this emitter and that module's own UPDATE block cannot
    disagree; once both are in place its UPDATE block goes and the column has
    exactly one writer.

    OPTIONAL BY DESIGN. A checkout that has never run the thumbnail step gets
    NULL for every pin, the case screen renders its placeholder, and nothing
    fails. Making the seed depend on a fetched artefact would put an outbound
    call between a clone and a working database, which AC-13 forbids.

    Read with the stdlib rather than through `prep.lib.frozen`, because this
    function has to work in a checkout where the manifest is absent and it must
    not import a module whose contract is "raise when the frozen file is
    missing". A row with an empty `cached_path` is skipped rather than emitted
    as an empty string: `sql_literal` would write NULL for it anyway, and a
    silent empty path is worth not producing.
    """
    path = os.path.join(repo, "data", "frozen", "satellite_thumbs.csv")
    if not os.path.isfile(path):
        return {}

    out = {}
    with io.open(path, "r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            cid = (row.get("collateral_id") or "").strip()
            cached = (row.get("cached_path") or "").strip()
            if cid and cached:
                out[cid] = cached
    return out


def portfolio_sql(rows: Sequence[Dict[str, object]],
                  repo: Optional[str] = None) -> str:
    out: List[str] = []
    out.append("-- db/seed/03_portfolio.sql")
    out.append("-- GENERATED by prep/gen_portfolio.py (S5). Do not edit by hand;")
    out.append("-- re-run `python -m prep.gen_portfolio` instead.")
    out.append("-- seed=%d, %d pins, %d personal / %d corporate, originated %d."
               % (MASTER_SEED, len(rows),
                  len([r for r in rows if r["segment"] == "personal"]),
                  len([r for r in rows if r["segment"] == "corporate"]),
                  ORIGINATED_YEAR))
    out.append("")

    # ---- idempotency ------------------------------------------------------
    #
    # `scripts/seed.ts` applies all five seed files on EVERY `npm run db:seed`,
    # against a database that may already hold them, so every INSERT here has to
    # be an upsert. Emitting plain INSERTs made the second seed of the day fail
    # on `applicants_pkey` and roll back the whole file, which reads like a
    # corrupt database rather than a missing clause.
    #
    # DO UPDATE rather than DO NOTHING, and the difference matters: DO NOTHING
    # would leave a regenerated portfolio silently unapplied on top of an old
    # one, so the seed would succeed while the figures stayed stale.

    out.append("INSERT INTO applicants (id, name, kind, country, synthetic) VALUES")
    values = ["  (%s, %s, %s, %s, true)" % (
        sql_literal(r["applicant_id"]), sql_literal(r["applicant_name"]),
        sql_literal(r["applicant_kind"]), sql_literal(r["country"])) for r in rows]
    out.append(",\n".join(values))
    out.append("ON CONFLICT (id) DO UPDATE SET")
    out.append("  name = EXCLUDED.name, kind = EXCLUDED.kind,")
    out.append("  country = EXCLUDED.country, synthetic = EXCLUDED.synthetic;")
    out.append("")

    # Three columns beyond the pin's own attributes. Without them this emitter
    # writes a NARROWER file than the one committed: running the CLI without
    # `--print-only` would drop the landslide badge's data and every thumbnail
    # path, and nothing would say so.
    derived = derived_columns(rows)
    thumbs = thumb_paths(repo if repo is not None else repo_root())

    out.append("INSERT INTO collateral (")
    out.append("  id, address_line, cluster_name, country, geom, building_type,")
    out.append("  occupancy_class, appraised_value_sgd, floor_level, elevation_m,")
    out.append("  dist_to_coast_km, adaptation_project_id, landslide_flag, slope_deg,")
    out.append("  satellite_thumb_path")
    out.append(") VALUES")
    values = []
    for r in rows:
        # geography(Point,4326). Longitude first: ST_MakePoint(x, y) is (lon, lat).
        geom = ("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography"
                % (repr(r["lon"]), repr(r["lat"])))
        cid = str(r["collateral_id"])
        update = derived.get(cid, {})
        values.append("  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)" % (
            sql_literal(cid), sql_literal(r["address_line"]),
            sql_literal(r["cluster_name"]), sql_literal(r["country"]), geom,
            sql_literal(r["building_type"]), sql_literal(r["occupancy_class"]),
            sql_literal(r["appraised_value_sgd"]), sql_literal(r["floor_level"]),
            sql_literal(r["elevation_m"]), sql_literal(r["dist_to_coast_km"]),
            sql_literal(r["adaptation_project_id"]),
            sql_literal(bool(update.get("landslide_flag", False))),
            sql_literal(update.get("slope_deg")),
            sql_literal(thumbs.get(cid))))
    out.append(",\n".join(values))
    out.append("ON CONFLICT (id) DO UPDATE SET")
    out.append("  address_line = EXCLUDED.address_line, cluster_name = EXCLUDED.cluster_name,")
    out.append("  country = EXCLUDED.country, geom = EXCLUDED.geom,")
    out.append("  building_type = EXCLUDED.building_type,")
    out.append("  occupancy_class = EXCLUDED.occupancy_class,")
    out.append("  appraised_value_sgd = EXCLUDED.appraised_value_sgd,")
    out.append("  floor_level = EXCLUDED.floor_level, elevation_m = EXCLUDED.elevation_m,")
    out.append("  dist_to_coast_km = EXCLUDED.dist_to_coast_km,")
    out.append("  adaptation_project_id = EXCLUDED.adaptation_project_id,")
    out.append("  landslide_flag = EXCLUDED.landslide_flag, slope_deg = EXCLUDED.slope_deg,")
    out.append("  satellite_thumb_path = EXCLUDED.satellite_thumb_path;")
    out.append("")

    # A short seed applies silently without this: 199 rows is a valid INSERT and
    # every downstream count would simply be wrong. `tests/prep/test_clean_machine.py`
    # asserts this guard is present, so it cannot be dropped by a regeneration.
    out.append("-- expected 200 collateral pins; a short seed must fail here rather than")
    out.append("-- leave every downstream count quietly wrong.")
    out.append("DO $$")
    out.append("DECLARE n INTEGER;")
    out.append("BEGIN")
    out.append("  SELECT count(*) INTO n FROM collateral;")
    out.append("  IF n <> %d THEN" % len(rows))
    out.append("    RAISE EXCEPTION 'expected %d collateral pins, found %%', n;" % len(rows))
    out.append("  END IF;")
    out.append("END $$;")
    out.append("")

    out.append("INSERT INTO loan_applications (")
    out.append("  id, applicant_id, collateral_id, segment, requested_amount,")
    out.append("  originated_year, base_ltv_override, status, opened_at")
    out.append(") VALUES")
    values = ["  (%s, %s, %s, %s, %s, %s, NULL, %s, %s)" % (
        sql_literal(r["loan_application_id"]), sql_literal(r["applicant_id"]),
        sql_literal(r["collateral_id"]), sql_literal(r["segment"]),
        sql_literal(r["requested_amount_sgd"]), sql_literal(r["originated_year"]),
        sql_literal(r["status"]), sql_literal(r["opened_at"])) for r in rows]
    out.append(",\n".join(values))
    out.append("ON CONFLICT (id) DO UPDATE SET")
    out.append("  applicant_id = EXCLUDED.applicant_id,")
    out.append("  collateral_id = EXCLUDED.collateral_id, segment = EXCLUDED.segment,")
    out.append("  requested_amount = EXCLUDED.requested_amount,")
    out.append("  originated_year = EXCLUDED.originated_year,")
    out.append("  base_ltv_override = EXCLUDED.base_ltv_override,")
    out.append("  status = EXCLUDED.status, opened_at = EXCLUDED.opened_at;")
    out.append("")
    return "\n".join(out)


def write_seed_sql(rows: Sequence[Dict[str, object]], repo: str) -> str:
    path = os.path.join(repo, "db", "seed", "03_portfolio.sql")
    directory = os.path.dirname(path)
    if not os.path.isdir(directory):
        os.makedirs(directory)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(portfolio_sql(rows, repo))
    return path

if __name__ == "__main__":
    raise SystemExit(main())
