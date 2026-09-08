/**
 * tests/e2e/rule-edit.spec.ts - AC-9, in the browser, with no restart.
 *
 * The risk manager edits a threshold, saves, and the rest of the application
 * shows the new bands immediately. That is the one step of the demo performed
 * live, so this drives it the way the presenter will.
 *
 * The test restores the original threshold at the end, because it shares the
 * database with every other spec and with whatever is on screen.
 */

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo!2026';

/**
 * Sign in from a clean session.
 *
 * The caller clears cookies first. Without that, /login redirects a signed-in
 * visitor straight to their home route and the form is never rendered, so the
 * helper would wait for an Email field that cannot appear.
 */
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function setBandMid(page: Page, value: string) {
  await page.goto('/rules');
  await page.getByLabel('Band mid').fill(value);
  await page.getByRole('button', { name: /Save and recompute/ }).click();
  await expect(page.getByTestId('rules-saved')).toBeVisible({ timeout: 60_000 });
}

test.describe('AC-9: editing a threshold recomputes with no restart', () => {
  /* Saving recomputes 600 valuations, and the cleanup hook saves again. */
  test.setTimeout(180_000);

  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await login(page, 'risk@ocbc.demo');
  });

  /*
    Restore the seeded thresholds ONCE, at the end, in its own page.

    Restoring after every test meant six full 600-valuation recomputes in a file
    that only changes the edge four times, and the extra work made whichever
    test ran alongside it time out. One restore is enough: Playwright runs spec
    files in sequence, so this completes before any other spec reads them.

    This restores the VALUES rather than reactivating the original row, because
    saving is the only way the application writes a rule set and this spec
    drives the application. The db tests restore the exact original id instead,
    which they can because they write SQL directly. Either way the invariant is
    the same and it is the one stated in tests/setup/db.ts: a test that touches
    rule_sets leaves the active thresholds exactly as it found them.

    Since #31 this runs against a database that exists only for this run, so a
    failure here can no longer leak into anyone else's work.
  */
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await login(page, 'risk@ocbc.demo');
      await setBandMid(page, '0.1');
      await expect(page.getByLabel('Band mid')).toHaveValue('0.1');
    } finally {
      await page.close();
    }
  });

  test('raising the mid band recomputes and reports what changed', async ({ page }) => {
    await page.goto('/rules');
    const before = await page.getByTestId('active-rule-set').textContent();

    await setBandMid(page, '0.12');

    /* The confirmation names the work done, rather than blinking silently. */
    await expect(page.getByTestId('rules-saved')).toContainText('600 valuations');

    /* A NEW rule set is active: the previous one was kept, not edited. */
    const after = await page.getByTestId('active-rule-set').textContent();
    expect(after).not.toBe(before);
  });

  test('the new bands are visible elsewhere immediately, with no restart', async ({ page }) => {
    await setBandMid(page, '0.12');

    /* Navigate away and back: no reload of the server, no restart. */
    await page.goto('/portfolio');
    await expect(page.getByTestId('portfolio-heading')).toBeVisible();

    await page.goto('/rules');
    await expect(page.getByLabel('Band mid')).toHaveValue('0.12');
  });

  test('refuses an incoherent edit and changes nothing', async ({ page }) => {
    await page.goto('/rules');

    const activeBefore = await page.getByTestId('active-rule-set').textContent();

    /* Mid below low: the bands would no longer increase. */
    await page.getByLabel('Band mid').fill('0.01');
    await page.getByRole('button', { name: /Save and recompute/ }).click();

    await expect(page.getByTestId('rules-error')).toBeVisible();
    await expect(page.getByTestId('rules-error')).toContainText('must increase');

    await page.reload();
    expect(await page.getByTestId('active-rule-set').textContent()).toBe(activeBefore);
  });

  test('shows the horizon probabilities with their n, and return period read-only', async ({
    page,
  }) => {
    await page.goto('/rules');

    await expect(page.getByLabel('P at n = 0')).toHaveValue('0');
    await expect(page.getByLabel('P at n = 5')).toHaveValue('0.05');
    await expect(page.getByLabel('P at n = 25')).toHaveValue('0.22');

    const returnPeriod = page.getByTestId('return-period');
    await expect(returnPeriod).toHaveValue('100');
    await expect(returnPeriod).toBeDisabled();
  });

  test('is not reachable by a loan officer', async ({ context, page }) => {
    await context.clearCookies();
    await login(page, 'officer@ocbc.demo');

    await page.goto('/rules');
    /* A generous timeout: this runs straight after a save that recomputed 600
       valuations, and the dev server may still be compiling /cases. The guard
       is what is under test, not how fast Turbopack is. */
    await expect(page).toHaveURL(/\/cases\?segment=personal$/, { timeout: 30_000 });
    await expect(page.getByTestId('rules-heading')).toHaveCount(0);
  });
});
