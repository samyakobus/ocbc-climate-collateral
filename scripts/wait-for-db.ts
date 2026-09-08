/**
 * Blocks until DATABASE_URL accepts a connection, or times out.
 *
 *   npx tsx scripts/wait-for-db.ts [--timeout=60]
 *
 * The local PGlite server takes a few seconds to bring the WASM instance up, so anything
 * that runs straight after `npm run db:up` needs this. Under compose the healthcheck covers
 * it and this is a fast no-op.
 */
import process from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'
import 'dotenv/config'

export async function waitForDb(connectionString: string, timeoutSeconds = 60): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastError = ''

  while (Date.now() < deadline) {
    const client = new Client({ connectionString, connectionTimeoutMillis: 2000 })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return true
    } catch (err) {
      lastError = (err as Error).message
      await client.end().catch(() => {})
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  console.error(`[wait-for-db] gave up after ${timeoutSeconds}s: ${lastError}`)
  return false
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[wait-for-db] DATABASE_URL is not set')
    process.exit(1)
  }

  const arg = process.argv.slice(2).find((a) => a.startsWith('--timeout='))
  const timeout = arg ? Number(arg.split('=')[1]) : 60

  const ok = await waitForDb(url, timeout)
  if (!ok) process.exit(1)
  console.log('[wait-for-db] ready')
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[wait-for-db]', (err as Error).message)
    process.exit(1)
  })
}
