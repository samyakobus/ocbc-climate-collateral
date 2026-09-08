/**
 * Playwright harness (plan S4, section 4.1; isolation per #31).
 *
 * One worker, because every spec runs against one seeded database and AC-9
 * deliberately mutates the active rule set. Trace is retained on failure, so a
 * red run on demo day is diagnosable without a re-run.
 *
 * DATABASE ISOLATION. `scripts/e2e-server.ts` is the web server. It starts its
 * own in-memory PGlite with real PostGIS, migrates, seeds and recomputes it,
 * then launches `next dev` against that DATABASE_URL, and takes the database
 * down with it. The specs therefore cannot disturb the shared development
 * database and cannot be disturbed by it.
 *
 * The bootstrap lives in that script rather than in a `globalSetup` hook
 * because Playwright loads its config and hooks through a CommonJS transform,
 * and the migrate and seed modules are ESM using `import.meta.url`, which that
 * transform cannot represent. Keeping the lifecycle in one ordinary `tsx`
 * process also makes it obvious: the database lives exactly as long as the
 * server.
 *
 * The application port is derived from this process id rather than fixed, so a
 * run never collides with a dev server on 3000 and two runs do not collide with
 * each other. It is never reused either, because an existing dev server points
 * at the SHARED database and reusing it would silently undo the isolation.
 *
 * Set `E2E_DATABASE_URL` to point the run at a stack you manage instead, such
 * as the compose database on demo day. Set `PLAYWRIGHT_BASE_URL` to skip the
 * server entirely and drive an application that is already running.
 */

import { defineConfig, devices } from '@playwright/test';

/** True when driving an application someone else started. */
const externalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

/*
  The application port, chosen once and then shared through the environment.

  Synchronous by necessity: Playwright evaluates this config with `require`, so
  there is no awaiting a free-port probe here. Deriving it from `process.pid`
  alone is not enough either, because Playwright re-evaluates this file in every
  worker process and each would derive a DIFFERENT port, leaving the tests
  pointed at nothing while the server listened elsewhere. Writing it back to
  `process.env` fixes it for the run: workers inherit the parent environment.
*/
if (!process.env.E2E_PORT) {
  process.env.E2E_PORT = String(3100 + (process.pid % 700));
}

const appPort = Number(process.env.E2E_PORT);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${appPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  /* AC-9 rewrites the active rule set, so specs share state and run in order. */
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: externalServer
    ? undefined
    : {
        command: 'npx tsx scripts/e2e-server.ts',
        url: baseURL,
        /*
          Never reuse. An existing dev server is pointed at the SHARED database,
          so reusing it would quietly defeat the isolation and leave the specs
          writing to the instance everyone else is working against.
        */
        reuseExistingServer: false,
        /* Migrating, seeding and recomputing 600 valuations before Next starts. */
        timeout: 240_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PORT: String(appPort) },
      },
});
