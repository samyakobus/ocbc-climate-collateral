/**
 * Server-side pin query for the portfolio map (S16, AC-5, AC-7).
 *
 * Route-local on purpose: this shape is the map's alone. The connection comes
 * from the one shared pool in `lib/db/client.ts`, because the local server is
 * PGlite with a bounded connection ceiling and a private pool per module
 * multiplies connections for the same work.
 *
 * Offline-first (plan 4.9): the only I/O is one query over DATABASE_URL. There
 * is no outbound call on this path, which `tests/unit/no-network-on-render.test.ts`
 * enforces by scanning for call sites.
 */

import type { Band } from '@/lib/rules/bands';
import { SCENARIOS, type Scenario } from '@/components/map/scenario';
import { pool } from '@/lib/db/client';

/** One collateral pin, with its band at each of the three scenarios. */
export type MapPin = {
  id: string;
  lon: number;
  lat: number;
  address_line: string;
  cluster_name: string;
  country: string;
  appraised_value_sgd: number;
  /** `null` where no valuation row exists yet, which the map renders as unscored. */
  bands: Record<Scenario, Band | null>;
};

type Row = {
  id: string;
  lon: number;
  lat: number;
  address_line: string;
  cluster_name: string;
  country: string;
  appraised_value_sgd: number;
  scenario: Scenario | null;
  band: Band | null;
};

/**
 * Every collateral pin, with all three scenario bands in one round trip.
 *
 * All three are fetched together so moving the slider recolours in the browser
 * with no refetch and no server round trip. That is what makes AC-5 a colour
 * change rather than a page load, and it is the one beat of the demo performed
 * live on stage.
 *
 * The join is left-outer twice over: a collateral row with no valuation still
 * appears, as a grey unscored pin. Before `npm run db:recompute` has ever run,
 * every pin is unscored and the map still draws 200 of them, which is the
 * state this shell is built to render.
 */
export async function loadMapPins(): Promise<MapPin[]> {
  const { rows } = await pool().query<Row>(`
    SELECT c.id,
           ST_X(c.geom::geometry)      AS lon,
           ST_Y(c.geom::geometry)      AS lat,
           c.address_line,
           c.cluster_name,
           c.country,
           c.appraised_value_sgd::float8 AS appraised_value_sgd,
           v.scenario,
           v.band
      FROM collateral c
      LEFT JOIN valuations v
             ON v.collateral_id = c.id
            AND v.rule_set_id = (SELECT id FROM rule_sets WHERE is_active LIMIT 1)
     ORDER BY c.id
  `);

  const byId = new Map<string, MapPin>();

  for (const row of rows) {
    let pin = byId.get(row.id);
    if (!pin) {
      pin = {
        id: row.id,
        lon: Number(row.lon),
        lat: Number(row.lat),
        address_line: row.address_line,
        cluster_name: row.cluster_name,
        country: row.country,
        appraised_value_sgd: Number(row.appraised_value_sgd),
        bands: { today: null, y2030: null, y2050: null },
      };
      byId.set(row.id, pin);
    }
    if (row.scenario && row.band) {
      pin.bands[row.scenario] = row.band;
    }
  }

  return [...byId.values()];
}

/** How many pins carry a band at each scenario. Drives the "unscored" caption. */
export function scoredCounts(pins: readonly MapPin[]): Record<Scenario, number> {
  const counts = { today: 0, y2030: 0, y2050: 0 } as Record<Scenario, number>;
  for (const scenario of SCENARIOS) {
    counts[scenario.key] = pins.filter((p) => p.bands[scenario.key] !== null).length;
  }
  return counts;
}
