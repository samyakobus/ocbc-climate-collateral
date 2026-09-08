/**
 * tests/unit/no-network-on-render.test.ts - AC-11. A pure static scan.
 *
 * Plan section 4.9, the offline-first rule: no server component, layout or GET
 * route performs an outbound network call. Outbound calls live in exactly three
 * places, and THIS FILE'S `OUTBOUND_ALLOWED` is the single constant that list is
 * expressed in. The section 4.9 prose and `tests/offline/checklist.md` quote it;
 * nothing else redeclares it.
 *
 * The scan looks for call sites AND module specifiers, not imports alone.
 * `fetch` is a Node and browser global that is never imported, so an
 * import-only check would miss the likeliest breach.
 *
 * Authored on Day 1 rather than Day 5 because it is a guard rail during
 * construction, not an audit afterwards: it fails the moment a fetch lands in a
 * render path, while the change is still one edit old.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories whose every render path must be offline (plan 4.9). */
const SCANNED_DIRS = ['app', 'components', 'lib'] as const;

/**
 * The three places an outbound call is allowed to live, as POSIX-style paths
 * relative to the repo root. Each is a POST route or a server action with an
 * explicit timeout and a cached fallback; none of them runs during a render.
 *
 * This constant is the list. Section 4.9 of the plan states it in prose and the
 * offline rehearsal checklist points back here.
 */
export const OUTBOUND_ALLOWED = [
  'app/api/refresh/tiles/route.ts',
  'app/api/refresh/news/route.ts',
  'app/api/narrative/regenerate/route.ts',
  'app/actions/rescore-hotspot.ts',
] as const;

/**
 * The outbound call sites and module specifiers the scan rejects.
 *
 * `fetch(` is matched with a leading word boundary only, so `refetch(` does not
 * false-positive while `globalThis.fetch(` and `window.fetch(` still do. A
 * missed global is a silent hole in AC-11; a false positive on some future
 * `client.fetch(` is visible in one test run and cheap to resolve.
 *
 * Note for S22 and S25: `@anthropic-ai/sdk` is forbidden inside `lib/`, which
 * is what the plan specifies. The client is therefore constructed in the
 * allowed entry point and passed into `lib/index/llm-score.ts` and
 * `lib/narrative/prompt.ts`, which hold prompt building and validation only.
 * That is also what makes "with the client stubbed to fail" testable in the
 * no-database unit project.
 */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'fetch(', pattern: /(?<![\w$])fetch\s*\(/ },
  { name: 'axios', pattern: /['"]axios['"]/ },
  { name: 'undici', pattern: /['"]undici['"]/ },
  { name: 'https.request', pattern: /\bhttps?\s*\.\s*(?:request|get)\s*\(/ },
  { name: 'node-fetch', pattern: /['"]node-fetch['"]/ },
  { name: '@anthropic-ai/sdk', pattern: /['"]@anthropic-ai\/sdk['"]/ },
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'];

function walk(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found; /* A directory a later step creates is not a breach. */
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(full, found);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

/** Strip comments so prose about `fetch(` is not read as a call site. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

type Breach = { file: string; call: string; line: number; text: string };

function scan(): Breach[] {
  const allowed = new Set<string>(OUTBOUND_ALLOWED);
  const breaches: Breach[] = [];

  for (const dir of SCANNED_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = posix(relative(ROOT, file));
      if (allowed.has(rel)) continue;

      const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/);
      lines.forEach((text, index) => {
        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(text)) {
            breaches.push({ file: rel, call: name, line: index + 1, text: text.trim() });
          }
        }
      });
    }
  }

  return breaches;
}

describe('offline-first rule: no outbound call in a render path', () => {
  it('finds no outbound call site outside the three allowed entry points', () => {
    const breaches = scan();
    const report = breaches
      .map((b) => `  ${b.file}:${b.line}  ${b.call}  ->  ${b.text}`)
      .join('\n');

    expect(
      breaches,
      breaches.length === 0
        ? ''
        : [
            'Outbound network calls found outside the three allowed entry points.',
            'Plan 4.9: no server component, layout or GET route makes an outbound call.',
            '',
            report,
            '',
            `Allowed: ${OUTBOUND_ALLOWED.join(', ')}`,
          ].join('\n'),
    ).toEqual([]);
  });

  it('scans every directory that can hold a render path', () => {
    expect([...SCANNED_DIRS]).toEqual(['app', 'components', 'lib']);
  });

  it('names exactly the four allowed files of the three entry points', () => {
    expect(OUTBOUND_ALLOWED).toHaveLength(4);
    for (const path of OUTBOUND_ALLOWED) {
      expect(path.startsWith('app/')).toBe(true);
    }
  });

  it('detects a breach when one is present, so a green result means something', () => {
    /* Guards the scanner itself: without this, a broken regex would report
       "no breaches" forever and AC-11's static half would be theatre. */
    const samples = [
      'const res = await fetch(url);',
      "import axios from 'axios';",
      "const { request } = require('undici');",
      'https.request(options, handler);',
      "import fetch from 'node-fetch';",
      "import Anthropic from '@anthropic-ai/sdk';",
    ];
    for (const sample of samples) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(sample))).toBe(true);
    }
  });

  it('does not flag ordinary code that merely looks like a call', () => {
    const safe = [
      'const rows = await client.query(sql);',
      'function refetch() { return null; }',
      'const data = props.fetched;',
      'await pool.connect();',
    ];
    for (const sample of safe) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(sample))).toBe(false);
    }
  });
});
