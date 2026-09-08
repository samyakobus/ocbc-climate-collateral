/**
 * tests/e2e/refresh.spec.ts - S24. AC-14, AC-16, and the failure half of AC-11.
 *
 * What this file can and cannot assert, stated because it is easy to get wrong.
 *
 * It asserts that a GET is refused, that a POST answers with a body the UI can
 * toast, and that every committed tile the strip renders is served locally.
 *
 * The offline failure path is asserted too, but NOT by blocking in the browser.
 * Playwright's `page.route` intercepts requests the BROWSER makes; both refresh
 * routes call out from the SERVER, inside the Next request handler, so a
 * browser-level block never reaches them. I wrote that test first and it failed
 * by succeeding: the route sailed past the interception, reached NASA and
 * returned ok.
 *
 * What works is making the SERVER offline. `lib/feeds/bases.ts` takes all three
 * outbound hosts from the environment, defaulting to the real ones, and
 * `playwright.config.ts` passes the environment through to the web server. So:
 *
 *     FEED_EONET_BASE=http://127.0.0.1:9 FEED_GIBS_BASE=http://127.0.0.1:9  *       npx playwright test tests/e2e/refresh.spec.ts
 *
 * runs the app against a dead port and the offline block below asserts the
 * fallback. Without those variables the block skips, because asserting a
 * fallback against a live feed would assert nothing. S26's offline spec sets
 * them for a whole run.
 *
 * These specs use `request` through the page's context so the session cookie
 * comes along; the routes require a signed-in user.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { login } from './support/map';

type RefreshBody = {
  ok: boolean;
  message: string;
  refreshed?: number;
  inserted?: number;
  updated?: number;
  total?: number;
};

test.describe('AC-16: the news refresh', () => {
  test('rejects GET, because a render path may not call out', async ({ page }) => {
    await login(page);

    const response = await page.request.get('/api/refresh/news');
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toContain('POST');
  });

  test('fetches and reports what changed when the feed is reachable', async ({ page }) => {
    await login(page);

    const response = await page.request.post('/api/refresh/news');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as RefreshBody;
    // The feed may legitimately be unreachable in a sandbox, and the route is
    // built to say so rather than throw. Either answer is valid; a 500 is not.
    if (!body.ok) {
      expect(body.message).toMatch(/cached items/i);
      return;
    }

    expect(body.message).toMatch(/refreshed/i);
    expect(body.total ?? 0).toBeGreaterThanOrEqual(10);
  });

});

/**
 * True when the web server was started with its outbound hosts pointed somewhere
 * dead. The specs below only mean something in that case.
 */
const OFFLINE = Boolean(process.env.FEED_EONET_BASE ?? process.env.FEED_GIBS_BASE);

test.describe('AC-11: a refresh with the server genuinely offline', () => {
  test.skip(
    !OFFLINE,
    'set FEED_EONET_BASE and FEED_GIBS_BASE to a dead port to exercise the offline path',
  );

  test('the news refresh toasts and leaves every item in place', async ({ page }) => {
    await login(page);

    const before = await page.request.post('/api/refresh/news');
    const beforeBody = (await before.json()) as RefreshBody;

    // A dead port is a connection refused, not a 500, and the body says what is
    // still on screen rather than only what failed.
    expect(before.status()).toBe(200);
    expect(beforeBody.ok).toBe(false);
    expect(beforeBody.message).toMatch(/cached items/i);

    // Nothing was written, so a second call reports identically.
    const again = await page.request.post('/api/refresh/news');
    expect(((await again.json()) as RefreshBody).message).toBe(beforeBody.message);
  });

  test('the tile refresh toasts and refreshes nothing', async ({ page }) => {
    await login(page);

    const response = await page.request.post('/api/refresh/tiles');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as RefreshBody;
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/cached imagery/i);
    expect(body.refreshed ?? 0).toBe(0);
  });

  test('every screen still renders, which is the point of the whole rule', async ({ page }) => {
    await login(page);

    for (const path of ['/ai', '/portfolio', '/cases', '/map', '/rules']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} status`).toBeLessThan(400);
    }
  });

  test('the cached tiles still serve, so the strip is not blank', async ({ page }) => {
    await login(page);

    const dir = resolve(process.cwd(), 'public/cache/tiles');
    const files = readdirSync(dir).filter((name) => name.endsWith('.jpg'));

    for (const name of files.slice(0, 3)) {
      const response = await page.request.get(`/cache/tiles/${name}`);
      expect(response.status(), `/cache/tiles/${name}`).toBe(200);
    }
  });
});

test.describe('AC-14: the tile refresh', () => {
  test('rejects GET, because a render path may not call out', async ({ page }) => {
    await login(page);

    const response = await page.request.get('/api/refresh/tiles');
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toContain('POST');
  });

  test('answers with a status the UI can toast, whether or not imagery moved', async ({ page }) => {
    await login(page);

    const response = await page.request.post('/api/refresh/tiles');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as RefreshBody;
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });

  test('serves every cached tile the strip points at, with no network at all', async ({ page }) => {
    await login(page);

    // The strip renders from cached_path, and those files sit under public/.
    // Requesting each one over HTTP proves the imagery is served by this app
    // from disk, so the strip has nothing to fetch when the interface is down.
    const dir = resolve(process.cwd(), 'public/cache/tiles');
    const files = readdirSync(dir).filter((name) => name.endsWith('.jpg'));
    expect(files.length, 'no cached tiles are committed').toBeGreaterThanOrEqual(12);

    for (const name of files) {
      const response = await page.request.get(`/cache/tiles/${name}`);
      expect(response.status(), `/cache/tiles/${name}`).toBe(200);

      const body = await response.body();
      expect(body.byteLength, `${name} is too small to be imagery`).toBeGreaterThan(512);
      // JPEG magic. A 200 that returns an HTML error page would otherwise pass.
      expect(body[0], `${name} is not a JPEG`).toBe(0xff);
      expect(body[1], `${name} is not a JPEG`).toBe(0xd8);
    }
  });
});
