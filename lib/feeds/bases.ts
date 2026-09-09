/**
 * The three outbound hosts, in one place and overridable by environment.
 *
 * Why they are overridable at all: the offline rehearsal has to be testable.
 * Plan 4.9 says the app must survive a dead network, and `tests/e2e/offline.spec.ts`
 * is supposed to prove it. It cannot. Playwright's `page.route` intercepts requests
 * the BROWSER makes, and all three of these are called from the SERVER, inside a
 * Next request handler, so a browser-level block sails straight past them. I wrote
 * that test first and it failed by succeeding: it reached NASA and reported ok.
 *
 * Pointing the bases at a dead port is what makes the server genuinely offline
 * while the app itself is untouched. The offline spec starts its web server with
 * these set; nothing else does, and the defaults are the real hosts, so a
 * misconfigured deployment fails loudly at the request rather than silently
 * serving stale data.
 *
 * The values come from `lib/config/env.ts`, which reads by variable key at call
 * time. That is not a style choice: Turbopack folds a literal
 * `process.env.SOMETHING` to its BUILD-time value, so a direct read here baked in
 * `undefined` and the default won for ever, and the offline specs passed while
 * silently reaching the real feed. See that module's header.
 */

import { readEnv } from '@/lib/config/env';

/** NASA EONET, the environmental event feed. `app/api/refresh/news`. */
export function eonetBase(): string {
  return trimSlash(readEnv('FEED_EONET_BASE') ?? 'https://eonet.gsfc.nasa.gov');
}

/** NASA GIBS, the satellite tile service. `app/api/refresh/tiles`. */
export function gibsBase(): string {
  return trimSlash(readEnv('FEED_GIBS_BASE') ?? 'https://gibs.earthdata.nasa.gov');
}

/**
 * Google Maps Static, the per-property satellite thumbnail (S43).
 * `app/api/refresh/thumbs`.
 *
 * Read only when the stored `collateral.satellite_thumb_url` names Maps Static.
 * Without `GOOGLE_MAPS_STATIC_KEY` the prep pipeline writes NASA GIBS URLs
 * instead, and those refresh through `gibsBase()`; the route picks by the stored
 * URL rather than by a flag, so a row keeps refreshing from the service it came
 * from.
 *
 * Note that the thumbnail is NOT a live call on a render path. The case screen
 * renders `satellite_thumb_path`, a committed file, and this host is reached
 * only behind the refresh button. That is what lets the thumbnail survive a
 * disabled interface with no degraded view to rehearse.
 */
export function thumbBase(): string {
  return trimSlash(readEnv('THUMB_BASE') ?? 'https://maps.googleapis.com');
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Swaps the origin of an absolute URL for `base`, keeping the path and query.
 *
 * `satellite_tiles.live_url` stores a full NASA GIBS URL, written by the seed.
 * The refresh route reuses that URL rather than rebuilding one, so this is how
 * an overridden host reaches it. A URL that will not parse is returned
 * unchanged: an unparseable stored URL is a data problem for the caller's error
 * path, not something to throw about here.
 */
export function rewriteToBase(url: string, base: string): string {
  try {
    const parsed = new URL(url);
    const target = new URL(base);
    parsed.protocol = target.protocol;
    parsed.host = target.host;
    return parsed.toString();
  } catch {
    return url;
  }
}

/** True when any host has been pointed away from its real default. */
export function anyBaseOverridden(): boolean {
  return Boolean(
    readEnv('FEED_EONET_BASE') ?? readEnv('FEED_GIBS_BASE') ?? readEnv('THUMB_BASE'),
  );
}
