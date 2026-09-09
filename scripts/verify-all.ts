/**
 * `npm run verify:all` - S28's one command (#37).
 *
 * Runs the whole verification battery in order and prints ONE table at the end
 * with a result and a count per step.
 *
 * Why a script rather than a line in a README. Six commands across three
 * runners produce six different output formats, and on a red run the useful
 * question is "which of the six, and how many" rather than "what does the last
 * screenful say". Scrolling back through a Playwright trace to find whether the
 * Python suite ran at all is how a step gets quietly dropped on a deadline.
 *
 * Every step runs even after one fails, unless `--bail` is passed. That is the
 * point: on the morning of a demo you want the full picture in one pass, not
 * the first thing that broke.
 *
 * Order matters and is not alphabetical. The cheap static checks come first, so
 * a syntax error is reported in seconds rather than after a four-minute browser
 * suite. `verify:dashboard` comes last because it reads the SHARED development
 * database, and the Playwright run before it can leave a test-created rule set
 * active; the step says so when it fails, and names `db:reset-rules`.
 *
 *   npm run verify:all
 *   npm run verify:all -- --skip=playwright     while the e2e suite is being fixed
 *   npm run verify:all -- --only=vitest,pytest
 *   npm run verify:all -- --bail
 *   npm run verify:all -- --list
 *
 * The offline enforcement suite IS part of this run, as its own step. It needs
 * the server started with its outbound hosts at a dead port, which is a
 * different environment from every other spec, so it cannot share a Playwright
 * invocation; it gets a second one with those hosts set.
 *
 * NEITHER Playwright project may skip a test. The offline project exists only
 * because its three hosts are overridden, so a skip inside it is never
 * deliberate; the default project no longer contains anything conditional now
 * that the AC-11 block has moved out of `refresh.spec.ts`. A skipped test is
 * reported in its own column and fails the gate, because a skip is the one
 * result that reads as success and is not one.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

type Step = {
  /** What `--only` and `--skip` call it. */
  key: string;
  /** What the table calls it. */
  label: string;
  command: string;
  args: string[];
  /** Extra environment for this step only. */
  env?: Record<string, string>;
  /** Pulls a countable fact out of the output, for the summary column. */
  count(output: string): string;
  /**
   * How many tests this step SKIPPED, or null where the idea does not apply.
   *
   * Its own column, because a skip is the one result that reads as success and
   * is not one. A suite reporting "39 passed" with four silent skips has told
   * you almost nothing about those four.
   */
  skipped?(output: string): number | null;
  /**
   * True when the step must fail because it skipped something, even though the
   * runner exited zero. The offline project is the case: it exists only when
   * its hosts are overridden, so inside it a skip is never deliberate.
   */
  failOnSkip?: boolean;
  /** What to say when this step fails, beyond the exit code. */
  hint?: string;
};

/** The first capture of the first pattern that matches, or a fallback. */
function firstMatch(output: string, patterns: RegExp[], fallback: string): string {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match.slice(1).filter(Boolean).join(' ');
  }
  return fallback;
}

function countOf(output: string, pattern: RegExp): number {
  return (output.match(pattern) ?? []).length;
}

/**
 * The discard port, on all three outbound hosts.
 *
 * Nothing listens on port 9, so every connection is refused at once rather than
 * hanging until a timeout. This is what makes the SERVER offline; blocking in
 * the browser cannot, because the refresh routes call out from inside the Next
 * handler.
 */
const DEAD_HOSTS: Record<string, string> = {
  FEED_EONET_BASE: 'http://127.0.0.1:9',
  FEED_GIBS_BASE: 'http://127.0.0.1:9',
  THUMB_BASE: 'http://127.0.0.1:9',
};

/** Playwright's summary line, whichever of its shapes this run produced. */
function playwrightCount(out: string): string {
  const parts = [
    firstMatch(out, [/(\d+) passed/], ''),
    firstMatch(out, [/(\d+) failed/], ''),
  ];
  const passed = parts[0] ? `${parts[0]} passed` : '';
  const failed = parts[1] ? `${parts[1]} failed` : '';
  const summary = [passed, failed].filter(Boolean).join(', ');
  return summary || firstMatch(out, [/(\d+) tests? using/], 'no tests');
}

function playwrightSkipped(out: string): number | null {
  const match = out.match(/(\d+) skipped/);
  return match ? Number(match[1]) : 0;
}

const STEPS: Step[] = [
  {
    key: 'tsc',
    label: 'TypeScript',
    command: 'npx',
    args: ['tsc', '--noEmit'],
    /* tsc says nothing on success, so the count is what went wrong. */
    count: (out) => {
      const errors = countOf(out, /error TS\d+/g);
      return errors === 0 ? 'no errors' : `${errors} error${errors === 1 ? '' : 's'}`;
    },
  },
  {
    key: 'lint',
    label: 'ESLint',
    command: 'npx',
    args: ['eslint'],
    count: (out) =>
      firstMatch(out, [/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/], 'clean'),
  },
  {
    key: 'vitest',
    label: 'Vitest (unit, component, db)',
    command: 'npx',
    args: ['vitest', 'run'],
    count: (out) => {
      const tests = firstMatch(out, [/Tests\s+(\d+ passed[^\n]*)/], '');
      const files = firstMatch(out, [/Test Files\s+(\d+ passed[^\n]*)/], '');
      return [tests.trim(), files ? `${files.trim()} files` : ''].filter(Boolean).join(', ') || '?';
    },
    hint: 'The db project needs `npm run db:up` running.',
  },
  {
    key: 'pytest',
    label: 'Python prep suite',
    command: 'python',
    args: ['-m', 'pytest', 'tests/prep', '-q'],
    count: (out) => firstMatch(out, [/(\d+ passed[^\n]*?) in [\d.]+s/], '?'),
  },
  /*
    The build, and it carries the offline hosts.

    Reading them through `lib/config/env.ts` means they are NOT baked into the
    bundle, so this build is byte-for-byte what a normal build would be and both
    Playwright projects can share it. Passing them anyway costs nothing and
    closes the question permanently: if anyone ever reintroduces a literal
    `process.env.FEED_*`, this build has the right values in it rather than
    silently baking in the real hosts and making the offline project lie.
  */
  {
    key: 'build',
    label: 'Production build',
    command: 'npm',
    args: ['run', 'build'],
    env: DEAD_HOSTS,
    count: (out) => (out.includes('Route (app)') ? 'routes emitted' : 'built'),
    hint: 'The e2e server serves the BUILT app, so both Playwright projects need this.',
  },
  /*
    Both projects fail on a skip, since the AC-11 block moved out of
    `refresh.spec.ts` and into the offline project. The default project reported
    "4 skipped" on every run for weeks, which is how a Skipped column becomes
    wallpaper. Zero is now the only acceptable number in either, so the column
    means something again.
  */
  {
    key: 'playwright',
    label: 'Playwright, default project',
    command: 'npx',
    args: ['playwright', 'test', '--project=default'],
    count: playwrightCount,
    skipped: playwrightSkipped,
    failOnSkip: true,
    hint:
      'Run `npm run build` first: the e2e server serves the BUILT app. A skip ' +
      'here means a spec opted out; the offline suite lives in its own project ' +
      'and has no business skipping in this one.',
  },
  /*
    The offline project, which only exists because these three variables are
    set. `playwright.config.ts` omits it entirely when they are not, so a run
    that reaches this step and skips a test has a real problem: there is no
    legitimate reason for a skip inside a project that was only added because
    its precondition held.
  */
  {
    key: 'offline',
    label: 'Playwright, offline project',
    command: 'npx',
    args: ['playwright', 'test', '--project=offline'],
    env: DEAD_HOSTS,
    count: playwrightCount,
    skipped: playwrightSkipped,
    failOnSkip: true,
    hint:
      'The offline project asserts AC-11. A skip here means the project was ' +
      'collected but a test opted out, which it must never do.',
  },
  {
    key: 'dashboard',
    label: 'Dashboard figures',
    command: 'npm',
    args: ['run', 'verify:dashboard'],
    /*
      Three outcomes, not two. "Could not connect" and "the figures disagree"
      are different problems with different fixes, and reporting the first as
      the second sends a reader to `db:reset-rules` when the answer is
      `db:up`. That happened on the first run of this script.
    */
    count: (out) => {
      if (out.includes('agree to the cent')) return 'view and base tables agree';
      if (/ECONNREFUSED|is not set|does not exist/.test(out)) return 'no database';
      return firstMatch(out, [/(\d+) MISMATCH/], 'disagreed');
    },
    hint:
      'ECONNREFUSED means the shared database is not running: `npm run db:up`. ' +
      'A MISMATCH after a Playwright run means a spec left a test-created rule ' +
      'set active: `npm run db:reset-rules`.',
  },
];

type Result = {
  step: Step;
  status: 'passed' | 'failed' | 'not run';
  count: string;
  /** Tests this step skipped, or null where the idea does not apply. */
  skipped: number | null;
  seconds: number;
  code: number | null;
  /** Set when the step exited zero but skipped something it must not. */
  skipFailure?: string;
};

function run(step: Step): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    /*
      `shell: true` because on Windows `npx` and `npm` are `.cmd` shims that
      `spawn` cannot start directly.

      One string rather than a command plus an args array, because Node 24 warns
      (DEP0190) that arguments passed alongside `shell: true` are concatenated
      rather than escaped. The warning is right in general and moot here: every
      token in this file is a literal, so there is nothing for a shell to
      reinterpret. Concatenating them myself says that explicitly and keeps the
      warning out of a summary a presenter reads at speed.
    */
    const child = spawn([step.command, ...step.args].join(' '), {
      shell: true,
      env: { ...process.env, ...step.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      /* Stream it: a four-minute step with no output looks like a hang. */
      process.stdout.write(text);
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => resolve({ code: 1, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

function parseList(flag: string): string[] | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${flag}=`));
  if (!arg) return null;
  return arg
    .slice(flag.length + 3)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A fixed-width table, so the summary reads as one block rather than eight lines. */
function table(results: Result[]): string {
  const head = ['Step', 'Result', 'Count', 'Skipped', 'Time'];
  const rows = results.map((r) => [
    r.step.label,
    r.status === 'passed' ? 'PASS' : r.status === 'failed' ? 'FAIL' : 'not run',
    r.status === 'not run' ? '-' : r.count,
    r.status === 'not run' || r.skipped === null ? '-' : String(r.skipped),
    r.status === 'not run' ? '-' : `${r.seconds.toFixed(1)}s`,
  ]);

  const widths = head.map((_, column) =>
    Math.max(head[column].length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    '  ' + cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();

  return [
    line(head),
    '  ' + widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

async function main(): Promise<void> {
  const only = parseList('only');
  const skip = parseList('skip') ?? [];
  const bail = process.argv.includes('--bail');

  if (process.argv.includes('--list')) {
    console.log('Steps, in the order they run:');
    for (const step of STEPS) console.log(`  ${step.key.padEnd(11)} ${step.label}`);
    return;
  }

  const unknown = [...(only ?? []), ...skip].filter((k) => !STEPS.some((s) => s.key === k));
  if (unknown.length) {
    console.error(`Unknown step(s): ${unknown.join(', ')}. Try --list.`);
    process.exit(2);
  }

  const results: Result[] = [];
  let stopped = false;

  for (const step of STEPS) {
    const wanted = (only === null || only.includes(step.key)) && !skip.includes(step.key);

    if (!wanted || stopped) {
      results.push({ step, status: 'not run', count: '-', skipped: null, seconds: 0, code: null });
      continue;
    }

    const envNote = step.env ? `  [${Object.keys(step.env).join(', ')} overridden]` : '';
    console.log(
      `\n${'='.repeat(72)}\n  ${step.label}  (${step.command} ${step.args.join(' ')})${envNote}\n${'='.repeat(72)}`,
    );

    const started = Date.now();
    const { code, output } = await run(step);
    const seconds = (Date.now() - started) / 1000;

    const skipped = step.skipped ? step.skipped(output) : null;

    /*
      A zero exit with a skip is still a failure where the step says so. This is
      the S28 gate's whole point: the offline suite must have RUN, and Playwright
      reports a skipped test as a successful run.
    */
    const skipFailure =
      step.failOnSkip && code === 0 && skipped !== null && skipped > 0
        ? `${skipped} test(s) skipped in a project that must never skip.`
        : undefined;

    results.push({
      step,
      status: code === 0 && !skipFailure ? 'passed' : 'failed',
      count: step.count(output),
      skipped,
      seconds,
      code,
      skipFailure,
    });

    if ((code !== 0 || skipFailure) && bail) stopped = true;
  }

  const failed = results.filter((r) => r.status === 'failed');
  const notRun = results.filter((r) => r.status === 'not run');

  console.log(`\n${'='.repeat(72)}\n  verify:all\n${'='.repeat(72)}\n`);
  console.log(table(results));
  console.log('');

  for (const result of failed) {
    console.log(
      result.skipFailure
        ? `  ${result.step.label}: ${result.skipFailure}`
        : `  ${result.step.label} exited ${result.code}.`,
    );
    if (result.step.hint) console.log(`    ${result.step.hint}`);
  }

  /* A skip inside a step that tolerates one still gets said out loud. */
  const quietSkips = results.filter(
    (r) => r.status === 'passed' && r.skipped !== null && r.skipped > 0,
  );
  for (const result of quietSkips) {
    console.log(
      `  ${result.step.label} skipped ${result.skipped} test(s). ` +
        'Green, but that is not coverage.',
    );
  }

  if (notRun.length) {
    console.log(
      `  ${notRun.length} step(s) not run: ${notRun.map((r) => r.step.key).join(', ')}. ` +
        'A step that did not run is not a passing step.',
    );
  }

  console.log(
    failed.length === 0
      ? `\n  ${results.length - notRun.length} of ${STEPS.length} steps green.\n`
      : `\n  ${failed.length} step(s) FAILED.\n`,
  );

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('[verify:all]', error instanceof Error ? error.message : error);
  process.exit(1);
});
