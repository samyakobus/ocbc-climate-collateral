/**
 * tests/unit/no-literal-env-reads.test.ts - a guard rail, authored after the bug.
 *
 * Turbopack statically replaces a literal `process.env.SOMETHING` in the
 * production bundle with that variable's value at BUILD time. A variable absent
 * from the build folds to `undefined`, so any default behind it wins for ever
 * and nothing supplied at run time is ever seen.
 *
 * That is not a theoretical concern. It cost a real bug: the refresh routes read
 * `process.env.FEED_EONET_BASE` directly, the offline specs pointed that host at
 * a dead port, and the routes reached NASA anyway and reported success. The
 * specs passed only once the BUILD was also given the variables, which would
 * have meant the Day-5 rehearsal appearing to pass while quietly reaching the
 * real feed. That is exactly the failure AC-11 exists to catch.
 *
 * `lib/config/env.ts` reads by variable key at call time, which the bundler
 * cannot fold. This scan keeps it the only place that does.
 *
 * Two things are deliberately allowed:
 *
 *   - `NODE_ENV`, which is a build-time constant by design. Inlining it is the
 *     intended behaviour and is how dead code gets eliminated.
 *   - `lib/config/env.ts` itself, which is the one indirection.
 *
 * Only bundled code is scanned. `scripts/` and `tests/` run under plain Node
 * with no bundler, so a literal read there is read at run time and is fine.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories whose code Turbopack bundles. */
const SCANNED_DIRS = ['app', 'lib', 'components'] as const;

/** The one module allowed to touch `process.env`, as a POSIX-style path. */
export const ENV_MODULE = 'lib/config/env.ts';

/** Build-time constants, where inlining is the point rather than the hazard. */
const ALLOWED_KEYS = new Set(['NODE_ENV']);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'];

/** `process.env.KEY` and `process.env['KEY']`, the two forms a bundler folds. */
const LITERAL_READ = /process\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"`]([^'"`]+)['"`]\s*\])/g;

/**
 * Removes comments before scanning, and ONLY comments.
 *
 * Several of these files DISCUSS `process.env.SOMETHING` in their own headers,
 * explaining this very hazard, so a scan that flagged its own documentation
 * would be uselessly noisy and the temptation would be to delete the
 * explanation rather than fix the scan.
 *
 * String literals are deliberately kept. `process.env['KEY']` carries its key
 * INSIDE a string, so stripping strings would silently blind the scan to the
 * bracketed form, which is the one someone reaches for when they are trying to
 * be clever about a dynamic key. The self-check below pins that both forms are
 * still caught.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (two === '//') {
      const end = source.indexOf('\n', i + 2);
      i = end === -1 ? source.length : end;
      continue;
    }

    out += source[i];
    i++;
  }

  return out;
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(full);
  }
  return found;
}

type Offence = { file: string; key: string };

function scan(): Offence[] {
  const offences: Offence[] = [];

  for (const dir of SCANNED_DIRS) {
    const base = resolve(ROOT, dir);
    for (const file of walk(base)) {
      const posix = relative(ROOT, file).split(sep).join('/');
      if (posix === ENV_MODULE) continue;

      const code = stripComments(readFileSync(file, 'utf8'));

      LITERAL_READ.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = LITERAL_READ.exec(code)) !== null) {
        const key = match[1] ?? match[2];
        if (ALLOWED_KEYS.has(key)) continue;
        offences.push({ file: posix, key });
      }
    }
  }

  return offences;
}

describe('no literal process.env reads outside lib/config/env.ts', () => {
  it('finds none, so nothing can be folded to a build-time value', () => {
    const offences = scan();

    const detail = offences
      .map((o) => `  ${o.file} reads process.env.${o.key}`)
      .join('\n');

    expect(
      offences,
      offences.length === 0
        ? ''
        : `Turbopack folds these to their BUILD-time value, so a value supplied at run\n` +
          `time will never be seen:\n\n${detail}\n\n` +
          `Route them through ${ENV_MODULE} (readEnv / requireEnv / readEnvNumber),\n` +
          `adding the key to ENV_KEYS. If the value really is a build-time constant,\n` +
          `add it to ALLOWED_KEYS in this file with a reason.`,
    ).toEqual([]);
  });

  it('scans the directories Turbopack bundles, and finds real files in each', () => {
    // A scan that silently matched nothing would pass for ever. This pins that
    // it is actually reading the tree.
    for (const dir of SCANNED_DIRS) {
      const files = walk(resolve(ROOT, dir));
      expect(files.length, `${dir} has no source files, so the scan covers nothing`)
        .toBeGreaterThan(0);
    }
  });

  it('would catch a literal read, so the scan is not vacuous', () => {
    // The stripper must not swallow real code, and the pattern must match both
    // forms a bundler folds.
    const sample = stripComments(
      [
        '// process.env.IN_A_COMMENT',
        '/* process.env.IN_A_BLOCK */',
        'const b = process.env.DOTTED;',
        "const c = process.env['BRACKETED'];",
      ].join('\n'),
    );

    LITERAL_READ.lastIndex = 0;
    const keys = [...sample.matchAll(LITERAL_READ)].map((m) => m[1] ?? m[2]);

    expect(keys).toEqual(['DOTTED', 'BRACKETED']);
  });

  it('leaves NODE_ENV alone, because inlining it is the point', () => {
    const sample = 'if (process.env.NODE_ENV !== "production") {}';
    LITERAL_READ.lastIndex = 0;
    const keys = [...stripComments(sample).matchAll(LITERAL_READ)]
      .map((m) => m[1] ?? m[2])
      .filter((k) => !ALLOWED_KEYS.has(k));
    expect(keys).toEqual([]);
  });
});
