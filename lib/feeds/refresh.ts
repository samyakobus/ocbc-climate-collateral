/**
 * What a failed refresh says, and what it promises about the data.
 *
 * Pure, so it can be tested without a socket. The two refresh routes hold the
 * `fetch` and the timeout; this holds the sentence the user sees when one fails,
 * which is the part AC-11 and offline checklist step 9 actually check.
 *
 * Every message here ends by saying what is still on screen. "Could not reach
 * the news feed" on its own reads like data loss; "Showing cached items" is the
 * fact, and the fact is the reassuring part.
 */

export type RefreshOutcome = {
  ok: boolean;
  message: string;
};

export const TIMEOUT_MS = 5_000;

/** What the user is still looking at after this refresh failed. */
export type Fallback = 'items' | 'imagery';

const FALLBACK_TEXT: Record<Fallback, string> = {
  items: 'Showing cached items.',
  imagery: 'Showing cached imagery.',
};

/**
 * Turns whatever went wrong into one sentence.
 *
 * An abort is reported as a timeout in seconds rather than as "AbortError",
 * because the first tells a presenter the venue's network is slow and the
 * second tells them nothing.
 */
export function describeFailure(
  what: string,
  cause: unknown,
  fallback: Fallback,
  timeoutMs = TIMEOUT_MS,
): RefreshOutcome {
  const aborted = cause instanceof Error && cause.name === 'AbortError';
  const reason = aborted
    ? `it did not answer within ${timeoutMs / 1000} seconds`
    : cause instanceof Error
      ? cause.message
      : String(cause);

  return { ok: false, message: `Could not reach ${what}: ${reason}. ${FALLBACK_TEXT[fallback]}` };
}

/** A write that failed after the fetch succeeded. Nothing changed either way. */
export function describeWriteFailure(what: string, cause: unknown): RefreshOutcome {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return { ok: false, message: `Could not store ${what}: ${reason}. Nothing changed.` };
}

/** A fetch that succeeded but carried nothing usable. Still not a failure state. */
export function describeEmpty(what: string, fallback: Fallback): RefreshOutcome {
  return { ok: false, message: `${what} returned nothing usable. ${FALLBACK_TEXT[fallback]}` };
}
