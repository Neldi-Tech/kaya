// Household · Payroll reminder cron (daily).
//
// READ-ONLY on payroll — it never raises or writes a salary. It only sends the
// two reminder emails the parent opted into (Settings → Notifications):
//   • "💰 {Month} salaries are ready"  — on the cycle's RAISE date (cycleEnd −
//      raiseDays), when the salary hasn't been raised yet, if `salaryRaised` is on.
//   • "⏰ Time to mark salaries paid"  — on the day the pay window opens, for any
//      Processing salary not yet marked paid, if `markPaidDue` is on.
//
// Emails go via /api/notify (Resend) to each parent's login email + up to 2
// extra inboxes. No-op safe: without RESEND_API_KEY the notify route skips.
//
// Auth: standard CRON_SECRET bearer.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── Pure cycle math (mirrors src/lib/payroll.ts — kept inline so this server
//    route doesn't import the 'use client' payroll module). ────────────────
function startOfDay(d: Date): Date { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function ymd(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function monthKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function parseIso(iso: string): Date { const [y, m, dd] = iso.split('-').map(Number); return startOfDay(new Date(y, (m ?? 1) - 1, dd ?? 1)); }
function monthLabel(mk: string): string { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }

interface PayrollConfig {
  frequency?: string; basis?: string; rateCents?: number; payAnchor?: number;
  startDate?: string; endDate?: string; raiseDaysBeforeCycleEnd?: number;
  payWindow?: string; allowances?: { amountCents?: number }[];
  deductions?: { active?: boolean; perCycleCents?: number; balanceCents?: number }[];
}

function payWindowFor(cfg: PayrollConfig, cycleStart: Date): { payWindowStart: Date; payWindowEnd: Date } {
  const mode = cfg.payWindow ?? 'next_month';
  if (mode === 'same_month') {
    const day = Math.min(28, Math.max(1, cfg.payAnchor || 28));
    const d = startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth(), day));
    return { payWindowStart: d, payWindowEnd: d };
  }
  return {
    payWindowStart: startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 1)),
    payWindowEnd: startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 5)),
  };
}

/** The work cycle whose RAISE date is exactly today (monthly only). */
function cycleRaisedToday(cfg: PayrollConfig, today: Date): { cycleKey: string } | null {
  if (cfg.frequency !== 'monthly' || !cfg.startDate) return null;
  const start = parseIso(cfg.startDate);
  const raiseDays = Math.min(28, Math.max(0, Math.round(cfg.raiseDaysBeforeCycleEnd ?? 7)));
  const end = cfg.endDate ? parseIso(cfg.endDate) : null;
  const firstMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  for (let i = 0; i < 240; i++) {
    const cycleStart = startOfDay(new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1));
    const cycleEnd = startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 0));
    const raiseDate = startOfDay(new Date(cycleEnd)); raiseDate.setDate(raiseDate.getDate() - raiseDays);
    if (raiseDate.getTime() > today.getTime()) return null;       // future
    if (ymd(raiseDate) === ymd(today)) {
      if (end && cycleStart > end) return null;
      return { cycleKey: monthKey(cycleStart) };
    }
    // raiseDate < today → keep walking to the current cycle
  }
  return null;
}

function netCentsOf(cfg: PayrollConfig): number {
  const basic = cfg.basis === 'monthly' ? (cfg.rateCents ?? 0) : 0;
  const allow = (cfg.allowances ?? []).reduce((a, x) => a + (x.amountCents ?? 0), 0);
  const ded = (cfg.deductions ?? []).filter((d) => d.active && (d.balanceCents ?? 0) > 0)
    .reduce((a, d) => a + Math.min(d.perCycleCents ?? 0, d.balanceCents ?? 0), 0);
  return Math.max(0, basic + allow - ded);
}

const fmt = (cents: number, cur: string) => `${cur} ${Math.round(cents / 100).toLocaleString('en-US')}`;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-not-configured' });

  const origin = new URL(req.url).origin;
  const today = startOfDay(new Date());
  let raiseEmails = 0;
  let markPaidEmails = 0;
  let families = 0;

  try {
    const famSnap = await db.collection('families').get();
    for (const fam of famSnap.docs) {
      const family = fam.data() as { payrollNotify?: { extraEmails?: string[]; events?: Record<string, boolean> }; hiveConfig?: { currency?: string } };
      const pn = family.payrollNotify;
      if (!pn?.events) continue;
      const wantRaise = pn.events.salaryRaised === true;
      const wantPaid = pn.events.markPaidDue === true;
      if (!wantRaise && !wantPaid) continue;
      families += 1;
      const currency = family.hiveConfig?.currency ?? 'TZS';

      // Recipients: parent login emails + extra inboxes.
      const usersSnap = await db.collection('users').where('familyId', '==', fam.id).get();
      const parentEmails = usersSnap.docs
        .map((u) => u.data() as { role?: string; email?: string })
        .filter((u) => u.role === 'parent' && u.email)
        .map((u) => u.email as string);
      const recipients = Array.from(new Set([...parentEmails, ...(pn.extraEmails ?? [])]));
      if (recipients.length === 0) continue;

      // Live payroll requests for this family.
      const reqSnap = await db.collection('families').doc(fam.id).collection('purchaseRequests')
        .where('module', '==', 'payroll').get();
      const reqs = reqSnap.docs.map((d) => d.data() as {
        status?: string; budgetMonth?: string; helperUid?: string; paidAt?: unknown;
        actualTotalCents?: number; estimatedTotalCents?: number; name?: string;
        payrollCycle?: { periodStart?: string; payWindowStart?: string; payWindowEnd?: string };
      });
      // ── Salary raised today (due to raise, not yet raised) ──
      if (wantRaise) {
        const helpersSnap = await db.collection('families').doc(fam.id).collection('helpers').get();
        const dueList: { name: string; amount: string }[] = [];
        let totalCents = 0;
        let cycleLabel = '';
        for (const h of helpersSnap.docs) {
          const helper = h.data() as { displayName?: string; status?: string; payrollConfig?: PayrollConfig };
          if (helper.status === 'removed' || !helper.payrollConfig) continue;
          const due = cycleRaisedToday(helper.payrollConfig, today);
          if (!due) continue;
          // Skip if this helper already has a salary for that cycle.
          const already = reqs.some((r) => r.status !== 'rejected' && r.helperUid === h.id &&
            ((r.budgetMonth || r.payrollCycle?.periodStart?.slice(0, 7)) === due.cycleKey));
          if (already) continue;
          const net = netCentsOf(helper.payrollConfig);
          dueList.push({ name: helper.displayName ?? 'Helper', amount: fmt(net, currency) });
          totalCents += net;
          cycleLabel = monthLabel(due.cycleKey);
        }
        if (dueList.length > 0) {
          await postNotify(origin, 'payroll-raised', recipients, {
            monthLabel: cycleLabel,
            totalFormatted: fmt(totalCents, currency),
            salaries: dueList,
          });
          raiseEmails += 1;
        }
      }

      // ── Mark-paid window opens today ──
      if (wantPaid) {
        const dueList: { name: string; amount: string }[] = [];
        let cycleLabel = '';
        let windowLabel = '';
        for (const r of reqs) {
          if (r.status !== 'closed') continue;
          if (r.paidAt) continue;
          const ws = r.payrollCycle?.payWindowStart;
          if (!ws || ymd(parseIso(ws)) !== ymd(today)) continue;  // only on window-open day
          dueList.push({ name: r.name ?? 'Salary', amount: fmt(r.actualTotalCents ?? r.estimatedTotalCents ?? 0, currency) });
          cycleLabel = monthLabel(r.budgetMonth || (r.payrollCycle?.periodStart?.slice(0, 7)) || monthKey(today));
          const we = r.payrollCycle?.payWindowEnd;
          windowLabel = we && we !== ws ? `${Number(ws.slice(8))}–${Number(we.slice(8))} ${monthLabel(we.slice(0, 7)).split(' ')[0]}` : `${Number(ws.slice(8))} ${monthLabel(ws.slice(0, 7)).split(' ')[0]}`;
        }
        if (dueList.length > 0) {
          await postNotify(origin, 'mark-paid-due', recipients, {
            monthLabel: cycleLabel,
            payWindowLabel: windowLabel,
            salaries: dueList,
          });
          markPaidEmails += 1;
        }
      }
    }
  } catch (e) {
    console.error('[cron/payroll-reminders] failed:', e);
    return NextResponse.json({ error: 'scan-failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, families, raiseEmails, markPaidEmails });
}

async function postNotify(origin: string, type: string, to: string[], data: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${origin}/api/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, to, data }),
    });
  } catch (e) {
    console.error('[cron/payroll-reminders] notify failed:', e);
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
