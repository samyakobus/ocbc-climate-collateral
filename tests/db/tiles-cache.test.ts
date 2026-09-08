/**
 * tests/db/tiles-cache.test.ts - S24. AC-14, and AC-11 by implication.
 *
 * The tile strip is the one part of the AI Dashboard that a director will see
 * fail if the network is down, so what this pins is not "the refresh works" but
 * **the strip renders without it**.
 *
 * The refresh route itself is exercised end to end by `tests/e2e/refresh.spec.ts`
 * against a running stack. Here the concern is the data contract underneath it:
 * every row points at a file that exists, the path is servable, and the columns
 * the failure path depends on are present and sane.
 */

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cachedPathFor, candidateDates, captureDateOf, withCaptureDate } from '../../lib/feeds/gibs';
import { dbOne, dbQuery } from '../setup/db';

const PUBLIC_ROOT = resolve(process.cwd(), 'public');

/** A tile smaller than this is an error page or a placeholder, not imagery. */
const MIN_TILE_BYTES = 512;

type TileRow = {
  id: string;
  region: string;
  bbox: string;
  cached_path: string;
  live_url: string | null;
  capture_date: string | null;
  provider: string;
  fetched_at: string | null;
};

async function tiles(): Promise<TileRow[]> {
  return dbQuery<TileRow>(
    `SELECT id, region, bbox, cached_path, live_url, capture_date::text AS capture_date,
            provider, fetched_at::text AS fetched_at
     FROM satellite_tiles ORDER BY id`,
  );
}

describe('the strip renders from cache, with no network', () => {
  it('seeds one tile per metro', async () => {
    const rows = await tiles();
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.region)).size).toBe(rows.length);
  });

  it('points every row at a real file, because a missing file is a blank strip', async () => {
    const rows = await tiles();
    const missing: string[] = [];
    const tiny: string[] = [];

    for (const row of rows) {
      const onDisk = join(PUBLIC_ROOT, row.cached_path.replace(/^\//, ''));
      if (!existsSync(onDisk)) {
        missing.push(`${row.id} -> ${row.cached_path}`);
        continue;
      }
      if (statSync(onDisk).size < MIN_TILE_BYTES) tiny.push(`${row.id} (${statSync(onDisk).size} bytes)`);
    }

    expect(missing, 'cached_path must resolve to a file under public/').toEqual([]);
    expect(tiny, 'a tile this small is a placeholder or an error page').toEqual([]);
  });

  it('stores a servable URL path, not a filesystem path', async () => {
    // `/cache/tiles/x.jpg` is what an <img src> needs. A Windows path, or one
    // starting `public/`, would render locally in dev and 404 in the container.
    for (const row of await tiles()) {
      expect(row.cached_path, row.id).toMatch(/^\/cache\/tiles\/[\w.-]+\.jpg$/);
      expect(row.cached_path).not.toContain('\\');
      expect(row.cached_path).not.toContain('public/');
    }
  });

  it('records the provenance the panel shows beside the image', async () => {
    for (const row of await tiles()) {
      expect(row.provider.trim().length, `${row.id} provider`).toBeGreaterThan(0);
      expect(row.capture_date, `${row.id} capture_date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.bbox, `${row.id} bbox`).toMatch(/^-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+$/);
    }
  });

  it('gives every row a live_url, or the refresh button has nothing to call', async () => {
    const withoutUrl = await dbQuery<{ id: string }>(
      'SELECT id FROM satellite_tiles WHERE live_url IS NULL',
    );
    expect(withoutUrl).toEqual([]);
  });
});

describe('a refresh can only ever add a file, never replace one', () => {
  it('derives a new path from the content hash, so the rendered file is untouched', async () => {
    const rows = await tiles();
    const row = rows[0];

    const next = cachedPathFor(row.id, '2026-09-08', 'a'.repeat(64));
    expect(next).toMatch(/^\/cache\/tiles\//);
    expect(next).not.toBe(row.cached_path);

    // Different content, different name. That is what makes a failed write
    // incapable of clobbering the image on screen.
    const other = cachedPathFor(row.id, '2026-09-08', 'b'.repeat(64));
    expect(other).not.toBe(next);
  });

  it('rewrites only the date segment of a stored GIBS URL', async () => {
    // The refresh does not rebuild a tile URL. prep/fetch_tiles.py decides which
    // tile a metro is; the route only asks for a different day of the same tile.
    const row = (await tiles()).find((r) => r.live_url?.includes('gibs'));
    if (!row?.live_url) {
      console.warn('[tiles-cache] no GIBS live_url seeded, so the date rewrite is not asserted');
      return;
    }

    const original = captureDateOf(row.live_url);
    expect(original).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const moved = withCaptureDate(row.live_url, '2026-01-02');
    expect(moved).not.toBeNull();
    expect(captureDateOf(moved!)).toBe('2026-01-02');
    // Everything except the date is byte-identical.
    expect(moved!.replace('2026-01-02', original!)).toBe(row.live_url);
  });

  it('offers candidate dates newest first, because GIBS lags a day or two', () => {
    const dates = candidateDates(new Date('2026-09-08T00:00:00Z'), 3);
    expect(dates).toEqual(['2026-09-07', '2026-09-06', '2026-09-05']);
  });
});

describe('the news list survives a refresh that fails', () => {
  it('keeps a unique dedupe_key, so an upsert amends rather than duplicates', async () => {
    const dupes = await dbQuery<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM environmental_events GROUP BY dedupe_key HAVING count(*) > 1`,
    );
    expect(dupes).toEqual([]);
  });

  it('holds enough items that AC-16 has headroom, with a source and a date on each', async () => {
    const row = await dbOne<{ n: string }>('SELECT count(*)::int AS n FROM environmental_events');
    expect(Number(row.n)).toBeGreaterThanOrEqual(10);

    const bad = await dbQuery<{ id: string }>(
      `SELECT id FROM environmental_events
       WHERE occurred_on IS NULL
          OR source_url IS NULL OR source_url !~ '^https?://'
          OR title IS NULL OR btrim(title) = ''
       LIMIT 10`,
    );
    expect(bad).toEqual([]);
  });

  it('keeps the three curated events, which no live feed can be relied on to carry', async () => {
    // They have no live counterpart, so no upsert can overwrite them and no
    // refresh can drop them. The demo names all three out loud.
    const curated = await dbQuery<{ id: string; event_type: string }>(
      `SELECT id, event_type::text AS event_type FROM environmental_events
       WHERE id LIKE 'EV-CURATED-%' ORDER BY id`,
    );
    expect(curated.map((r) => r.id)).toEqual([
      'EV-CURATED-BORNEO-FIRE',
      'EV-CURATED-BSD-POLLUTION',
      'EV-CURATED-NTT-EARTHQUAKE',
    ]);
    expect(curated.map((r) => r.event_type).sort()).toEqual(['earthquake', 'fire', 'pollution']);
  });
});
