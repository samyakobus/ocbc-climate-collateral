'use server';

/**
 * The server action behind the narrative regenerate button (S25, AC-10).
 *
 * It calls the route handler in process rather than over HTTP, exactly as
 * `app/actions/refresh.ts` does and for the same reason: the outbound call must
 * stay inside `app/api/narrative/regenerate/route.ts`, which is one of the four
 * files plan 4.9 allows it in, and a `fetch(` in the button component would trip
 * the static scan. It would be a same-origin POST rather than an outbound call,
 * so the scan would be reporting the wrong thing, but the scan's value comes
 * from having no exceptions to argue about.
 *
 * Not in plan section 4.1's file list; recorded in section 10. The plan lists
 * the route and the component and is silent on how a button reaches a route,
 * and this is the pattern the project already answered that with.
 */

import { revalidatePath } from 'next/cache';

import { POST as regenerateRoute } from '@/app/api/narrative/regenerate/route';

export type NarrativeActionResult = { ok: boolean; message: string };

export async function regenerateCaseNarrativeAction(
  collateralId: string,
  scenario: string,
): Promise<NarrativeActionResult> {
  try {
    const response = await regenerateRoute(
      new Request('http://internal/api/narrative/regenerate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject_type: 'case',
          subject_id: collateralId,
          scenario,
        }),
      }),
    );

    const body = (await response.json()) as { ok?: boolean; message?: string };
    revalidatePath(`/cases/${collateralId}`);

    return {
      ok: Boolean(body.ok),
      message: body.message ?? 'Regenerated.',
    };
  } catch {
    return {
      ok: false,
      message: 'Regeneration failed. The stored narrative is unchanged.',
    };
  }
}
