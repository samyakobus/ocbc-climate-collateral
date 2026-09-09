/**
 * `npm run cache:prune` - #48. Delete cached imagery nothing points at.
 *
 * WHY THIS EXISTS, and it is not tidiness.
 *
 * Both refresh routes write a NEW file under a content-hashed name and only
 * then move the database row to it, deliberately leaving the old file in place
 * so a rollback needs no file restore. That is the right design and it has a
 * consequence: every successful refresh leaves one orphan per image.
 *
 * The Playwright suite presses those buttons. A run that reaches a live NASA
 * GIBS therefore leaves up to twelve untracked JPEGs under
 * `public/cache/tiles`, referenced by nothing, and they are exactly the kind of
 * file a hurried `git add -A` sweeps into a checkpoint. Twelve were found and
 * removed by hand once already; this makes that repeatable and safe.
 *
 * SAFE BY DEFAULT. It reports and deletes nothing unless `--delete` is passed.
 * The reason is that "unreferenced" is a claim about the DATABASE, and pointing
 * this at the wrong `DATABASE_URL` would make every committed file look like an
 * orphan. A dry run that prints 200 candidates is a signal to check the
 * connection string, not to add `--delete`.
 *
 *   npm run cache:prune                 report only, the default
 *   npm run cache:prune -- --delete     actually remove them
 *   npm run cache:prune -- --json       machine-readable, for a hook
 *
 * It refuses outright when a table it reads is empty, because an unseeded
 * database would otherwise make it "prune" the entire committed cache.
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import 'dotenv/config';

import { pool } from '../lib/db/client';

/** Each cache directory, and the column that decides what lives in it. */
const CACHES = [
  {
    label: 'satellite tiles',
    directory: 'public/cache/tiles',
    prefix: '/cache/tiles/',
    query: 'SELECT cached_path FROM satellite_tiles WHERE cached_path IS NOT NULL',
  },
  {
    label: 'property thumbnails',
    directory: 'public/cache/thumbs',
    prefix: '/cache/thumbs/',
    query: 'SELECT satellite_thumb_path AS cached_path FROM collateral WHERE satellite_thumb_path IS NOT NULL',
  },
] as const;

type Orphan = { cache: string; file: string; bytes: number };

function listFiles(directory: string): string[] {
  try {
    return readdirSync(resolve(process.cwd(), directory)).filter((n) => n.endsWith('.jpg'));
  } catch {
    return [];
  }
}

async function referenced(query: string): Promise<Set<string>> {
  const { rows } = await pool().query<{ cached_path: string }>(query);
  return new Set(
    rows
      .map((r) => r.cached_path)
      .filter(Boolean)
      .map((p) => p.slice(p.lastIndexOf('/') + 1)),
  );
}

async function main(): Promise<void> {
  const doDelete = process.argv.includes('--delete');
  const asJson = process.argv.includes('--json');

  const orphans: Orphan[] = [];
  const summary: { cache: string; onDisk: number; referenced: number; orphans: number }[] = [];

  for (const cache of CACHES) {
    const files = listFiles(cache.directory);
    const keep = await referenced(cache.query);

    /*
      The refusal that matters. An empty result means either an unseeded
      database or the wrong DATABASE_URL, and in both cases every file on disk
      looks unreferenced. Deleting the committed cache because a connection
      string was wrong is the one outcome this script must never produce.
    */
    if (files.length > 0 && keep.size === 0) {
      console.error(
        `[cache:prune] REFUSING: ${cache.directory} holds ${files.length} file(s) but the ` +
          `database references none.\n` +
          `[cache:prune] That is an unseeded database or the wrong DATABASE_URL, not ${files.length} orphans.\n` +
          `[cache:prune] Run \`npm run db:seed\` and check DATABASE_URL, then try again.`,
      );
      process.exit(2);
    }

    const found = files
      .filter((name) => !keep.has(name))
      .map((name) => {
        const path = join(resolve(process.cwd(), cache.directory), name);
        return { cache: cache.directory, file: name, bytes: statSync(path).size };
      });

    orphans.push(...found);
    summary.push({
      cache: cache.directory,
      onDisk: files.length,
      referenced: keep.size,
      orphans: found.length,
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ summary, orphans, deleted: doDelete }, null, 2));
  } else {
    console.log('\n  Cached imagery, against what the database points at\n');
    for (const row of summary) {
      console.log(
        `  ${row.cache.padEnd(22)} ${String(row.onDisk).padStart(4)} on disk, ` +
          `${String(row.referenced).padStart(4)} referenced, ` +
          `${String(row.orphans).padStart(4)} orphaned`,
      );
    }

    if (orphans.length) {
      const kb = Math.round(orphans.reduce((sum, o) => sum + o.bytes, 0) / 1024);
      console.log(`\n  ${orphans.length} orphan(s), ${kb} kB:`);
      for (const orphan of orphans.slice(0, 20)) {
        console.log(`    ${orphan.cache}/${orphan.file}`);
      }
      if (orphans.length > 20) console.log(`    ... and ${orphans.length - 20} more`);
    }
  }

  if (orphans.length === 0) {
    if (!asJson) console.log('\n  Nothing to prune.\n');
    return;
  }

  if (!doDelete) {
    if (!asJson) {
      console.log(
        '\n  Reported only. Re-run with `-- --delete` to remove them.\n' +
          '  These are refresh leftovers: each successful refresh writes a new\n' +
          '  hashed file and leaves the old one, which is what makes a rollback\n' +
          '  need no file restore.\n',
      );
    }
    return;
  }

  for (const orphan of orphans) {
    unlinkSync(join(resolve(process.cwd(), orphan.cache), orphan.file));
  }
  console.log(`\n  Deleted ${orphans.length} orphan(s).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[cache:prune]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
