/**
 * tests/e2e/slider.spec.ts - AC-5.
 *
 * The scenario slider changes pin colours in all five countries, and a sampled
 * pin's colour equals its case band. Both halves matter: the first is the beat
 * the demo performs live, the second is what stops the map and the case screen
 * telling a director two different stories.
 *
 * Colours are read out of the rendered MapLibre style rather than sampled from
 * canvas pixels, so a failure names the pin and the band rather than a colour
 * that is nearly right.
 *
 * Needs a seeded and recomputed database:
 *   npm run db:up (leave running), npm run db:migrate, npm run db:seed,
 *   npm run db:recompute
 */

import { expect, test } from '@playwright/test';

import { colourScenario, login, openMap, renderedPins } from './support/map';

const SOUTHERN = ['SG', 'MY', 'ID'];
const NORTHERN = ['CN', 'HK'];

test.describe('AC-5: the scenario slider recolours the map', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openMap(page);
  });

  test('opens at 2025 (origination), never labelled "today"', async ({ page }) => {
    const slider = page.getByRole('slider', { name: 'Scenario' });
    await expect(slider).toHaveValue('0');
    await expect(slider).toHaveAttribute('aria-valuetext', '2025 (origination)');
    await expect(page.getByTestId('scenario-tick-today')).toHaveText('2025 (origination)');
    await expect(page.getByTestId('scenario-slider')).not.toHaveText(/\btoday\b/i);
  });

  test('draws every pin in the portfolio', async ({ page }) => {
    const pins = await renderedPins(page);
    expect(pins).toHaveLength(200);
    expect(new Set(pins.map((p) => p.id)).size).toBe(200);
  });

  test('shows the ADR-5 split at origination across all five countries', async ({ page }) => {
    const pins = await renderedPins(page);

    /*
      Flood and heat are both zero at the reference window, so the southern
      three carry nothing: they score neither wind nor PM2.5. Hong Kong and
      coastal China carry their full present-climate wind plus chronic PM2.5.
      The applicability table is what separates them, not a country branch.
    */
    for (const country of SOUTHERN) {
      const bands = new Set(pins.filter((p) => p.country === country).map((p) => p.band_today));
      expect([...bands], `${country} at origination`).toEqual(['green']);
    }
    for (const country of NORTHERN) {
      const bands = new Set(pins.filter((p) => p.country === country).map((p) => p.band_today));
      expect([...bands], `${country} at origination`).toEqual(['amber']);
    }
  });

  test('repaints from the 2050 band when the slider moves', async ({ page }) => {
    expect(await colourScenario(page)).toContain('band_today');

    await page.getByTestId('scenario-tick-y2050').click();

    await expect
      .poll(() => colourScenario(page))
      .toContain('band_y2050');
  });

  test('changes colours in all five countries between origination and 2050', async ({ page }) => {
    const pins = await renderedPins(page);

    for (const country of [...SOUTHERN, ...NORTHERN]) {
      const moved = pins.filter(
        (p) => p.country === country && p.band_today !== p.band_y2050,
      );
      expect(moved.length, `${country} pins that change colour`).toBeGreaterThan(0);
    }
  });

  test('spreads the 2050 column across more than one band', async ({ page }) => {
    const pins = await renderedPins(page);
    const bands = new Set(pins.map((p) => p.band_y2050));
    /* A single-colour 2050 column would make the slider pointless on stage. */
    expect(bands.size).toBeGreaterThanOrEqual(3);
  });

  test('gives a sampled pin the same band its case screen shows', async ({ page }) => {
    const pins = await renderedPins(page);

    /* One pin per band, so the assertion covers the whole colour scale rather
       than whichever band happens to be first. */
    const samples = ['green', 'amber', 'orange', 'red']
      .map((band) => pins.find((p) => p.band_y2050 === band))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    expect(samples.length).toBeGreaterThanOrEqual(3);

    for (const pin of samples) {
      await page.goto(`/cases/${pin.id}?scenario=y2050`);
      await expect(page.getByTestId('case-id')).toHaveText(pin.id);
      await expect(page.getByTestId('case-band')).toHaveAttribute('data-band', pin.band_y2050);
    }
  });
});
