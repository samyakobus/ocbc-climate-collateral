/**
 * tests/e2e/hotspot-popup.spec.ts - AC-15, AC-17, and AC-14/AC-16 offline.
 *
 * Clicking a hotspot enlarges its pointer and opens a panel carrying the summary
 * and the loan exposure. The pointer size is read out of the rendered MapLibre
 * paint expression rather than from pixels, so a failure names the radius rather
 * than a colour that is nearly right.
 *
 * The last block is the one that matters most on demo day: with every outbound
 * route blocked, the whole dashboard still renders. Nothing on it is fetched at
 * render time, so the only thing that can fail is a refresh, and a refresh
 * failure must leave the page exactly as it was.
 *
 * Needs a seeded database (see slider.spec.ts).
 */

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo!2026';

async function loginAsRiskManager(page: Page) {
  page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE CONSOLE ERROR:', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message.slice(0, 300)));
  await page.goto('/login');
  await page.getByLabel('Email').fill('risk@ocbc.demo');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/ai$/);
}

/** Wait until the hotspot layer has features rendered. */
async function openDashboard(page: Page) {
  await loginAsRiskManager(page);
  await page.getByTestId('ai-heading').waitFor();
  await page.locator('canvas.maplibregl-canvas').first().waitFor();

  /* The DOM readiness signal first, then the handle. See `support/map.ts` for
     why the order matters: the handle was once eliminated from the build and
     every map spec blamed the map for it. */
  await expect(page.getByTestId('hotspot-map')).toHaveAttribute('data-map-ready', 'true', {
    timeout: 90_000,
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const map = (window as unknown as { __hotspotMap?: MapHandle }).__hotspotMap;
          if (!map || !map.isStyleLoaded()) return 0;
          return map.queryRenderedFeatures({ layers: ['hotspot-pointers'] }).length;
        }),
      /* Generous, because this may be the first hit on /ai against a cold dev
         server: Turbopack compiles the MapLibre bundle on demand and that first
         compile can take most of a minute. The assertion still fails if the
         pointers never arrive. */
      { timeout: 90_000, message: 'the hotspot layer never rendered any pointers' },
    )
    .toBeGreaterThan(0);
}

type MapHandle = {
  isStyleLoaded(): boolean;
  queryRenderedFeatures(o: { layers: string[] }): { properties: Record<string, string> }[];
  getPaintProperty(layer: string, property: string): unknown;
};

/* The first /ai render compiles the map bundle; give the whole file room. */
test.describe.configure({ timeout: 120_000 });

test.describe('AC-15: the hotspot popup', () => {
  test('renders a pointer for every hotspot', async ({ page }) => {
    await openDashboard(page);

    const count = await page.evaluate(() => {
      const map = (window as unknown as { __hotspotMap?: MapHandle }).__hotspotMap;
      return map?.queryRenderedFeatures({ layers: ['hotspot-pointers'] }).length ?? 0;
    });

    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('opens a panel with the summary and the loan exposure', async ({ page }) => {
    await openDashboard(page);

    const first = page.locator('[data-testid^="hotspot-item-"]').first();
    const id = (await first.getAttribute('data-testid'))!.replace('hotspot-item-', '');
    await first.click();

    /* Identity, not a substring of the list row. The panel carries the id it was
       opened for, so this asserts that clicking one hotspot opens that hotspot
       rather than that two pieces of text happen to overlap. */
    const popup = page.getByTestId('hotspot-popup');
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAttribute('data-hotspot-id', id);

    await expect(page.getByTestId('hotspot-name')).not.toBeEmpty();
    await expect(page.getByTestId('hotspot-exposure')).toContainText('S$');
    await expect(page.getByTestId('hotspot-share')).toContainText('%');
    await expect(page.getByTestId('hotspot-summary')).toBeVisible();
  });

  test('enlarges the selected pointer', async ({ page }) => {
    await openDashboard(page);

    const before = await page.evaluate(() => {
      const map = (window as unknown as { __hotspotMap?: MapHandle }).__hotspotMap;
      return JSON.stringify(map?.getPaintProperty('hotspot-pointers', 'circle-radius'));
    });

    await page.locator('[data-testid^="hotspot-item-"]').first().click();
    await expect(page.getByTestId('hotspot-popup')).toBeVisible();

    const after = await page.evaluate(() => {
      const map = (window as unknown as { __hotspotMap?: MapHandle }).__hotspotMap;
      return JSON.stringify(map?.getPaintProperty('hotspot-pointers', 'circle-radius'));
    });

    /* The selected pointer gains a constant, so the expression itself changes. */
    expect(after).not.toBe(before);
    expect(after).toContain('case');
  });

  test('shows the score section with its reference index and state', async ({ page }) => {
    await openDashboard(page);
    await page.locator('[data-testid^="hotspot-item-"]').first().click();

    await expect(page.getByTestId('score-gauge')).toBeVisible();

    /* Attached, not visible. The reference index is always in the DOM, but it
       is rendered for screen readers only when the dial is already showing it,
       which is the fallback and not-yet-scored states. */
    await expect(page.getByTestId('reference-index')).toBeAttached();

    /* Whatever the state, the badges element is present and names it. Before
       prep:reference and prep:scores have run that state is `unscored`. */
    const badges = page.getByTestId('score-badges');
    await expect(badges).toBeVisible();
    const state = await badges.getAttribute('data-state');
    expect(['model', 'divergent', 'fallback', 'unscored']).toContain(state);
  });

  test('closes back to the hotspot list', async ({ page }) => {
    await openDashboard(page);
    await page.locator('[data-testid^="hotspot-item-"]').first().click();
    await expect(page.getByTestId('hotspot-popup')).toBeVisible();

    await page.getByRole('button', { name: 'Close hotspot detail' }).click();

    await expect(page.getByTestId('hotspot-list')).toBeVisible();
  });
});

test.describe('AC-14 and AC-16: the dashboard renders with the network down', () => {
  test('renders the strip, the map and the news list with every outbound route blocked', async ({
    page,
    context,
  }) => {
    await loginAsRiskManager(page);

    /* Block everything that is not this app. If any panel needed the network at
       render time, it would fail here rather than on stage.

       The origin is read from the page rather than written down. The harness
       derives the application port from the runner's process id, so a literal
       `localhost:3000` allowlist blocked the application itself and the
       navigation below died with ERR_FAILED. */
    const appOrigin = new URL(page.url()).origin;
    await context.route(
      (url) => url.origin !== appOrigin,
      (route) => route.abort(),
    );

    await page.goto('/ai');
    await expect(page.getByTestId('ai-heading')).toBeVisible();
    await expect(page.getByTestId('satellite-strip')).toBeVisible();
    await expect(page.getByTestId('news-list')).toBeVisible();
    await expect(page.getByTestId('hotspot-list')).toBeVisible();

    const items = await page.locator('[data-testid^="news-item-"]').count();
    expect(items).toBeGreaterThanOrEqual(10);

    const tiles = await page.locator('[data-testid^="tile-"]').count();
    expect(tiles).toBeGreaterThan(0);
  });

  test('a failed refresh reports it and removes nothing', async ({ page, context }) => {
    await loginAsRiskManager(page);
    await page.goto('/ai');
    await expect(page.getByTestId('news-list')).toBeVisible();

    const before = await page.locator('[data-testid^="news-item-"]').count();

    /* Every request from this point on is aborted, the application's own
       included. The server action therefore rejects in the browser, the button
       takes its catch path and reports the failure, and the rendered items are
       untouched because nothing re-fetched them.

       Aborting the application origin too is deliberate here, and it is the
       only way this spec can force the failure by itself: the refresh route's
       own outbound call is made by the SERVER, which a browser route handler
       cannot reach. Pointing the feed hosts at a dead port is worker-a's
       offline spec (#34); this one covers the client half. */
    await context.route(/.*/, (route) => route.abort());
    await page.getByTestId('refresh-news').click();

    await expect(page.getByTestId('refresh-news-status')).toBeVisible({ timeout: 30_000 });
    expect(await page.locator('[data-testid^="news-item-"]').count()).toBe(before);
  });
});
