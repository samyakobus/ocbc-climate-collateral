'use client';

/**
 * The per-property satellite thumbnail on the case screen (S27, #44; AC-11,
 * AC-13, AC-14).
 *
 * WHAT RENDERS IS ALWAYS THE CACHE. `collateral.satellite_thumb_path` is a
 * same-origin path under `public/cache/thumbs/`, committed to the repository,
 * and this component renders exactly that. Nothing is fetched while the page
 * renders, which is what makes offline checklist step 4 have no degraded view
 * to rehearse: there is no degraded view, because there was never a live
 * dependency to lose.
 *
 * THE REFRESH IS THE ONE LIVE FETCH THE SPEC ALLOWS, and it is a click, not a
 * render. The outbound work happens server-side in the refresh route, which
 * writes a NEW file under a content-hashed name and only then moves the row.
 * Because the new file never overwrites the old one, a refresh that fails at
 * any stage leaves the image currently on screen untouched and needs no
 * rollback. On success this swaps to the returned path in place, with no
 * navigation, so the swap is visible on stage.
 *
 * THE ACTION IS INJECTED, never called from here, and that is not merely for
 * testability. `tests/unit/no-network-on-render.test.ts` scans `app/`,
 * `components/` and `lib/` for `fetch(` and allows it in four named files. A
 * fetch here, even a same-origin POST to our own route, would trip it, and
 * weakening the scan to argue that this one is fine is the worse trade: the
 * scan's value comes from having no exceptions to argue about. The two
 * dashboard refresh buttons take an injected action for exactly this reason,
 * and `app/actions/refresh.ts` records the reasoning at length.
 *
 * FAILURE IS A FIRST-CLASS STATE, not an error boundary. A dead network, a
 * handler that is not deployed, a 404, a malformed body: all of them report
 * their message beside the button and change nothing on the page. That is the
 * behaviour AC-11 asks for and the behaviour the demo needs, because the
 * refresh is the only thing on any screen that can fail.
 */

import Image from 'next/image';
import { useState, useTransition } from 'react';

export type SatelliteThumbProps = {
  collateralId: string;
  /** A same-origin path such as `/cache/thumbs/SG-EC-001-a1b2c3d4.jpg`, or null. */
  path: string | null;
  /** The server action that performs the refresh. Never called during render. */
  refresh: (collateralId: string) => Promise<RefreshThumbResult>;
};

export type RefreshThumbResult = {
  ok: boolean;
  message: string;
  /** The new same-origin path, when one was written. */
  path?: string | null;
};

/**
 * Same-origin only, and checked rather than trusted.
 *
 * The action is ours, but the path it returns lands in an `<img src>`, and an
 * absolute URL arriving there would be an outbound request on a screen that
 * promises none. A path that is not a rooted same-origin one under the cache
 * directory is refused and the current image is kept. This is defence in depth:
 * the column should never hold such a value, and the cost of checking is a
 * regular expression.
 */
export function isSameOriginThumb(path: unknown): path is string {
  return typeof path === 'string' && /^\/cache\/thumbs\/[A-Za-z0-9._-]+$/.test(path);
}

export function SatelliteThumb({ collateralId, path, refresh }: SatelliteThumbProps) {
  const [current, setCurrent] = useState<string | null>(
    isSameOriginThumb(path) ? path : null,
  );
  const [outcome, setOutcome] = useState<RefreshThumbResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onRefresh() {
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await refresh(collateralId);
        if (result.ok && isSameOriginThumb(result.path)) setCurrent(result.path);
        setOutcome(result);
      } catch {
        setOutcome({
          ok: false,
          message: 'Refresh failed. Showing the cached image.',
        });
      }
    });
  }

  return (
    <figure data-testid="satellite-thumb" className="panel avoid-break flex flex-col">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-surface-sunken">
        {current ? (
          /*
            `unoptimized`, deliberately. Next's optimiser rewrites the src
            through `/_next/image`, which resizes on the server at request time;
            the file here is already a small committed JPEG and the indirection
            buys nothing while adding a second thing that can fail offline. The
            `<img>` a test or an offline spec sees is then the cache path
            itself, which is what "every image is same-origin" is asserted on.
          */
          <Image
            data-testid="satellite-thumb-image"
            src={current}
            alt={`Satellite imagery over collateral ${collateralId}`}
            fill
            unoptimized
            sizes="(min-width: 1024px) 20rem, 100vw"
            className="object-cover"
          />
        ) : (
          <div
            data-testid="satellite-thumb-placeholder"
            className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center"
          >
            <span aria-hidden className="text-2xl text-faint">
              &#9633;
            </span>
            <span className="text-[11px] text-muted">No cached imagery for this property.</span>
            <span className="text-[11px] text-faint">
              <code>python -m prep.fetch_thumbs</code> writes one.
            </span>
          </div>
        )}
      </div>

      <figcaption className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]">
        <span className="text-muted">
          Satellite imagery, illustrative. Not used in any valuation.
        </span>

        <span className="print-hide flex items-center gap-2">
          <button
            type="button"
            data-testid="refresh-thumb"
            onClick={onRefresh}
            disabled={pending}
            className="rounded border border-rule-strong px-2 py-0.5 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {pending ? 'Refreshing...' : 'Refresh imagery'}
          </button>

          {outcome ? (
            <span
              role="status"
              data-testid="refresh-thumb-status"
              className={outcome.ok ? 'text-green-700 dark:text-green-400' : 'text-caution-fg'}
            >
              {outcome.message}
            </span>
          ) : null}
        </span>
      </figcaption>
    </figure>
  );
}

export default SatelliteThumb;
