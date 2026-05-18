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
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest,
  STATUS_LABEL,
  subscribeToOpenRequests,
  subscribeToRecentRequests,
  createDraftRequest,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';

const todayDraftName = (role: 'parent' | 'helper') =>
  role === 'helper' ? 'Advance request' : `${new Date().toLocaleDateString('en-US', { weekday: 'long' })} payroll`;

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

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);

    // Visibility rule: helpers ONLY see their own payroll requests;
    // parents see every payroll request in the family.
    const scope = (r: PurchaseRequest) => {
      if (r.module !== 'payroll') return false;
      if (role === 'parent') return true;
      return r.helperUid === myUid;
    };
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter(scope));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter(scope));
      flip();
    });
    return () => { clearTimeout(t); a(); b(); };
  }, [profile?.familyId, role, myUid]);

  const pending = open.filter((r) => r.status === 'pending_approval');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraft = async () => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    try {
      const id = await createDraftRequest(profile.familyId, {
        name: todayDraftName(role),
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
    } catch {
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

      {role === 'parent' && pending.length > 0 && (
        <Section title="Awaiting your nod" tone="amber" count={pending.length}>
          {pending.map((r) => <RequestRow key={r.id} req={r} currency={currency} showHelper />)}
        </Section>
      )}

      {role === 'helper' && (drafts.length > 0 || inProgress.length > 0) && (
        <>
          {drafts.length > 0 && (
            <Section title="Your drafts" tone="leaf" count={drafts.length}>
              {drafts.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
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
          {drafts.map((r) => <RequestRow key={r.id} req={r} currency={currency} showHelper />)}
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
          {recent.slice(0, 5).map((r) => (
            <RequestRow key={r.id} req={r} currency={currency} showHelper={role === 'parent'} dimmed />
          ))}
        </Section>
      )}

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

function RequestRow({
  req, currency, dimmed, showHelper,
}: {
  req: PurchaseRequest;
  currency: string;
  dimmed?: boolean;
  showHelper?: boolean;
}) {
  const total = req.actualTotalCents ?? req.estimatedTotalCents;
  const isClosed = req.status === 'closed' || req.status === 'rejected';
  return (
    <Link
      href={`/pantry/purchase/${req.id}`}
      className={`bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline ${dimmed ? 'opacity-70' : ''}`}
    >
      <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">
        🤝
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">
          {req.name || 'Untitled request'}
        </div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5">
          {STATUS_LABEL[req.status]}{showHelper && req.helperUid ? ` · uid ${req.helperUid.slice(0, 6)}…` : ''}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-nunito font-black text-sm text-hive-navy">
          {formatCents(total, currency)}
        </div>
        <div className="text-[10px] text-hive-muted font-bold">
          {isClosed ? 'actual' : req.actualTotalCents != null ? 'actual' : 'est.'}
        </div>
      </div>
    </Link>
  );
}
