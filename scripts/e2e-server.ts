/**
 * The Playwright web server, with its own isolated database (#31).
 *
 * Starts an in-memory PGlite with real PostGIS on a port the OS picks,
 * migrates, seeds and recomputes it, then serves the BUILT application against
 * THAT DATABASE_URL. When Playwright stops this process, the application and
 * the database both go with it.
 *
 * Run `npm run build` first: this serves the build rather than making one, so
 * it never rewrites `.next` underneath another worker's dev server.
 *
 * Why one process rather than a Playwright `globalSetup`. Playwright loads its
 * config and hooks through a CommonJS transform, and every script here is ESM
 * using `import.meta.url`, so importing the migrate and seed functions from a
 * Playwright-loaded module fails outright. Running the bootstrap in an ordinary
 * `tsx` process sidesteps that, and it also makes the lifetime obvious: the
 * database exists exactly as long as the server does.
 *
 * The isolation is the point. The e2e specs used to run against the shared
 * development database on 5432, so `rule-edit.spec.ts` rewrote the active rule
 * set while another worker's map specs were reading it, and anyone's reseed
 * could move the numbers mid-run. A red e2e run then tells you nothing.
 *
 *   PORT                 the port the built app listens on. Required.
 *   E2E_DATABASE_URL     use this database instead of starting one, for the
 *                        compose stack on demo day.
 *   E2E_DB_VERBOSE=1     show every migration and seed line.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';

import 'dotenv/config';

import { migrate } from './db-migrate';
import { startDbServer } from './db-server';
import { recompute } from './recompute';
import { seedDatabase } from './seed';
import { waitForDb } from './wait-for-db';

const log = (message: string) => console.log(message);
const detail = process.env.E2E_DB_VERBOSE ? log : () => {};

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

async function main(): Promise<void> {
  const appPort = process.env.PORT;
  if (!appPort) {
    throw new Error('PORT is not set. Playwright passes it through webServer.env.');
  }

  let databaseUrl: string;
  let stopDatabase: () => Promise<void> = async () => {};

  if (process.env.E2E_DATABASE_URL) {
    databaseUrl = process.env.E2E_DATABASE_URL;
    log(`[e2e] using the database provided: ${databaseUrl}`);
  } else {
    const dbPort = await freePort();
    const server = await startDbServer({ port: dbPort, memory: true });
    stopDatabase = () => server.stop();
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;

    try {
      if (!(await waitForDb(databaseUrl, 60))) {
        throw new Error(`The e2e database did not accept connections on ${dbPort} within 60s.`);
      }
      await migrate(databaseUrl, { log: detail });
      await seedDatabase(databaseUrl, { log: detail });

      /*
        Recompute so the specs have stored valuations, bands and recommendations
        to assert against. S21 chains `prep:reference` here once
        `scripts/compute-reference.ts` exists, for the same reason it chains
        after `db:recompute`: `score_inputs` snapshots hotspot exposure at prep
        time while the view is live.
      */
      const result = await recompute(databaseUrl);
      log(`[e2e] isolated database on ${dbPort}: ${result.valuations} valuations`);
    } catch (cause) {
      await stopDatabase();
      throw cause;
    }
  }

  /*
    `next start`, not `next dev`. Two reasons, both practical.

    Next refuses to run a second dev server in the same project directory, so
    while any worker has `npm run dev` open the e2e run could never start one.
    And a built app is what the demo actually runs under compose, so the specs
    exercise the same thing the board will see, with no first-hit compile
    latency to make an assertion time out.

    The build is the operator's: run `npm run build` first. Building here would
    rewrite `.next` underneath whatever dev server another worker has open.
  */
  if (!existsSync(resolve('.next', 'BUILD_ID'))) {
    throw new Error(
      [
        'No production build found. The e2e run serves the built app.',
        '  npm run build',
        'then re-run the Playwright suite.',
      ].join('\n'),
    );
  }

  const next = spawn('npm', ['run', 'start', '--', '--port', appPort], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: appPort },
    stdio: 'inherit',
    shell: true,
  });

  let closing = false;
  const shutdown = async (signal: NodeJS.Signals | 'exit') => {
    if (closing) return;
    closing = true;
    if (!next.killed) next.kill(signal === 'exit' ? 'SIGTERM' : signal);
    await stopDatabase().catch(() => undefined);
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }

  next.on('exit', (code) => {
    void shutdown('exit').then(() => process.exit(code ?? 0));
  });
}

main().catch((error: unknown) => {
  console.error('[e2e]', error instanceof Error ? error.message : error);
  process.exit(1);
});
