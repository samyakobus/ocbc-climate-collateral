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
 *   E2E_DEV=1            serve `next dev` instead of the build. Only works when
 *                        no other dev server is open on this directory.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

import { migrate } from './db-migrate';
import { startDbServer } from './db-server';
import { scorePass } from './gen-hotspot-scores';
import { narrativePass } from './gen-narratives';
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

/* ------------------------------------------------------------------ *
 * Killing the whole tree, and refusing to start on top of a leaked one
 * ------------------------------------------------------------------ */

/**
 * The port range `playwright.config.ts` draws from: `3100 + (pid % 700)`.
 *
 * The pre-flight scan sweeps it because a leaked server does not sit on a port
 * anyone chose; it sits on whichever port the run that leaked it happened to
 * derive.
 */
export const PORT_RANGE = { from: 3100, to: 3800 } as const;

export type Listener = { port: number; pid: string };

/**
 * Listening sockets in the e2e port range, with the process behind each.
 *
 * Parsed from the platform's own tool rather than probed by binding, because
 * the whole point is to NAME the process a human has to kill. A bind probe can
 * only say that something is there.
 */
export function listenersInRange(extraPort: number): Listener[] {
  const found = new Map<string, Listener>();
  const inRange = (port: number) =>
    (port >= PORT_RANGE.from && port <= PORT_RANGE.to) || port === extraPort;

  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? '';
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const local = parts[1] ?? '';
      const pid = parts[parts.length - 1] ?? '';
      const port = Number(local.slice(local.lastIndexOf(':') + 1));
      if (Number.isFinite(port) && inRange(port)) found.set(`${port}:${pid}`, { port, pid });
    }
    return [...found.values()];
  }

  /* lsof is the portable-enough POSIX answer; if it is absent the scan reports
     nothing rather than blocking a run over a missing tool. */
  const out = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '';
  for (const line of out.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    const address = parts[8] ?? '';
    const port = Number(address.slice(address.lastIndexOf(':') + 1));
    if (Number.isFinite(port) && inRange(port)) {
      found.set(`${port}:${parts[1]}`, { port, pid: parts[1] ?? '' });
    }
  }
  return [...found.values()];
}

/**
 * Refuse to start on top of a leaked server.
 *
 * This is the second half of the fix and the more important half for anyone
 * debugging. A leaked `next start` holds `.next/static` open; a later
 * `npm run build` rewrites those files underneath it, and the leaked server
 * then serves HTML whose stylesheet and client bundle 404. The map never
 * mounts, the canvas wait times out, and the failure reads as a rendering bug
 * in whichever spec happened to run first. It also worsens with every run since
 * the last cleanup, which is why it looked intermittent.
 *
 * Failing here with the pids named turns an afternoon of that into one line.
 */
function assertNoStaleServers(appPort: number): void {
  if (process.env.E2E_SKIP_PORT_SCAN === '1') {
    log('[e2e] port scan skipped by E2E_SKIP_PORT_SCAN=1.');
    return;
  }

  const listeners = listenersInRange(appPort);
  if (listeners.length === 0) return;

  const pids = [...new Set(listeners.map((entry) => entry.pid))].filter((pid) => pid !== '');
  const kill =
    process.platform === 'win32'
      ? pids.map((pid) => `taskkill /T /F /PID ${pid}`).join('\n  ')
      : `kill -9 ${pids.join(' ')}`;

  throw new Error(
    [
      `Something is already listening in the e2e port range ${PORT_RANGE.from}-${PORT_RANGE.to}:`,
      ...listeners.map((entry) => `  port ${entry.port}, pid ${entry.pid}`),
      '',
      'This is almost always a leaked `next start` from an earlier run. It holds',
      '.next/static open, a later `npm run build` rewrites those files underneath',
      'it, and it then serves HTML whose stylesheet and client bundle 404, which',
      'looks like a map that never renders rather than like a stale server.',
      '',
      'Kill it:',
      `  ${kill}`,
      '',
      'Then re-run. Set E2E_SKIP_PORT_SCAN=1 only if you know the listener is',
      'something else of yours that the run will not collide with.',
    ].join('\n'),
  );
}

/**
 * Kill a child AND everything it spawned.
 *
 * `child.kill()` is not enough on either platform once there is an intermediate
 * process, and it was not enough here: the server used to be started through
 * `npm run start`, so the tree was tsx -> cmd.exe -> npm -> node, and killing
 * the shell left the Next server running with no parent to stop it. The app is
 * now spawned directly, which makes the tree shallow, and this makes the kill
 * total anyway:
 *
 *   win32   `taskkill /T /F` walks the tree by pid.
 *   POSIX   the child is spawned `detached`, so it leads its own process group
 *           and a negative pid signals the whole group.
 *
 * Synchronous throughout, because the `exit` handler is the last chance to run
 * and nothing asynchronous survives it.
 */
export function killTree(child: ChildProcess | undefined): void {
  const pid = child?.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* Already gone. */
    }
  }
}

/**
 * One request through the stack before Playwright's first assertion.
 *
 * Roughly two runs in ten failed on the FIRST test of a file and on nothing
 * else. Playwright's readiness probe is a request to `/`, which Next answers
 * from its router before the first page has rendered, the `pg` pool has opened a
 * connection or the PGlite socket server has served a query. The probe therefore
 * reports ready while the first real navigation is still paying all three costs,
 * and a spec that opens with a 15-second `expect` can lose that race.
 *
 * So this walks the two routes every spec starts from and swallows everything:
 * a warm-up is an optimisation, and a failure here must not fail a run that the
 * application itself would have passed. It races Playwright's own probe rather
 * than gating it, which is enough, because the cost being paid is per-route and
 * paid once.
 */
async function warmUp(port: string): Promise<void> {
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/login`, { redirect: 'follow' });
      await response.text();
      break;
    } catch {
      await new Promise((wait) => setTimeout(wait, 300));
    }
  }

  for (const path of ['/', '/login']) {
    try {
      const response = await fetch(`${base}${path}`, { redirect: 'follow' });
      await response.text();
    } catch {
      /* Deliberately ignored: see the note above. */
    }
  }

  log(`[e2e] warmed up in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main(): Promise<void> {
  const appPort = process.env.PORT;
  if (!appPort) {
    throw new Error('PORT is not set. Playwright passes it through webServer.env.');
  }

  /*
    Before anything else, and before a database is started that would have to be
    torn down again: refuse to run on top of a server leaked by an earlier run.
  */
  assertNoStaleServers(Number(appPort));

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
        to assert against, then the reference index, for the same reason
        `db:recompute` chains it: `score_inputs` snapshots hotspot exposure at
        prep time while `v_hotspot_exposure` is live, and `hotspot-popup.spec.ts`
        asserts the popup's figures against that snapshot.
      */
      const result = await recompute(databaseUrl);

      /*
        Then the two generative passes, with NO model client, so the isolated
        database mirrors what the demo host shows: every hotspot in the tested
        fallback state, and a rule-text narrative on every pinned case rather
        than the "no summary stored" line. Both are database-only writes here
        and cost about a second, well inside the 240 s webServer budget.

        Passing no client is deliberate and not a limitation. An e2e run that
        called the API on a machine with a key and skipped it on one without
        would produce different screens for different people, which is the
        opposite of what an isolated database is for.
      */
      const scores = await scorePass(databaseUrl);
      const narratives = await narrativePass(databaseUrl);

      log(
        `[e2e] isolated database on ${dbPort}: ${result.valuations} valuations, ` +
          `${result.reference.hotspots} reference indices ` +
          `(${result.reference.min_index}-${result.reference.max_index}), ` +
          `${scores.fallback} hotspots in fallback, ` +
          `${narratives.cases + narratives.portfolios} narratives`,
      );
    } catch (cause) {
      await stopDatabase();
      throw cause;
    }
  }

  /*
    The BUILT app by default, not `next dev`. Two reasons, both practical.

    Next refuses to run a second dev server in the same project directory, so
    while any worker has `npm run dev` open the e2e run could never start one.
    And a built app is what the demo actually runs under compose, so the specs
    exercise the same thing the board will see, with no first-hit compile
    latency to make an assertion time out. That fidelity has already earned its
    keep: it is what surfaced the map rendering no pin features in a production
    build while working in dev.

    The build is the operator's: run `npm run build` first. Building here would
    rewrite `.next` underneath whatever dev server another worker has open.
    E2E_DEV=1 falls back to the dev server when that is what you want.
  */
  const useDev = process.env.E2E_DEV === '1';

  if (!useDev && !existsSync(resolve('.next', 'BUILD_ID'))) {
    throw new Error(
      [
        'No production build found. The e2e run serves the built app.',
        '  npm run build',
        'then re-run the Playwright suite, or set E2E_DEV=1 to serve the dev',
        'server instead (which fails while another dev server is open).',
      ].join('\n'),
    );
  }

  /*
    The Next binary DIRECTLY, not `npm run start`, and no shell.

    Through npm the tree was tsx -> cmd.exe -> npm -> node on Windows, and
    killing the child killed the shell while the Next server carried on with no
    parent to stop it. Every run leaked one. Spawning the binary makes the tree
    one deep, so `next` is the process this script actually holds a handle to.
  */
  const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

  const next = spawn(process.execPath, [nextBin, useDev ? 'dev' : 'start', '--port', appPort], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: appPort },
    stdio: 'inherit',
    /* POSIX: lead a process group, so one signal reaches every descendant. */
    detached: process.platform !== 'win32',
  });

  void warmUp(appPort);

  /*
    EVERY exit path kills the tree. There are five, and the leak came from the
    two that were not covered: a run that ended cleanly still left the server
    up, because killing the shell was not killing the server, and an uncaught
    error left both.
  */
  let closing = false;

  const shutdown = async (reason: string) => {
    if (closing) return;
    closing = true;
    log(`[e2e] shutting down (${reason})`);
    killTree(next);
    await stopDatabase().catch(() => undefined);
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }

  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (error: unknown) => {
      console.error(`[e2e] ${event}:`, error);
      void shutdown(event).then(() => process.exit(1));
    });
  }

  /*
    The last chance, and synchronous by necessity: nothing asynchronous runs
    after `exit` is emitted. Playwright's teardown kills this process, and if it
    ever does so in a way that skips the signal handlers, this still fires.
  */
  process.on('exit', () => {
    killTree(next);
  });

  next.on('exit', (code, signal) => {
    /*
      An exit we did NOT ask for is the interesting case, and it used to be
      silent: worker-a saw a run where the server vanished between test 19 and
      20 and every later test reported ERR_CONNECTION_REFUSED with nothing in
      the log to say why. The teardown was doing its job and saying nothing.
      Now it names the exit code and the signal, so the next occurrence starts
      with evidence instead of a guess.
    */
    if (!closing) {
      console.error(
        [
          `[e2e] THE WEB SERVER EXITED ON ITS OWN: code ${code ?? 'none'}, signal ${signal ?? 'none'}.`,
          '[e2e] Every test after this point will report ERR_CONNECTION_REFUSED, and the',
          '[e2e] application is not necessarily at fault. Look for a crash in the output',
          '[e2e] above this line, an out-of-memory kill, or something outside the run',
          '[e2e] killing the process (a stray taskkill /T that caught this tree).',
        ].join('\n'),
      );
    }

    void shutdown(`next exited with code ${code ?? 'none'}, signal ${signal ?? 'none'}`).then(() =>
      process.exit(code ?? 0),
    );
  });
}

/*
  Only when run as a command. The two lifecycle helpers above are exported and
  `tests/unit/e2e-server-lifecycle.test.ts` imports them; without this guard that
  import would start a web server and a database inside the unit project.
*/
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error('[e2e]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
