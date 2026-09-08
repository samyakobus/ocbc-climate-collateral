/**
 * tests/db/news-list.test.ts - AC-16.
 *
 * At least ten cached items, each with a source and a date, newest first. The
 * point of the seeded set is that the list renders with the network interface
 * disabled, so what matters is that the rows are complete and orderable without
 * any refresh having run.
 */

import { describe, expect, it } from 'vitest';

import { dbOne, dbQuery } from '../setup/db';

type EventRow = {
  id: string;
  title: string;
  event_type: string;
  occurred_on: Date | string;
  source_feed: string;
  source_url: string;
  hotspot_id: string | null;
};

async function events(): Promise<EventRow[]> {
  return dbQuery<EventRow>(
    `SELECT id, title, event_type, occurred_on, source_feed, source_url, hotspot_id
       FROM environmental_events
      ORDER BY occurred_on DESC, id`,
  );
}

function day(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

describe('the seeded news list stands on its own', () => {
  it('holds at least ten items with no refresh having run', async () => {
    const rows = await events();
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('gives every item a title, a source feed and a source URL', async () => {
    for (const row of await events()) {
      expect(row.title.trim(), row.id).not.toBe('');
      expect(row.source_feed.trim(), row.id).not.toBe('');
      expect(row.source_url, row.id).toMatch(/^https?:\/\//);
    }
  });

  it('gives every item a date', async () => {
    for (const row of await events()) {
      expect(day(row.occurred_on), row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('orders newest first', async () => {
    const dates = (await events()).map((r) => day(r.occurred_on));
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('uses only the six event types the enum allows', async () => {
    const rows = await dbQuery<{ event_type: string }>(
      `SELECT DISTINCT event_type FROM environmental_events ORDER BY 1`,
    );
    const allowed = ['fire', 'flood', 'pollution', 'earthquake', 'storm', 'haze'];
    for (const row of rows) expect(allowed).toContain(row.event_type);
  });
});

describe('refresh can be idempotent, because dedupe_key is unique', () => {
  it('has a unique dedupe key on every item', async () => {
    const row = await dbOne<{ total: string; keys: string }>(
      `SELECT count(*) AS total, count(DISTINCT dedupe_key) AS keys
         FROM environmental_events`,
    );
    expect(row.keys).toBe(row.total);
  });
});

describe('events are context, never a priced hazard', () => {
  it('keeps earthquake out of the hazard enum, so it can never be scored', async () => {
    const labels = await dbQuery<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'hazard'`,
    );
    const names = labels.map((r) => r.label);
    expect(names).not.toContain('earthquake');
    expect(names).not.toContain('fire');
  });

  it('links events to hotspots without requiring one', async () => {
    /* A `hotspot_id` is a nice-to-have on the popup, not a constraint on the
       feed: an event outside every hotspot is still news. */
    const row = await dbOne<{ linked: string; total: string }>(
      `SELECT count(*) FILTER (WHERE hotspot_id IS NOT NULL) AS linked,
              count(*) AS total
         FROM environmental_events`,
    );
    expect(Number(row.linked)).toBeGreaterThan(0);
    expect(Number(row.linked)).toBeLessThanOrEqual(Number(row.total));
  });

  it('points every linked event at a hotspot that exists', async () => {
    const orphans = await dbQuery<{ id: string }>(
      `SELECT e.id FROM environmental_events e
         LEFT JOIN hotspots h ON h.id = e.hotspot_id
        WHERE e.hotspot_id IS NOT NULL AND h.id IS NULL`,
    );
    expect(orphans).toEqual([]);
  });
});
