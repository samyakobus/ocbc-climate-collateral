/**
 * tests/db/thumbnails.test.ts - S43. AC-11 and AC-12.
 *
 * Every one of the 200 properties has a satellite thumbnail, and every one of
 * those paths resolves to a real JPEG that is committed to this repository.
 *
 * The point is narrower than "the column is populated". A path column is the
 * easiest thing in the schema to get wrong in a way nothing notices: it is a
 * string, so any string satisfies the type, and a case screen renders a broken
 * image rather than throwing. That failure surfaces on a projector.
 *
 * So this walks the filesystem, not just the table. A row whose file was never
 * committed is exactly the AC-13 failure a clean clone would hit, and it is
 * caught here in two seconds instead of on a second laptop on Day 5.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pool } from '@/lib/db/client';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public');

/** Below this a file is an error page or a placeholder, not imagery. */
const MIN_BYTES = 512;

/*
  The blank-image thresholds, and they are the same three numbers
  `prep/fetch_thumbs.py` and `app/api/refresh/thumbs/route.ts` apply. Restated
  here rather than imported because this test's job is to catch a committed
  artefact that drifted from them; importing the constants would make it agree
  with a changed pipeline instead of noticing.

  Set from measurement over all 200 pins on 2026-09-09: real imagery reads 48.7
  to 242.9 at 99% coverage or better, a black MODIS tile read 0.0, cloud read
  251 to 255, and an out-of-swath HLS tile read 0% opaque.
*/
const LUMINANCE_FLOOR = 12;
const LUMINANCE_CEILING = 245;

/** `data/frozen/satellite_thumbs.csv`, the manifest the seed was built from. */
type ManifestRow = Record<string, string>;

function manifest(): ManifestRow[] {
  const text = readFileSync(join(ROOT, 'data/frozen/satellite_thumbs.csv'), 'utf8').trim();
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ''])) as ManifestRow;
  });
}

const EXPECTED_PINS = 200;

type Row = {
  id: string;
  satellite_thumb_path: string | null;
  satellite_thumb_url: string | null;
};

async function collateral(): Promise<Row[]> {
  const { rows } = await pool().query<Row>(
    `SELECT id, satellite_thumb_path, satellite_thumb_url FROM collateral ORDER BY id`,
  );
  return rows;
}

describe('S43: the per-property satellite thumbnail', () => {
  it('gives all 200 pins a cached path', async () => {
    const rows = await collateral();
    expect(rows).toHaveLength(EXPECTED_PINS);

    const missing = rows.filter((r) => !r.satellite_thumb_path);
    expect(
      missing.map((r) => r.id),
      `${missing.length} pin(s) have no thumbnail path`,
    ).toEqual([]);
  });

  it('points every path at a file that is actually committed', async () => {
    const rows = await collateral();

    const absent = rows
      .map((r) => r.satellite_thumb_path!)
      .filter((path) => !existsSync(join(PUBLIC, path.replace(/^\//, ''))));

    expect(
      absent.slice(0, 5),
      `${absent.length} thumbnail file(s) named by the database are not on disk. ` +
        'The seed was regenerated and the images were not committed.',
    ).toEqual([]);
  });

  it('serves a real JPEG at every one of those paths', async () => {
    const rows = await collateral();

    const problems: string[] = [];

    for (const row of rows) {
      const file = join(PUBLIC, row.satellite_thumb_path!.replace(/^\//, ''));
      const size = statSync(file).size;

      if (size < MIN_BYTES) {
        problems.push(`${row.id}: only ${size} bytes`);
        continue;
      }

      // JPEG magic. A committed HTML error page would pass a size check.
      const head = readFileSync(file).subarray(0, 2);
      if (head[0] !== 0xff || head[1] !== 0xd8) {
        problems.push(`${row.id}: not a JPEG`);
      }
    }

    expect(problems.slice(0, 5), `${problems.length} thumbnail(s) are not imagery`).toEqual([]);
  });

  it('keeps every path under the cache directory the app serves', async () => {
    const rows = await collateral();

    /*
      A path outside `/cache/thumbs/` would either 404 or, worse, escape the
      public root. The case screen renders this value straight into an `img`
      src, so it is the one column where a stray `..` matters.
    */
    const stray = rows
      .map((r) => r.satellite_thumb_path!)
      .filter((path) => !path.startsWith('/cache/thumbs/') || path.includes('..'));

    expect(stray.slice(0, 5), `${stray.length} path(s) are outside the cache`).toEqual([]);
  });

  it('names a source URL the refresh route can follow', async () => {
    const rows = await collateral();

    /*
      `/api/refresh/thumbs` re-fetches the stored URL rather than composing one,
      so a NULL here is not an error but it does mean that property cannot be
      refreshed. Under the frozen and live paths every row has one; the
      synthetic floor has none, and this test says which world it is in rather
      than asserting one of them blindly.
      */
    const withUrl = rows.filter((r) => r.satellite_thumb_url);

    if (withUrl.length === 0) {
      expect(
        rows.every((r) => r.satellite_thumb_path?.includes('-')),
        'the synthetic floor still writes a hashed path per pin',
      ).toBe(true);
      return;
    }

    expect(withUrl).toHaveLength(EXPECTED_PINS);
    for (const row of withUrl.slice(0, 5)) {
      expect(row.satellite_thumb_url, `${row.id} source URL`).toMatch(/^https?:\/\//);
    }

    // The key must never reach a committed column.
    const leaked = withUrl.filter((r) => /[?&]key=/.test(r.satellite_thumb_url!));
    expect(leaked.map((r) => r.id), 'an API key leaked into satellite_thumb_url').toEqual([]);
  });

  it('gives each property its own file, so a refresh moves one and not the book', async () => {
    const rows = await collateral();

    const paths = rows.map((r) => r.satellite_thumb_path!);
    expect(new Set(paths).size, 'two properties share a thumbnail file').toBe(EXPECTED_PINS);

    /*
      Pixels may repeat between neighbours; FILE NAMES must not. The refresh
      route writes a new file per property, and a shared name would let one
      property's refresh overwrite another's picture.
    */
    for (const row of rows) {
      expect(row.satellite_thumb_path, `${row.id} path`).toContain(row.id);
    }
  });

  /**
   * No committed thumbnail is blank, which is the defect this file grew for.
   *
   * The MODIS tile at z8/x201/y127 on 2026-09-08 decoded as a uniformly black
   * square, mean luminance 0.0. It was a valid JPEG of the right size, so the
   * size check and the magic-byte check above both passed it, and it was the
   * image shared by all 60 Singapore and 8 Johor Bahru pins including the
   * fixture `SG-EC-001`, which is the first case screen the demo opens.
   *
   * The luminance is read from the manifest rather than recomputed, because
   * decoding a JPEG needs a library that is not a dependency of this project's
   * Node side. The manifest is written by the same run that wrote the files, and
   * the row-to-file correspondence is asserted separately, so a drift between
   * them cannot hide here: `prep/fetch_thumbs.py` is where the pixels are
   * measured, and `tests/prep/test_clean_machine.py` decodes them for real.
   */
  it('has no blank thumbnail, black or white', async () => {
    const rows = manifest();
    expect(rows).toHaveLength(EXPECTED_PINS);

    const blank = rows
      .map((r) => ({ id: r.collateral_id, lum: Number(r.mean_luminance) }))
      .filter((r) => !Number.isFinite(r.lum) || r.lum < LUMINANCE_FLOOR || r.lum > LUMINANCE_CEILING);

    expect(
      blank.slice(0, 5),
      `${blank.length} thumbnail(s) are blank. Below ${LUMINANCE_FLOOR} is a black ` +
        `square, above ${LUMINANCE_CEILING} is a white one, and both read as a broken ` +
        'image on a case screen.',
    ).toEqual([]);
  });

  it('records which layer served each property, so the panel can say what it is', async () => {
    const rows = manifest();

    /*
      The layer is not decoration. A pin on MODIS is a 156 km regional view and
      a pin on HLS is a 9.8 km one, and the provenance panel has to be able to
      tell a director which they are looking at.
    */
    const missing = rows.filter((r) => !r.layer || !r.capture_date).map((r) => r.collateral_id);
    expect(missing.slice(0, 5), `${missing.length} row(s) name no layer or date`).toEqual([]);

    const byLayer = new Map<string, number>();
    for (const row of rows) byLayer.set(row.provider, (byLayer.get(row.provider) ?? 0) + 1);

    // At least most of the book should be on a fine layer; a run that quietly
    // fell all the way back to MODIS for everything is the regression to catch.
    const coarse = [...byLayer.entries()]
      .filter(([name]) => name.includes('MODIS'))
      .reduce((sum, [, n]) => sum + n, 0);

    expect(
      coarse / rows.length,
      `${coarse} of ${rows.length} pins fell back to MODIS. The HLS rungs are the ` +
        'point of the ladder; check whether GIBS stopped serving them.',
    ).toBeLessThanOrEqual(0.25);
  });

  /**
   * The fidelity cap.
   *
   * Neighbouring properties sharing a picture is expected and fine: the source
   * is a satellite tile, not a photograph of a building. What is NOT fine is the
   * state this replaced, where a single MODIS tile at zoom 8 covered 156 km and
   * one image served 68 of 200 pins, every Singapore and Johor Bahru property
   * included. On a case screen that reads as a stub.
   *
   * Measured after the move to HLS at zoom 12: 33 distinct images, most-shared
   * 26 pins (13%). The cap is set at 20%, which leaves headroom for a rerun on a
   * cloudier week without admitting a return to one-tile-per-country.
   */
  it('does not let one image cover more than a fifth of the book', async () => {
    const rows = await collateral();

    const counts = new Map<string, number>();
    for (const row of rows) {
      const file = join(PUBLIC, row.satellite_thumb_path!.replace(/^\//, ''));
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
      counts.set(digest, (counts.get(digest) ?? 0) + 1);
    }

    const worst = Math.max(...counts.values());
    const share = worst / rows.length;

    expect(
      counts.size,
      `only ${counts.size} distinct images across ${rows.length} pins`,
    ).toBeGreaterThanOrEqual(20);

    expect(
      share,
      `one image covers ${worst} of ${rows.length} pins (${(share * 100).toFixed(1)}%). ` +
        'The thumbnail has collapsed back towards one tile per country; check which ' +
        'layer prep/fetch_thumbs.py fell back to.',
    ).toBeLessThanOrEqual(0.2);
  });
});
