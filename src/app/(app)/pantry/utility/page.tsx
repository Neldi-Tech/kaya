'use client';

// /pantry/utility — Household → Utility request module.
//
// Same request → approve → reconcile loop as Pantry / Outdoor /
// Drivers, scoped to utility top-ups + bill payments (electricity,
// water, internet, gas, TV, security, rent). Coexists with the
// existing /pantry/utilities catalogue (recurring bills) — Utilities
// there is the CATALOGUE of bills the family pays; this page is the
// transactional surface that actually debits the budget.

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

const todayDraftName = () => {
  const d = new Date();
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })} utility`;
};

export default function UtilityHomePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';

  const [open, setOpen] = useState<PurchaseRequest[]>([]);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter((x) => x.module === 'utility'));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter((x) => x.module === 'utility'));
      flip();
    });
    return () => { clearTimeout(t); a(); b(); };
  }, [profile?.familyId]);

  const pending = open.filter((r) => r.status === 'pending_approval');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraft = async () => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    try {
      const id = await createDraftRequest(profile.familyId, {
        name: todayDraftName(),
        createdBy: profile.uid,
        createdByRole: role,
        module: 'utility',
      });
      router.push(`/pantry/purchase/${id}`);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          Household · Utility
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {role === 'parent' ? 'Utility requests' : 'Utility runs'}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          {role === 'parent'
            ? 'Top-ups + bill payments for electricity, water, internet, gas, TV, security, rent.'
            : 'Request a top-up or bill payment, send for the nod, then reconcile after.'}
        </p>
        <p className="text-[11px] text-hive-muted mt-2 font-bold">
          Recurring bills live in <Link href="/pantry/utilities" className="text-hive-honey-dk underline">/pantry/utilities</Link> (the catalogue) — this is the transactional surface.
        </p>
      </div>

      {role === 'parent' && pending.length > 0 && (
        <Section title="Awaiting your nod" tone="amber" count={pending.length}>
          {pending.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
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
            <Section title="Ready to pay · reconcile" tone="leaf" count={inProgress.length}>
              {inProgress.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
            </Section>
          )}
        </>
      )}

      {role === 'parent' && drafts.length > 0 && (
        <Section title="Drafts" tone="neutral" count={drafts.length}>
          {drafts.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
        </Section>
      )}
      {role === 'parent' && inProgress.length > 0 && (
        <Section title="In progress" tone="leaf" count={inProgress.length}>
          {inProgress.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
        </Section>
      )}

      {role === 'helper' && pending.length > 0 && (
        <Section title="Awaiting parent approval" tone="amber" count={pending.length}>
          {pending.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
        </Section>
      )}

      {!loading && open.length === 0 && recent.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">⚡</div>
          <h3 className="font-nunito font-black text-lg">No utility requests yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Request an electricity top-up, internet payment, or gas refill. Send for approval, then reconcile after.
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <Section title="Recent" tone="neutral" count={recent.length}>
          {recent.slice(0, 5).map((r) => (
            <RequestRow key={r.id} req={r} currency={currency} dimmed />
          ))}
        </Section>
      )}

      <div className="mt-4 mb-32">
        <button
          type="button"
          onClick={startDraft}
          disabled={creating || isGuest}
          className="w-full bg-hive-honey text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-hive-honey/30 disabled:opacity-60"
        >
          {creating ? 'Starting…' : '＋ New utility request'}
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
  req, currency, dimmed,
}: {
  req: PurchaseRequest;
  currency: string;
  dimmed?: boolean;
}) {
  const total = req.actualTotalCents ?? req.estimatedTotalCents;
  const isClosed = req.status === 'closed' || req.status === 'rejected';
  return (
    <Link
      href={`/pantry/purchase/${req.id}`}
      className={`bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline ${dimmed ? 'opacity-70' : ''}`}
    >
      <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-base flex-shrink-0">
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">
          {req.name || 'Untitled request'}
        </div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5">
          {req.items.length} {req.items.length === 1 ? 'item' : 'items'} · {STATUS_LABEL[req.status]}
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
