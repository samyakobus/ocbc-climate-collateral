'use client';

/**
 * The satellite tile strip (S23, AC-14, AC-11).
 *
 * The strip ALWAYS renders from `satellite_tiles.cached_path`, never from a
 * live URL. Refresh writes a new file with a hash suffix and moves the row to
 * it, so the file being rendered is never overwritten and a failed refresh
 * changes nothing. That is why this strip still renders with the network
 * interface disabled, which is offline checklist step 8.
 *
 * Plain `img` rather than `next/image`: these are committed files served
 * straight from `public/`, and the optimiser would add a server hop and a cache
 * that buys nothing for twelve fixed tiles.
 */

import { RefreshButton, type RefreshOutcome } from './RefreshButton';
import type { SatelliteTile } from '@/app/(app)/ai/queries';

export type SatelliteStripProps = {
  tiles: readonly SatelliteTile[];
  refreshAction?: () => Promise<RefreshOutcome>;
};

export function SatelliteStrip({ tiles, refreshAction }: SatelliteStripProps) {
  return (
    <section
      data-testid="satellite-strip"
      className="panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5 dark:border-rule">
        <h2 className="text-sm font-semibold">
          Satellite imagery{' '}
          <span className="font-normal opacity-60">({tiles.length} regions)</span>
        </h2>
        {refreshAction ? (
          <RefreshButton action={refreshAction} label="Refresh tiles" testId="refresh-tiles" />
        ) : null}
      </header>

      {tiles.length === 0 ? (
        <p data-testid="strip-empty" className="px-4 py-3 text-sm opacity-70">
          No tiles are cached yet.
        </p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto px-4 py-3">
          {tiles.map((tile) => (
            <li
              key={tile.id}
              data-testid={`tile-${tile.id}`}
              className="w-40 shrink-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tile.cached_path}
                alt={`${tile.provider} imagery over ${tile.region}`}
                width={160}
                height={160}
                className="h-40 w-40 rounded border border-rule object-cover dark:border-rule"
              />
              <div className="mt-1 text-xs font-medium">{tile.region}</div>
              <div className="text-[11px] opacity-60">
                {tile.capture_date ?? 'date unknown'} &middot; {tile.provider}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-rule px-4 py-2 text-[11px] opacity-60 dark:border-rule">
        Rendered from the committed cache, so the strip survives a dead network.
        Refresh replaces the file and updates the row; a failure changes nothing.
      </p>
    </section>
  );
}

export default SatelliteStrip;
