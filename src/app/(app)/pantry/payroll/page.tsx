'use client';

// /pantry/payroll — Household → Payroll request module.
//
// Self-service: each helper creates their own advance / loan / bonus /
// reimbursement request, scoped to their `helperUid` (== their auth
// UID). Helpers ONLY see their own requests; parents see everything.
//
// v0 enforces visibility client-side (filter by helperUid). Firestore
// rule-level confidentiality (helper read scoped strictly to own docs)
// will tighten in a follow-up — for now any helper in the family CAN
// read other payroll requests if they bypass the UI. Acceptable for
// v0 with trusted family setups; document for tightening later.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest,
  STATUS_LABEL,
  subscribeToOpenRequests,
  subscribeToRecentRequests,
  subscribeToPayrollForHelper,
  createDraftRequest,
  deleteRequest,
  markSalaryPaid,
} from '@/lib/purchase';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { ReconcileTimerChip } from '@/components/pantry/ReconcileTimer';
import { runPayrollGenerator, type GeneratorRun } from '@/lib/payroll';
import { useConfirm } from '@/contexts/ConfirmContext';
import { listHelpers } from '@/lib/helpers';

// Auto-name comes from createDraftRequest (`PAY-NNNN · DDMMYY`).
// Helper displayName is passed as context: `PAY-NNNN · DDMMYY · Jacky`.

export default function PayrollHomePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';
  const myUid = profile?.uid ?? '';

  const [open, setOpen] = useState<PurchaseRequest[]>([]);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Recent collapses to 3 with a "+ See more" toggle (2026-05-19).
  const [showAllRecent, setShowAllRecent] = useState(false);
  const RECENT_DEFAULT_LIMIT = 3;

  const confirmAction = useConfirm();
  // One-tap "Mark paid" — captures today as the payment day. Status-only;
  // never moves the budget month (the salary stays in its work month).
  const handleMarkPaid = async (req: PurchaseRequest) => {
    if (!profile?.familyId || isGuest) return;
    const ok = await confirmAction({
      title: `Mark "${req.name || 'this salary'}" paid?`,
      message: 'Records today as the payment day. The budget month stays unchanged.',
      confirmLabel: 'Mark paid',
    });
    if (!ok) return;
    try {
      await markSalaryPaid(profile.familyId, req.id, new Date());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[payroll] markSalaryPaid failed:', e);
    }
  };
  const handleDeleteDraft = async (req: PurchaseRequest) => {
    if (!profile?.familyId) return;
    const ok = await confirmAction({
      title: `Delete "${req.name || 'this draft'}"?`,
      message: "This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteRequest(profile.familyId, req.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[payroll] deleteRequest failed:', e);
    }
  };
  // v3 — payroll auto-generator. Runs once when a parent lands on
  // this page; results show in a transient banner.
  const [generatorRun, setGeneratorRun] = useState<GeneratorRun | null>(null);
  useEffect(() => {
    if (!profile?.familyId || !profile.uid || role !== 'parent') return;
    let cancelled = false;
    (async () => {
      try {
        const run = await runPayrollGenerator(profile.familyId, profile.uid);
        if (!cancelled && run.generated.length > 0) {
          setGeneratorRun(run);
        }
      } catch { /* swallow — page renders without the banner */ }
    })();
    return () => { cancelled = true; };
  // Only re-run on family/role change, NOT on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.familyId, role]);

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);

    if (role === 'parent') {
      // Parents are allowed to read every payroll doc by the rule —
      // use the broad open/recent subscriptions and filter to payroll
      // client-side.
      const onlyPayroll = (r: PurchaseRequest) => r.module === 'payroll';
      const a = subscribeToOpenRequests(profile.familyId, (r) => {
        setOpen(r.filter(onlyPayroll));
        flip();
      });
      const b = subscribeToRecentRequests(profile.familyId, (r) => {
        setRecent(r.filter(onlyPayroll));
        flip();
      });
      return () => { clearTimeout(t); a(); b(); };
    }

    // Helpers MUST query with where(helperUid == own uid) — the
    // confidentiality rule blocks reading other helpers' payroll
    // docs, so a broad query would return permission_denied.
    if (!myUid) { setLoading(false); return; }
    const a = subscribeToPayrollForHelper(profile.familyId, myUid, 'open',   (r) => { setOpen(r); flip(); });
    const b = subscribeToPayrollForHelper(profile.familyId, myUid, 'recent', (r) => { setRecent(r); flip(); });
    return () => { clearTimeout(t); a(); b(); };
  }, [profile?.familyId, role, myUid]);

  // `pending` covers both parent-action states: pre-shop approval AND
  // post-shop close review (pending_close — 2026-05-19).
  const pending = open.filter((r) => r.status === 'pending_approval' || r.status === 'pending_close');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraft = async () => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    try {
      // 2026-05-19 — Double-pay guard. Helper-locked self-service is
      // the intended flow; when a Parent raises a MANUAL payroll
      // request and auto-payroll is already armed for any helper, we
      // pause to confirm — accidental overlap creates a near-perfect
      // duplicate that's painful to unwind once approved.
      //
      // Two signals trip the warning:
      //   • any helper has payrollConfig set (auto-payroll is armed)
      //   • there's an open auto-generated payroll request in flight
      //     (generatedBy='system' on `open`)
      if (role === 'parent') {
        const [helpers, openAutoCount] = await Promise.all([
          listHelpers(profile.familyId).catch(() => []),
          Promise.resolve(open.filter((r) => r.generatedBy === 'system').length),
        ]);
        const helpersWithAuto = helpers.filter((h) => h.payrollConfig && h.status !== 'removed');
        if (helpersWithAuto.length > 0 || openAutoCount > 0) {
          const names = helpersWithAuto.map((h) => h.displayName).slice(0, 3);
          const moreCount = helpersWithAuto.length - names.length;
          const namesLine = names.length === 0
            ? ''
            : names.join(', ') + (moreCount > 0 ? ` + ${moreCount} more` : '');
          const inflight = openAutoCount > 0
            ? ` There ${openAutoCount === 1 ? 'is' : 'are'} ${openAutoCount} auto-generated payroll request${openAutoCount === 1 ? '' : 's'} already in flight.`
            : '';
          const ok = await confirmAction({
            title: 'Auto-payroll is active',
            message: `${namesLine ? `Auto-payroll is set up for ${namesLine}. ` : ''}Manually creating a payroll entry now risks double-paying the helper.${inflight} Continue anyway?`,
            confirmLabel: 'Continue · I checked',
            tone: 'danger',
          });
          if (!ok) { setCreating(false); return; }
        }
      }

      const id = await createDraftRequest(profile.familyId, {
        // Context = helper displayName, so payroll requests read as
        // `PAY-NNNN · DDMMYY · Jacky` for the parent's audit view.
        context: profile.displayName?.split(' ')[0],
        createdBy: profile.uid,
        createdByRole: role,
        module: 'payroll',
        // Self-service: helpers pin their own UID. Parents creating a
        // payroll request (e.g. recording a bonus on a helper's behalf)
        // can pin a different uid later via the detail page; v0
        // defaults to the creator.
        helperUid: profile.uid,
      });
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[payroll] startDraft failed:', e);
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Payroll
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {role === 'parent' ? 'Payroll requests' : 'My pay'}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          {role === 'parent'
            ? 'Advances, loans, bonuses, reimbursements from helpers — approved by parents, posted to the budget.'
            : 'Request an advance, loan, bonus, or reimbursement. Only you and the parents see your requests.'}
        </p>
        {role === 'helper' && (
          <div className="mt-2 bg-hive-paper border border-hive-line rounded-xl p-2.5 flex items-center gap-2">
            <span className="text-base">🔒</span>
            <span className="text-[11px] text-hive-muted font-bold">
              Private to you. Other helpers in your family don't see your requests.
            </span>
          </div>
        )}
      </div>

      {/* Top CTA: visible without scrolling (2026-05-19). Payroll has
          no TemplatePicker (each request is unique per helper); the
          auto-payroll generator handles the "recurring" use case. */}
      {!isGuest && (
        <button
          type="button"
          onClick={startDraft}
          disabled={creating}
          className="w-full bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60 mb-4"
        >
          {creating ? 'Starting…' : (role === 'helper' ? '＋ New advance / loan / bonus' : '＋ New payroll entry')}
        </button>
      )}

      {/* Helper date-led timeline (2026-05-27): leads with the next pay-out,
          shows every pay-out this month in date order, with a small "Total
          by end of [Month]" summary at the bottom. The status-grouped
          sections below still render for transparency. */}
      {role === 'helper' && (open.length > 0 || recent.length > 0) && (
        <HelperPayTimeline open={open} recent={recent} currency={currency} />
      )}

      {/* Generator banner — surfaces what the auto-payroll just
          created so the parent knows where to look. Dismissable. */}
      {generatorRun && generatorRun.generated.length > 0 && (
        <div className="bg-pantry-leaf-soft border border-pantry-leaf rounded-hive p-3 mb-3">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="font-nunito font-extrabold text-sm text-pantry-leaf-dk">
              ⚙️ Auto-generated {generatorRun.generated.length} salary request{generatorRun.generated.length === 1 ? '' : 's'}
            </p>
            <button
              type="button"
              onClick={() => setGeneratorRun(null)}
              className="text-[11px] text-hive-muted font-bold"
            >Dismiss</button>
          </div>
          <ul className="text-[11px] text-hive-ink leading-relaxed space-y-0.5">
            {generatorRun.generated.map((g) => (
              <li key={g.helperUid}>
                · <strong>{g.helperName}</strong> · pay date {g.payDate}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-hive-muted mt-1.5">
            Review + approve them below — they appear in <strong>Awaiting your nod</strong>.
          </p>
        </div>
      )}

      {role === 'parent' && pending.length > 0 && (
        <Section title="Awaiting your nod" tone="amber" count={pending.length}>
          {/* Parents can clear a mis-raised pending salary in one tap (e.g.
              old June entries from before the cycle model). */}
          {pending.map((r) => (
            <RequestRow
              key={r.id} req={r} currency={currency} showHelper
              onDelete={r.status === 'pending_approval' ? () => handleDeleteDraft(r) : undefined}
            />
          ))}
        </Section>
      )}

      {role === 'helper' && (drafts.length > 0 || inProgress.length > 0) && (
        <>
          {drafts.length > 0 && (
            <Section title="Your drafts" tone="leaf" count={drafts.length}>
              {drafts.map((r) => <RequestRow key={r.id} req={r} currency={currency} onDelete={() => handleDeleteDraft(r)} />)}
            </Section>
          )}
          {inProgress.length > 0 && (
            <Section title="Approved" tone="leaf" count={inProgress.length}>
              {inProgress.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
            </Section>
          )}
        </>
      )}

      {role === 'parent' && drafts.length > 0 && (
        <Section title="Drafts" tone="neutral" count={drafts.length}>
          {drafts.map((r) => <RequestRow key={r.id} req={r} currency={currency} showHelper onDelete={() => handleDeleteDraft(r)} />)}
        </Section>
      )}
      {role === 'parent' && inProgress.length > 0 && (
        <Section title="In progress" tone="leaf" count={inProgress.length}>
          {inProgress.map((r) => <RequestRow key={r.id} req={r} currency={currency} showHelper />)}
        </Section>
      )}

      {role === 'helper' && pending.length > 0 && (
        <Section title="Awaiting parent approval" tone="amber" count={pending.length}>
          {pending.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
        </Section>
      )}

      {!loading && open.length === 0 && recent.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">🤝</div>
          <h3 className="font-nunito font-black text-lg">
            {role === 'parent' ? 'No payroll requests yet' : 'No requests yet'}
          </h3>
          <p className="text-hive-muted text-sm mt-1">
            {role === 'parent'
              ? "When helpers request an advance / loan / bonus, you'll see it here."
              : 'Tap "New request" below to ask for an advance, loan, bonus or reimbursement.'}
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <Section title="Recent" tone="neutral" count={recent.length}>
          {(showAllRecent ? recent : recent.slice(0, RECENT_DEFAULT_LIMIT)).map((r) => (
            <RequestRow
              key={r.id}
              req={r}
              currency={currency}
              showHelper={role === 'parent'}
              dimmed
              onMarkPaid={role === 'parent' ? () => handleMarkPaid(r) : undefined}
            />
          ))}
          {recent.length > RECENT_DEFAULT_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllRecent((v) => !v)}
              className="w-full bg-hive-paper border border-hive-line rounded-hive py-2 mt-1 text-pantry-leaf-dk font-nunito font-extrabold text-xs"
            >
              {showAllRecent
                ? '▴ Show less'
                : `＋ See ${recent.length - RECENT_DEFAULT_LIMIT} more`}
            </button>
          )}
        </Section>
      )}

      {/* Bottom fallback CTA — convenience after scroll. */}
      <div className="mt-4 mb-32">
        <button
          type="button"
          onClick={startDraft}
          disabled={creating || isGuest}
          className="w-full bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
        >
          {creating ? 'Starting…' : (role === 'helper' ? '＋ New advance / loan / bonus' : '＋ New payroll entry')}
        </button>
        {isGuest && (
          <p className="text-center text-xs text-hive-muted mt-2">
            Guest mode — sign in to create a request.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────

function Section({
  title, tone, count, children,
}: {
  title: string;
  tone: 'amber' | 'leaf' | 'neutral';
  count: number;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'amber' ? 'text-hive-honey-dk'
    : tone === 'leaf' ? 'text-pantry-leaf-dk'
    : 'text-hive-muted';
  return (
    <div className="mt-5">
      <div className={`text-[11px] font-nunito font-extrabold uppercase tracking-[2px] mb-2 flex items-center gap-2 ${toneClass}`}>
        <span>{title}</span>
        <span className="bg-hive-paper border border-hive-line rounded-full px-2 py-0.5 text-[10px] text-hive-muted">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// "1–5 Jun" / "28 May" from the cycle's pay window (ISO dates). null when
// the entry has no pay window (legacy / weekly).
function payWindowLabel(cycle: PurchaseRequest['payrollCycle']): string | null {
  const s = cycle?.payWindowStart;
  const e = cycle?.payWindowEnd;
  if (!s) return null;
  const fmtDay = (iso: string) => { const [, , d] = iso.split('-'); return String(Number(d)); };
  const fmtMon = (iso: string) => {
    const [y, m] = iso.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
  };
  if (!e || e === s) return `${fmtDay(s)} ${fmtMon(s)}`;
  // Same month → "1–5 Jun"; spanning months → "28 May–2 Jun".
  return fmtMon(s) === fmtMon(e)
    ? `${fmtDay(s)}–${fmtDay(e)} ${fmtMon(s)}`
    : `${fmtDay(s)} ${fmtMon(s)}–${fmtDay(e)} ${fmtMon(e)}`;
}

function RequestRow({
  req, currency, dimmed, showHelper, onDelete, onMarkPaid,
}: {
  req: PurchaseRequest;
  currency: string;
  dimmed?: boolean;
  showHelper?: boolean;
  /** Render an inline × delete button at the end of the row when set.
   *  Only passed for draft rows so non-drafts stay click-through-only. */
  onDelete?: () => void | Promise<void>;
  /** Parent-only: one-tap "Mark paid" for a closed-but-unpaid salary. */
  onMarkPaid?: () => void | Promise<void>;
}) {
  const total = req.actualTotalCents ?? req.estimatedTotalCents;
  const isClosed = req.status === 'closed' || req.status === 'rejected';
  // A closed salary is "Processing" (booked to budget, not yet paid) until the
  // parent marks it paid in the pay window — then "Paid {date}".
  const isSalary = req.module === 'payroll' && req.status === 'closed';
  const paidOn = req.paidAt?.toDate?.();
  const canMarkPaid = !!onMarkPaid && isSalary && !paidOn;
  return (
    <div className={`flex items-stretch gap-1.5 ${dimmed ? 'opacity-70' : ''}`}>
      <Link
        href={`/pantry/purchase/${req.id}`}
        className="flex-1 bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
      >
        <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">
          🤝
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">
            {req.name || 'Untitled request'}
          </div>
          <div className="text-[11px] text-hive-muted font-bold mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{STATUS_LABEL[req.status]}{showHelper && req.helperUid ? ` · uid ${req.helperUid.slice(0, 6)}…` : ''}</span>
            {req.status === 'approved' && <ReconcileTimerChip approvedAt={req.approvedAt} />}
            {isSalary && (
              paidOn
                ? <span className="rounded-full bg-hive-green/12 text-hive-green border border-hive-green/40 px-2 py-0.5 text-[9.5px] font-nunito font-extrabold">✓ Paid {paidOn.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                : <span className="rounded-full bg-hive-blue/12 text-hive-blue border border-hive-blue/40 px-2 py-0.5 text-[9.5px] font-nunito font-extrabold">Processing</span>
            )}
            {isSalary && !paidOn && payWindowLabel(req.payrollCycle) && (
              <span className="rounded-full bg-[#F4EFFB] text-[#6B4FA0] border border-[#C9B8E5] px-2 py-0.5 text-[9.5px] font-nunito font-extrabold">
                Pay {payWindowLabel(req.payrollCycle)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-nunito font-black text-sm text-hive-navy">
            {req.actualTotalCents != null
              ? formatCents(total, currency)
              : <>≈ {formatCentsBudgetNeat(total, currency)}</>}
          </div>
          <div className="text-[10px] text-hive-muted font-bold">
            {isClosed ? 'actual' : req.actualTotalCents != null ? 'actual' : 'est.'}
          </div>
        </div>
      </Link>
      {canMarkPaid && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onMarkPaid!(); }}
          className="flex-shrink-0 bg-hive-navy text-hive-cream rounded-hive px-3 font-nunito font-black text-[11px] hover:opacity-90"
          aria-label="Mark this salary paid"
          title="Mark paid — captures today as the payment day"
        >
          Mark&nbsp;paid
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onDelete(); }}
          className="flex-shrink-0 bg-hive-paper border border-hive-line rounded-hive px-3 text-hive-rose font-nunito font-black hover:bg-hive-rose/10 hover:border-hive-rose"
          aria-label="Delete this draft"
          title="Delete draft"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Helper date-led pay timeline (2026-05-27) ──────────────────────
//
// Used on the helper view of /pantry/payroll. Replaces the "big total at
// the top" with: NEXT pay-out hero + date-ordered list of this month's
// pay-outs + small "Total by end of [Month]" summary + a "Coming up · later"
// rail. The existing status-grouped sections still render below for
// transparency (drafts / awaiting / approved).
function HelperPayTimeline({
  open, recent, currency,
}: {
  open: PurchaseRequest[];
  recent: PurchaseRequest[];
  currency: string;
}) {
  // Combine open + recent (helper's own requests), sort by createdAt asc.
  const all = useMemo(() => {
    const merged = [...open, ...recent];
    // Dedupe by id (recent + open may overlap during transitions).
    const seen = new Set<string>();
    return merged.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }, [open, recent]);

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayMs = startOfLocalDay(now).getTime();

  const dateOf = (r: PurchaseRequest): Date | null => {
    // Salary requests carry periodEnd in payrollCycle (= end of cycle, our
    // "pay date" anchor). Off-cycle allowance requests don't — fall back to
    // createdAt which is when the generator fired.
    const pe = (r as { payrollCycle?: { periodEnd?: string } }).payrollCycle?.periodEnd;
    if (pe) {
      const [y, m, d] = pe.split('-').map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    const ms = (r.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.();
    return typeof ms === 'number' ? new Date(ms) : null;
  };

  const withDates = all
    .map((r) => ({ r, d: dateOf(r) }))
    .filter((x): x is { r: PurchaseRequest; d: Date } => x.d !== null);

  const thisMonth = withDates.filter(({ d }) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === thisMonthKey);
  thisMonth.sort((a, b) => a.d.getTime() - b.d.getTime());

  // Next pay-out = earliest entry on/after today; if none, the most recent
  // upcoming/today entry in this month; finally fall back to the first item.
  const upcomingThisMonth = thisMonth.filter(({ d }) => d.getTime() >= todayMs);
  const nextEntry = upcomingThisMonth[0] ?? thisMonth[thisMonth.length - 1] ?? null;

  // "Coming up later" — anything dated after the current month, ascending.
  const later = withDates
    .filter(({ d }) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` > thisMonthKey)
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  if (thisMonth.length === 0 && later.length === 0) return null;

  // Total by end of month — sum each request's "take-home" amount. Use
  // payrollCycle.netCents when present, else actual or estimated total.
  const totalCents = thisMonth.reduce((acc, { r }) => {
    const net = (r as { payrollCycle?: { netCents?: number } }).payrollCycle?.netCents;
    return acc + (typeof net === 'number' ? net : (r.actualTotalCents ?? r.estimatedTotalCents ?? 0));
  }, 0);

  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayIso;
  const daysFromToday = (d: Date) => Math.round((startOfLocalDay(d).getTime() - todayMs) / 86_400_000);

  const rowAmount = (r: PurchaseRequest): number => {
    const net = (r as { payrollCycle?: { netCents?: number } }).payrollCycle?.netCents;
    return typeof net === 'number' ? net : (r.actualTotalCents ?? r.estimatedTotalCents ?? 0);
  };

  return (
    <div className="mb-4">
      {/* Hero — next pay-out only */}
      {nextEntry && (
        <Link href={`/pantry/purchase/${nextEntry.r.id}`}
          className="block bg-hive-honey-soft border-2 border-hive-honey rounded-hive p-4 no-underline mb-3">
          <p className="text-[10px] uppercase tracking-[2px] font-nunito font-extrabold text-hive-honey-dk">
            💰 Next pay-out · {isToday(nextEntry.d) ? 'today' : daysFromToday(nextEntry.d) > 0 ? `in ${daysFromToday(nextEntry.d)} day${daysFromToday(nextEntry.d) === 1 ? '' : 's'}` : 'most recent'}
          </p>
          <p className="font-nunito font-black text-2xl text-hive-navy mt-1">
            {formatCents(rowAmount(nextEntry.r), currency)}
          </p>
          <p className="text-[12px] text-hive-muted font-bold mt-0.5 truncate">
            {nextEntry.r.name || 'Pay-out'} · {toDisplayDate(`${nextEntry.d.getFullYear()}-${String(nextEntry.d.getMonth() + 1).padStart(2, '0')}-${String(nextEntry.d.getDate()).padStart(2, '0')}`)}
          </p>
        </Link>
      )}

      {/* This month, in date order */}
      {thisMonth.length > 0 && (
        <>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-pantry-leaf-dk mb-2">
            All pay-outs this month · {monthName} · in order
          </p>
          <div className="flex flex-col gap-1.5">
            {thisMonth.map(({ r, d }) => {
              const today = isToday(d);
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              return (
                <Link key={r.id} href={`/pantry/purchase/${r.id}`}
                  className={`flex items-center gap-3 p-3 rounded-hive border no-underline ${today ? 'bg-hive-honey-soft border-hive-honey' : 'bg-hive-paper border-hive-line'}`}>
                  <div className="flex flex-col items-center w-12 shrink-0">
                    <span className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">
                      {d.toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                    <span className="font-nunito font-black text-lg text-hive-navy leading-none">{d.getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-extrabold text-[13px] text-hive-navy truncate">
                      {r.name || 'Pay-out'}
                    </p>
                    <p className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {STATUS_LABEL[r.status]}{today ? ' · today' : ''}
                    </p>
                  </div>
                  <p className="font-nunito font-black text-sm text-hive-navy shrink-0">
                    {formatCents(rowAmount(r), currency)}
                  </p>
                </Link>
              );
            })}
          </div>

          <div className="mt-2 px-3 py-2 bg-kaya-cream border border-hive-line rounded-hive flex items-baseline justify-between">
            <span className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">
              Total by end of {now.toLocaleDateString('en-US', { month: 'short' })}
            </span>
            <span className="font-nunito font-black text-[15px] text-hive-navy">{formatCents(totalCents, currency)}</span>
          </div>
        </>
      )}

      {later.length > 0 && (
        <>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mt-4 mb-2">Coming up · later</p>
          <div className="flex flex-col gap-1.5">
            {later.slice(0, 3).map(({ r, d }) => (
              <Link key={r.id} href={`/pantry/purchase/${r.id}`}
                className="flex items-center gap-3 p-3 rounded-hive border border-hive-line bg-hive-paper no-underline">
                <div className="flex flex-col items-center w-12 shrink-0">
                  <span className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">
                    {d.toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                  <span className="font-nunito font-black text-lg text-hive-navy leading-none">{d.getDate()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[13px] text-hive-navy truncate">
                    {r.name || 'Pay-out'}
                  </p>
                  <p className="text-[11px] text-hive-muted font-bold mt-0.5">{STATUS_LABEL[r.status]}</p>
                </div>
                <p className="font-nunito font-black text-sm text-hive-navy shrink-0">{formatCents(rowAmount(r), currency)}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
