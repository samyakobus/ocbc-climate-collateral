/**
 * npm run prep:basemap
 *
 * Cuts the two offline basemap archives of plan 4.7 out of a Protomaps daily planet build
 * with two `pmtiles extract` invocations, and verifies the SHA-256 of each.
 *
 *   1. asia-region-z0-z10.pmtiles   by bounding box, 95E-125E / 11S-33N
 *   2. asia-cities-z0-z12.pmtiles   by --region over the twelve metro boxes in clusters.geojson
 *
 * One invocation takes one region and one maximum zoom, so a single archive cannot hold a
 * regional extract plus a high-zoom city overlay. MapLibre adds the region archive with
 * maxzoom 10 and the cities archive with minzoom 11, and `protomaps-themes-base` is
 * instantiated twice with an explicit source name per call so the two do not collide.
 *
 * Neither archive is committed: .gitignore excludes public/basemap/*.pmtiles and negates the
 * committed z0-z6 floor, so a clean clone still renders at country and regional scale.
 *
 *   npm run prep:basemap                 fetch both, verify against checksums.json
 *   npm run prep:basemap -- --record     fetch both, then WRITE checksums.json
 *   npm run prep:basemap -- --dry-run    count the tiles without downloading them
 *   npm run prep:basemap -- --floor      re-cut the committed z0-z6 floor as well
 *   npm run prep:basemap -- --clusters   rewrite clusters.geojson from METRO_BOXES and stop
 *   npm run prep:basemap -- --verify     hash the archives already on disk, no network at all
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { platform } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import 'dotenv/config'

// --- plan 4.7 constants -----------------------------------------------------

const BASEMAP_DIR = resolve(process.cwd(), 'public/basemap')
const CLUSTERS = join(BASEMAP_DIR, 'clusters.geojson')
const CHECKSUMS = join(BASEMAP_DIR, 'checksums.json')

const REGION_BBOX = '95.0,-11.0,125.0,33.0'

/**
 * The twelve metro boxes of plan 4.7, as [name, west, south, east, north].
 *
 * The 27 seeded clusters of plan S5 group into these twelve metros. Each box is 0.5 degrees
 * square and centred on the clusters it must cover, EXCEPT Shanghai and Ningbo: Pudong sits
 * at 31.23N and Ningbo at 29.87N, 1.36 degrees apart, so no 0.5-degree square holds both and
 * that one box is 0.50 x 1.86 degrees. Recorded in the plan changelog.
 *
 * The boxes are generous on purpose, about 55 km a side, so a pin placed anywhere in its
 * cluster still gets city zoom. A pin outside every box renders from the region archive
 * instead, which stops at z10.
 */
export const METRO_BOXES: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['Singapore', 103.55, 1.09, 104.05, 1.59],
  ['Klang Valley', 101.35, 2.73, 101.85, 3.23],
  ['Penang', 100.08, 5.16, 100.58, 5.66],
  ['Johor Bahru', 103.48, 1.22, 103.98, 1.72],
  ['Kota Kinabalu', 115.82, 5.73, 116.32, 6.23],
  ['Jakarta and BSD', 106.49, -6.455, 106.99, -5.955],
  ['Semarang', 110.17, -7.22, 110.67, -6.72],
  ['Surabaya', 112.5, -7.5, 113.0, -7.0],
  ['Shanghai and Ningbo', 121.3, 29.62, 121.8, 31.48],
  ['Guangzhou and Shenzhen', 113.42, 22.4, 113.92, 22.9],
  ['Xiamen', 117.84, 24.23, 118.34, 24.73],
  ['Hong Kong', 113.92, 22.1, 114.42, 22.6],
]

/** Writes the twelve boxes as ONE MultiPolygon, which is what `pmtiles extract --region` takes. */
export async function writeClusters(path = CLUSTERS): Promise<void> {
  const ring = (w: number, s: number, e: number, n: number) => [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ]

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'OCBC seeded metro clusters',
          note:
            'Twelve metro boxes as one MultiPolygon. Passed to `pmtiles extract --region` to cut ' +
            'public/basemap/asia-cities-z0-z12.pmtiles (plan 4.7). Regenerate with ' +
            '`npm run prep:basemap -- --clusters`.',
          metros: METRO_BOXES.map((b) => b[0]),
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: METRO_BOXES.map(([, w, s, e, n]) => [ring(w, s, e, n)]),
        },
      },
    ],
  }

  await writeFile(path, JSON.stringify(geojson, null, 2) + '\n', 'utf8')
  console.log(`[basemap] wrote ${path}: ${METRO_BOXES.length} boxes`)
}

const ARCHIVES = {
  region: {
    file: 'asia-region-z0-z10.pmtiles',
    args: ['--bbox=' + REGION_BBOX, '--maxzoom=10'],
    expectedTiles: 15216,
    description: 'regional archive, z0-z10 over the whole bbox',
  },
  cities: {
    file: 'asia-cities-z0-z12.pmtiles',
    args: ['--region=' + CLUSTERS, '--maxzoom=12'],
    expectedTiles: 982,
    description: 'cities archive, z0-z12 over the twelve metro boxes',
  },
  floor: {
    file: 'asia-z0-z6.pmtiles',
    args: ['--bbox=' + REGION_BBOX, '--maxzoom=6'],
    expectedTiles: 96,
    description: 'committed floor, country and regional scale only',
  },
} as const

type ArchiveKey = keyof typeof ARCHIVES

/** Budget 500 MB across both fetched files; the step fails above the hard cap. */
const HARD_CAP_BYTES = 800 * 1024 * 1024
const BUDGET_BYTES = 500 * 1024 * 1024

// --- pinned go-pmtiles ------------------------------------------------------

const PMTILES_VERSION = '1.22.0'
const PMTILES_RELEASE = `https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}`

/**
 * SHA-256 of the pinned release assets, recorded by downloading them on 2026-09-07. The
 * project publishes no checksums.txt, so these were computed here and are pinned so a
 * later run cannot silently pick up a different binary.
 */
const PMTILES_ASSETS: Record<string, { asset: string; sha256: string; binary: string }> = {
  win32: {
    asset: `go-pmtiles_${PMTILES_VERSION}_Windows_x86_64.zip`,
    sha256: 'd285d88989d23e81602a5651a60c5db37a75f287129c3d94da405d5a7227ca5a',
    binary: 'pmtiles.exe',
  },
  linux: {
    asset: `go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz`,
    sha256: 'a3a206d8fc7c2692f21747ec7d3cef2d34e6977fb3ca0209ae7d8d40c5c99161',
    binary: 'pmtiles',
  },
}

const CACHE_DIR = resolve(process.cwd(), '.cache/pmtiles')

// --- helpers ----------------------------------------------------------------

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function human(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} kB`
}

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd })
    let output = ''
    child.stdout.on('data', (d) => {
      output += d.toString()
      process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      output += d.toString()
      process.stderr.write(d)
    })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? 1, output }))
  })
}

async function head(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    return res.ok ? res : null
  } catch {
    return null
  }
}

/**
 * The Protomaps daily builds are retained for about a week, so a pinned date URL goes stale.
 * Use PLANET_URL if it resolves, otherwise walk back from today to the newest build that does.
 */
export async function resolvePlanetUrl(preferred?: string): Promise<string> {
  if (preferred) {
    const res = await head(preferred)
    if (res) {
      console.log(`[basemap] planet: ${preferred} (${human(Number(res.headers.get('content-length') ?? 0))})`)
      return preferred
    }
    console.warn(`[basemap] PLANET_URL is not available, falling back to the newest daily build`)
  }

  for (let back = 0; back < 14; back++) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - back)
    const stamp = d.toISOString().slice(0, 10).replace(/-/g, '')
    const url = `https://build.protomaps.com/${stamp}.pmtiles`
    const res = await head(url)
    if (res) {
      console.log(`[basemap] planet: ${url} (${human(Number(res.headers.get('content-length') ?? 0))})`)
      return url
    }
  }

  throw new Error(
    'No Protomaps daily build resolved in the last 14 days. Set PLANET_URL to a reachable ' +
      'archive, or skip this step: the committed z0-z6 floor still renders the map at ' +
      'country and regional scale.',
  )
}

/** Returns a usable `pmtiles` executable, downloading the pinned release if PATH has none. */
export async function resolvePmtiles(): Promise<string> {
  const probe = await run(platform() === 'win32' ? 'where' : 'which', ['pmtiles']).catch(() => null)
  if (probe && probe.code === 0) {
    const found = probe.output.trim().split(/\r?\n/)[0]
    if (found) {
      console.log(`[basemap] pmtiles: ${found} (on PATH)`)
      return found
    }
  }

  const spec = PMTILES_ASSETS[platform()]
  if (!spec) {
    throw new Error(
      `No pinned go-pmtiles asset for platform ${platform()}. Install go-pmtiles v${PMTILES_VERSION} ` +
        `manually and put it on PATH.`,
    )
  }

  const binary = join(CACHE_DIR, spec.binary)
  if (existsSync(binary)) {
    console.log(`[basemap] pmtiles: ${binary} (cached)`)
    return binary
  }

  await mkdir(CACHE_DIR, { recursive: true })
  const archive = join(CACHE_DIR, spec.asset)
  console.log(`[basemap] downloading go-pmtiles v${PMTILES_VERSION} for ${platform()}`)

  const res = await fetch(`${PMTILES_RELEASE}/${spec.asset}`, { redirect: 'follow' })
  if (!res.ok) throw new Error(`go-pmtiles download failed: HTTP ${res.status}`)
  await writeFile(archive, Buffer.from(await res.arrayBuffer()))

  const actual = await sha256File(archive)
  if (actual !== spec.sha256) {
    await rm(archive, { force: true })
    throw new Error(
      `go-pmtiles checksum mismatch.\n  expected ${spec.sha256}\n  actual   ${actual}\n` +
        `The pinned asset changed under us. Do not use it.`,
    )
  }
  console.log(`[basemap] go-pmtiles SHA-256 verified`)

  // Unpacking is per-platform on purpose. `tar` on a Windows box is usually GNU tar from Git
  // Bash, which cannot read a zip at all, and the bsdtar that can reads an absolute C:\ path
  // as a remote host spec. PowerShell's Expand-Archive is always present and does neither.
  const unpack = spec.asset.endsWith('.zip')
    ? await run('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${CACHE_DIR}' -Force`,
      ])
    : await run('tar', ['-xzf', spec.asset, spec.binary], CACHE_DIR)
  if (unpack.code !== 0) throw new Error(`could not unpack ${spec.asset} (exit ${unpack.code})`)

  await chmod(binary, 0o755).catch(() => {})

  if (!existsSync(binary)) throw new Error(`go-pmtiles extracted but ${spec.binary} is not there`)
  console.log(`[basemap] pmtiles: ${binary}`)
  return binary
}

type Checksums = Record<string, { sha256: string; bytes: number; tiles: number; cutFrom: string; cutAt: string }>

async function loadChecksums(): Promise<Checksums> {
  try {
    return JSON.parse(await readFile(CHECKSUMS, 'utf8')) as Checksums
  } catch {
    return {}
  }
}

// --- the two invocations ----------------------------------------------------

export async function extractArchive(
  pmtiles: string,
  planet: string,
  key: ArchiveKey,
  dryRun: boolean,
): Promise<{ file: string; bytes: number; sha256: string; tiles: number } | null> {
  const spec = ARCHIVES[key]
  const out = join(BASEMAP_DIR, spec.file)
  // Write to a temporary name so a failed run cannot leave a truncated archive that the
  // map would then try to read.
  const tmp = `${out}.partial`

  console.log(`\n[basemap] ${spec.file}: ${spec.description}`)
  await rm(tmp, { force: true })

  const args = ['extract', planet, dryRun ? out : tmp, ...spec.args]
  if (dryRun) args.push('--dry-run')

  const { code, output } = await run(pmtiles, args)
  if (code !== 0) {
    await rm(tmp, { force: true })
    throw new Error(`pmtiles extract failed for ${spec.file} (exit ${code})`)
  }

  const counted = /Region tiles (\d+)/.exec(output)
  const tiles = counted ? Number(counted[1]) : -1
  if (tiles !== spec.expectedTiles) {
    console.warn(
      `[basemap] WARNING ${spec.file}: pmtiles counted ${tiles} tiles, plan 4.7 says ${spec.expectedTiles}. ` +
        `The bbox, the region file or the planet build changed.`,
    )
  }

  if (dryRun) return null

  await rename(tmp, out)
  const { size } = await stat(out)
  const sha256 = await sha256File(out)
  console.log(`[basemap] ${spec.file}: ${human(size)}, ${tiles} tiles`)
  console.log(`[basemap] ${spec.file}: sha256 ${sha256}`)
  return { file: spec.file, bytes: size, sha256, tiles }
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const record = argv.includes('--record')
  const withFloor = argv.includes('--floor')

  if (argv.includes('--clusters')) {
    await writeClusters()
    return
  }

  // Offline path: hash whatever is already on disk. Used by the Day-5 rehearsal, where the
  // question is whether the archives on this laptop are the ones that were tested, and where
  // the network is deliberately down.
  if (argv.includes('--verify')) {
    const expected = await loadChecksums()
    let checked = 0
    let bad = 0
    for (const key of Object.keys(ARCHIVES) as ArchiveKey[]) {
      const file = ARCHIVES[key].file
      const path = join(BASEMAP_DIR, file)
      if (!existsSync(path)) {
        console.log(`[basemap] ${file}: absent${key === 'floor' ? ' (the floor should be committed)' : ''}`)
        continue
      }
      const { size } = await stat(path)
      const actual = await sha256File(path)
      const want = expected[file]
      checked++
      if (!want) {
        console.log(`[basemap] ${file}: ${human(size)}, sha256 ${actual} (not yet recorded)`)
      } else if (want.sha256 === actual) {
        console.log(`[basemap] ${file}: ${human(size)}, SHA-256 matches the recorded value`)
      } else {
        bad++
        console.error(`[basemap] ${file}: SHA-256 MISMATCH\n  recorded ${want.sha256}\n  actual   ${actual}`)
      }
    }
    console.log(`\n[basemap] verified ${checked} archive(s), ${bad} mismatch(es)`)
    if (bad > 0) process.exitCode = 1
    return
  }

  if (!existsSync(CLUSTERS)) {
    throw new Error(`${CLUSTERS} is missing. The cities extract cannot run without it.`)
  }

  const pmtilesBin = await resolvePmtiles()
  const planet = await resolvePlanetUrl(process.env.PLANET_URL)

  const keys: ArchiveKey[] = withFloor ? ['region', 'cities', 'floor'] : ['region', 'cities']
  const results = []
  for (const key of keys) {
    const r = await extractArchive(pmtilesBin, planet, key, dryRun)
    if (r) results.push(r)
  }

  if (dryRun) {
    console.log('\n[basemap] dry run complete, nothing written')
    return
  }

  const fetched = results.filter((r) => r.file !== ARCHIVES.floor.file)
  const total = fetched.reduce((a, r) => a + r.bytes, 0)
  console.log(`\n[basemap] fetched archives total ${human(total)} (budget ${human(BUDGET_BYTES)}, hard cap ${human(HARD_CAP_BYTES)})`)
  if (total > HARD_CAP_BYTES) {
    throw new Error(`the two fetched archives exceed the ${human(HARD_CAP_BYTES)} hard cap`)
  }
  if (total > BUDGET_BYTES) {
    console.warn(`[basemap] WARNING over the ${human(BUDGET_BYTES)} budget, under the hard cap`)
  }

  const expected = await loadChecksums()
  const cutAt = new Date().toISOString().slice(0, 10)

  if (record) {
    const next: Checksums = { ...expected }
    for (const r of results) {
      next[r.file] = { sha256: r.sha256, bytes: r.bytes, tiles: r.tiles, cutFrom: planet, cutAt }
    }
    await writeFile(CHECKSUMS, JSON.stringify(next, null, 2) + '\n', 'utf8')
    console.log(`\n[basemap] recorded ${CHECKSUMS}`)
  } else {
    let mismatches = 0
    for (const r of results) {
      const want = expected[r.file]
      if (!want) {
        console.warn(`[basemap] ${r.file}: no recorded SHA-256. Rerun with --record to pin it.`)
        continue
      }
      if (want.sha256 === r.sha256) {
        console.log(`[basemap] ${r.file}: SHA-256 matches the recorded value`)
      } else {
        mismatches++
        console.error(
          `[basemap] ${r.file}: SHA-256 MISMATCH\n  recorded ${want.sha256} (cut from ${want.cutFrom} on ${want.cutAt})\n  actual   ${r.sha256}`,
        )
      }
    }
    if (mismatches > 0) {
      console.error(
        `\n[basemap] ${mismatches} archive(s) differ from the recorded checksums. A different ` +
          `planet build produces different bytes, which is expected when the daily build rolls. ` +
          `Rerun with --record once you have confirmed the map still renders.`,
      )
      process.exitCode = 1
    }
  }

  console.log('\n[basemap] block for docs/sources.md:')
  for (const r of results) {
    console.log(`  | ${r.file} | ${r.tiles} tiles | ${human(r.bytes)} | \`${r.sha256}\` | cut from ${planet} on ${cutAt} |`)
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`\n[basemap] ${(err as Error).message}`)
    console.error(
      '[basemap] The map still renders: MapLibre falls back to the committed z0-z6 floor, ' +
        'which carries country and regional geometry only (plan 4.7, rehearsal step 6).',
    )
    process.exit(1)
  })
}
