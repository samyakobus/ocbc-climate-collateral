/**
 * Landslide manual-review badge (S14, AC-7).
 *
 * Landslide is a manual-review flag and never a number. The spec is explicit and
 * the engine has no way to price it: there is no `landslide` member of the
 * `hazard` enum and no landslide column on `valuations`. This badge is the only
 * place it appears, and it says in words that it carries no haircut, so nobody
 * reading the breakdown wonders which line it is in.
 */

export type LandslideBadgeProps = {
  flagged: boolean;
  slopeDeg?: number | null;
};

export function LandslideBadge({ flagged, slopeDeg }: LandslideBadgeProps) {
  if (!flagged) return null;

  return (
    <span
      data-testid="landslide-badge"
      className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200"
    >
      <span aria-hidden>&#9888;</span>
      Landslide: manual review
      {typeof slopeDeg === 'number' ? (
        <span className="font-normal opacity-70">slope {slopeDeg.toFixed(1)}&deg;</span>
      ) : null}
      <span className="sr-only">
        This flag never enters the haircut. It is referred for manual review.
      </span>
    </span>
  );
}

export default LandslideBadge;
