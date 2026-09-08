/**
 * NASA GIBS URL handling for the tile refresh, with no network call.
 *
 * The refresh does NOT rebuild a tile URL from scratch. Every `satellite_tiles`
 * row already carries the `live_url` the seed fetched, so newer imagery for the
 * same tile is the same URL with a different date segment. Substituting the date
 * keeps the layer, the matrix set, the zoom and the tile indices out of
 * TypeScript entirely; `prep/fetch_tiles.py` remains the only place that decides
 * which tile a metro is.
 *
 * `tests/unit/no-network-on-render.test.ts` forbids `fetch(` under `lib/`, so
 * the probing and the download live in the route, which is one of the four
 * places plan 4.9 allows an outbound call.
 */

import { gibsBase, rewriteToBase } from './bases';

/** A GIBS WMTS path carries the capture date as its own segment, ISO formatted. */
const DATE_SEGMENT = /\/(\d{4}-\d{2}-\d{2})\//;

/** GIBS lags a day or two, so a refresh steps back until one answers. */
export const CAPTURE_LOOKBACK_DAYS = 6;

export function captureDateOf(url: string): string | null {
  const match = DATE_SEGMENT.exec(url);
  return match ? match[1] : null;
}

/**
 * The same tile on a different day, on whatever host is configured.
 *
 * The stored `live_url` carries the real NASA host, written by the seed. The
 * origin is rewritten from lib/feeds/bases.ts so the offline rehearsal can point
 * it at a dead port without touching the seeded rows. The default is the real host,
 * so this is a no-op in every normal run.
 *
 * Returns null if the URL carries no date segment, which is the caller's signal
 * that it is not a GIBS tile URL and cannot be moved to another day.
 */
export function withCaptureDate(url: string, isoDate: string): string | null {
  if (!DATE_SEGMENT.test(url)) return null;
  return rewriteToBase(url.replace(DATE_SEGMENT, `/${isoDate}/`), gibsBase());
}

/** Candidate capture dates, newest first, for a refresh to probe. */
export function candidateDates(from: Date, lookbackDays = CAPTURE_LOOKBACK_DAYS): string[] {
  const out: string[] = [];
  for (let back = 1; back <= lookbackDays; back++) {
    const day = new Date(from.getTime());
    day.setUTCDate(day.getUTCDate() - back);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The public path a freshly downloaded tile is stored at.
 *
 * The content hash is the whole point: a refresh writes a NEW file and never
 * overwrites the one the strip is currently rendering, so a half-written file
 * cannot replace a good one and a failed refresh leaves the page untouched
 * (plan 4.9).
 */
export function cachedPathFor(tileId: string, isoDate: string, contentHash: string): string {
  const slug = tileId.replace(/^TILE-/, '').toLowerCase();
  return `/cache/tiles/${slug}-${isoDate}-${contentHash.slice(0, 10)}.jpg`;
}
