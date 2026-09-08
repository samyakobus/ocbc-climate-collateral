/**
 * Global setup for the `db` Vitest project.
 *
 * Starts an in-process, in-memory PGlite instance with the real PostGIS
 * extension on its own port, migrates it, seeds it, and tears it down when the
 * run ends. The db tests therefore never touch `data/pglite` or port 5432,
 * which worker-a owns exclusively; a test run cannot disturb development state
 * and development state cannot make a test flake.
 *
 * Migration and seeding go through the same `migrate` and `seedDatabase`
 * functions the CLI uses, so the harness cannot drift from what
 * `npm run db:migrate` and `npm run db:seed` actually do.
 *
 * The port and URL come from `vitest.config.mts`, which sets them on
 * `process.env` before this runs. Both execute in the main Vitest process.
 */

import { migrate } from '../../scripts/db-migrate';
import { startDbServer } from '../../scripts/db-server';
import { recompute } from '../../scripts/recompute';
import { seedDatabase } from '../../scripts/seed';
import { waitForDb } from '../../scripts/wait-for-db';

const port = Number(process.env.TEST_DB_PORT ?? 5433);
const url =
  process.env.TEST_DATABASE_URL ?? `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;

/** Quiet by default; VITEST_DB_VERBOSE=1 shows every migration and seed line. */
const log = process.env.VITEST_DB_VERBOSE
  ? (message: string) => console.log(message)
  : () => {};

export default async function setup() {
  let server: Awaited<ReturnType<typeof startDbServer>>;

  try {
    server = await startDbServer({ port, memory: true });
  } catch (cause) {
    /*
      A crashed or killed run leaves the previous test server holding the port,
      and the raw EADDRINUSE says nothing about which process or what to do.
      Naming the fix here saves the next person the same ten minutes.
    */
    if ((cause as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
      throw new Error(
        `Port ${port} is already in use, so the db test server cannot start.\n` +
          'A previous test run probably did not shut down. Find and stop it:\n' +
          `  netstat -ano | findstr 127.0.0.1:${port}\n` +
          '  taskkill /PID <pid> /F\n' +
          'Or set TEST_DB_PORT to a free port. This is NOT the shared development ' +
          'database on 5432; do not stop that one.',
      );
    }
    throw cause;
  }

  const ready = await waitForDb(url, 60);
  if (!ready) {
    await server.stop();
    throw new Error(`The test database did not accept connections on port ${port} within 60s.`);
  }

  try {
    await migrate(url, { log });
    await seedDatabase(url, { log });

    /* The db tests assert on stored valuations, so the harness computes them
       the same way `npm run db:recompute` does, through the same function. */
    const result = await recompute(url);
    log(
      `[recompute] ${result.valuations} valuations, ` +
        `${result.recommendations} recommendations`,
    );
  } catch (cause) {
    await server.stop();
    throw cause;
  }

  return async () => {
    await server.stop();
  };
}
