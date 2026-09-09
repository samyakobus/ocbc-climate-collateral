/**
 * tests/e2e/refresh.spec.ts - S24. AC-14, AC-16, and the failure half of AC-11.
 *
 * What this file can and cannot assert, stated because it is easy to get wrong.
 *
 * It asserts that a GET is refused, that a POST answers with a body the UI can
 * toast, and that every committed tile the strip renders is served locally.
 *
 * THE OFFLINE HALF IS NOT IN THIS FILE, and that is deliberate.
 *
 * It used to be, guarded by a `test.skip` on the three feed hosts, and it
 * reported badly: a skipped test still LISTS, so every default run ended "39
 * passed, 4 skipped" for ever, and a Skipped column that always reads 4 is one
 * people stop reading. Those four tests now live in `offline.spec.ts`, which
 * `playwright.config.ts` collects only when the hosts are overridden. The
 * default project reports 0 skipped, so any skip in it is now a real signal.
 *
 * Why blocking in the browser cannot do it, recorded because it is easy to try:
 * Playwright's `page.route` intercepts requests the BROWSER makes, and both
 * refresh routes call out from the SERVER inside the Next handler. Written that
 * way first, the test failed by succeeding, reaching NASA and returning ok.
 *
 * These specs use `request` through the page's context so the session cookie
 * comes along; the routes require a signed-in user.
 */


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

    /*
      THE STRIP, not the directory, and the difference is what this test used to
      get wrong.

      It read `public/cache/tiles` and required every file in it to serve. That
      punished the route for doing its job: a successful refresh writes a NEW
      file under a content-hashed name, deliberately leaving the old one in
      place, and `next start` serves the build-time snapshot of `public/`, so a
      file written after the build 404s. One live refresh earlier in the same run
      therefore turned a passing suite red, and the thing it reported was correct
      behaviour.

      Asking the rendered page which files it points at is both the assertion the
      name promises and immune to extra files on disk.
    */
    await page.goto('/ai');
    const sources = await page.locator('[data-testid^="tile-"] img').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLImageElement).getAttribute('src') ?? ''),
    );

    expect(sources.length, 'the strip rendered no tiles').toBeGreaterThanOrEqual(12);

    for (const src of sources) {
      expect(src, `${src} is not a local cached path`).toMatch(/^\/cache\/tiles\//);

      const response = await page.request.get(src);
      expect(response.status(), src).toBe(200);

      const body = await response.body();
      expect(body.byteLength, `${src} is too small to be imagery`).toBeGreaterThan(512);
      // JPEG magic. A 200 that returns an HTML error page would otherwise pass.
      expect(body[0], `${src} is not a JPEG`).toBe(0xff);
      expect(body[1], `${src} is not a JPEG`).toBe(0xd8);
    }
  });
});
