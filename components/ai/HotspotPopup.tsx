'use client';

/**
 * The hotspot detail panel (S23, AC-15, AC-17).
 *
 * The popup never shows a bare number. Section 4.5 fixes what it carries: the
 * summary, the loan exposure and its share, the score with its badges, up to
 * five drivers, the rationale, the reference index beside the score, and the
 * stored input record the score was formed from. That list is the fence around
 * the one LLM-assigned figure in the product, so the panel renders every part of
 * it rather than the parts that happen to be populated.
 *
 * With nothing selected it lists the hotspots by exposure, which is also how a
 * keyboard reaches one: the map pointers are canvas, the list is not.
 */

import type { Hotspot } from '@/app/(app)/ai/queries';
import { ScoreGauge } from './ScoreGauge';
import { inputFieldLabel, scoreInputRows } from './score-inputs';

export type HotspotPopupProps = {
  hotspot: Hotspot | null;
  hotspots: readonly Hotspot[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

function money(value: number): string {
  if (value >= 1_000_000) return `S$${(value / 1_000_000).toFixed(1)}m`;
  return `S$${Math.round(value).toLocaleString('en-SG')}`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function HotspotPopup({ hotspot, hotspots, onSelect, onClose }: HotspotPopupProps) {
  if (!hotspot) {
    return (
      <aside
        data-testid="hotspot-list"
        className="flex max-h-[26rem] flex-col overflow-y-auto panel"
      >
        <h2 className="border-b border-rule px-4 py-2.5 text-sm font-semibold dark:border-rule">
          Hotspots by exposure ({hotspots.length})
        </h2>
        <ul className="divide-y divide-rule">
          {hotspots.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                data-testid={`hotspot-item-${h.id}`}
                onClick={() => onSelect(h.id)}
                className="flex w-full items-baseline justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
              >
                <span>
                  {h.name}
                  <span className="ml-1.5 text-xs opacity-60">{h.country}</span>
                </span>
                <span className="tabular-nums text-xs opacity-70">
                  {money(h.loan_exposure_sgd)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  /* Ordered and formatted by `score-inputs.ts`, never by JSONB key order. */
  const inputRows = scoreInputRows(hotspot.score_inputs);

  return (
    <aside
      data-testid="hotspot-popup"
      data-hotspot-id={hotspot.id}
      className="flex max-h-[26rem] flex-col overflow-y-auto panel"
    >
      <header className="flex items-start justify-between gap-2 border-b border-rule px-4 py-2.5 dark:border-rule">
        <div>
          <h2 data-testid="hotspot-name" className="text-sm font-semibold">
            {hotspot.name}
          </h2>
          <p className="text-xs opacity-60">
            {hotspot.country} &middot; {hotspot.hazard_type.replace(/_/g, ' ')} &middot;{' '}
            {hotspot.has_polygon ? 'polygon' : `${Math.round(hotspot.radius_m ?? 0)} m radius`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close hotspot detail"
          className="text-xs opacity-60 hover:opacity-100"
        >
          Close
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3 text-sm">
        {hotspot.summary ? (
          <p data-testid="hotspot-summary" className="opacity-80">
            {hotspot.summary}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div>
            <dt className="text-xs opacity-60">Loan exposure</dt>
            <dd data-testid="hotspot-exposure" className="tabular-nums">
              {money(hotspot.loan_exposure_sgd)}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-60">Share of hotspot book</dt>
            <dd data-testid="hotspot-share" className="tabular-nums">
              {percent(hotspot.exposure_share)}
            </dd>
          </div>
        </dl>
        <p className="text-[11px] opacity-60">
          Synthetic portfolio, illustrative figures. Collateral inside two hotspots
          counts in both, so these shares sum to more than the book.
        </p>

        <div className="border-t border-rule pt-3 dark:border-rule">
          <ScoreGauge
            llmScore={hotspot.llm_score}
            referenceIndex={hotspot.reference_index}
            scoreFallback={hotspot.score_fallback}
            scoreValidated={hotspot.score_validated}
            scoreSource={hotspot.score_source}
            model={hotspot.model}
          />
        </div>

        {hotspot.llm_drivers.length > 0 ? (
          <div data-testid="hotspot-drivers">
            <h3 className="text-xs font-medium opacity-70">Drivers</h3>
            <ul className="mt-1 space-y-1">
              {hotspot.llm_drivers.map((driver, index) => (
                <li key={`${driver.input_field}-${index}`} className="text-xs">
                  <span className="font-medium">{inputFieldLabel(driver.input_field)}</span>{' '}
                  <span className="text-muted">{driver.direction}</span>
                  {driver.note ? <span className="opacity-80"> &middot; {driver.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hotspot.llm_rationale ? (
          <div>
            <h3 className="text-xs font-medium opacity-70">Rationale</h3>
            <p data-testid="hotspot-rationale" className="mt-1 text-xs opacity-80">
              {hotspot.llm_rationale}
            </p>
          </div>
        ) : null}

        <div>
          <h3 className="text-xs font-medium text-muted">Inputs the score was formed from</h3>
          {inputRows.length > 0 ? (
            <>
              <dl
                data-testid="hotspot-inputs"
                className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs"
              >
                {inputRows.map((row) => (
                  <div key={row.key} className="contents">
                    <dt
                      data-testid={`hotspot-input-${row.key}`}
                      data-sent-to-model={row.sentToModel ? 'true' : 'false'}
                      className="text-muted"
                    >
                      {row.label}
                      {row.sentToModel ? null : (
                        <span
                          aria-label="withheld from the model"
                          title="Withheld from the prompt (ADR-3)"
                          className="ml-1 text-faint"
                        >
                          &#9679;
                        </span>
                      )}
                    </dt>
                    <dd className="text-right tabular-nums">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1.5 text-[11px] text-faint">
                A dot marks a figure the model was never shown. ADR-3 withholds the
                reference index and its two denominators from the prompt, so the
                deterministic number and the model score stay independent.
              </p>
            </>
          ) : (
            <p data-testid="hotspot-inputs-empty" className="mt-1 text-xs text-muted">
              No input record stored yet. <code>npm run prep:reference</code> writes it.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

export default HotspotPopup;
