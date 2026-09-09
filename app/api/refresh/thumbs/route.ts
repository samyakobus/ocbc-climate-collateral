/**
 * POST /api/refresh/thumbs - S43. AC-12, and AC-11 by what it does when it fails.
 *
 * The per-property satellite thumbnail on the case screen, refreshed for ONE
 * property at a time. One of the places plan 4.9 allows an outbound call, and it
 * is added to `OUTBOUND_ALLOWED` in `tests/unit/no-network-on-render.test.ts`
 * rather than being an exception argued about in prose.
 *
 * ONE PROPERTY, NOT ALL 200. The strip refresh moves twelve tiles because the
 * strip shows twelve tiles. A case screen shows one property, and refreshing the
 * whole book to update the picture a user is looking at would put two hundred
 * outbound calls behind one button. The body names the collateral.
 *
 * The write order is the same design the tile refresh uses, and for the same
 * reasons. The image is downloaded first, then written to a NEW file whose name
 * carries the content hash, and only then does the row move to it. So:
 *
 *   - the file the case screen is currently rendering is never overwritten;
 *   - a failed download, a failed write or a rolled-back transaction all leave
 *     the row pointing at the old file, and the screen renders as it did;
 *   - the old file stays on disk, so a rollback needs no file restore.
 *
 * A refresh that fetches the identical image is reported as unchanged rather
 * than as a refresh, because the content hash is the file name: re-writing the
 * same bytes under the same name would be a no-op dressed up as an update.
 *
 * WHAT THE IMAGE ACTUALLY IS. Without `GOOGLE_MAPS_STATIC_KEY` the source is
 * NASA GIBS at zoom 8, which is regional imagery centred on the property rather
 * than a picture of the building. `prep/fetch_thumbs.py` explains that at
 * length. This route refreshes whatever the stored `live_url` names, so it
 * upgrades to Maps Static the moment the prep pipeline is rerun with a key, with
 * no change here.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { pool } from '@/lib/db/client';
import { gibsBase, rewriteToBase, thumbBase } from '@/lib/feeds/bases';
import {
  LOOKBACK_DAYS,
  blankReason,
  isoDaysAgo,
  measureBlankness,
  withCaptureDate,
} from '@/lib/feeds/blank-image';
import { TIMEOUT_MS, describeFailure, describeWriteFailure } from '@/lib/feeds/refresh';

export const dynamic = 'force-dynamic';

/** Smaller than this is an error page or a placeholder, not imagery. */
const MIN_THUMB_BYTES = 512;

/** Where a refreshed thumbnail is written, matching `prep/fetch_thumbs.py`. */
const CACHE_PREFIX = '/cache/thumbs';

/*
  THE BLANK-IMAGE GUARD lives in `lib/feeds/blank-image.ts`, so the thresholds
  have one home on this side and the decision is testable without a database, a
  session or a network. `prep/fetch_thumbs.py` applies the identical checks when
  it builds the committed cache.
*/

type ThumbRow = {
  id: string;
  cached_path: string | null;
  live_url: string | null;
};

type Result = {
  ok: boolean;
  message: string;
  collateral_id?: string;
  refreshed?: number;
  unchanged?: number;
  cached_path?: string;
};

function json(body: Result, status = 200): NextResponse<Result> {
  return NextResponse.json(body, { status });
}

async function download(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < MIN_THUMB_BYTES) {
      throw new Error(`only ${buffer.byteLength} bytes, which is not imagery`);
    }
    /* JPEG magic. A 200 carrying an HTML error page would otherwise be cached
       as if it were a photograph. */
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      throw new Error('the response is not a JPEG');
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<NextResponse<Result>> {
  await requireUser();

  let collateralId = '';
  try {
    const body = (await request.json()) as { collateral_id?: unknown };
    collateralId = typeof body.collateral_id === 'string' ? body.collateral_id.trim() : '';
  } catch {
    collateralId = '';
  }

  if (!collateralId) {
    return json(
      { ok: false, message: 'Name the property to refresh: POST {"collateral_id": "SG-EC-001"}.' },
      400,
    );
  }

  const db = pool();
  const { rows } = await db.query<ThumbRow>(
    `SELECT id, satellite_thumb_path AS cached_path, satellite_thumb_url AS live_url
     FROM collateral WHERE id = $1`,
    [collateralId],
  );

  const row = rows[0];
  if (!row) {
    return json({ ok: false, message: `No collateral ${collateralId}.` }, 404);
  }

  /*
    The stored live URL is the only thing that decides which image this property
    is. Rebuilding one here would make this route a second place that knows how
    to address the imagery service, and the two would drift.
  */
  if (!row.live_url) {
    return json({
      ok: false,
      message: 'This property records no live URL to refresh from. Showing the cached image.',
      collateral_id: collateralId,
      refreshed: 0,
    });
  }

  /*
    The host comes from the environment, so the offline rehearsal reaches a dead
    port here exactly as it does everywhere else.

    Which variable depends on which service the stored URL names, because the
    two are configured separately: `THUMB_BASE` is the Maps Static host and
    `FEED_GIBS_BASE` is the imagery host the credential-free path uses. Picking
    by the stored path rather than by a flag means a row fetched under one
    provider still refreshes under that provider after the other is configured.
  */
  const isMapsStatic = row.live_url.includes('/maps/api/staticmap');
  const base = isMapsStatic ? thumbBase() : gibsBase();
  const url = rewriteToBase(row.live_url, base);

  /*
    Step the capture date back until a scene exists that is not blank, exactly
    as the prep pipeline does. Without this the route would happily overwrite a
    good image with the black tile that started all of this: the layer serves it,
    it is a valid JPEG, and it is the right size.

    Maps Static has no date segment, so it is fetched once.
  */
  const rejected: string[] = [];

  let bytes: Buffer | null = null;
  let usedUrl = url;

  try {
    /*
      A URL with no date segment, Maps Static among them, is fetched once: there
      is no earlier scene to step back to.
    */
    const datedForm = withCaptureDate(url, isoDaysAgo(1));

    if (isMapsStatic || datedForm === null) {
      bytes = await download(url);
    } else {
      for (let back = 1; back <= LOOKBACK_DAYS && bytes === null; back += 1) {
        const dated = withCaptureDate(url, isoDaysAgo(back))!;

        let candidate: Buffer;
        try {
          candidate = await download(dated);
        } catch {
          continue; // No scene that day. Ordinary for HLS; try the day before.
        }

        /*
          `null` means NOT MEASURED, never "fine": `sharp` is an optional
          dependency of Next and may be absent. In that case the size and
          JPEG-magic checks in `download` are the whole guard, and this route
          accepts the first scene it finds rather than pretending to have
          checked it.
        */
        const measured = await measureBlankness(candidate);
        const reason = measured === null ? null : blankReason(measured);

        if (reason === null) {
          bytes = candidate;
          usedUrl = dated;
        } else {
          rejected.push(`${isoDaysAgo(back)}: ${reason}`);
        }
      }
    }
  } catch (cause) {
    // Nothing downloaded, nothing written. The case screen is untouched.
    return json({
      ...describeFailure('the imagery service', cause, 'imagery'),
      collateral_id: collateralId,
      refreshed: 0,
    });
  }

  if (bytes === null) {
    return json({
      ok: false,
      message:
        `No usable imagery in the last ${LOOKBACK_DAYS} days` +
        (rejected.length ? ` (${rejected[0]})` : '') +
        '. Showing the cached image.',
      collateral_id: collateralId,
      refreshed: 0,
    });
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  const path = `${CACHE_PREFIX}/${collateralId}-${hash}.jpg`;

  if (path === row.cached_path) {
    return json({
      ok: true,
      message: 'Already showing the newest image for this property.',
      collateral_id: collateralId,
      refreshed: 0,
      unchanged: 1,
      cached_path: path,
    });
  }

  // The NEW file first. The old one stays exactly where it is, so the rollback
  // below needs no file restore and the screen never points at nothing.
  try {
    const target = join(resolve(process.cwd(), 'public'), path.replace(/^\//, ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  } catch (cause) {
    return json({
      ...describeWriteFailure('the refreshed thumbnail', cause),
      collateral_id: collateralId,
      refreshed: 0,
    });
  }

  try {
    /*
      The URL moves with the image. It carries the capture date that actually
      worked, so a later refresh starts from a scene that existed rather than
      from the date this row was first seeded, and the provenance panel keeps
      naming the picture on screen rather than the one it replaced.
    */
    await db.query(
      `UPDATE collateral SET satellite_thumb_path = $2, satellite_thumb_url = $3 WHERE id = $1`,
      [collateralId, path, usedUrl],
    );
  } catch (cause) {
    /* The new file is on disk and unreferenced, which is harmless: the row still
       names the old one and the screen is unchanged. */
    return json({
      ...describeWriteFailure('the refreshed thumbnail', cause),
      collateral_id: collateralId,
      refreshed: 0,
    });
  }

  return json({
    ok: true,
    message: 'Refreshed the satellite thumbnail for this property.',
    collateral_id: collateralId,
    refreshed: 1,
    cached_path: path,
  });
}

/**
 * A GET would put an outbound call on a render path, which plan 4.9 forbids and
 * `tests/unit/no-network-on-render.test.ts` enforces.
 */
export async function GET(): Promise<NextResponse<Result>> {
  return NextResponse.json(
    { ok: false, message: 'Use POST. A GET here would place an outbound call on a render path.' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
