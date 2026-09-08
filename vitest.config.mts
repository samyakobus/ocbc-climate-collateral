/**
 * Vitest harness, three projects (plan S4, section 4.1).
 *
 *   unit       node, no database. Formula, curve, band, payload and validation
 *              tests. Fast, and the project the AC-2 and AC-17 pure assertions
 *              are assigned to.
 *   component  jsdom + Testing Library. Rendered-component assertions.
 *   db         node, against the seeded database over the Postgres wire
 *              protocol. PGlite locally (`npm run db:up`), postgis/postgis:16-3.4
 *              under compose; the tests cannot tell the difference.
 *
 * DEVIATION from plan section 4.1, recorded in section 10 (2026-09-07).
 * The plan names `vitest.workspace.ts`. Vitest 5, the version that installs
 * against this Node 24 / React 19 scaffold, removed workspace files entirely;
 * the replacement is `test.projects` in this file. The three project names are
 * unchanged, so `vitest run --project component` and `--project db`, which
 * `package.json` already scripts, work as the plan intends.
 */

import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The db project's own database: an in-memory PGlite instance on its own port,
 * started and torn down by `tests/setup/db-global.ts`. Never 5432, which
 * belongs to the shared development instance worker-a owns.
 *
 * The port is CHOSEN AT STARTUP by binding port 0 and reading back what the OS
 * assigned, rather than fixed. A fixed 5433 meant one worker's run failed with
 * EADDRINUSE whenever another worker's overlapped it, and on demo day that
 * reads as a database fault rather than as two runs sharing a port.
 * `TEST_DB_PORT` still overrides it when a specific port is wanted.
 *
 * These are defined here, once, and reach the two places that need them by
 * different routes: `process.env` for the global setup, which runs in this same
 * main process, and the db project's `env` for the test workers, which are
 * separate processes. Sharing a module instead would make this config import a
 * `.ts` file, which the native Vite config loader cannot read as ESM.
 */
async function freePort(): Promise<string> {
  if (process.env.TEST_DB_PORT) return process.env.TEST_DB_PORT;

  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(String(port)) : reject(new Error('no free port'))));
    });
  });
}

const TEST_DB_PORT = await freePort();
const TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`;

process.env.TEST_DB_PORT = TEST_DB_PORT;
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

/** Matches the `@/*` -> `./*` mapping in tsconfig.json. */
const alias = { '@': root };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/setup/component.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          /* Its own in-memory PGlite on its own port, migrated and seeded per
             run. Never the shared instance on 5432, which worker-a owns. */
          globalSetup: ['tests/setup/db-global.ts'],
          env: { DATABASE_URL: TEST_DATABASE_URL },
          setupFiles: ['tests/setup/db.ts'],
          /* One database, one writer: db tests share seeded state, so they run
             one file at a time rather than racing each other. */
          fileParallelism: false,
          /* fixture-pinning.test.ts seeds three times and is the slowest test
             in the suite (S28); it is budgeted for, not cut. */
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
