'use server';

/**
 * app/actions/rules.ts - saving the threshold editor (S18, AC-9).
 *
 * Saving writes a NEW active `rule_sets` row, deactivating the previous one and
 * never deleting it, then recomputes the whole portfolio and revalidates every
 * screen that shows a haircut. All of it in ONE transaction, so the board
 * either sees the new thresholds everywhere or the old ones everywhere, never a
 * half-recoloured map.
 *
 * This is the one step of the demo performed live, and ADR-1 is why it is a
 * single in-process pass: no restart, no message bus, no second deployable.
 *
 * The previous rule set is kept because `valuations.rule_set_id` references it
 * and because the history is an audit trail: a director can ask what the
 * numbers were before the edit.
 */

import { revalidatePath } from 'next/cache';

import { requireRole } from '@/lib/auth/session';
import { type RuleSetEdit, validateRuleSetEdit } from '@/lib/rules/bands';
import { transaction } from '@/lib/db/client';
import { recomputeAll } from '@/lib/valuation/recompute';

export type RulesState = {
  error: string | null;
  saved: boolean;
  /** What the recompute did, so the page can say so rather than just blink. */
  summary: string | null;
};

/** Screens that render a haircut, a band or a pin colour. */
const REVALIDATE: readonly string[] = ['/map', '/cases', '/portfolio', '/ai', '/rules'];

function readNumber(form: FormData, field: string): number {
  const raw = form.get(field);
  const value = Number(String(raw ?? '').trim());
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a number.`);
  }
  return value;
}

/**
 * Save new thresholds and recompute.
 *
 * Only the risk manager may do this. The `(app)` layout already keeps officers
 * off `/rules`, and this check is the one that matters: a server action is a
 * public endpoint, and a page guard does not protect it.
 */
export async function saveRulesAction(
  _previous: RulesState,
  formData: FormData,
): Promise<RulesState> {
  const user = await requireRole(['risk_manager']);

  let edit: RuleSetEdit;
  try {
    edit = {
      base_ltv_personal: readNumber(formData, 'base_ltv_personal'),
      base_ltv_corporate: readNumber(formData, 'base_ltv_corporate'),
      band_low: readNumber(formData, 'band_low'),
      band_mid: readNumber(formData, 'band_mid'),
      band_high: readNumber(formData, 'band_high'),
      total_cap: readNumber(formData, 'total_cap'),
      chronic_cap: readNumber(formData, 'chronic_cap'),
      p_today: readNumber(formData, 'p_today'),
      p_2030: readNumber(formData, 'p_2030'),
      p_2050: readNumber(formData, 'p_2050'),
      inundation_threshold_m: readNumber(formData, 'inundation_threshold_m'),
      adaptation_enabled: formData.get('adaptation_enabled') === 'on',
    };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : 'Every threshold must be a number.',
      saved: false,
      summary: null,
    };
  }

  const invalid = validateRuleSetEdit(edit);
  if (invalid) {
    return { error: invalid, saved: false, summary: null };
  }

  let summary: string;
  try {
    summary = await transaction(async (client) => {
      /*
        Deactivate, then insert. The rule_sets_one_active partial unique index
        allows one active row at a time, so the order matters and both must
        happen in the same transaction.
      */
      await client.query('UPDATE rule_sets SET is_active = false WHERE is_active');

      await client.query(
        `INSERT INTO rule_sets (
           is_active, base_ltv_personal, base_ltv_corporate,
           band_low, band_mid, band_high, total_cap, chronic_cap,
           p_today, p_2030, p_2050, inundation_threshold_m,
           adaptation_enabled, updated_by, updated_at
         ) VALUES (true,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())`,
        [
          edit.base_ltv_personal,
          edit.base_ltv_corporate,
          edit.band_low,
          edit.band_mid,
          edit.band_high,
          edit.total_cap,
          edit.chronic_cap,
          edit.p_today,
          edit.p_2030,
          edit.p_2050,
          edit.inundation_threshold_m,
          edit.adaptation_enabled,
          user.id,
        ],
      );

      const result = await recomputeAll(client);
      return `${result.valuations} valuations and ${result.recommendations} recommendations recomputed across ${result.collateral} properties.`;
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { error: `The thresholds were not saved: ${reason}`, saved: false, summary: null };
  }

  /* Nothing is revalidated until the transaction has committed. */
  for (const path of REVALIDATE) {
    revalidatePath(path);
  }

  return { error: null, saved: true, summary };
}
