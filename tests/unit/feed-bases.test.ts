/**
 * tests/unit/feed-bases.test.ts - S26. The mechanism AC-11's automated half rests on.
 *
 * The offline spec cannot block a server-side fetch from the browser, so it
 * instead starts its web server with the three outbound hosts pointed at a dead
 * port. That only works if every outbound URL in the app is actually built from
 * these bases. This asserts that, and asserts the defaults are the real hosts so
 * a normal run is untouched.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { anyBaseOverridden, eonetBase, gibsBase, rewriteToBase, thumbBase } from '../../lib/feeds/bases';
import { eonetUrl } from '../../lib/feeds/eonet';
import { captureDateOf, withCaptureDate } from '../../lib/feeds/gibs';

const KEYS = ['FEED_EONET_BASE', 'FEED_GIBS_BASE', 'THUMB_BASE'] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('the defaults are the real hosts', () => {
  it('points at NASA and Google when nothing is set', () => {
    expect(eonetBase()).toBe('https://eonet.gsfc.nasa.gov');
    expect(gibsBase()).toBe('https://gibs.earthdata.nasa.gov');
    expect(thumbBase()).toBe('https://maps.googleapis.com');
    expect(anyBaseOverridden()).toBe(false);
  });

  it('builds the real EONET feed URL with the regional bbox and the 90-day window', () => {
    const url = eonetUrl();
    expect(url.startsWith('https://eonet.gsfc.nasa.gov/api/v3/events?')).toBe(true);
    expect(url).toContain('days=90');
    expect(url).toContain('bbox=95,33,125,-11');
  });
});

describe('an override reaches every outbound URL', () => {
  it('moves the EONET feed to the configured host', () => {
    process.env.FEED_EONET_BASE = 'http://127.0.0.1:9';
    expect(eonetBase()).toBe('http://127.0.0.1:9');
    expect(eonetUrl().startsWith('http://127.0.0.1:9/api/v3/events?')).toBe(true);
    expect(anyBaseOverridden()).toBe(true);
  });

  it('moves a stored GIBS tile URL to the configured host, keeping its path', () => {
    // The seeded live_url carries the real NASA host. The refresh reuses that URL
    // rather than rebuilding one, so the rewrite is how an override reaches it.
    const stored =
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
      'MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-09-07/' +
      'GoogleMapsCompatible_Level9/6/33/50.jpg';

    expect(withCaptureDate(stored, '2026-09-08')).toBe(
      stored.replace('2026-09-07', '2026-09-08'),
    );

    process.env.FEED_GIBS_BASE = 'http://127.0.0.1:9';
    const moved = withCaptureDate(stored, '2026-09-08');

    expect(moved).not.toBeNull();
    expect(moved!.startsWith('http://127.0.0.1:9/wmts/epsg3857/best/')).toBe(true);
    // The layer, matrix set, zoom and tile indices are untouched: prep decides
    // which tile a metro is, and the override must not be able to change that.
    expect(moved!).toContain('MODIS_Terra_CorrectedReflectance_TrueColor');
    expect(moved!).toContain('GoogleMapsCompatible_Level9/6/33/50.jpg');
    expect(captureDateOf(moved!)).toBe('2026-09-08');
  });

  it('tolerates a trailing slash on the configured base', () => {
    process.env.FEED_EONET_BASE = 'http://127.0.0.1:9/';
    expect(eonetBase()).toBe('http://127.0.0.1:9');
    expect(eonetUrl()).not.toContain('//api/v3');
  });

  it('reads the environment per call, not once at import', () => {
    // Otherwise the value would depend on import order relative to whatever set
    // it, which is exactly the kind of thing that works locally and not in CI.
    expect(eonetBase()).toBe('https://eonet.gsfc.nasa.gov');
    process.env.FEED_EONET_BASE = 'http://127.0.0.1:9';
    expect(eonetBase()).toBe('http://127.0.0.1:9');
    delete process.env.FEED_EONET_BASE;
    expect(eonetBase()).toBe('https://eonet.gsfc.nasa.gov');
  });
});

describe('rewriteToBase', () => {
  it('replaces the origin and keeps path, query and fragment', () => {
    expect(rewriteToBase('https://a.example/x/y?z=1#f', 'http://127.0.0.1:9')).toBe(
      'http://127.0.0.1:9/x/y?z=1#f',
    );
  });

  it('returns an unparseable URL unchanged rather than throwing', () => {
    // A malformed stored URL is a data problem for the caller's error path. A
    // throw here would turn it into a 500 instead of a toast.
    expect(rewriteToBase('not a url', 'http://127.0.0.1:9')).toBe('not a url');
  });

  it('leaves a URL alone when the base matches its own origin', () => {
    const url = 'https://gibs.earthdata.nasa.gov/wmts/a.jpg';
    expect(rewriteToBase(url, 'https://gibs.earthdata.nasa.gov')).toBe(url);
  });
});
