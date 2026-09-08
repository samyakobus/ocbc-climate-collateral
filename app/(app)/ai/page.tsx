/**
 * /ai - the AI Dashboard (S23, AC-14 to AC-17).
 *
 * The risk manager's landing route under the amended AC-1, with the portfolio
 * dashboard one click away in the top navigation.
 *
 * Four sections and no more, which is the scope the plan fixes: the satellite
 * strip, the hotspot map with its detail panel, the news list, and the score
 * gauge that lives inside the panel. Every one renders from stored rows, so the
 * page is complete with the network interface disabled. The only outbound calls
 * are behind the two refresh buttons, and a failure there changes nothing.
 */

import { existsSync } from 'node:fs';

import { requireRole } from '@/lib/auth/session';
import { refreshNewsAction, refreshTilesAction } from '@/app/actions/refresh';
import { SatelliteStrip } from '@/components/ai/SatelliteStrip';
import { HotspotMap } from '@/components/ai/HotspotMap';
import { NewsList } from '@/components/ai/NewsList';
import type { BasemapAvailability } from '@/components/map/basemap';
import { loadEvents, loadHotspots, loadTiles } from './queries';

export const dynamic = 'force-dynamic';

/*
  Literal paths. A path built at runtime cannot be followed by the bundler, so it
  traces the whole directory it points into, and that directory holds 213 MB of
  pmtiles archives. See the same note in the map route.
*/
function basemapAvailability(): BasemapAvailability {
  return {
    region: existsSync('public/basemap/asia-region-z0-z10.pmtiles'),
    cities: existsSync('public/basemap/asia-cities-z0-z12.pmtiles'),
    floor: existsSync('public/basemap/asia-z0-z6.pmtiles'),
  };
}

export default async function AiDashboardPage() {
  await requireRole(['risk_manager']);

  const [hotspots, events, tiles] = await Promise.all([
    loadHotspots(),
    loadEvents(),
    loadTiles(),
  ]);
  const basemap = basemapAvailability();

  return (
    <section className="flex flex-col gap-4 p-6">
      <header>
        <h1 data-testid="ai-heading" className="text-lg font-semibold">
          AI Dashboard
        </h1>
        <p className="text-sm opacity-60">
          {hotspots.length} hotspots, {events.length} recent events and {tiles.length}{' '}
          cached regions. The model assigns the hotspot triage score; the
          deterministic reference index sits beside it, and no credit figure is
          model-assigned.
        </p>
      </header>

      <SatelliteStrip tiles={tiles} refreshAction={refreshTilesAction} />

      <HotspotMap hotspots={hotspots} basemap={basemap} />

      <NewsList events={events} refreshAction={refreshNewsAction} />
    </section>
  );
}
