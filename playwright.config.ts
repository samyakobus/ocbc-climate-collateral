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
 *
 * TWO PROJECTS, and the second one is conditional (S26, S28).
 *
 *   default   every spec except the offline suite.
 *   offline   only `offline.spec.ts`, and only when the three outbound hosts
 *             have been pointed somewhere dead.
 *
 * The offline suite is meaningless against live feeds, so it used to guard
 * itself with a `test.skip` inside the file. That was correct and it was not
 * enough: a skip still LISTS as a test, and a green run reading "4 skipped" is
 * one glance away from being read as coverage that does not exist. Worse, the
 * S28 gate has to be able to fail when the offline block did not run, and it
 * cannot tell a deliberate skip from a broken one.
 *
 * So the gating moved here. Without the overrides the `offline` project is not
 * in the array at all: the spec is never collected, never listed, and never
 * counted. With them it is the only thing that project runs, and any skip
 * inside it is a real problem.
 *
 *   npx playwright test                              default only
 *   FEED_EONET_BASE=http://127.0.0.1:9 \
 *   FEED_GIBS_BASE=http://127.0.0.1:9 \
 *   THUMB_BASE=http://127.0.0.1:9 \
 *     npx playwright test --project offline          the four offline tests
 *
 * `npm run verify:all` runs both, and fails the gate if the offline project
 * reports a single skip.
 */

import { defineConfig, devices, type Project } from '@playwright/test';

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

/** Only `tests/e2e/offline.spec.ts`, matched on both path separators. */
const OFFLINE_SPEC = /offline\.spec\.ts$/;

/**
 * The three hosts the offline suite needs pointed somewhere dead.
 *
 * Empty counts as unset, the same rule `lib/config/env.ts` applies, because
 * `.env.example` ships all three declared and blank: a developer who copied it
 * would otherwise enable a project whose whole premise is that the hosts were
 * changed.
 */
const OFFLINE_HOSTS = ['FEED_EONET_BASE', 'FEED_GIBS_BASE', 'THUMB_BASE'] as const;

const overridden = OFFLINE_HOSTS.filter((key) => (process.env[key] ?? '').trim() !== '');
const offlineEnabled = overridden.length === OFFLINE_HOSTS.length;

/*
  Say why, once. Playwright re-evaluates this config in every worker process, so
  the note is fenced behind an environment flag that survives into them; without
  it the same three lines print once per worker and read like an error.
*/
if (!process.env.E2E_OFFLINE_NOTED) {
  process.env.E2E_OFFLINE_NOTED = '1';
  if (!offlineEnabled) {
    const missing = OFFLINE_HOSTS.filter((key) => !overridden.includes(key));
    console.log(
      `[playwright] the "offline" project is not in this run: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not overridden.\n` +
        '[playwright] Asserting an offline fallback against a live feed asserts nothing, so the\n' +
        '[playwright] suite is omitted rather than skipped. To run it:\n' +
        '[playwright]   FEED_EONET_BASE=http://127.0.0.1:9 FEED_GIBS_BASE=http://127.0.0.1:9 \\\n' +
        '[playwright]   THUMB_BASE=http://127.0.0.1:9 npx playwright test --project offline',
    );
  } else {
    console.log(
      '[playwright] the "offline" project is enabled: all three outbound hosts are overridden.',
    );
  }
}

const projects: Project[] = [
  {
    name: 'default',
    testIgnore: OFFLINE_SPEC,
    use: { ...devices['Desktop Chrome'] },
  },
];

if (offlineEnabled) {
  projects.push({
    name: 'offline',
    testMatch: OFFLINE_SPEC,
    use: { ...devices['Desktop Chrome'] },
  });
}

export default defineConfig({
  testDir: './tests/e2e',
  /*
    Artifacts go in a directory of this run's own, keyed by the same port.
    Two runs sharing `test-results/` delete each other's trace and screenshot
    files mid-write, which surfaces as ENOENT on `browserContext.close` and
    fails tests that actually passed. That is worse than a plain collision: it
    reports a red run for a reason that has nothing to do with the application.
  */
  outputDir: `./test-results/run-${appPort}`,
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

  projects,

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
