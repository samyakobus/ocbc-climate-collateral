/**
 * GET /cache/... - S43, #43. Serve cached imagery that was written after the
 * server started.
 *
 * WHY THIS EXISTS, and it is a production defect rather than a test artefact.
 *
 * Next enumerates `public/` at BUILD time (`outputs.staticFiles[]`, see the
 * `public` folder reference in the vendored docs). A file created after that is
 * on disk and is not in the manifest, so `next start` answers 404 for it.
 * Measured on 2026-09-09: a file copied into `public/cache/tiles` while the
 * server was running returned 404, while a file that existed at startup
 * returned 200.
 *
 * That breaks BOTH refresh routes on their SUCCESS path, which is the worst
 * place to break. Each writes a new content-hashed file and only then moves the
 * database row, deliberately, so a rollback needs no file restore. In
 * production the consequence was: press Refresh, the route succeeds, the row
 * now points at a file the server will not serve, and the strip or the case
 * screen shows a broken image until the next restart. The offline path was
 * unaffected, because a failed refresh moves no row, which is exactly why every
 * offline test passed and nothing caught this until a live run.
 *
 * HOW IT FIXES IT. Static files win over route handlers for paths that exist in
 * the build manifest, so everything committed keeps its fast static path and
 * this handler never sees it. A file written after startup is absent from that
 * manifest, falls through to here, and is read from disk. No stored path
 * changes, no seed regeneration, no directory moves.
 *
 * This reads the local filesystem and makes no outbound call, so it is not an
 * entry in `OUTBOUND_ALLOWED` and the offline guarantee is untouched.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** The only directories this may read from. */
const ALLOWED = new Set(['tiles', 'thumbs']);

/** The only shape a cached image name may take. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jpg$/;

const ROOT = resolve(process.cwd(), 'public', 'cache');

function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string[] }> },
): Promise<NextResponse> {
  const { file } = await context.params;

  /*
    Exactly two segments, a known directory and a name matching the pattern the
    generators produce. Three separate checks rather than one clever one,
    because this handler reads whatever path it is given and the request is
    attacker-controlled. The resolved path is then confirmed to sit under the
    cache root, which is what catches anything the pattern missed.
  */
  if (!Array.isArray(file) || file.length !== 2) return notFound();

  const [directory, name] = file;
  if (!ALLOWED.has(directory) || !SAFE_NAME.test(name)) return notFound();

  const target = resolve(join(ROOT, directory, normalize(name)));
  if (!target.startsWith(ROOT + sep)) return notFound();

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(size),
      /*
        The file name carries a content hash, so the bytes behind a given URL
        never change and a long cache is safe. A refresh publishes a NEW name
        rather than new bytes, which is the same property that makes the
        write-then-move ordering safe.
      */
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
