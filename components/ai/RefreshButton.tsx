'use client';

/**
 * The refresh button shared by the satellite strip and the news list (AC-14,
 * AC-16, and AC-11 by what it does when it fails).
 *
 * It takes a server action rather than a URL, so no outbound call site lives in
 * a component. `app/actions/refresh.ts` explains why.
 *
 * Offline behaviour is the point. A failure shows its message and changes
 * nothing on the page: the strip keeps rendering its cached file and the news
 * list keeps its items. Offline checklist step 9 rehearses exactly that.
 */

import { useState, useTransition } from 'react';

export type RefreshOutcome = { ok: boolean; message: string };

export type RefreshButtonProps = {
  action: () => Promise<RefreshOutcome>;
  label?: string;
  testId?: string;
};

export function RefreshButton({ action, label = 'Refresh', testId }: RefreshButtonProps) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);

  function onClick() {
    setOutcome(null);
    startTransition(async () => {
      try {
        setOutcome(await action());
      } catch {
        setOutcome({ ok: false, message: 'Refresh failed. Showing the cached copy.' });
      }
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        disabled={pending}
        className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
      >
        {pending ? 'Refreshing...' : label}
      </button>

      {outcome ? (
        <span
          role="status"
          data-testid={testId ? `${testId}-status` : undefined}
          className={
            'text-xs ' +
            (outcome.ok
              ? 'text-green-700 dark:text-green-400'
              : 'text-amber-700 dark:text-amber-400')
          }
        >
          {outcome.message}
        </span>
      ) : null}
    </span>
  );
}

export default RefreshButton;
