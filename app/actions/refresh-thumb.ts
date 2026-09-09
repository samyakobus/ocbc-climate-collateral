'use server';

/**
 * The server action behind the case screen's "refresh imagery" button (#44).
 *
 * Same shape and same reasoning as `app/actions/refresh.ts`, which should be
 * read first: the action calls the route handler IN PROCESS rather than over
 * HTTP, so there is no second round trip through the auth cookie, and the
 * outbound call stays inside the route module where plan 4.9 puts it and where
 * `tests/unit/no-network-on-render.test.ts` allows it by name. A `fetch(` in the
 * component would trip that scan; it would be a same-origin POST rather than an
 * outbound call, so the scan would be reporting the wrong thing, but weakening
 * the scan is the worse trade.
 *
 * The route refreshes ONE property, named in the body, which is why this action
 * takes a collateral id where the two dashboard actions take nothing.
 *
 * A failure of any kind returns `ok: false` with a message and revalidates
 * nothing, so the case screen keeps rendering the image it already had. That is
 * the whole offline promise for this panel: the route writes a NEW file under a
 * content-hashed name and only moves the row afterwards, so there is never a
 * moment where the file on screen has been overwritten.
 */

import { revalidatePath } from 'next/cache';

import { POST as refreshThumbsRoute } from '@/app/api/refresh/thumbs/route';

export type RefreshThumbOutcome = {
  ok: boolean;
  message: string;
  path?: string | null;
};

/**
 * A rooted same-origin path under the committed cache directory.
 *
 * Checked here as well as in the component. The component checks because the
 * value lands in an `<img src>`; this checks because the action is what
 * revalidates the page, and a success carrying an unusable path must not be
 * reported as a success.
 */
function isCachedThumbPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/cache\/thumbs\/[A-Za-z0-9._-]+$/.test(value);
}

export async function refreshThumbAction(collateralId: string): Promise<RefreshThumbOutcome> {
  try {
    const request = new Request('http://local/api/refresh/thumbs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collateral_id: collateralId }),
    });

    const response = await refreshThumbsRoute(request);
    const body = (await response.json()) as {
      ok?: boolean;
      message?: string;
      cached_path?: unknown;
      refreshed?: number;
    };

    /*
      `cached_path`, which is the route's own name for it. The route reports a
      refresh that fetched identical bytes as UNCHANGED rather than as an
      update, because the content hash is the file name; in that case there is
      no new path and the component simply keeps the image it has.
    */
    const path = isCachedThumbPath(body.cached_path) ? body.cached_path : null;
    const ok = Boolean(body.ok);

    /* Only a real change re-reads the page. Anything else must leave the
       rendered content exactly as it was, image included. */
    if (ok && path) revalidatePath(`/cases/${collateralId}`);

    return {
      ok: ok && path !== null,
      message:
        body.message ??
        (path ? 'Imagery updated.' : 'No newer imagery is available. Showing the cached image.'),
      path,
    };
  } catch {
    return {
      ok: false,
      message: 'Could not reach the imagery service. Showing the cached image.',
    };
  }
}
