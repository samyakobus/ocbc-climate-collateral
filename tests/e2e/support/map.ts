/**
 * Shared helpers for the map end-to-end specs (S16).
 *
 * Not a spec file: Playwright's `testMatch` only picks up `*.spec.ts`, so this
 * module is imported rather than run.
 */

import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Demo!2026';
export const RISK_MANAGER = 'risk@ocbc.demo';

/**
 * Log in and wait until the session is actually established.
 *
 * The wait matters: the server action sets the cookie and redirects, so a test
 * that navigates immediately after the click races the response and arrives
 * unauthenticated.
 */
export async function login(page: Page, email = RISK_MANAGER, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/**
 * Open /map and wait until the style has parsed and the pin layer carries
 * features.
 *
 * TWO WAITS, IN THIS ORDER, AND THE ORDER IS THE POINT.
 *
 * First `data-map-ready`, a plain DOM attribute the component sets once the pin
 * layer is on the map. A DOM signal survives anything the bundler does, which
 * the window handle demonstrably did not: it used to be assigned behind
 * `process.env.NODE_ENV !== 'production'`, Next inlined that to `false`, the
 * assignment was eliminated from the build, and every map spec then reported
 * "the pin layer never rendered any features" for pins that were on screen the
 * whole time. The end-to-end run serves the build, so that was every run.
 *
 * Then the handle, because these specs genuinely need it: reading a pin's
 * colour out of the rendered paint expression is the only alternative to
 * sampling canvas pixels and hoping. It is now assigned unconditionally. The
 * DOM wait first means a future regression in the handle fails with a message
 * about the handle rather than one that blames the map.
 */
export async function openMap(page: Page) {
  await page.goto('/map');
  await assertAssetsLoaded(page, '/map');
  await page.locator('canvas.maplibregl-canvas').waitFor();
  await expect(page.getByTestId('portfolio-map')).toHaveAttribute('data-map-ready', 'true', {
    timeout: 90_000,
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const map = (window as unknown as { __portfolioMap?: MapHandle }).__portfolioMap;
          if (!map || !map.isStyleLoaded()) return 0;
          return map.queryRenderedFeatures({ layers: ['collateral-pins'] }).length;
        }),
      /* Generous, because this may be the first hit on /map against a cold dev
         server: Turbopack compiles the MapLibre bundle on demand. */
      { timeout: 90_000, message: 'the pin layer never rendered any features' },
    )
    .toBeGreaterThan(0);
}

/**
 * Fail fast, and by name, when the page arrives without its static assets.
 *
 * This exists because of a real intermittent failure that was costing ninety
 * seconds and naming the wrong thing. Roughly one full run in three, a
 * navigation to `/map` came back with the server-rendered HTML but with NEITHER
 * the stylesheet NOR the client bundle: the screenshot showed unstyled markup,
 * the accessibility snapshot carried no `<canvas>` at all because the client
 * component never mounted, and the map container had no height because nothing
 * had styled it. The only symptom the specs reported was "waiting for
 * locator('canvas.maplibregl-canvas') to be visible", which reads as a broken
 * map and sends the next person to look at MapLibre.
 *
 * A missing stylesheet is checked rather than a missing script because it is
 * the cheaper and more reliable signal: `document.styleSheets` is populated
 * synchronously as the sheet parses, and the app ships exactly one. The timeout
 * is short on purpose. If the assets are coming at all they are already here;
 * waiting longer only delays a failure whose cause is not the application.
 *
 * This diagnoses, it does not fix. The underlying flake is in serving
 * `/_next/static/**` and is recorded in plan section 10.
 */
async function assertAssetsLoaded(page: Page, route: string): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => document.styleSheets.length), {
      timeout: 15_000,
      message:
        `${route} rendered without its stylesheet, so the client bundle did not load ` +
        'either and no component mounted. This is the static-asset flake, not a map ' +
        'fault: re-run the spec. See plan section 10.',
    })
    .toBeGreaterThan(0);
}

/** The minimum of MapLibre's surface these specs touch. */
type MapHandle = {
  isStyleLoaded(): boolean;
  queryRenderedFeatures(options: { layers: string[] }): {
    properties: Record<string, string>;
  }[];
  getPaintProperty(layer: string, property: string): unknown;
  jumpTo(options: { center: [number, number]; zoom: number }): void;
  project(coords: [number, number]): { x: number; y: number };
};

/** Every rendered pin's id and its band at each scenario. */
export async function renderedPins(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __portfolioMap?: MapHandle }).__portfolioMap;
    if (!map) return [];
    return map.queryRenderedFeatures({ layers: ['collateral-pins'] }).map((f) => ({
      id: f.properties.id,
      country: f.properties.country,
      band_today: f.properties.band_today,
      band_y2030: f.properties.band_y2030,
      band_y2050: f.properties.band_y2050,
    }));
  });
}

/** Which scenario the pin layer's colour expression is currently reading. */
export async function colourScenario(page: Page): Promise<string> {
  return page.evaluate(() => {
    const map = (window as unknown as { __portfolioMap?: MapHandle }).__portfolioMap;
    const paint = map?.getPaintProperty('collateral-pins', 'circle-color');
    return JSON.stringify(paint ?? null);
  });
}
