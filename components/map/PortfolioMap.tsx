'use client';

/**
 * The portfolio map (S16, AC-5, AC-7).
 *
 * 200 collateral pins over the offline pmtiles basemap, coloured by the stored
 * band at the selected scenario. Moving the slider repaints in the browser from
 * data already in the page: all three scenario bands ship with the first render,
 * so there is no refetch and no server round trip on the one beat of the demo
 * performed live in front of the room.
 *
 * A pin with no valuation row renders grey and reads "unscored". That is the
 * state before `npm run db:recompute` has ever run, and it is a real state the
 * map has to draw rather than an error.
 *
 * Clicking a pin opens its case (AC-7).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { Band } from '@/lib/rules/bands';
import type { MapPin } from '@/app/(app)/map/pins';
import { buildMapStyle, isFloorOnly, type BasemapAvailability } from './basemap';
import { ScenarioSlider } from './ScenarioSlider';
import { DEFAULT_SCENARIO, SCENARIOS, type Scenario } from './scenario';

/**
 * Pin colours. These are the four `risk_band` enum values, so a pin's colour and
 * its case band are the same value rather than two things kept in step (AC-5).
 */
export const BAND_COLOUR: Record<Band, string> = {
  green: '#16a34a',
  amber: '#f59e0b',
  orange: '#ea580c',
  red: '#dc2626',
};

export const UNSCORED_COLOUR = '#9ca3af';

const PIN_LAYER = 'collateral-pins';
const PIN_SOURCE = 'collateral';

/**
 * The plan's basemap bbox, 95E-125E and 11S-33N. The archives hold nothing
 * outside it, so the view opens fitted to it and panning is bounded a little
 * beyond it. Without the bound the map opens onto grey margins where there is
 * simply no data, which reads as a broken tile load rather than the edge of the
 * extract.
 */
const ARCHIVE_BOUNDS: [[number, number], [number, number]] = [
  [95, -11],
  [125, 33],
];
/**
 * Panning is deliberately NOT bounded. `maxBounds` forces MapLibre to zoom in
 * until the visible area fits inside it, and on a wide viewport that crops the
 * region badly: fitting 44 degrees of latitude leaves the 1400px width spanning
 * far more longitude than the archive covers, so the map opened on a third of
 * the portfolio. The grey beyond the extract is honest, and plan 4.7 already
 * documents that the archives stop at the bbox.
 */

type Props = {
  pins: readonly MapPin[];
  basemap: BasemapAvailability;
};

/** `circle-color` for one scenario: match on that scenario's band property. */
function colourExpression(scenario: Scenario): ExpressionSpecification {
  return [
    'match',
    ['get', `band_${scenario}`],
    'green', BAND_COLOUR.green,
    'amber', BAND_COLOUR.amber,
    'orange', BAND_COLOUR.orange,
    'red', BAND_COLOUR.red,
    UNSCORED_COLOUR,
  ] as ExpressionSpecification;
}

function toFeatureCollection(pins: readonly MapPin[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] },
      properties: {
        id: pin.id,
        address_line: pin.address_line,
        cluster_name: pin.cluster_name,
        country: pin.country,
        appraised_value_sgd: pin.appraised_value_sgd,
        band_today: pin.bands.today ?? '',
        band_y2030: pin.bands.y2030 ?? '',
        band_y2050: pin.bands.y2050 ?? '',
      },
    })),
  };
}

export function PortfolioMap({ pins, basemap }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [ready, setReady] = useState(false);
  const [hazards, setHazards] = useState({ flood: false, heat: false });

  const data = useMemo(() => toFeatureCollection(pins), [pins]);

  // The router is only read inside the click handler, so keep it in a ref and
  // out of the init effect's dependencies. Re-creating the map on every render
  // of a parent would tear down and rebuild the WebGL context.
  //
  // Both refs are seeded by `useRef` on the first render and kept current in an
  // effect, never assigned during render. The init effect below is declared
  // after these two, and effects run in declaration order, so it always sees a
  // current value on mount.
  const routerRef = useRef(router);
  const dataRef = useRef(data);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // MapLibre 6 spawns its worker from a separate ES module rather than the
    // inlined blob worker of earlier majors, and neither Turbopack nor webpack
    // emits that chunk for a dependency's internal `new Worker(new URL(...))`.
    // The worker then never starts, and every symptom points somewhere else:
    // the map paints its background layer, the style never finishes loading,
    // and nothing that needs worker-side parsing appears, so both the vector
    // tiles and the GeoJSON pins are silently absent with no console error.
    //
    // `public/maplibre/` holds the worker and the shared chunk it imports,
    // copied from the pinned maplibre-gl version and served from our own
    // origin, so this stays inside the offline rule of plan 4.9.
    setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

    // The pmtiles protocol reads the local archives by byte range. Registering
    // is global and idempotent enough to repeat, but only once per mount here.
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);

    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildMapStyle(basemap),
      bounds: ARCHIVE_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      attributionControl: { compact: true },
      // Nothing may be fetched from the network on a render path (plan 4.9).
      // MapLibre's default is already local-only here because every source URL
      // is a same-origin file, but say so rather than leave it to inference.
      maxZoom: 16,
    });
    mapRef.current = map;

    // Surface style and tile failures. A pmtiles range request that 404s or a
    // malformed style otherwise fails silently and leaves a blank grey canvas.
    map.on('error', (event) => {
      console.error('[map]', event.error?.message ?? event.error ?? 'unknown error');
    });

    // A handle for the AC-5 end-to-end spec, which has to read pin colours out
    // of the rendered style rather than guess at pixels.
    //
    // Unconditional, and it has to be. This was guarded by
    // `process.env.NODE_ENV !== 'production'`, which Next inlines to `false` in
    // the client bundle, so the whole assignment was eliminated from the build.
    // The end-to-end run serves the BUILD, and every map spec waits on this
    // handle, so all of them failed with "the pin layer never rendered any
    // features" while the pins were on screen the whole time. The demo-day
    // compose stack serves the build too, so the dev server was the only place
    // the specs could ever have passed.
    //
    // Assigning it always is harmless: it is a reference to an object this page
    // already owns and renders from, on a page behind the session guard, and it
    // grants a reader nothing they could not get from the DOM. Keeping the two
    // environments identical is worth more here than hiding a debug handle.
    (window as unknown as { __portfolioMap?: MapLibreMap }).__portfolioMap = map;

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    // Bottom-right: the scenario slider sits bottom-left.
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

    // `style.load`, not `load`. `load` waits for the first visually complete
    // render, which means every basemap tile in view; a slow or missing archive
    // would then keep the pins off the map entirely. The pins are the point of
    // the page and they depend on nothing but the style being parsed.
    const addPins = () => {
      if (map.getSource(PIN_SOURCE)) return;
      map.addSource(PIN_SOURCE, { type: 'geojson', data: dataRef.current });

      map.addLayer({
        id: PIN_LAYER,
        type: 'circle',
        source: PIN_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.2, 8, 6, 13, 10],
          'circle-color': colourExpression(DEFAULT_SCENARIO),
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.92,
        },
      });

      map.on('mouseenter', PIN_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', PIN_LAYER, () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('click', PIN_LAYER, (event: MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') routerRef.current.push(`/cases/${id}`);
      });

      // The container is sized by CSS after mount, so take one explicit measure
      // rather than trusting the size MapLibre saw at construction time.
      map.resize();
      setReady(true);
    };

    if (map.isStyleLoaded()) addPins();
    else map.once('style.load', addPins);

    const onWindowResize = () => map.resize();
    window.addEventListener('resize', onWindowResize);

    return () => {
      window.removeEventListener('resize', onWindowResize);
      map.remove();
      mapRef.current = null;
      removeProtocol('pmtiles');
    };
    // `basemap` is a plain server-provided record and does not change after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint on scenario change. `setPaintProperty` re-evaluates the expression
  // against properties already on the features, so no data is re-uploaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty(PIN_LAYER, 'circle-color', colourExpression(scenario));
  }, [scenario, ready]);

  // Keep the source in step if the server sends a new set of pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(PIN_SOURCE) as GeoJSONSource | undefined;
    source?.setData(data);
  }, [data, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty('hazard-flood', 'visibility', hazards.flood ? 'visible' : 'none');
    map.setLayoutProperty('hazard-heat', 'visibility', hazards.heat ? 'visible' : 'none');
  }, [hazards, ready]);

  const scoredNow = pins.filter((p) => p.bands[scenario] !== null).length;

  const toggleHazard = useCallback((key: 'flood' | 'heat') => {
    setHazards((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div
      className="absolute inset-0"
      data-testid="portfolio-map"
      /* A DOM-level readiness signal, so a spec can wait on the pin layer
         without reaching for the window handle above. */
      data-map-ready={ready ? 'true' : 'false'}
    >
      {/*
        h-full, not `absolute inset-0`. maplibre-gl.css sets
        `.maplibregl-map { position: relative }` on this very element and
        loads after the utility styles, so an absolute fill silently loses
        its positioning and the container collapses to zero height.
      */}
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="pointer-events-auto flex flex-wrap items-start gap-2">
          <Legend scoredNow={scoredNow} total={pins.length} />
          <HazardToggles hazards={hazards} onToggle={toggleHazard} />
          {isFloorOnly(basemap) ? <FloorNotice /> : null}
        </div>

        <div className="pointer-events-auto self-start">
          <ScenarioSlider value={scenario} onChange={setScenario} />
        </div>
      </div>
    </div>
  );
}

function Legend({ scoredNow, total }: { scoredNow: number; total: number }) {
  return (
    <div
      data-testid="map-legend"
      className="rounded-md border border-rule bg-white/85 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-rule dark:bg-black/70"
    >
      <div className="mb-1 font-medium">Band at selected scenario</div>
      <ul className="flex flex-col gap-0.5">
        {(Object.keys(BAND_COLOUR) as Band[]).map((band) => (
          <li key={band} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: BAND_COLOUR[band] }}
            />
            <span className="capitalize">{band}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: UNSCORED_COLOUR }}
          />
          <span>Unscored</span>
        </li>
      </ul>
      <div className="mt-1.5 opacity-60">
        {scoredNow} of {total} pins valued
      </div>
    </div>
  );
}

function HazardToggles({
  hazards,
  onToggle,
}: {
  hazards: { flood: boolean; heat: boolean };
  onToggle: (key: 'flood' | 'heat') => void;
}) {
  return (
    <div className="rounded-md border border-rule bg-white/85 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-rule dark:bg-black/70">
      <div className="mb-1 font-medium">Hazard layers</div>
      {(['flood', 'heat'] as const).map((key) => (
        <label key={key} className="flex items-center gap-1.5 capitalize">
          <input type="checkbox" checked={hazards[key]} onChange={() => onToggle(key)} />
          {key}
        </label>
      ))}
      <div className="mt-1 opacity-60">Extents not yet loaded</div>
    </div>
  );
}

function FloorNotice() {
  return (
    <div className="max-w-64 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      Rendering the committed z0-z6 basemap floor. Country and regional geometry
      only, so a city-scale view is close to empty. Run{' '}
      <code>npm run prep:basemap</code> for city detail.
    </div>
  );
}

export { SCENARIOS };
export default PortfolioMap;
