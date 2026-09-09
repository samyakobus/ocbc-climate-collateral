/**
 * The only place in `app/`, `lib/` or `components/` that reads `process.env`.
 *
 * This exists because of a bug that passed its own test.
 *
 * `tests/e2e/refresh.spec.ts` starts its web server with the outbound hosts
 * pointed at a dead port, so the SERVER is genuinely offline and the refresh
 * routes must fall back. The specs failed by succeeding: the routes reached NASA
 * and reported ok. The cause is that **Turbopack statically replaces a literal
 * `process.env.SOMETHING` in the production bundle with that variable's value at
 * BUILD time**. `FEED_EONET_BASE` was absent from the build, so the read folded
 * to `undefined`, the default won permanently, and no value supplied at run time
 * could ever be seen.
 *
 * The consequences are worse than a failing test. A host could not be changed
 * without a rebuild, and the Day-5 offline rehearsal would have appeared to pass
 * while quietly reaching the real feed, which is precisely the failure AC-11
 * exists to catch.
 *
 * Reading through a VARIABLE key defeats the substitution, because the bundler
 * cannot know which property is wanted. Every runtime-configurable read in the
 * app therefore comes through this module, and
 * `tests/unit/no-literal-env-reads.test.ts` fails the build if a literal read
 * appears anywhere else.
 *
 * A note on what is NOT broken. `DATABASE_URL` is present in `.env` at build
 * time, and the isolated end-to-end database demonstrably works, so that read
 * was reaching the runtime value. It goes through here anyway: relying on a
 * variable happening to be defined at build time is the fragile half of the same
 * mechanism, and the next person to add a variable should not have to know which
 * half they are in.
 */

/** Every environment variable the running application may read. */
export const ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_POOL_MAX',
  'AUTH_SECRET',
  'ANTHROPIC_API_KEY',
  'GOOGLE_MAPS_STATIC_KEY',
  'FEED_EONET_BASE',
  'FEED_GIBS_BASE',
  'THUMB_BASE',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

/**
 * The raw value, or undefined.
 *
 * An EMPTY value counts as unset. `.env.example` ships several keys declared and
 * blank, so a developer who copies it would otherwise get `''`, and `'' ?? x`
 * keeps the empty string: every outbound URL would start at `/api/...` and fail
 * in a way that looks like a bug in the route rather than a blank config line.
 */
export function readEnv(key: EnvKey): string | undefined {
  const value = (process.env as Record<string, string | undefined>)[key];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** The value, or `fallback` when unset. */
export function readEnvOr(key: EnvKey, fallback: string): string {
  return readEnv(key) ?? fallback;
}

/**
 * The value, or a thrown error naming what to do about it.
 *
 * For the two the app cannot start without. The message says which file to look
 * in, because "AUTH_SECRET is not set" on its own sends a reader to the wrong place.
 */
export function requireEnv(key: EnvKey, hint = 'Copy .env.example to .env.'): string {
  const value = readEnv(key);
  if (value === undefined) {
    throw new Error(`${key} is not set. ${hint}`);
  }
  return value;
}

/** A positive number, or `fallback` when unset, blank or unparseable. */
export function readEnvNumber(key: EnvKey, fallback: number): number {
  const raw = readEnv(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** True when the key has a usable value. */
export function hasEnv(key: EnvKey): boolean {
  return readEnv(key) !== undefined;
}
