'use client';

import { useActionState } from 'react';

import { saveRulesAction, type RulesState } from '@/app/actions/rules';

const NO_STATE: RulesState = { error: null, saved: false, summary: null };

export type ActiveRuleSet = {
  id: string;
  base_ltv_personal: number;
  base_ltv_corporate: number;
  band_low: number;
  band_mid: number;
  band_high: number;
  total_cap: number;
  chronic_cap: number;
  p_today: number;
  p_2030: number;
  p_2050: number;
  inundation_threshold_m: number;
  return_period: number;
  today_year: number;
  today_label: string;
  adaptation_enabled: boolean;
};

function Field({
  name,
  label,
  value,
  hint,
  step = '0.0001',
}: {
  name: string;
  label: string;
  value: number;
  hint?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={value}
        step={step}
        min="0"
        max="1"
        aria-label={label}
        className="rounded border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-black/20"
      />
      {hint ? <span className="text-[11px] opacity-60">{hint}</span> : null}
    </label>
  );
}

export function RulesForm({ active }: { active: ActiveRuleSet }) {
  const [state, formAction, pending] = useActionState<RulesState, FormData>(
    saveRulesAction,
    NO_STATE,
  );

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Recommendation bands</legend>
        <p className="text-xs opacity-70">
          Edges on the 2050 total haircut, as fractions. Lower-inclusive, so a case at exactly
          the mid edge falls in the higher band.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field name="band_low" label="Band low" value={active.band_low} hint="green below this" />
          <Field name="band_mid" label="Band mid" value={active.band_mid} hint="amber below this" />
          <Field
            name="band_high"
            label="Band high"
            value={active.band_high}
            hint="orange below, red at or above"
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Base LTV</legend>
        <p className="text-xs opacity-70">
          Applied to the climate-adjusted value, not the appraised value. A per-case override
          on an application takes precedence over these.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            name="base_ltv_personal"
            label="Personal"
            value={active.base_ltv_personal}
            step="0.001"
          />
          <Field
            name="base_ltv_corporate"
            label="Corporate"
            value={active.base_ltv_corporate}
            step="0.001"
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Combination caps</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field
            name="chronic_cap"
            label="Chronic cap"
            value={active.chronic_cap}
            hint="heat plus PM2.5"
          />
          <Field name="total_cap" label="Total cap" value={active.total_cap} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Horizon probability</legend>
        <p className="text-xs opacity-70">
          P = 1 - 0.99<sup>n</sup>, base year {active.today_year}. Only the flood term is
          multiplied by P. The stored values are authoritative; nothing derives them at run time.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field
            name="p_today"
            label="P at n = 0"
            value={active.p_today}
            step="0.001"
            hint={active.today_label}
          />
          <Field name="p_2030" label="P at n = 5" value={active.p_2030} step="0.001" hint="2030" />
          <Field
            name="p_2050"
            label="P at n = 25"
            value={active.p_2050}
            step="0.001"
            hint="2050"
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Other</legend>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field
            name="inundation_threshold_m"
            label="Inundation threshold (m)"
            value={active.inundation_threshold_m}
            step="0.05"
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Return period (years)</span>
            <input
              type="number"
              value={active.return_period}
              readOnly
              disabled
              aria-label="Return period (years)"
              data-testid="return-period"
              className="rounded border border-black/10 bg-black/5 px-2 py-1 text-sm opacity-70 dark:border-white/10 dark:bg-white/5"
            />
            <span className="text-[11px] opacity-60">
              Descriptive label only. Read-only: it does not drive P.
            </span>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="adaptation_enabled"
            defaultChecked={active.adaptation_enabled}
            aria-label="Apply adaptation credits"
          />
          Apply adaptation credits across the portfolio
        </label>
      </fieldset>

      {state.error ? (
        <p role="alert" data-testid="rules-error" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p data-testid="rules-saved" className="text-sm text-green-700 dark:text-green-400">
          Saved. {state.summary}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving and recomputing...' : 'Save and recompute'}
      </button>
    </form>
  );
}
