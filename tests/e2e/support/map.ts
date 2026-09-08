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
 * The map exposes itself on `window.__portfolioMap` outside production
 * precisely so a spec can ask the rendered style what colour a pin is, rather
 * than sampling canvas pixels and hoping.
 */
export async function openMap(page: Page) {
  await page.goto('/map');
  await page.locator('canvas.maplibregl-canvas').waitFor();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const map = (window as unknown as { __portfolioMap?: MapHandle }).__portfolioMap;
          if (!map || !map.isStyleLoaded()) return 0;
          return map.queryRenderedFeatures({ layers: ['collateral-pins'] }).length;
        }),
      { timeout: 30_000, message: 'the pin layer never rendered any features' },
    )
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
