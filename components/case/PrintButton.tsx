'use client';

/**
 * The print control on the case screen (S27).
 *
 * A client component for one reason: `window.print()`. It is the smallest
 * possible island, so the case screen itself stays a server component and none
 * of its figures cross into the browser bundle.
 *
 * It hides itself on paper, because a button that has already been pressed is
 * not information.
 */

export function PrintButton() {
  return (
    <button
      type="button"
      data-testid="case-print"
      onClick={() => window.print()}
      className="print-hide rounded border border-rule-strong px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
    >
      Print case file
    </button>
  );
}

export default PrintButton;
