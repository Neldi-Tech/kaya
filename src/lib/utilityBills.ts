// Household · Utilities v2 — recurring-bill auto-request generator.
//
// When a recurring bill (a `Utility` doc with autoRequest=true) reaches
// its due day, Kaya auto-creates a `pending_approval` utility payment
// request — stamped generatedBy:'system' — and emails the parents so
// they remember to pay. Mirrors `runPayrollGenerator` exactly:
//   • runs once on parent page-load (no server cron)
//   • idempotent via a per-period `lastGeneratedKey` on the bill
//   • returns a summary the caller can ignore (fire-and-forget)
//
// v1 scope: monthly + 2×-a-month (semimonthly) cadences only. Quarterly
// + yearly bills still roll into the budget but don't auto-request yet
// (they need an anchor-month picker — follow-up). Weekly/biweekly/daily
// are top-up territory (helper-requested), not auto-pay bills.

import {
  type Utility, listUtilities, updateUtility,
  currentPeriodKey,
} from './pantry';
import { createDraftRequest, type PurchaseRequestItem } from './purchase';
import { isGuestActive } from './mockFamily';
import { notifyUtilityBillDue } from './notify';
import { formatCents } from '@/components/pantry/format';

export interface UtilityBillGeneratorRun {
  generated: { utilityId: string; name: string; periodKey: string; requestId: string }[];
  skipped: { utilityId: string; name: string; reason: string }[];
}

/** Decide which period a bill is due for as of `now`, and the key we
 *  stamp to prevent a duplicate. Returns null when nothing is due yet.
 *
 *  monthly      → key "YYYY-MM"; due once today.date >= dueDay.
 *  semimonthly  → two halves: "YYYY-MM-H1" (due from the 1st) and
 *                 "YYYY-MM-H2" (due from the 15th). We return the LATEST
 *                 half that's due + not yet generated, so a parent who
 *                 opens the app on the 20th having missed H1 still gets
 *                 H2 (H1 would already be stamped from an earlier visit,
 *                 or is now superseded). */
export function dueBillPeriod(
  utility: Pick<Utility, 'cadence' | 'dueDay' | 'lastGeneratedKey'>,
  now: Date = new Date(),
): { periodKey: string } | null {
  const monthKey = currentPeriodKey(now);
  const day = now.getDate();

  if (utility.cadence === 'monthly') {
    const dueDay = utility.dueDay && utility.dueDay > 0 ? utility.dueDay : 1;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const effectiveDue = Math.min(dueDay, lastDay);
    if (day < effectiveDue) return null;            // not due yet this month
    if (utility.lastGeneratedKey === monthKey) return null; // already done
    return { periodKey: monthKey };
  }

  if (utility.cadence === 'semimonthly') {
    // H2 first — if we're at/after the 15th and haven't done H2, that's
    // the one to fire. Otherwise H1 if at/after the 1st and not done.
    const h2 = `${monthKey}-H2`;
    const h1 = `${monthKey}-H1`;
    if (day >= 15 && utility.lastGeneratedKey !== h2) return { periodKey: h2 };
    if (day >= 1 && utility.lastGeneratedKey !== h1 && utility.lastGeneratedKey !== h2) {
      return { periodKey: h1 };
    }
    return null;
  }

  // Other cadences don't auto-request in v1.
  return null;
}

/** Walk every recurring bill with autoRequest on. For each that's due
 *  and not yet generated this period, create a pending_approval utility
 *  request + email the parents, then stamp lastGeneratedKey.
 *
 *  `parentEmails` are the recipients for the bill-due email (caller
 *  passes the family's parent emails; empty is fine — the email step
 *  no-ops). `appUrl` builds the deep-link in the email. */
export async function runUtilityBillGenerator(
  familyId: string,
  byUid: string,
  opts: { parentEmails?: string[]; currency?: string; appUrl?: string } = {},
): Promise<UtilityBillGeneratorRun> {
  const run: UtilityBillGeneratorRun = { generated: [], skipped: [] };
  if (isGuestActive()) return run;

  const utilities = await listUtilities(familyId);
  const now = new Date();

  for (const u of utilities) {
    const name = u.name || 'Utility bill';
    if (!u.active) { run.skipped.push({ utilityId: u.id, name, reason: 'inactive' }); continue; }
    if (!u.autoRequest) { run.skipped.push({ utilityId: u.id, name, reason: 'auto-request off' }); continue; }
    if (!u.amountCents || u.amountCents <= 0) {
      run.skipped.push({ utilityId: u.id, name, reason: 'no amount set' });
      continue;
    }
    const due = dueBillPeriod(u, now);
    if (!due) { run.skipped.push({ utilityId: u.id, name, reason: 'not due / already generated' }); continue; }

    try {
      const item: PurchaseRequestItem = {
        id: `${Date.now().toString(36)}-bill`,
        name,
        category: 'other',
        qty: 1,
        unit: 'x',
        estimatedCents: u.amountCents,
      };
      const requestId = await createDraftRequest(familyId, {
        module: 'utility',
        createdBy: byUid,
        createdByRole: 'parent',
        initialStatus: 'pending_approval',
        generatedBy: 'system',
        items: [item],
        context: name,
      });
      // Stamp idempotency guard + link before emailing so a failed email
      // can't cause a duplicate request on the next run.
      await updateUtility(familyId, u.id, {
        lastGeneratedKey: due.periodKey,
        lastGeneratedRequestId: requestId,
      });
      run.generated.push({ utilityId: u.id, name, periodKey: due.periodKey, requestId });

      // Fire the bill-due email (fire-and-forget; no-ops if Resend
      // unconfigured or no recipients).
      if (opts.parentEmails && opts.parentEmails.length > 0) {
        void notifyUtilityBillDue({
          to: opts.parentEmails,
          billName: name,
          amountFormatted: formatCents(u.amountCents, opts.currency || 'USD'),
          accountRef: u.accountRef || undefined,
          dueLabel: u.dueDay && u.dueDay > 0 ? `due on the ${ordinal(u.dueDay)}` : 'due now',
          requestUrl: `${opts.appUrl || ''}/pantry/purchase/${requestId}`,
        });
      }
    } catch (e) {
      run.skipped.push({ utilityId: u.id, name, reason: `generation failed: ${String(e)}` });
    }
  }
  return run;
}

/** 1 → "1st", 2 → "2nd", 15 → "15th". */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
