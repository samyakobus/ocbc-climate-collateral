/**
 * NASA EONET: the feed URL and the response parser, with no network call.
 *
 * Deliberately split from the route. `app/api/refresh/news/route.ts` is one of
 * the four places plan 4.9 allows an outbound call, and it holds the `fetch` and
 * the timeout; everything that can be tested without a socket lives here.
 * `tests/unit/no-network-on-render.test.ts` forbids `fetch(` anywhere under
 * `lib/`, so this file could not call out even if it wanted to.
 *
 * `prep/fetch_events.py` holds the same feed URL and category map for the seed.
 * That is a second copy, and it is structural rather than accidental: the plan
 * puts prep in Python and the runtime refresh in TypeScript, and both have to
 * name the same feed. The copy is kept small on purpose, and both sides are
 * asserted against the same fixture shape.
 */

import { eonetBase } from './bases';

/** The `event_type` enum. A category with no sensible home here is dropped. */
export type EventType = 'fire' | 'flood' | 'pollution' | 'earthquake' | 'storm' | 'haze';

export type FeedEvent = {
  id: string;
  title: string;
  event_type: EventType;
  occurred_on: string;
  lon: number;
  lat: number;
  source_feed: string;
  source_url: string;
  dedupe_key: string;
};

/** The regional bounding box, the same one the basemap region archive uses. */
export const BBOX = { west: 95.0, south: -11.0, east: 125.0, north: 33.0 } as const;

export const RECENT_WINDOW_DAYS = 90;

/** EONET category ids mapped onto the `event_type` enum. */
export const EONET_CATEGORY: Readonly<Record<string, EventType>> = {
  wildfires: 'fire',
  floods: 'flood',
  severeStorms: 'storm',
  earthquakes: 'earthquake',
  dustHaze: 'haze',
  manmade: 'pollution',
  waterColor: 'pollution',
  landslides: 'flood',
};

export function eonetUrl(days = RECENT_WINDOW_DAYS, limit = 200): string {
  const bbox = `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`;
  // The host comes from lib/feeds/bases.ts so the offline rehearsal can point it
  // at a dead port. The default is the real feed.
  return (
    `${eonetBase()}/api/v3/events` +
    `?status=all&limit=${limit}&days=${days}&bbox=${bbox}`
  );
}

/**
 * Reduces any EONET geometry to one point, returning [lon, lat].
 *
 * EONET returns a bare Point for most events and a Polygon or MultiPolygon for
 * flood footprints, nested to an arbitrary depth. Walking to the leaves and
 * averaging is the only shape-agnostic reduction that always yields a point.
 */
export function centroidOf(coordinates: unknown): [number, number] | null {
  if (
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number'
  ) {
    return [coordinates[0], coordinates[1]];
  }

  const points: [number, number][] = [];

  const walk = (node: unknown): void => {
    if (
      Array.isArray(node) &&
      node.length === 2 &&
      typeof node[0] === 'number' &&
      typeof node[1] === 'number'
    ) {
      points.push([node[0], node[1]]);
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child);
    }
  };

  walk(coordinates);
  if (points.length === 0) return null;

  return [
    points.reduce((a, p) => a + p[0], 0) / points.length,
    points.reduce((a, p) => a + p[1], 0) / points.length,
  ];
}

type RawEonet = {
  events?: {
    id?: unknown;
    title?: unknown;
    categories?: { id?: unknown }[];
    geometry?: { date?: unknown; coordinates?: unknown }[];
    sources?: { url?: unknown }[];
  }[];
};

/**
 * Turns an EONET payload into rows ready for the upsert.
 *
 * Anything malformed is skipped rather than throwing: a refresh that drops one
 * unparseable event is far better than one that fails entirely and leaves the
 * news list stale, and the caller reports how many were kept.
 */
export function parseEonet(payload: unknown): FeedEvent[] {
  const raw = (payload ?? {}) as RawEonet;
  const rows: FeedEvent[] = [];

  for (const event of raw.events ?? []) {
    const categories = (event.categories ?? []).map((c) => String(c?.id ?? ''));
    const category = categories.find((c) => c in EONET_CATEGORY);
    if (!category) continue;

    const geometries = event.geometry ?? [];
    const latest = geometries[geometries.length - 1];
    if (!latest) continue;

    const point = centroidOf(latest.coordinates);
    if (!point) continue;

    const [lon, lat] = point;
    if (lon < BBOX.west || lon > BBOX.east || lat < BBOX.south || lat > BBOX.north) continue;

    const parsed = new Date(String(latest.date ?? ''));
    if (Number.isNaN(parsed.getTime())) continue;

    const id = String(event.id ?? '').trim();
    const title = String(event.title ?? '').trim().slice(0, 200);
    if (!id || !title) continue;

    const sourceUrl = String(event.sources?.[0]?.url ?? '').trim();

    rows.push({
      id,
      title,
      event_type: EONET_CATEGORY[category],
      occurred_on: parsed.toISOString().slice(0, 10),
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      source_feed: 'NASA EONET',
      source_url: sourceUrl.startsWith('http') ? sourceUrl : 'https://eonet.gsfc.nasa.gov/',
      dedupe_key: `eonet:${id}`,
    });
  }

  return rows;
}
