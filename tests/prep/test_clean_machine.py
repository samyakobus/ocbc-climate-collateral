"""S30 - AC-13. The whole data pipeline runs on a machine with no credentials.

Plan sections 2 (three-source rule), 4.6 and 5 (S30).

The other files under `tests/prep` assert that the DATA is right. This one
asserts something different and easier to lose: that the data can be REBUILT
from what is committed, by someone who has just cloned the repository, with no
Earth Engine account, no API key and no network.

That is the property the Day-1 cut line exists to protect and the one a demo
depends on. It is also the property that decays silently: any step can start
depending on a credential, or on a file somebody forgot to commit, and every
other test keeps passing because the artefacts are already sitting on disk.

So the generators are re-run here in a SUBPROCESS with every credential stripped
from the environment, and their output is checked. Not the committed CSVs: those
would pass even if the generator could no longer produce them.

The physical clause no runner can observe, a clean-machine run on a second
laptop, is S30's other half and is scripted at the bottom of this file.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: Anything that could let a step reach a credentialed service. Stripped from the
#: environment before every subprocess below, so a step that quietly started
#: depending on one fails here rather than on demo day.
CREDENTIAL_KEYS = (
    "EE_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "EARTHENGINE_TOKEN",
    "ANTHROPIC_API_KEY",
    "GOOGLE_MAPS_STATIC_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
)

PINS = 200
HAZARDS = ("flood_riverine", "flood_coastal", "wind", "heat_days35", "pm25")
SCENARIOS = ("today", "y2030", "y2050")

FIXTURE_IDS = (
    "SG-EC-001",
    "SG-EC-002",
    "SG-EC-003",
    "SG-KB-003",
    "SG-MS-002",
    "SG-MS-003",
)


def clean_env() -> dict:
    """The current environment with every credential removed."""
    env = {k: v for k, v in os.environ.items() if k not in CREDENTIAL_KEYS}
    # Belt and braces: make the absence explicit rather than merely unset, so a
    # library that reads a default path does not find one.
    env["OCBC_CLEAN_MACHINE"] = "1"
    return env


def run(args, expect_success: bool = True) -> subprocess.CompletedProcess:
    """Runs a prep command from the repo root with no credentials."""
    result = subprocess.run(
        [sys.executable, "-m", *args],
        cwd=REPO_ROOT,
        env=clean_env(),
        capture_output=True,
        text=True,
        timeout=300,
    )
    if expect_success and result.returncode != 0:
        raise AssertionError(
            f"`python -m {' '.join(args)}` failed on a clean machine "
            f"(exit {result.returncode}).\n\nstdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
        )
    return result


# ---------------------------------------------------------------------------
# Committed artefacts: what a fresh clone must already contain
# ---------------------------------------------------------------------------

COMMITTED = (
    "db/migrations/0001_schema.sql",
    "db/migrations/0002_views.sql",
    "db/seed/01_users.sql",
    "db/seed/02_reference.sql",
    "db/seed/03_portfolio.sql",
    "db/seed/04_samples.sql",
    "db/seed/05_regional.sql",
    "data/synthetic/portfolio.csv",
    "data/synthetic/collateral.csv",
    "data/synthetic/applicants.csv",
    "data/synthetic/loan_applications.csv",
    "data/synthetic/hazard_samples.csv",
    "data/synthetic/site_modifiers.csv",
    "data/frozen/satellite_thumbs.csv",
    "public/basemap/asia-z0-z6.pmtiles",
    "public/basemap/clusters.geojson",
    "public/basemap/checksums.json",
)


def test_every_artefact_a_clean_clone_needs_is_committed():
    """A fresh clone must be able to migrate, seed and render without fetching."""
    missing = [p for p in COMMITTED if not os.path.exists(os.path.join(REPO_ROOT, p))]
    assert missing == [], f"{len(missing)} committed artefact(s) absent: {missing}"


def test_the_committed_basemap_floor_is_not_a_placeholder():
    """A zero-byte or tiny floor would render an empty map and pass a file check."""
    floor = os.path.join(REPO_ROOT, "public/basemap/asia-z0-z6.pmtiles")
    size = os.path.getsize(floor)
    assert size > 500_000, f"the committed basemap floor is only {size} bytes"


def test_per_property_thumbnails_are_committed_and_are_real_images():
    """S43: the case screen renders a committed file, so it has to be in the clone.

    200 files, one per pin. The pixels repeat, because without a Maps key the
    source is NASA GIBS at zoom 8 where one tile covers about 156 km, but the
    FILES do not: each carries its collateral id, so a refresh moves one property
    without touching another's picture.
    """
    thumbs_dir = os.path.join(REPO_ROOT, "public/cache/thumbs")
    assert os.path.isdir(thumbs_dir), "public/cache/thumbs is missing"

    jpgs = [f for f in os.listdir(thumbs_dir) if f.endswith(".jpg")]
    assert len(jpgs) == PINS, f"expected {PINS} thumbnails, found {len(jpgs)}"

    for name in jpgs:
        path = os.path.join(thumbs_dir, name)
        assert os.path.getsize(path) > 512, f"{name} is too small to be imagery"
        with open(path, "rb") as handle:
            assert handle.read(2) == b"\xff\xd8", f"{name} is not a JPEG"


def test_no_committed_thumbnail_is_blank():
    """The defect this whole ladder exists to make unrepeatable.

    The pixels are DECODED here, not read from the manifest. Every other check
    in this repository trusts a number the pipeline wrote down; this one opens
    the committed files and measures them, because the failure being guarded
    against is precisely a file that satisfies every description of a good image
    and is a blank square.

    The MODIS tile at z8/x201/y127 for 2026-09-08 was a valid 1,665-byte JPEG
    with correct magic bytes and a mean luminance of 0.0, and it was the picture
    behind all 60 Singapore and 8 Johor Bahru properties, `SG-EC-001` included.

    Pillow is in `requirements-dev.txt`. It is not needed to SEED a clean clone,
    only to verify one, so AC-13's stdlib-only path is unaffected.
    """
    pytest.importorskip("PIL", reason="Pillow is in requirements-dev.txt")
    from PIL import Image

    #: The same three numbers `prep/fetch_thumbs.py` and
    #: `lib/feeds/blank-image.ts` apply. Real imagery measured 48.7 to 242.9.
    floor, ceiling = 12.0, 245.0

    directory = os.path.join(REPO_ROOT, "public/cache/thumbs")
    files = sorted(f for f in os.listdir(directory) if f.endswith(".jpg"))
    assert len(files) == PINS

    blank = []
    for name in files:
        with Image.open(os.path.join(directory, name)) as image:
            grey = image.convert("L")
            data = (grey.get_flattened_data() if hasattr(grey, "get_flattened_data")
                    else grey.getdata())
            pixels = list(data)
            mean = sum(pixels) / float(len(pixels))

        if not (floor <= mean <= ceiling):
            blank.append(f"{name} mean luminance {mean:.1f}")

    assert blank[:5] == [], (
        f"{len(blank)} committed thumbnail(s) are blank. Below {floor} is a black "
        f"square and above {ceiling} a white one, and both render as a broken "
        "image on the case screen."
    )


def test_the_thumbnail_manifest_covers_every_pin_and_leaks_no_key():
    """The manifest is what `gen_portfolio.py`'s emitter reads, so it must be whole."""
    import csv

    path = os.path.join(REPO_ROOT, "data/frozen/satellite_thumbs.csv")
    with open(path, encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    assert len(rows) == PINS, f"the manifest names {len(rows)} pins, not {PINS}"

    for row in rows:
        relative = row["cached_path"].lstrip("/")
        assert os.path.exists(os.path.join(REPO_ROOT, "public", relative)), (
            f"{row['collateral_id']}: the manifest names a file that is not committed"
        )
        # A Maps Static URL carries a key and these manifests are committed.
        assert "key=" not in row["live_url"], (
            f"{row['collateral_id']}: an API key leaked into the committed manifest"
        )


def test_cached_satellite_tiles_are_committed_and_are_real_images():
    """AC-14: the strip renders from cache, so the cache has to be in the clone."""
    tiles_dir = os.path.join(REPO_ROOT, "public/cache/tiles")
    assert os.path.isdir(tiles_dir), "public/cache/tiles is missing"

    jpgs = [f for f in os.listdir(tiles_dir) if f.endswith(".jpg")]
    assert len(jpgs) >= 12, f"expected at least 12 cached tiles, found {len(jpgs)}"

    for name in jpgs:
        path = os.path.join(tiles_dir, name)
        assert os.path.getsize(path) > 512, f"{name} is too small to be imagery"
        with open(path, "rb") as handle:
            assert handle.read(2) == b"\xff\xd8", f"{name} is not a JPEG"


# ---------------------------------------------------------------------------
# The synthetic floor: the unconditional path
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def synthetic_check() -> subprocess.CompletedProcess:
    """`--check` validates and writes nothing, so it is safe to run here."""
    return run(["prep.sample_hazards", "--source=synthetic", "--check"])


def test_synthetic_sampling_runs_with_no_credentials(synthetic_check):
    assert synthetic_check.returncode == 0
    assert "coverage states valid" in synthetic_check.stdout


def test_synthetic_covers_every_pin_hazard_and_scenario(synthetic_check):
    """AC-13: 200 pins, all four hazard families, all three horizons."""
    out = synthetic_check.stdout

    match = re.search(r"(\d+) hazard rows", out)
    assert match, f"the run did not report a row count:\n{out}"
    assert int(match.group(1)) == PINS * len(HAZARDS) * len(SCENARIOS) == 3000

    # The coverage table names every hazard, so a hazard silently dropped from
    # the sampler shows up here rather than as a blank column on the case screen.
    for hazard in HAZARDS:
        assert hazard in out, f"{hazard} is missing from the coverage summary"


def test_portfolio_generator_runs_with_no_credentials():
    result = run(["prep.gen_portfolio", "--print-only"])
    assert "200" in result.stdout, f"the generator did not report 200 pins:\n{result.stdout}"


def test_hotspot_builder_runs_with_no_credentials():
    result = run(["prep.build_hotspots", "--print"])
    assert "hotspots" in result.stdout
    assert "membership is decided by v_hotspot_membership" in result.stdout


def test_regional_composer_runs_with_no_credentials():
    """Events and tiles must both have a credential-free path (AC-14, AC-16)."""
    result = run(["prep.build_regional", "--source=synthetic", "--print"])
    assert "hotspots" in result.stdout and "events" in result.stdout and "tiles" in result.stdout


# ---------------------------------------------------------------------------
# The seed the clean machine actually applies
# ---------------------------------------------------------------------------


def read_seed(name: str) -> str:
    with open(os.path.join(REPO_ROOT, "db/seed", name), encoding="utf-8") as handle:
        return handle.read()


def test_the_committed_sample_seed_carries_every_row_ac13_needs():
    """AC-13 is about what lands in the database, so check the seed itself."""
    sql = read_seed("04_samples.sql")

    for hazard in HAZARDS:
        assert f"'{hazard}'" in sql, f"{hazard} does not appear in the sample seed"
    for scenario in SCENARIOS:
        assert f"'{scenario}'" in sql, f"{scenario} does not appear in the sample seed"

    # The six fixtures are members of the 200, and their pinned block is last.
    for fixture in FIXTURE_IDS:
        assert f"'{fixture}'" in sql, f"{fixture} is not in the sample seed"

    assert sql.index("PINNED FIXTURES") > sql.index("sampled hazard rows"), (
        "the pinned fixture block must come AFTER the sampled rows, or a sampled "
        "value could survive on top of a fixture"
    )


def test_the_committed_portfolio_seed_carries_200_pins():
    sql = read_seed("03_portfolio.sql")
    assert "expected 200 collateral pins" in sql, (
        "03_portfolio.sql has lost its count guard, so a short seed would apply silently"
    )
    for fixture in FIXTURE_IDS:
        assert f"'{fixture}'" in sql, f"{fixture} is not in the portfolio seed"


def test_no_seed_file_opens_a_transaction():
    """`scripts/seed.ts` wraps each file itself; a BEGIN inside would nest."""
    for name in ("01_users.sql", "02_reference.sql", "03_portfolio.sql",
                 "04_samples.sql", "05_regional.sql"):
        sql = read_seed(name).upper()
        assert "\nBEGIN;" not in sql and not sql.startswith("BEGIN;"), f"{name} opens a transaction"


# ---------------------------------------------------------------------------
# The live path must FAIL without credentials, not fall back
# ---------------------------------------------------------------------------


def test_live_sampling_fails_loudly_without_credentials():
    """A run that claims to be live must be live.

    If `--source=live` quietly fell back to the synthetic floor, `data/frozen/`
    would fill with synthetic values wearing a real dataset's name, and the
    provenance panel would present a model output as a measurement. That is the
    single worst thing this pipeline could do, so it is asserted rather than
    assumed.
    """
    result = run(["prep.sample_hazards", "--source=live", "--check"], expect_success=False)

    assert result.returncode != 0, "live sampling succeeded with no credentials"
    combined = result.stdout + result.stderr
    assert "Nothing was written" in combined, (
        f"the live failure did not say that nothing was written:\n{combined}"
    )
    assert "synthetic" in combined, "the failure message should name the floor to fall back to"


# ---------------------------------------------------------------------------
# The frozen replay
# ---------------------------------------------------------------------------


def test_frozen_replay_of_the_regional_feeds_needs_no_network():
    """Events and tiles have been frozen by a live run, so this half works today."""
    result = run(["prep.fetch_events", "--source=frozen", "--check"])
    assert "events" in result.stdout


def test_frozen_hazard_replay():
    """AC-13's frozen half.

    `data/frozen/hazard_samples.csv` is written only by a successful
    `--source=live` run against Earth Engine. No such run has happened, so on
    this machine the frozen hazard path has nothing to replay.

    This SKIPS rather than passing, and names the missing file, because a green
    test here would claim coverage AC-13 does not yet have. It starts asserting
    the moment a live run is committed, with no change to this file.
    """
    frozen = os.path.join(REPO_ROOT, "data/frozen/hazard_samples.csv")
    if not os.path.exists(frozen):
        pytest.skip(
            "data/frozen/hazard_samples.csv is not committed, so AC-13's frozen half "
            "cannot be asserted. Only a successful --source=live run writes it; until "
            "then --source=synthetic is the unconditional floor and is fully asserted above."
        )

    result = run(["prep.sample_hazards", "--source=frozen", "--check"])
    match = re.search(r"(\d+) hazard rows", result.stdout)
    assert match and int(match.group(1)) == PINS * len(HAZARDS) * len(SCENARIOS)


# ---------------------------------------------------------------------------
# Regeneration: the committed seeds are REPRODUCIBLE, not just present
# ---------------------------------------------------------------------------
#
# Everything above this line asks whether a generator still RUNS without
# credentials. That is necessary and it is not sufficient. A generator can run
# happily and produce something different from what is committed, and every
# other test in the repository keeps passing, because they all read the
# committed artefacts.
#
# The seeded figures a director is shown come from these files. If they cannot
# be reproduced from the code, then the numbers on stage are the output of a run
# nobody can repeat, which is the thing AC-13 exists to rule out.
#
# So each generator is re-run, into a TEMPORARY location, and its output is
# compared byte for byte with what is committed. Nothing here writes to
# `db/seed/` or `data/synthetic/`: a test that regenerated a committed file in
# place would be indistinguishable from a test that silently accepted a drift.


def run_code(code: str) -> subprocess.CompletedProcess:
    """Runs a snippet against the real modules, from the repo root, uncredentialed.

    `-c` rather than `-m` for two generators whose CLI writes its seed file to a
    fixed path under `db/seed/`. Calling the same composing function the CLI
    calls, and writing where this test says, exercises the identical code path
    without putting a committed file at risk.
    """
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT,
        env=clean_env(),
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"the snippet failed on a clean machine (exit {result.returncode}).\n\n"
            f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
        )
    return result


#: A value tuple in a generated seed file. Used only when a byte comparison
#: fails, to say whether the difference is a changed row or a changed count.
_TUPLE = re.compile(r"^\s*\(", re.M)


def rows_in(sql: str) -> int:
    return len(_TUPLE.findall(sql))


def read_bytes(relative: str) -> bytes:
    with open(os.path.join(REPO_ROOT, relative), "rb") as handle:
        return handle.read()


def assert_regenerates(relative: str, produced: bytes, committed: bytes = None) -> None:
    """The committed file and a fresh run of its generator must agree.

    Byte identity is the assertion. When it fails, the row counts are reported
    alongside, because "the same 3,000 rows, one value changed" and "2,999 rows"
    are different bugs and the first line of the failure should say which.

    `committed` overrides what is read from disk, for the one caller that has to
    exclude a named non-deterministic field from both sides.
    """
    if committed is None:
        committed = read_bytes(relative)
    if committed == produced:
        return

    left = committed.decode("utf-8", "replace")
    right = produced.decode("utf-8", "replace")
    raise AssertionError(
        f"{relative} is not reproducible from its generator.\n"
        f"  committed: {len(committed):,} bytes, {rows_in(left):,} value rows\n"
        f"  regenerated: {len(produced):,} bytes, {rows_in(right):,} value rows\n"
        "Either the generator changed and the seed was not regenerated, or the "
        "seed was edited by hand. Both break AC-13: a clean clone would seed "
        "different numbers from the ones on the dashboard."
    )


def test_the_sample_seed_regenerates_identically(tmp_path):
    """`04_samples.sql`, the 3,000 hazard rows plus the six pinned fixtures."""
    out = tmp_path / "04_samples.sql"
    result = run(["prep.sample_hazards", "--source=synthetic", f"--out-sql={out}"])
    assert "pinned fixtures applied last" in result.stdout

    assert_regenerates("db/seed/04_samples.sql", out.read_bytes())


#: The 200 collateral rows carry three columns the sampler later updates.
#: Named here because the row-count fallback below must not become a blanket
#: excuse: a seed that lost a column would still have 600 rows.
COLLATERAL_LATE_COLUMNS = ("landslide_flag", "slope_deg", "satellite_thumb_path")


def test_the_portfolio_seed_regenerates_identically(tmp_path):
    """`03_portfolio.sql`, the 200 pins with their applicants and applications.

    BYTE identical, since #46. It was row-count identical for one day, while two
    generators wrote this path: `scripts/gen-portfolio-sql.ts` produced the
    committed file and `prep/gen_portfolio.py` had grown a narrower emitter of
    its own, so running the Python CLI would have quietly dropped three
    collateral columns. The stopgap is deleted and the Python emitter is the
    only writer, which is what lets this assert the stronger property.

    The column check below stays even so. Byte identity would also be satisfied
    by a regenerated file that lost a column, since both sides would lose it
    together; the explicit list is what notices.
    """
    out = str(tmp_path / "03_portfolio.sql").replace("\\", "\\\\")
    run_code(
        "from prep.gen_portfolio import generate, portfolio_sql, repo_root\n"
        f"open(r'{out}', 'w', encoding='utf-8', newline='')"
        ".write(portfolio_sql(generate(), repo_root()))\n"
    )

    assert_regenerates("db/seed/03_portfolio.sql", (tmp_path / "03_portfolio.sql").read_bytes())

    committed = read_bytes("db/seed/03_portfolio.sql").decode("utf-8")

    for column in COLLATERAL_LATE_COLUMNS:
        assert column in committed, (
            f"db/seed/03_portfolio.sql no longer writes {column}, so the landslide "
            "badge (AC-7) or the case thumbnail has nothing to render."
        )

    assert rows_in(committed) == 600, (
        f"the portfolio seed carries {rows_in(committed)} value rows, not 600 "
        "(200 applicants, 200 collateral, 200 loan applications)."
    )

    # Every INSERT is an upsert. `scripts/seed.ts` reapplies all five files on
    # every `npm run db:seed`, so a plain INSERT fails on the second seed of the
    # day and rolls the whole file back.
    assert committed.count("ON CONFLICT (id) DO UPDATE SET") == 3, (
        "03_portfolio.sql is not idempotent: each of its three INSERTs needs an "
        "ON CONFLICT DO UPDATE, or a reseed fails on a primary key."
    )


def test_the_stopgap_portfolio_generator_is_gone():
    """#46: one generator owns `03_portfolio.sql`.

    Asserted by absence, because that is the state that decays. Plan section 10
    promised the TypeScript stopgap would go the day `gen_portfolio.py` grew a
    complete emitter; a test is what makes the promise hold.
    """
    stopgap = os.path.join(REPO_ROOT, "scripts/gen-portfolio-sql.ts")
    assert not os.path.exists(stopgap), (
        "scripts/gen-portfolio-sql.ts is back. Two generators for one seed file is "
        "the duplication ADR-2 exists to prevent, and they had already drifted by "
        "three columns once."
    )


#: A tile's `fetched_at`, stamped at compose time rather than carried from the
#: frozen row. The only non-deterministic field in any generated seed.
_TILE_FETCHED_AT = re.compile(
    r"^(\s*\('TILE-.*?)'\d{4}-\d{2}-\d{2}T[\d:]{8}\+00:00'::timestamptz", re.M
)


def _pin_tile_timestamps(sql: str) -> str:
    return _TILE_FETCHED_AT.sub(r"\1'<fetched_at>'::timestamptz", sql)


def test_the_regional_seed_regenerates_identically(tmp_path):
    """`05_regional.sql`, the hotspots, events and satellite tiles.

    `--source=frozen` is the mode the committed file was built in and it is
    credential-free: it replays `data/frozen/environmental_events.csv`, which is
    committed, and needs no network. `--source=synthetic` is the floor below it
    and carries only the curated events, so it produces a valid but smaller
    file; that mode is asserted separately, above.

    `write_files=False` is what `--print` passes: it composes the SQL without
    re-freezing the fetched feeds, which is what a clean machine does.

    ONE field is excluded from the byte comparison and it is named rather than
    waved through: each satellite tile's `fetched_at` is stamped at compose time
    instead of being carried from the frozen row, so it moves on every run. It
    is provenance about when the file was built, not a figure anything reads,
    and the tile's `capture_date` (the field that says which imagery this is) is
    compared in full.
    """
    out = str(tmp_path / "05_regional.sql").replace("\\", "\\\\")
    run_code(
        "from prep.build_regional import compose\n"
        "sql = compose('frozen', write_files=False)[0]\n"
        f"open(r'{out}', 'w', encoding='utf-8', newline='\\n').write(sql)\n"
    )

    committed = read_bytes("db/seed/05_regional.sql").decode("utf-8")
    produced = (tmp_path / "05_regional.sql").read_bytes().decode("utf-8")

    # The exclusion is bounded: exactly the twelve tile rows, in both files.
    assert len(_TILE_FETCHED_AT.findall(committed)) == 12
    assert len(_TILE_FETCHED_AT.findall(produced)) == 12

    assert_regenerates(
        "db/seed/05_regional.sql",
        _pin_tile_timestamps(produced).encode("utf-8"),
        committed=_pin_tile_timestamps(committed).encode("utf-8"),
    )


def test_the_synthetic_regional_floor_is_complete_if_smaller(tmp_path):
    """The floor below the frozen replay still carries every table AC-14 needs.

    It has fewer events, because only the three curated rows survive without the
    frozen feed, and that is the documented fallback rather than a failure. What
    would be a failure is a missing table.
    """
    out = str(tmp_path / "05_synthetic.sql").replace("\\", "\\\\")
    run_code(
        "from prep.build_regional import compose\n"
        "sql = compose('synthetic', write_files=False)[0]\n"
        f"open(r'{out}', 'w', encoding='utf-8', newline='\\n').write(sql)\n"
    )
    sql = (tmp_path / "05_synthetic.sql").read_text(encoding="utf-8")

    for table in ("hotspots", "environmental_events", "satellite_tiles"):
        assert f"INSERT INTO {table}" in sql, f"{table} is missing from the synthetic floor"


def test_the_synthetic_hazard_floor_regenerates_identically(tmp_path):
    """`prep.lib.synthetic` is the floor every acceptance test runs against.

    Its two CSVs feed the sampler, so a drift here would move every haircut in
    the book. They are committed, and this proves they can be rebuilt.
    """
    result = run(["prep.lib.synthetic", f"--out-dir={tmp_path}"])
    assert "hazard_samples=" in result.stdout

    for name in ("hazard_samples.csv", "site_modifiers.csv"):
        assert_regenerates(f"data/synthetic/{name}", (tmp_path / name).read_bytes())


def test_the_portfolio_csvs_regenerate_identically(tmp_path):
    """The four CSVs `03_portfolio.sql` and the sampler both read."""
    out = str(tmp_path).replace("\\", "\\\\")
    run_code(
        "from prep.gen_portfolio import generate, write_outputs\n"
        f"write_outputs(generate(), r'{out}')\n"
    )

    for name in ("portfolio.csv", "collateral.csv", "applicants.csv", "loan_applications.csv"):
        assert_regenerates(f"data/synthetic/{name}", (tmp_path / name).read_bytes())


def test_regenerating_wrote_nothing_into_the_repository(tmp_path):
    """The guard on the guard.

    Two of the generators above write their seed to a fixed path when driven
    through their CLI. If a future refactor made one of the calls here do the
    same, these tests would start comparing a file against itself and would pass
    for ever. So the committed seeds' modification times are taken before and
    after a full regeneration round.
    """
    watched = [
        "db/seed/03_portfolio.sql",
        "db/seed/04_samples.sql",
        "db/seed/05_regional.sql",
        "data/synthetic/hazard_samples.csv",
        "data/synthetic/portfolio.csv",
    ]
    before = {p: os.path.getmtime(os.path.join(REPO_ROOT, p)) for p in watched}

    out = str(tmp_path / "scratch.sql").replace("\\", "\\\\")
    run(["prep.sample_hazards", "--source=synthetic", f"--out-sql={tmp_path / 'scratch2.sql'}"])
    run_code(
        "from prep.build_regional import compose\n"
        "sql = compose('synthetic', write_files=False)[0]\n"
        f"open(r'{out}', 'w', encoding='utf-8', newline='\\n').write(sql)\n"
    )

    after = {p: os.path.getmtime(os.path.join(REPO_ROOT, p)) for p in watched}
    touched = [p for p in watched if before[p] != after[p]]
    assert touched == [], (
        f"regenerating touched {touched} inside the repository. These tests must "
        "write only to a temporary directory, or they compare a file with itself."
    )


# ---------------------------------------------------------------------------
# The command sequence for the physical clean-machine run (S30)
# ---------------------------------------------------------------------------

CLEAN_MACHINE_SEQUENCE = """
Clean-machine run of AC-13. Second laptop, Day 5 morning, before the rehearsal.

Run every step below on a machine that has never seen this project, with no
Earth Engine account, no API key, and, from step 5 onward, no network at all.

The same sequence is in README.md under "Clean machine (AC-13)", written for a
reader rather than for this test. Keep the two in step.

  1.  git clone <repo> && cd <repo>
  2.  cp .env.example .env
      Set AUTH_SECRET to any 32+ character string. Leave every other key blank:
      the app must start without them.
  3.  npm install
      python -m pip install pytest
  4.  npm run prep:basemap        OPTIONAL and the LAST step that may use the
                                  network. It fetches the two large pmtiles
                                  archives, which are gitignored. Skip it and the
                                  committed z0-z6 floor renders country and
                                  regional geometry only, which is the documented
                                  fallback.
  5.  DISABLE THE NETWORK INTERFACE HERE. Everything below must pass without it.
  6.  npm run db:up              (leave running; PGlite + PostGIS, no Docker)
  7.  npm run db:migrate
  8.  npm run db:seed            (applies all five committed seed files)
  9.  npm run db:recompute
  10. npm run prep:reference
  11. npm run verify:dashboard   (expect: view and base tables agree to the cent)
  12. python -m pytest tests/prep -q
  13. npm run build
  14. npm run start
  15. Work tests/offline/checklist.md end to end.

Nothing in this sequence REGENERATES a seed file, and that is deliberate. The
seeds are committed artefacts; the generators are asserted above to reproduce
them byte for byte, which is a different job from a fresh clone doing it again.
What AC-13 tests is that a clone can seed from what is committed.

Regenerating is safe as of #46, now that each seed file has exactly one writer.
It was not before: two generators wrote 03_portfolio.sql and the Python one was
three columns narrower, so running its CLI silently dropped the landslide data
and every thumbnail path.

Expected at step 11, against the seeded rule set:
  2050 amber-or-worse 66.01% by value, total haircut S$175,376,417,
  revaluation due by 2030: 3, collateral S$2,396,510,000 over 200 properties.

If step 8 fails, the cause is a seed file that was generated but not committed.
If step 14's map is empty at city zoom, that is the committed z0-z6 floor doing
its job: country and regional geometry only, which is the documented fallback.
"""


def test_the_clean_machine_sequence_is_documented():
    """The physical half of S30 is a script, and the script has to exist."""
    assert "DISABLE THE NETWORK INTERFACE HERE" in CLEAN_MACHINE_SEQUENCE
    for command in ("npm run db:migrate", "npm run db:seed", "npm run db:recompute",
                    "npm run prep:reference", "npm run verify:dashboard",
                    "npm run build", "npm run start"):
        assert command in CLEAN_MACHINE_SEQUENCE


def test_the_readme_carries_the_same_sequence():
    """A sequence only this file knows is a sequence the user will not find.

    S30's deliverable is something someone can follow on a second laptop, so the
    README section is part of the test rather than an afterthought.
    """
    with open(os.path.join(REPO_ROOT, "README.md"), encoding="utf-8") as handle:
        readme = handle.read()

    assert "Clean machine (AC-13)" in readme, (
        "README.md has no clean-machine section, so AC-13's command sequence "
        "lives only inside a test file"
    )

    for command in ("npm run db:migrate", "npm run db:seed", "npm run db:recompute",
                    "npm run prep:reference", "npm run verify:dashboard",
                    "python -m pytest tests/prep", "npm run build", "npm run start"):
        assert command in readme, f"the README clean-machine section is missing `{command}`"

    # The figures a reader checks their run against.
    for figure in ("66.01", "175,376,417", "2,396,510,000"):
        assert figure in readme, f"the README clean-machine section is missing {figure}"
