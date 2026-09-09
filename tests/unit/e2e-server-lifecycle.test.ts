/**
 * The e2e web server must not outlive its run (#47).
 *
 * THE BUG THIS PINS. `scripts/e2e-server.ts` used to start the application with
 * `npm run start` through a shell, so the process tree was tsx -> cmd.exe ->
 * npm -> node, and killing the child reached the shell rather than the server.
 * Worker-c reported servers surviving every exit path, a clean one included.
 * Each leaked server holds `.next/static` open; a later `npm run build` rewrites
 * those files underneath it, and the leaked server then serves HTML whose
 * stylesheet and client bundle 404. The map never mounts and the canvas wait
 * times out, so the failure reads as a rendering bug in whichever spec ran
 * first, and it gets worse with every run since the last cleanup. That is the
 * "first test in the file" flake worker-c and worker-a were chasing.
 *
 * WHAT IS AND IS NOT PROVEN HERE. The leak itself was observed by worker-c: two
 * listeners over an hour old, and a run that exited 0 leaking a third. I did not
 * reproduce the old failure in isolation, and a probe with a plain parent did
 * not leak, so the mechanism is specific to the shell-and-npm wrapper the old
 * code used rather than to `child.kill()` in general. The fix removes that
 * wrapper AND kills the whole tree, and these tests pin the second half.
 *
 * Two things are asserted, both without Playwright and without a build:
 *   1. `killTree` kills a CHILD AND ITS GRANDCHILD, so no descendant of the
 *      server can outlive the run whatever the tree turns out to be;
 *   2. `listenersInRange` finds a listener in the e2e port range and names the
 *      process holding it, which is what turns the next occurrence into one
 *      line instead of an afternoon.
 */

import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { killTree, listenersInRange, PORT_RANGE } from '../../scripts/e2e-server';

/** A parent that spawns a child and then does nothing, like npm around next. */
const PARENT_SOURCE = `
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  process.stdout.write(String(child.pid));
  setInterval(() => {}, 1000);
`;

function alive(pid: number): boolean {
  try {
    /* Signal 0 tests for existence without delivering anything. */
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function settle(ms = 400): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => done());
        }),
    ),
  );
});

describe('killTree', () => {
  it('kills the grandchild as well as the child', async () => {
    const parent = spawn(process.execPath, ['-e', PARENT_SOURCE], {
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: process.platform !== 'win32',
    });

    const grandchildPid = await new Promise<number>((done, fail) => {
      parent.stdout?.once('data', (chunk: Buffer) => done(Number(String(chunk).trim())));
      parent.once('error', fail);
      setTimeout(() => fail(new Error('the parent never reported a child pid')), 10_000);
    });

    expect(parent.pid, 'the parent never started').toBeTypeOf('number');
    expect(alive(parent.pid!)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    killTree(parent);
    await settle();

    expect(alive(parent.pid!), 'the child survived').toBe(false);
    expect(alive(grandchildPid), 'the GRANDCHILD survived, which is the leak').toBe(false);
  }, 30_000);

  it('is safe to call twice, and on a child that never started', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });

    killTree(child);
    await settle();
    expect(() => killTree(child)).not.toThrow();
    expect(() => killTree(undefined)).not.toThrow();
  }, 30_000);
});

describe('listenersInRange', () => {
  it('finds a listener inside the e2e port range and names its process', async () => {
    const port = await new Promise<number>((done, fail) => {
      const server = createServer();
      servers.push(server);
      server.once('error', fail);
      /* 3111 is inside 3100-3800 and is not the formula's own choice for this
         process, so the test does not depend on a pid. */
      server.listen(3111, '127.0.0.1', () => done(3111));
    });

    const found = listenersInRange(0);
    const mine = found.find((entry) => entry.port === port);

    /* lsof is not installed everywhere; on a POSIX box without it the scan
       returns nothing by design rather than blocking a run. Windows always has
       netstat, and Windows is where the leak was observed. */
    if (process.platform !== 'win32' && found.length === 0) return;

    expect(mine, `no listener reported on ${port}`).toBeDefined();
    expect(mine!.pid).toBe(String(process.pid));
  }, 30_000);

  it('reports nothing when the range is empty of listeners', () => {
    /* An out-of-range extra port, and nothing of ours listening in the range
       once the fixture server has closed, is the ordinary pre-run state. */
    const found = listenersInRange(0).filter((entry) => entry.port === 3111);

    expect(found).toEqual([]);
  });

  it('sweeps the range playwright.config.ts draws its port from', () => {
    /* The config computes 3100 + (pid % 700), so the highest port it can pick
       is 3799. A scan that stopped short would miss exactly the leaked servers
       it exists to find. */
    expect(PORT_RANGE.from).toBe(3100);
    expect(PORT_RANGE.to).toBeGreaterThanOrEqual(3799);
  });
});
