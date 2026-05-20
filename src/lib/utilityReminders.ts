// Household · Utilities v2 — regular top-up reminder generator.
//
// Unlike recurring BILLS (which auto-create a payment request + email
// the parent — see utilityBills.ts), regular TOP-UPS are variable: the
// helper buys when the meter runs low and enters the actual amount at
// shop time. So for top-ups we only REMIND — we never auto-create a
// request. (Elia 2026-05-20: "if dates given reminder only will go, so
// that helper can launch a request.")
//
// A meter opts in by setting `reminderDays` (days of the month). On a
// reminder day, Kaya nudges the family's active helpers to launch a
// top-up request. Idempotent via `lastRemindedKey` (YYYY-MM-DD).
//
// Runs on /pantry/utility page-load (mirrors the bill generator). Safe
// to call repeatedly — same-day reruns are no-ops.

import { type UtilityMeter, listMeters, updateMeter, meterLabel } from './utilityMeters';
import { listHelpers } from './helpers';
import { isGuestActive } from './mockFamily';
import { notifyUtilityTopupDue } from './notify';
import { formatCents } from '@/components/pantry/format';

export interface TopupReminderRun {
  reminded: { meterId: string; label: string; dayKey: string }[];
  skipped: { meterId: string; label: string; reason: string }[];
}

/** YYYY-MM-DD for the idempotency guard. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Is a reminder due for this meter as of `now`? True when today's day
 *  of month is in `reminderDays` and we haven't already reminded today.
 *  Clamps reminder days to the month's length so a "31" reminder still
 *  fires on the last day of a short month. */
export function topupReminderDue(
  meter: Pick<UtilityMeter, 'reminderDays' | 'lastRemindedKey'>,
  now: Date = new Date(),
): boolean {
  const days = meter.reminderDays ?? [];
  if (days.length === 0) return false;
  const today = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const hit = days.some((d) => Math.min(d, lastDayOfMonth) === today);
  if (!hit) return false;
  return meter.lastRemindedKey !== dayKey(now);
}

/** Walk every active meter with reminder days. For each whose reminder
 *  day is today (and not yet reminded today), nudge the active helpers
 *  + stamp lastRemindedKey. Fire-and-forget; failures are collected in
 *  the run summary but never thrown. */
export async function runUtilityTopupReminders(
  familyId: string,
  opts: { currency?: string } = {},
): Promise<TopupReminderRun> {
  const run: TopupReminderRun = { reminded: [], skipped: [] };
  if (isGuestActive()) return run;

  const meters = await listMeters(familyId);
  const now = new Date();
  const dueMeters = meters.filter((m) => m.active && topupReminderDue(m, now));
  if (dueMeters.length === 0) return run;

  // Resolve active helper UIDs once — the reminder targets them.
  let helperUids: string[] = [];
  try {
    const helpers = await listHelpers(familyId);
    helperUids = helpers.filter((h) => h.status !== 'removed').map((h) => h.uid);
  } catch { helperUids = []; }

  for (const m of dueMeters) {
    const label = m.label || meterLabel(m.type);
    if (helperUids.length === 0) {
      run.skipped.push({ meterId: m.id, label, reason: 'no active helpers' });
      continue;
    }
    try {
      await notifyUtilityTopupDue({
        familyId,
        meterId: m.id,
        meterLabel: label,
        helperUids,
        estimatedLabel: m.estimatedCents && m.estimatedCents > 0
          ? formatCents(m.estimatedCents, opts.currency || 'USD')
          : undefined,
      });
      // Stamp AFTER the notify so a failed notify can retry next open.
      await updateMeter(familyId, m.id, { lastRemindedKey: dayKey(now) });
      run.reminded.push({ meterId: m.id, label, dayKey: dayKey(now) });
    } catch (e) {
      run.skipped.push({ meterId: m.id, label, reason: `reminder failed: ${String(e)}` });
    }
  }
  return run;
}

/** Auto-suggested reminder days for a given top-up frequency. Used by
 *  the meter form to pre-fill (editable). "2× a month" → 1st & 15th;
 *  monthly → 1st; others → none (cadence-driven, no fixed day). */
export function suggestedReminderDays(frequency: string | undefined): number[] {
  switch (frequency) {
    case 'semimonthly': return [1, 15];
    case 'monthly':     return [1];
    default:            return [];
  }
}
