/**
 * /map - the portfolio map (S16, AC-5, AC-7).
 *
 * A server component that does three things and nothing else: guard the route,
 * read the 200 pins with their three scenario bands, and stat the basemap
 * archives so the client knows which fallback it is on. No outbound call is made
 * here, which is what plan 4.9 requires of every render path.
 *
 * The archives are stat'ed rather than assumed because two of the three are
 * gitignored: a clean clone has only the committed z0-z6 floor, and the map has
 * to say so on screen instead of rendering an empty grey square.
 */

import { existsSync } from 'node:fs';

import { requireUser } from '@/lib/auth/session';
import { PortfolioMap } from '@/components/map/PortfolioMap';
import { type BasemapAvailability } from '@/components/map/basemap';
import { loadMapPins } from './pins';

/** Always read the live table: bands change whenever the rule set is edited (AC-9). */
export const dynamic = 'force-dynamic';

/*
  Literal paths, not a computed one. The bundler cannot follow a path built at
  runtime, so it conservatively traces the whole directory it points into, and
  that directory holds 213 MB of pmtiles archives. Three string literals it can
  see, plus the `outputFileTracingExcludes` entry in next.config.ts, keep the
  archives out of the server bundle entirely.

  This only ever asks whether the file is there. Nothing server-side reads an
  archive: the browser fetches them by HTTP range through the pmtiles protocol.
*/
function basemapAvailability(): BasemapAvailability {
  return {
    region: existsSync('public/basemap/asia-region-z0-z10.pmtiles'),
    cities: existsSync('public/basemap/asia-cities-z0-z12.pmtiles'),
    floor: existsSync('public/basemap/asia-z0-z6.pmtiles'),
  };
}

export default async function MapPage() {
  await requireUser();

  const [pins, basemap] = [await loadMapPins(), basemapAvailability()];

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 pb-2 pt-4">
        <h1 data-testid="map-heading" className="text-lg font-semibold">
          Portfolio map
        </h1>
        <p className="text-sm opacity-60">
          {pins.length} collateral pins across five markets. Move the scenario
          slider to recolour; click a pin to open its case.
        </p>
      </header>

      {/*
        An explicit height, not a percentage chain. `h-full` inside a flex
        column resolves against a parent whose height is auto here, which
        collapses the map to nothing and leaves MapLibre with a canvas it
        never resizes. The viewport calculation subtracts the ribbon, the
        nav and this page header.
      */}
      <div className="relative h-[calc(100dvh-9.5rem)] min-h-[32rem] border-t border-rule">
        <PortfolioMap pins={pins} basemap={basemap} />
      </div>
    </section>
  );
}
