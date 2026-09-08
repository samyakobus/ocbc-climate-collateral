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
 * Read lazily rather than captured at module load, so a test can set them before
 * the first request without depending on import order.
 */

/** NASA EONET, the environmental event feed. `app/api/refresh/news`. */
export function eonetBase(): string {
  return trimSlash(process.env.FEED_EONET_BASE ?? 'https://eonet.gsfc.nasa.gov');
}

/** NASA GIBS, the satellite tile service. `app/api/refresh/tiles`. */
export function gibsBase(): string {
  return trimSlash(process.env.FEED_GIBS_BASE ?? 'https://gibs.earthdata.nasa.gov');
}

/**
 * The per-property satellite thumbnail: the one live call on a render path that
 * the spec asks for, with a cached fallback.
 *
 * Nothing reads this yet. It is declared here so that whoever builds the
 * thumbnail takes its host from the same place as the other two, rather than
 * hard-coding one and leaving the offline rehearsal with a hole in it.
 */
export function thumbBase(): string {
  return trimSlash(process.env.THUMB_BASE ?? 'https://maps.googleapis.com');
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
    process.env.FEED_EONET_BASE ?? process.env.FEED_GIBS_BASE ?? process.env.THUMB_BASE,
  );
}
