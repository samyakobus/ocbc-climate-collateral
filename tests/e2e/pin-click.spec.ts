/**
 * tests/e2e/pin-click.spec.ts - AC-7.
 *
 * Clicking a pin opens the matching case. The click goes through the real
 * canvas at the pin's own projected position, so it exercises MapLibre's hit
 * testing rather than a DOM element that happens to sit nearby.
 *
 * Needs a seeded and recomputed database (see slider.spec.ts).
 */

import { expect, test } from '@playwright/test';

import { login, openMap, renderedPins } from './support/map';

/** Click the canvas where MapLibre projects this pin's coordinates. */
async function clickPin(page: import('@playwright/test').Page, id: string) {
  const point = await page.evaluate((pinId) => {
    type Handle = {
      queryRenderedFeatures(o: { layers: string[] }): {
        properties: Record<string, string>;
        geometry: { coordinates: [number, number] };
      }[];
      project(c: [number, number]): { x: number; y: number };
    };
    const map = (window as unknown as { __portfolioMap?: Handle }).__portfolioMap;
    const feature = map
      ?.queryRenderedFeatures({ layers: ['collateral-pins'] })
      .find((f) => f.properties.id === pinId);
    if (!feature || !map) return null;
    const projected = map.project(feature.geometry.coordinates);
    return { x: projected.x, y: projected.y };
  }, id);

  expect(point, `pin ${id} is not on screen`).not.toBeNull();

  const canvas = await page.locator('canvas.maplibregl-canvas').boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + point!.x, canvas!.y + point!.y);
}

test.describe('AC-7: clicking a pin opens its case', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openMap(page);
  });

  test('routes to the case screen for the pin that was clicked', async ({ page }) => {
    const pins = await renderedPins(page);
    const target = pins[0];

    await clickPin(page, target.id);

    await page.waitForURL(new RegExp(`/cases/${target.id}$`));
    await expect(page.getByTestId('case-id')).toHaveText(target.id);
  });

  test('opens a case whose band matches the pin colour it was clicked from', async ({ page }) => {
    const pins = await renderedPins(page);
    const target = pins.find((p) => p.band_today) ?? pins[0];

    await clickPin(page, target.id);
    await page.waitForURL(/\/cases\//);

    /* The case screen defaults to 2050, so compare against that band. */
    await expect(page.getByTestId('case-band')).toHaveAttribute('data-band', target.band_y2050);
  });

  test('shows the case header, breakdown and provenance once opened', async ({ page }) => {
    const pins = await renderedPins(page);

    await clickPin(page, pins[0].id);
    await page.waitForURL(/\/cases\//);

    await expect(page.getByTestId('case-header')).toBeVisible();
    await expect(page.getByTestId('haircut-breakdown')).toBeVisible();
    await expect(page.getByTestId('provenance-panel')).toBeVisible();
    await expect(page.getByTestId('condition-list')).toBeVisible();
  });

  test('gets back to the map from the case screen', async ({ page }) => {
    const pins = await renderedPins(page);

    await clickPin(page, pins[0].id);
    await page.waitForURL(/\/cases\//);

    await page.getByRole('link', { name: 'Map' }).click();
    await page.waitForURL(/\/map$/);
    await expect(page.getByTestId('map-heading')).toBeVisible();
  });
});
