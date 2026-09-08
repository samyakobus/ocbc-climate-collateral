/**
 * Smoke assertion for the Playwright harness (S4).
 *
 * Proves the browser, the `webServer` and the base URL are wired before any
 * criterion depends on them. AC-1, AC-5, AC-7, AC-9, AC-11, AC-14, AC-15 and
 * AC-16 all run through this harness, so it is scheduled on Day 1 rather than
 * discovered on Day 5.
 */

import { expect, test } from '@playwright/test';

test('the app answers on the base URL', async ({ page }) => {
  const response = await page.goto('/');

  expect(response, 'no response from the app; is the dev server running?').not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await expect(page.locator('body')).toBeVisible();
});
