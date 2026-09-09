/**
 * Context factors (S14, AC-12).
 *
 * Seven factors per pin, measured and shown, never summed into a haircut. They
 * are the answer to "what else do you know about this site" without pretending
 * that everything known is priced.
 *
 * Each row carries a 2030 and a 2050 direction rather than a projected value,
 * because the underlying sources disagree on magnitude far more than they
 * disagree on sign.
 */

import type { CaseContextFactor } from '@/app/(app)/cases/queries';
import { humanise } from './format';

export type ContextPanelProps = {
  factors: readonly CaseContextFactor[];
};

const DIRECTION_GLYPH: Record<string, string> = {
  up: 'rises',
  down: 'falls',
  flat: 'steady',
  rising: 'rises',
  falling: 'falls',
  stable: 'steady',
};

/**
 * Context values arrive at full stored precision, which reads as false accuracy:
 * a haze index is not known to four decimal places. Precision scales with
 * magnitude so a 3386.4323 reads 3386 and a 0.0924 keeps its two figures.
 */
function readable(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function direction(value: string | null): string {
  if (!value) return '-';
  return DIRECTION_GLYPH[value.toLowerCase()] ?? value;
}

export function ContextPanel({ factors }: ContextPanelProps) {
  if (factors.length === 0) {
    return (
      <section
        data-testid="context-panel"
        className="panel avoid-break px-4 py-3 text-sm"
      >
        <h2 className="text-sm font-semibold">Context factors</h2>
        <p className="mt-1 text-xs opacity-70">
          No context factors are stored for this collateral yet.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="context-panel"
      className="panel avoid-break"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5 dark:border-rule">
        <h2 className="text-sm font-semibold">Context factors</h2>
        <span className="text-xs opacity-60">
          Measured and shown. None of these enters a haircut.
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="data-table min-w-[36rem]">
          <thead>
            <tr className="text-left opacity-60">
              <th scope="col" className="px-4 py-1.5 font-medium">Factor</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Value</th>
              <th scope="col" className="px-4 py-1.5 font-medium">2030</th>
              <th scope="col" className="px-4 py-1.5 font-medium">2050</th>
              <th scope="col" className="px-4 py-1.5 font-medium">Dataset</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((factor) => (
              <tr
                key={factor.factor}
                data-testid={`context-row-${factor.factor}`}
                className="border-t border-rule"
              >
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {humanise(factor.factor)}
                </th>
                <td className="px-4 py-2 tabular-nums">
                  {factor.value === null ? '-' : `${readable(factor.value)} ${factor.unit}`}
                </td>
                <td className="px-4 py-2">{direction(factor.direction_2030)}</td>
                <td className="px-4 py-2">{direction(factor.direction_2050)}</td>
                <td className="px-4 py-2">
                  <a
                    href={factor.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline opacity-80"
                  >
                    {factor.dataset_name}
                  </a>
                  <div className="opacity-60">{factor.sampled_at}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default ContextPanel;
