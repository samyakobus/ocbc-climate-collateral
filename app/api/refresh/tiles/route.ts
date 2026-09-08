/**
 * POST /api/refresh/tiles - S24. AC-14, and AC-11 by what it does when it fails.
 *
 * One of the four places plan 4.9 allows an outbound call.
 *
 * POST only, five-second timeout, and a failure that changes nothing.
 *
 * The write order is the whole design (plan 4.9). A refreshed tile is written to
 * a NEW file whose name carries the content hash, and only then does the row
 * move to it. So:
 *
 *   - the file the strip is currently rendering is never overwritten, and a
 *     half-written download cannot replace a good image;
 *   - if the download fails, or the write fails, or the transaction rolls back,
 *     the row still points at the old file and the strip renders exactly as it
 *     did before;
 *   - the old file stays on disk, so a rollback needs no file restore.
 *
 * That is what offline checklist step 9 rehearses: press refresh with the
 * interface down, get a toast, and watch nothing disappear.
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { pool } from '@/lib/db/client';
import { candidateDates, cachedPathFor, withCaptureDate } from '@/lib/feeds/gibs';
import { TIMEOUT_MS, describeFailure, describeWriteFailure } from '@/lib/feeds/refresh';

export const dynamic = 'force-dynamic';

/** A tile smaller than this is an error page or a placeholder, not imagery. */
const MIN_TILE_BYTES = 512;

type TileRow = {
  id: string;
  region: string;
  cached_path: string;
  live_url: string | null;
  capture_date: string | null;
};

type Result = {
  ok: boolean;
  message: string;
  refreshed?: number;
  unchanged?: number;
  capture_date?: string;
};

async function download(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < MIN_TILE_BYTES) {
      throw new Error(`only ${buffer.byteLength} bytes, which is not imagery`);
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/** The newest capture date GIBS actually serves for a known tile URL. */
async function resolveCaptureDate(sampleUrl: string): Promise<string> {
  for (const isoDate of candidateDates(new Date())) {
    const probe = withCaptureDate(sampleUrl, isoDate);
    if (!probe) break;
    try {
      await download(probe);
      return isoDate;
    } catch {
      // Try the previous day. GIBS publishes a day at a time and lags.
    }
  }
  throw new Error('no recent capture date is being served');
}

export async function POST(): Promise<NextResponse<Result>> {
  await requireUser();

  const db = pool();
  const { rows: tiles } = await db.query<TileRow>(
    `SELECT id, region, cached_path, live_url, capture_date::text AS capture_date
     FROM satellite_tiles ORDER BY id`,
  );

  const withUrl = tiles.filter((t): t is TileRow & { live_url: string } => Boolean(t.live_url));
  if (withUrl.length === 0) {
    return NextResponse.json(
      { ok: false, message: 'No tile records a live URL to refresh from. Showing cached imagery.' },
      { status: 200 },
    );
  }

  let captureDate: string;
  try {
    captureDate = await resolveCaptureDate(withUrl[0].live_url);
  } catch (cause) {
    // Nothing downloaded, nothing written. The strip is untouched.
    return NextResponse.json(describeFailure('the imagery service', cause, 'imagery'), {
      status: 200,
    });
  }

  // Download everything BEFORE touching the database or the old files, so a
  // failure halfway through leaves the strip whole rather than half updated.
  const publicRoot = resolve(process.cwd(), 'public');
  const downloaded: { id: string; path: string; bytes: Buffer }[] = [];

  for (const tile of withUrl) {
    if (tile.capture_date === captureDate) continue;

    const url = withCaptureDate(tile.live_url, captureDate);
    if (!url) continue;

    try {
      const bytes = await download(url);
      const hash = createHash('sha256').update(bytes).digest('hex');
      downloaded.push({ id: tile.id, path: cachedPathFor(tile.id, captureDate, hash), bytes });
    } catch {
      // One tile failing does not fail the strip. The rest still refresh and
      // this one keeps rendering the image it already has.
    }
  }

  if (downloaded.length === 0) {
    const alreadyCurrent = withUrl.every((t) => t.capture_date === captureDate);
    return NextResponse.json({
      ok: alreadyCurrent,
      message: alreadyCurrent
        ? `Already showing the newest imagery (${captureDate}).`
        : 'No tile could be refreshed. Showing cached imagery.',
      refreshed: 0,
      unchanged: withUrl.length,
      capture_date: captureDate,
    });
  }

  // Write the NEW files first. The old ones stay exactly where they are, so a
  // rollback below needs no file restore and the strip never points at nothing.
  try {
    for (const item of downloaded) {
      const target = join(publicRoot, item.path.replace(/^\//, ''));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, item.bytes);
    }
  } catch (cause) {
    return NextResponse.json(describeWriteFailure('the refreshed imagery', cause), { status: 200 });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const item of downloaded) {
      await client.query(
        `UPDATE satellite_tiles
         SET cached_path = $2, capture_date = $3::date, fetched_at = now()
         WHERE id = $1`,
        [item.id, item.path, captureDate],
      );
    }
    await client.query('COMMIT');
  } catch (cause) {
    await client.query('ROLLBACK');
    // The new files are on disk and unreferenced, which is harmless. Every row
    // still points at the image it was rendering a moment ago.
    return NextResponse.json(describeWriteFailure('the refreshed imagery', cause), { status: 200 });
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    message: `Refreshed ${downloaded.length} of ${withUrl.length} tiles to ${captureDate}.`,
    refreshed: downloaded.length,
    unchanged: withUrl.length - downloaded.length,
    capture_date: captureDate,
  });
}

/** GET is not a refresh. Answering it would put an outbound call on a render path. */
export async function GET(): Promise<NextResponse<{ message: string }>> {
  return NextResponse.json(
    { message: 'Use POST. A GET here would put an outbound call on a render path (plan 4.9).' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
