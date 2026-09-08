/**
 * tests/unit/refresh-fallback.test.ts - S24. The failure half of AC-11.
 *
 * What a refresh SAYS when it fails, and what it promises about the data.
 *
 * This lives in the unit project rather than in `tests/e2e/refresh.spec.ts` for
 * a reason worth recording, because it is easy to write an end-to-end test here
 * that asserts nothing. Playwright's `page.route` intercepts requests the
 * BROWSER makes. Both refresh routes call out from the SERVER, inside the Next
 * request handler, so a browser-level block cannot reach them: the route sails
 * past the interception, reaches NASA, and the "offline" assertion passes on a
 * fully online run. I wrote that test first and it failed by succeeding.
 *
 * So the failure path is asserted where it can actually be controlled, on the
 * pure function that decides the message, and the true end-to-end behaviour is
 * covered by the Day-5 rehearsal with the host interface physically disabled
 * (`tests/offline/checklist.md`, step 9) and by S26's offline spec.
 */

import { describe, expect, it } from 'vitest';

import {
  TIMEOUT_MS,
  describeEmpty,
  describeFailure,
  describeWriteFailure,
} from '../../lib/feeds/refresh';

describe('a failed refresh says what is still on screen', () => {
  it('names the fallback, because "could not reach" alone reads like data loss', () => {
    const news = describeFailure('the news feed', new Error('getaddrinfo ENOTFOUND'), 'items');
    expect(news.ok).toBe(false);
    expect(news.message).toContain('Showing cached items.');

    const tiles = describeFailure('the imagery service', new Error('ECONNREFUSED'), 'imagery');
    expect(tiles.ok).toBe(false);
    expect(tiles.message).toContain('Showing cached imagery.');
  });

  it('reports a timeout in seconds rather than as "AbortError"', () => {
    // A presenter reading "AbortError" learns nothing. "did not answer within 5
    // seconds" tells them the venue's network is slow, which is actionable.
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const outcome = describeFailure('the news feed', abort, 'items');

    expect(outcome.message).toContain(`${TIMEOUT_MS / 1000} seconds`);
    expect(outcome.message).not.toContain('AbortError');
  });

  it('carries the underlying reason through for anything that is not a timeout', () => {
    const outcome = describeFailure('the news feed', new Error('HTTP 503'), 'items');
    expect(outcome.message).toContain('HTTP 503');
  });

  it('survives a thrown non-Error without losing the fallback sentence', () => {
    const outcome = describeFailure('the imagery service', 'socket hang up', 'imagery');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('socket hang up');
    expect(outcome.message).toContain('Showing cached imagery.');
  });

  it('promises nothing changed when the fetch worked and the write did not', () => {
    // This is the case where a half-applied refresh would be worst, so the
    // message has to be unambiguous rather than merely apologetic.
    const outcome = describeWriteFailure('the refreshed items', new Error('deadlock detected'));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Nothing changed.');
    expect(outcome.message).toContain('deadlock detected');
  });

  it('treats an empty but successful fetch as a fallback, not a success', () => {
    const outcome = describeEmpty('The news feed', 'items');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Showing cached items.');
  });

  it('never reports ok on any failure path', () => {
    const outcomes = [
      describeFailure('x', new Error('e'), 'items'),
      describeFailure('x', new Error('e'), 'imagery'),
      describeWriteFailure('x', new Error('e')),
      describeEmpty('x', 'items'),
      describeEmpty('x', 'imagery'),
    ];
    expect(outcomes.every((o) => o.ok === false)).toBe(true);
    expect(outcomes.every((o) => o.message.trim().endsWith('.'))).toBe(true);
  });
});

describe('the five-second budget is the one plan 4.9 states', () => {
  it('is five seconds for feeds and tiles', () => {
    expect(TIMEOUT_MS).toBe(5_000);
  });
});
