import { requireRole } from '@/lib/auth/session';
import { queryOne } from '@/lib/db/client';

import { RulesForm, type ActiveRuleSet } from './rules-form';

/**
 * The threshold editor (S18, AC-9). Risk manager only.
 *
 * Saving writes a new active rule set and recomputes the whole portfolio in one
 * transaction, then revalidates every screen that shows a haircut. The demo
 * raises the mid band from 10 to 12 percent, returns to the map, and the pins
 * have recoloured with no restart.
 *
 * Reads only. No outbound call, per the offline-first rule (plan 4.9).
 */
export const dynamic = 'force-dynamic';

type Row = Record<string, string | number | boolean>;

export default async function RulesPage() {
  await requireRole(['risk_manager']);

  const row = await queryOne<Row>(
    `SELECT id, base_ltv_personal, base_ltv_corporate, band_low, band_mid, band_high,
            total_cap, chronic_cap, p_today, p_2030, p_2050, inundation_threshold_m,
            return_period, today_year, today_label, adaptation_enabled
     FROM rule_sets WHERE is_active`,
  );

  const active: ActiveRuleSet = {
    id: String(row.id),
    base_ltv_personal: Number(row.base_ltv_personal),
    base_ltv_corporate: Number(row.base_ltv_corporate),
    band_low: Number(row.band_low),
    band_mid: Number(row.band_mid),
    band_high: Number(row.band_high),
    total_cap: Number(row.total_cap),
    chronic_cap: Number(row.chronic_cap),
    p_today: Number(row.p_today),
    p_2030: Number(row.p_2030),
    p_2050: Number(row.p_2050),
    inundation_threshold_m: Number(row.inundation_threshold_m),
    return_period: Number(row.return_period),
    today_year: Number(row.today_year),
    today_label: String(row.today_label),
    adaptation_enabled: Boolean(row.adaptation_enabled),
  };

  return (
    <section className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h1 data-testid="rules-heading" className="text-lg font-semibold">
          Threshold editor
        </h1>
        <p className="text-sm opacity-70">
          Saving writes a new active rule set and recomputes every case. The previous rule set is
          kept, not deleted, so the figures before an edit remain auditable.
        </p>
        <p data-testid="active-rule-set" className="text-xs opacity-60">
          Active rule set {active.id}
        </p>
      </div>

      <RulesForm active={active} />
    </section>
  );
}
