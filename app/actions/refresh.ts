'use server';

/**
 * Server actions behind the two refresh buttons (S23, AC-14 and AC-16).
 *
 * These call the route handlers in process rather than over HTTP. Two reasons,
 * and the second is the load-bearing one.
 *
 * The refresh routes are two of the four places plan 4.9 allows an outbound
 * call, and `tests/unit/no-network-on-render.test.ts` enforces that list by
 * scanning `app/`, `components/` and `lib/` for call sites. A `fetch(` in the
 * button component would trip that scan. It would be a same-origin POST to our
 * own route rather than an outbound call, so the scan would be reporting the
 * wrong thing, but weakening the scan to make room for it is the worse trade:
 * the scan is the guard rail that keeps AC-11 honest, and its value comes from
 * having no exceptions to argue about.
 *
 * Calling the handler directly removes the question. There is no HTTP hop, no
 * second round trip through the auth cookie, and the outbound call still lives
 * exactly where the plan puts it, inside the route module.
 *
 * A failed refresh returns `ok: false` with a message and changes nothing, so
 * the strip keeps rendering its cached file and the news list keeps its items.
 * That is what offline checklist step 9 rehearses.
 */

import { revalidatePath } from 'next/cache';

import { POST as refreshTilesRoute } from '@/app/api/refresh/tiles/route';
import { POST as refreshNewsRoute } from '@/app/api/refresh/news/route';

async function run(handler: () => Promise<Response>): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await handler();
    const body = (await response.json()) as { ok?: boolean; message?: string };
    const outcome = {
      ok: Boolean(body.ok),
      message: body.message ?? (body.ok ? 'Refreshed.' : 'Refresh failed.'),
    };

    /* Only a success re-reads the page. A failure must leave the rendered
       content exactly as it was. */
    if (outcome.ok) revalidatePath('/ai');

    return outcome;
  } catch {
    return { ok: false, message: 'Could not reach the feed. Showing the cached copy.' };
  }
}

export async function refreshTilesAction(): Promise<{ ok: boolean; message: string }> {
  return run(refreshTilesRoute as () => Promise<Response>);
}

export async function refreshNewsAction(): Promise<{ ok: boolean; message: string }> {
  return run(refreshNewsRoute as () => Promise<Response>);
}
