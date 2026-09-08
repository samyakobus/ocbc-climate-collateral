/**
 * tests/e2e/auth.spec.ts - AC-1, authored in S3 alongside the feature.
 *
 * AC-1 as amended on 2026-09-07: each of the three seeded accounts lands on its
 * own home route, the risk manager lands on the AI Dashboard with the portfolio
 * dashboard one click away in the top navigation, and there is no sign-up.
 *
 * Needs a seeded database:
 *   npm run db:up  (leave running), npm run db:migrate, npm run db:seed
 */

import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo!2026';

const ACCOUNTS = [
  {
    email: 'officer@ocbc.demo',
    role: 'loan officer',
    landing: /\/cases\?segment=personal$/,
    segment: 'personal',
  },
  {
    email: 'corp@ocbc.demo',
    role: 'corporate credit officer',
    landing: /\/cases\?segment=corporate$/,
    segment: 'corporate',
  },
  {
    email: 'risk@ocbc.demo',
    role: 'risk manager',
    landing: /\/ai$/,
    segment: null,
  },
] as const;

/** Fill the form and submit it, without assuming the attempt succeeds. */
async function submitLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Log in and wait until the session is actually established.
 *
 * The wait matters: the server action sets the cookie and redirects, so a test
 * that navigates immediately after the click races the response and arrives
 * unauthenticated.
 */
async function login(page: Page, email: string, password = PASSWORD) {
  await submitLogin(page, email, password);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('AC-1: login, roles and landing routes', () => {
  for (const account of ACCOUNTS) {
    test(`the ${account.role} lands on its own home route`, async ({ page }) => {
      await login(page, account.email);

      await expect(page).toHaveURL(account.landing);

      if (account.segment) {
        await expect(page.getByTestId('cases-segment')).toHaveText(
          `Segment: ${account.segment}`,
        );
      } else {
        await expect(page.getByTestId('ai-heading')).toBeVisible();
      }
    });
  }

  test('the risk manager reaches the portfolio dashboard in one click from /ai', async ({
    page,
  }) => {
    await login(page, 'risk@ocbc.demo');
    await expect(page).toHaveURL(/\/ai$/);

    /* One click, from the top navigation, with no intermediate page. */
    await page.getByRole('link', { name: 'Portfolio' }).click();

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId('portfolio-heading')).toBeVisible();
  });

  test('there is no sign-up route', async ({ page }) => {
    const response = await page.goto('/signup');
    expect(response?.status()).toBe(404);
  });

  test('an unauthenticated visitor is sent to the login page', async ({ page }) => {
    await page.goto('/cases');
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a wrong password is refused, and says nothing about which accounts exist', async ({
    page,
  }) => {
    await submitLogin(page, 'officer@ocbc.demo', 'wrong-password');

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    const refused = await page.getByTestId('login-error').textContent();
    expect(refused).toBeTruthy();

    /* An unknown address must be refused in exactly the same words. */
    await submitLogin(page, 'nobody@ocbc.demo', PASSWORD);
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.getByTestId('login-error').textContent()).toBe(refused);
  });

  test('an officer cannot reach the risk-manager-only threshold editor', async ({ page }) => {
    await login(page, 'officer@ocbc.demo');

    await page.goto('/rules');

    /* Sent to their own home route rather than shown a denial. */
    await expect(page).toHaveURL(/\/cases\?segment=personal$/);
    await expect(page.getByTestId('rules-heading')).toHaveCount(0);
  });

  test('the navigation offers each role only its own destinations', async ({ page }) => {
    await login(page, 'officer@ocbc.demo');
    await expect(page.getByRole('link', { name: 'Cases' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'AI Dashboard' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Portfolio' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await login(page, 'risk@ocbc.demo');
    await expect(page.getByRole('link', { name: 'AI Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Portfolio' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Thresholds' })).toBeVisible();
  });

  test('signing out ends the session', async ({ page }) => {
    await login(page, 'risk@ocbc.demo');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login$/);

    /* The session is gone, not merely navigated away from. */
    await page.goto('/ai');
    await expect(page).toHaveURL(/\/login$/);
  });
});
