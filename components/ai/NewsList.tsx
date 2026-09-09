'use client';

/**
 * Environmental events, newest first (S23, AC-16).
 *
 * Every item carries its date, its type and a link to the feed it came from, so
 * a reader can leave the page and check it. Refresh upserts by dedupe key and
 * never deletes, and a failed refresh leaves the list exactly as it is.
 *
 * Earthquakes appear here. They are environmental context and are never scored:
 * the `hazard` enum has no earthquake member, so the engine has no way to price
 * one. The list says so rather than leaving a director to wonder why a
 * geophysical event is on a climate screen.
 */

import { RefreshButton, type RefreshOutcome } from './RefreshButton';
import type { EnvironmentalEvent } from '@/app/(app)/ai/queries';

export type NewsListProps = {
  events: readonly EnvironmentalEvent[];
  refreshAction?: () => Promise<RefreshOutcome>;
};

const TYPE_TONE: Record<string, string> = {
  fire: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  flood: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  storm: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
  haze: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200',
  pollution: 'bg-stone-200 text-stone-900 dark:bg-stone-800 dark:text-stone-100',
  earthquake: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200',
};

export function NewsList({ events, refreshAction }: NewsListProps) {
  const hasEarthquake = events.some((event) => event.event_type === 'earthquake');

  return (
    <section
      data-testid="news-list"
      className="flex min-h-0 flex-col panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5 dark:border-rule">
        <h2 className="text-sm font-semibold">
          Recent events{' '}
          <span data-testid="news-count" className="font-normal opacity-60">
            ({events.length})
          </span>
        </h2>
        {refreshAction ? (
          <RefreshButton action={refreshAction} label="Refresh news" testId="refresh-news" />
        ) : null}
      </header>

      {events.length === 0 ? (
        <p data-testid="news-empty" className="px-4 py-3 text-sm opacity-70">
          No events are stored yet.
        </p>
      ) : (
        <ol data-testid="news-items" className="max-h-96 divide-y divide-black/5 overflow-y-auto dark:divide-white/10">
          {events.map((event) => (
            <li
              key={event.id}
              data-testid={`news-item-${event.id}`}
              data-occurred-on={event.occurred_on}
              className="flex flex-col gap-1 px-4 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  data-testid={`news-type-${event.id}`}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    TYPE_TONE[event.event_type] ?? 'bg-black/5 dark:bg-white/10'
                  }`}
                >
                  {event.event_type}
                </span>
                <time dateTime={event.occurred_on} className="text-xs tabular-nums opacity-60">
                  {event.occurred_on}
                </time>
                {event.hotspot_name ? (
                  <span className="text-xs opacity-60">{event.hotspot_name}</span>
                ) : null}
              </div>

              <a
                href={event.source_url}
                target="_blank"
                rel="noreferrer"
                data-testid={`news-link-${event.id}`}
                className="text-sm underline-offset-2 hover:underline"
              >
                {event.title}
              </a>

              <span className="text-xs opacity-60">{event.source_feed}</span>
            </li>
          ))}
        </ol>
      )}

      {hasEarthquake ? (
        <p
          data-testid="earthquake-note"
          className="border-t border-rule px-4 py-2 text-xs opacity-70 dark:border-rule"
        >
          Earthquakes are shown as environmental context and are never scored. The
          hazard set has no earthquake member, so no haircut can include one.
        </p>
      ) : null}
    </section>
  );
}

export default NewsList;
