/**
 * POST /api/refresh/news - S24. AC-16, and AC-11 by what it does when it fails.
 *
 * One of the four places plan 4.9 allows an outbound call. Everything about it
 * is shaped by the offline rule.
 *
 * POST only. A GET would make this a render path, and a render path may not call
 * out; `tests/unit/no-network-on-render.test.ts` allows this file by name, so the
 * method restriction is what keeps that allowance honest.
 *
 * Five-second timeout, enforced with AbortSignal. A hung feed on demo day must
 * fail fast and visibly rather than hang the button.
 *
 * **A failed refresh changes nothing.** The fetch and the parse both complete
 * before a single row is written, so a timeout, a 500 or a malformed payload
 * leaves the news list exactly as it was and returns a body the UI renders as a
 * toast. That is the behaviour offline checklist step 9 rehearses.
 *
 * **The upsert never deletes** (plan 4.9). Events are upserted on `dedupe_key`,
 * so a feed that has moved on does not silently empty the list, and the curated
 * events the spec names by hand survive every refresh because no live row shares
 * their key.
 */

import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { pool } from '@/lib/db/client';
import { eonetUrl, parseEonet, type FeedEvent } from '@/lib/feeds/eonet';
import {
  TIMEOUT_MS,
  describeEmpty,
  describeFailure,
  describeWriteFailure,
} from '@/lib/feeds/refresh';

export const dynamic = 'force-dynamic';

type Result = {
  ok: boolean;
  message: string;
  fetched?: number;
  inserted?: number;
  updated?: number;
  total?: number;
};

async function fetchEvents(): Promise<FeedEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(eonetUrl(), {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`NASA EONET returned HTTP ${response.status}`);
    }
    return parseEonet(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(): Promise<NextResponse<Result>> {
  await requireUser();

  let events: FeedEvent[];
  try {
    events = await fetchEvents();
  } catch (cause) {
    // Nothing has been written. The list on screen is untouched.
    return NextResponse.json(describeFailure('the news feed', cause, 'items'), { status: 200 });
  }

  if (events.length === 0) {
    return NextResponse.json(
      { ...describeEmpty('The news feed', 'items'), fetched: 0 },
      { status: 200 },
    );
  }

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    let updated = 0;

    for (const event of events) {
      // ON CONFLICT on dedupe_key, and no DELETE anywhere: a refresh adds and
      // amends, it never empties the list.
      const { rows } = await client.query<{ was_insert: boolean }>(
        `INSERT INTO environmental_events
           (id, title, event_type, occurred_on, location, source_feed, source_url, dedupe_key)
         VALUES ($1, $2, $3::event_type, $4::date,
                 ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7, $8, $9)
         ON CONFLICT (dedupe_key) DO UPDATE SET
           title = EXCLUDED.title,
           event_type = EXCLUDED.event_type,
           occurred_on = EXCLUDED.occurred_on,
           location = EXCLUDED.location,
           source_feed = EXCLUDED.source_feed,
           source_url = EXCLUDED.source_url
         RETURNING (xmax = 0) AS was_insert`,
        [
          event.id,
          event.title,
          event.event_type,
          event.occurred_on,
          event.lon,
          event.lat,
          event.source_feed,
          event.source_url,
          event.dedupe_key,
        ],
      );

      if (rows[0]?.was_insert) inserted++;
      else updated++;
    }

    // ADR-7: the event-to-hotspot association is a spatial decision and PostGIS
    // owns it, here exactly as in db/seed/05_regional.sql. A newly inserted
    // event with no association would otherwise never reach a hotspot's V term.
    await client.query(
      `UPDATE environmental_events e
       SET hotspot_id = (
         SELECT h.id FROM hotspots h
         WHERE ST_DWithin(e.location, h.centroid, 400000)
         ORDER BY ST_Distance(e.location, h.centroid)
         LIMIT 1
       )
       WHERE e.location IS NOT NULL`,
    );

    const { rows } = await client.query<{ n: string }>(
      'SELECT count(*)::int AS n FROM environmental_events',
    );

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      message: `Refreshed: ${inserted} new, ${updated} updated.`,
      fetched: events.length,
      inserted,
      updated,
      total: Number(rows[0].n),
    });
  } catch (cause) {
    await client.query('ROLLBACK');
    return NextResponse.json(describeWriteFailure('the refreshed items', cause), { status: 200 });
  } finally {
    client.release();
  }
}

/** GET is not a refresh. Answering it would put an outbound call on a render path. */
export async function GET(): Promise<NextResponse<{ message: string }>> {
  return NextResponse.json(
    { message: 'Use POST. A GET here would put an outbound call on a render path (plan 4.9).' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
