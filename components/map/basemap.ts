/**
 * Offline basemap style for the portfolio map (S16, plan 4.7, AC-11).
 *
 * Two archives, two MapLibre sources. `pmtiles extract` takes one region and one
 * maximum zoom per invocation, so a single archive cannot hold a regional
 * extract plus a high-zoom city overlay. The region archive is read below z11
 * and the cities archive from z11 up.
 *
 * Two things here are easy to get wrong and both are deliberate.
 *
 * **Layer ids are namespaced per source.** `protomaps-themes-base` emits a fixed
 * id for every layer ("background", "earth", "roads_minor", ...) with no prefix
 * option, so calling it twice, once per source, produces duplicate ids and
 * MapLibre rejects the style. Every id is rewritten to `<source>:<id>` here.
 *
 * **No labels, therefore no glyphs.** A style with text layers needs a `glyphs`
 * URL, and every font range is an outbound fetch at render. Plan 4.9 forbids
 * that on any render path, so the shell uses the label-free layer set. Labels
 * can come back the day a glyph set is served from `public/`, and nothing else
 * has to change.
 */

import { noLabels } from 'protomaps-themes-base';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** Which archives are present on disk. The server component stats them. */
export type BasemapAvailability = {
  region: boolean;
  cities: boolean;
  floor: boolean;
};

/*
  The archive URLs the browser fetches. The matching filesystem paths live as
  string literals in `app/(app)/map/page.tsx`, deliberately not shared from
  here: the bundler has to see them as literals to avoid tracing 213 MB of
  archives into the server bundle, and a constant imported from another module
  is not a literal it can follow.
*/
const URLS = {
  region: 'pmtiles:///basemap/asia-region-z0-z10.pmtiles',
  cities: 'pmtiles:///basemap/asia-cities-z0-z12.pmtiles',
  floor: 'pmtiles:///basemap/asia-z0-z6.pmtiles',
} as const;

/** ODbL requires attribution to be rendered on the map, not buried in a doc. */
export const ATTRIBUTION =
  '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> | ' +
  '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> (ODbL)';

/** Where the cities archive takes over from the region archive. */
export const CITIES_MIN_ZOOM = 11;

const THEME = 'light';

const EMPTY_FEATURE_COLLECTION = {
  type: 'FeatureCollection' as const,
  features: [] as never[],
};

/**
 * The theme's layers for one source, with ids namespaced and zoom bounds applied.
 * `keepBackground` is true for exactly one source: a style wants one background.
 */
function themeLayers(
  source: string,
  options: { keepBackground: boolean; minzoom?: number; maxzoom?: number },
): LayerSpecification[] {
  const out: LayerSpecification[] = [];

  for (const layer of noLabels(source, THEME)) {
    if (layer.type === 'background' && !options.keepBackground) continue;

    const next = { ...layer, id: `${source}:${layer.id}` } as LayerSpecification;

    // A background layer has no source and no tile zoom range to respect.
    if (layer.type !== 'background') {
      if (options.minzoom !== undefined) next.minzoom = options.minzoom;
      if (options.maxzoom !== undefined) next.maxzoom = options.maxzoom;
    }

    out.push(next);
  }

  return out;
}

/**
 * Build the style from whichever archives are actually on disk.
 *
 * The fallback ladder is the one plan 4.7 documents: both fetched archives, else
 * the committed z0-z6 floor, else no basemap at all. The floor renders country
 * and regional geometry only, so a Singapore-scale view from it is close to
 * empty. That is the documented fallback rather than a failure, and the caller
 * says so on screen.
 */
export function buildMapStyle(available: BasemapAvailability): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  const layers: LayerSpecification[] = [];

  const hasCities = available.cities;
  const baseKey = available.region ? 'region' : available.floor ? 'floor' : null;

  if (baseKey) {
    sources.region = {
      type: 'vector',
      url: URLS[baseKey],
      attribution: ATTRIBUTION,
    };
    layers.push(
      ...themeLayers('region', {
        keepBackground: true,
        maxzoom: hasCities ? CITIES_MIN_ZOOM : undefined,
      }),
    );
  } else {
    // No archive at all: a flat ground so the pins still have something to sit on.
    layers.push({
      id: 'region:background',
      type: 'background',
      paint: { 'background-color': '#e9eae4' },
    });
  }

  if (hasCities) {
    sources.cities = {
      type: 'vector',
      url: URLS.cities,
      attribution: ATTRIBUTION,
    };
    layers.push(
      ...themeLayers('cities', { keepBackground: false, minzoom: CITIES_MIN_ZOOM }),
    );
  }

  // Hazard overlays. Empty placeholders for now: S16 is the shell, and the real
  // flood and heat extents arrive with the hazard layer work. They are declared
  // here so the ordering below the pins is fixed and the toggles already work.
  sources['hazard-flood'] = { type: 'geojson', data: EMPTY_FEATURE_COLLECTION };
  sources['hazard-heat'] = { type: 'geojson', data: EMPTY_FEATURE_COLLECTION };

  layers.push(
    {
      id: 'hazard-flood',
      type: 'fill',
      source: 'hazard-flood',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.25 },
    },
    {
      id: 'hazard-heat',
      type: 'fill',
      source: 'hazard-heat',
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.2 },
    },
  );

  return {
    version: 8,
    sources,
    layers,
  };
}

/** True when the map is drawing from the committed floor rather than the fetched archives. */
export function isFloorOnly(available: BasemapAvailability): boolean {
  return !available.region && !available.cities && available.floor;
}
