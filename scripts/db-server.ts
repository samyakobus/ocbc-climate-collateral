/**
 * Local Postgres for development and tests.
 *
 * Plan 4.1 targets `postgis/postgis:16-3.4` under docker compose. Docker is not installed
 * on the Day-1 build host, so this script serves an embedded PGlite instance with the real
 * PostGIS extension over the ordinary Postgres wire protocol. Everything above the driver
 * is unchanged: the app and the tests connect with `pg` and DATABASE_URL, and ADR-7 still
 * holds because `v_hotspot_membership` is evaluated by PostGIS (`ST_Intersects`,
 * `ST_DWithin`) exactly as written in `db/migrations/0002_views.sql`.
 *
 * Usage:
 *   npm run db:up                 serve on PGLITE_PORT (default 5432), persisted to PGLITE_DATA_DIR
 *   npm run db:up -- --fresh      delete the data directory first
 *   npm run db:up -- --memory     in-memory, nothing persisted (used by the db test project)
 *
 * See plan section 10, "Execution deviations".
 */
import { connect } from 'node:net'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import 'dotenv/config'

const argv = process.argv.slice(2)
const fresh = argv.includes('--fresh')
const memory = argv.includes('--memory')

const port = Number(process.env.PGLITE_PORT ?? 5432)
const host = process.env.PGLITE_HOST ?? '127.0.0.1'
const dataDir = resolve(process.env.PGLITE_DATA_DIR ?? './data/pglite')

/** True when something is already accepting connections on host:port. */
export function portInUse(checkPort: number, checkHost = host, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ port: checkPort, host: checkHost })
    const settle = (inUse: boolean) => {
      socket.destroy()
      resolvePromise(inUse)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

export async function startDbServer(options: { port?: number; memory?: boolean } = {}) {
  const usePort = options.port ?? port
  const useMemory = options.memory ?? memory

  const db = await PGlite.create({
    dataDir: useMemory ? undefined : dataDir,
    extensions: { postgis },
  })
  await db.exec('CREATE EXTENSION IF NOT EXISTS postgis;')

  // PGLiteSocketServer defaults to ONE concurrent connection, which a `pg` Pool and the
  // Vitest db project both exceed. Queries are queued at the query level inside the
  // server, so raising the connection ceiling is safe.
  const server = new PGLiteSocketServer({
    db,
    port: usePort,
    host,
    maxConnections: Number(process.env.PGLITE_MAX_CONNECTIONS ?? 25),
  })
  await server.start()

  return {
    db,
    server,
    url: `postgresql://postgres:postgres@${host}:${usePort}/postgres`,
    async stop() {
      await server.stop()
      await db.close()
    },
  }
}

async function main() {
  // A live server holds the data directory open. Deleting it out from under that
  // process corrupts the store: the running server keeps accepting connections and
  // serves a damaged, empty directory, and every later migrate fails with
  // "unexpected data beyond EOF". That happened once on 2026-09-07 and cost a
  // rebuild, so --fresh now refuses rather than trusting the operator to have checked.
  if (fresh && !memory && (await portInUse(port))) {
    console.error(
      `[db] REFUSING --fresh: something is already listening on ${host}:${port}.\n` +
        `[db] Deleting ${dataDir} while a server holds it corrupts the store, and the\n` +
        `[db] running process keeps answering with an empty, damaged directory.\n` +
        `[db] Stop that server first, then rerun. To start a second instance instead,\n` +
        `[db] give it its own port and directory:\n` +
        `[db]   PGLITE_PORT=5433 PGLITE_DATA_DIR=./data/pglite-alt npm run db:up -- --fresh\n` +
        `[db] Or use --memory, which persists nothing and needs no directory.`,
    )
    process.exit(1)
  }

  if (fresh && !memory) {
    await rm(dataDir, { recursive: true, force: true })
    console.log(`[db] removed ${dataDir}`)
  }

  const { db, url, stop } = await startDbServer()
  const { rows } = await db.query<{ v: string }>('SELECT postgis_version() AS v')

  console.log(`[db] PGlite listening on ${host}:${port}`)
  console.log(`[db] PostGIS ${rows[0]?.v}`)
  console.log(`[db] storage: ${memory ? 'in-memory' : dataDir}`)
  console.log(`[db] DATABASE_URL=${url}`)
  console.log('[db] Ctrl+C to stop.')

  const shutdown = async () => {
    console.log('\n[db] stopping')
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[db] failed to start:', err)
    process.exit(1)
  })
}
