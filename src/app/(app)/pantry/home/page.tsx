'use client';

// /pantry/home — Household → Home (durable goods).
//
// Same request → approve → reconcile loop as the other modules, scoped
// to the Home module — furniture, appliances, décor, fittings. Mostly
// parent-bought, so it sits last in the module order (low-frequency).
//
// Detail page is shared with Pantry Purchase (/pantry/purchase/[id]) —
// the request doc's `module` field steers the picker + Quick-add.

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
  subscribeToOpenRequestsByModule,
  subscribeToRecentRequestsByModule,
  createDraftRequest,
  createDraftFromTemplate,
  createDraftFromRequest,
  deleteRequest,
} from '@/lib/purchase';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import TemplatePicker from '@/components/pantry/TemplatePicker';
import { ReconcileTimerChip } from '@/components/pantry/ReconcileTimer';
import { useConfirm } from '@/contexts/ConfirmContext';

// Auto-name comes from createDraftRequest (`HOM-NNNN · DDMMYY`).

export default function HomeModulePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';

  const [open, setOpen] = useState<PurchaseRequest[]>([]);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [recyclingId, setRecyclingId] = useState<string | null>(null);
  const recycle = async (sourceId: string) => {
    if (!profile?.familyId || !profile.uid || isGuest || recyclingId) return;
    setRecyclingId(sourceId);
    try {
      const id = await createDraftFromRequest(profile.familyId, sourceId, {
        createdBy: profile.uid,
        createdByRole: role,
      });
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[home] recycle failed:', e);
      setRecyclingId(null);
    }
  };
  const [showAllRecent, setShowAllRecent] = useState(false);
  const RECENT_DEFAULT_LIMIT = 3;

  const confirmAction = useConfirm();
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
      console.error('[home] deleteRequest failed:', e);
    }
  };

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);
    if (role === 'helper') {
      const a = subscribeToOpenRequestsByModule(profile.familyId, 'home', (r) => {
        setOpen(r); flip();
      });
      const b = subscribeToRecentRequestsByModule(profile.familyId, 'home', (r) => {
        setRecent(r); flip();
      });
      return () => { clearTimeout(t); a(); b(); };
    }
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter((x) => x.module === 'home'));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter((x) => x.module === 'home'));
      flip();
    });
    return () => { clearTimeout(t); a(); b(); };
  }, [profile?.familyId, role]);

  const pending = open.filter((r) => r.status === 'pending_approval' || r.status === 'pending_close');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraft = async () => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    try {
      const id = await createDraftRequest(profile.familyId, {
        createdBy: profile.uid,
        createdByRole: role,
        module: 'home',
      });
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[home] startDraft failed:', e);
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-[#9B6B3F]">
          Household · Home
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {role === 'parent' ? 'Home requests' : 'Home runs'}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          {role === 'parent'
            ? 'Furniture, appliances, décor, fittings — the bigger household buys.'
            : 'Build a request for home items, send for the nod, then reconcile after.'}
        </p>
      </div>

      {profile?.familyId && !isGuest && (
        <div className="mb-4">
          <button
            type="button"
            onClick={startDraft}
            disabled={creating}
            className="w-full bg-[#9B6B3F] text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-[#9B6B3F]/30 disabled:opacity-60 mb-2"
          >
            {creating ? 'Starting…' : '＋ New home request'}
          </button>
          <TemplatePicker
            familyId={profile.familyId}
            module="home"
            currency={currency}
            onPick={async (tpl) => {
              if (!profile.uid) return;
              const id = await createDraftFromTemplate(profile.familyId!, tpl.id, {
                createdBy: profile.uid,
                createdByRole: role,
              });
              router.push(`/pantry/purchase/${id}`);
            }}
          />
        </div>
      )}

      {role === 'parent' && pending.length > 0 && (
        <Section title="Awaiting your nod" tone="amber" count={pending.length}>
          {pending.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
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
            <Section title="Ready to shop · reconcile" tone="leaf" count={inProgress.length}>
              {inProgress.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
            </Section>
          )}
        </>
      )}

      {role === 'parent' && drafts.length > 0 && (
        <Section title="Drafts" tone="neutral" count={drafts.length}>
          {drafts.map((r) => <RequestRow key={r.id} req={r} currency={currency} onDelete={() => handleDeleteDraft(r)} />)}
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
          <div className="text-3xl mb-2">🛋️</div>
          <h3 className="font-nunito font-black text-lg">No home requests yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Start the first one — quick-add furniture / appliances / décor / fittings, send for approval, then reconcile after.
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
              dimmed
              onRecycle={r.status === 'closed' && !isGuest ? () => recycle(r.id) : undefined}
              recycling={recyclingId === r.id}
            />
          ))}
          {recent.length > RECENT_DEFAULT_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllRecent((v) => !v)}
              className="w-full bg-hive-paper border border-hive-line rounded-hive py-2 mt-1 text-[#9B6B3F] font-nunito font-extrabold text-xs"
            >
              {showAllRecent
                ? '▴ Show less'
                : `＋ See ${recent.length - RECENT_DEFAULT_LIMIT} more`}
            </button>
          )}
        </Section>
      )}

      <div className="mt-4 mb-32">
        <button
          type="button"
          onClick={startDraft}
          disabled={creating || isGuest}
          className="w-full bg-[#9B6B3F] text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-[#9B6B3F]/30 disabled:opacity-60"
        >
          {creating ? 'Starting…' : '＋ New home request'}
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

// ── Bits (mirror /pantry/outdoor's local helpers; kept inline so the
//   surface stays independently tweakable). ───────────────────────────

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
  req, currency, dimmed, onDelete, onRecycle, recycling,
}: {
  req: PurchaseRequest;
  currency: string;
  dimmed?: boolean;
  onDelete?: () => void | Promise<void>;
  onRecycle?: () => void | Promise<void>;
  recycling?: boolean;
}) {
  const total = req.actualTotalCents ?? req.estimatedTotalCents;
  const isClosed = req.status === 'closed' || req.status === 'rejected';
  return (
    <div className={`flex items-stretch gap-1.5 ${dimmed ? 'opacity-70' : ''}`}>
      <Link
        href={`/pantry/purchase/${req.id}`}
        className="flex-1 bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
      >
        <div className="w-10 h-10 rounded-xl bg-[#F6EBDD] flex items-center justify-center text-base flex-shrink-0">
          🛋️
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">
            {req.name || 'Untitled request'}
          </div>
          <div className="text-[11px] text-hive-muted font-bold mt-0.5 flex items-center gap-1.5">
            <span>{req.items.length} {req.items.length === 1 ? 'item' : 'items'} · {STATUS_LABEL[req.status]}</span>
            {req.status === 'approved' && <ReconcileTimerChip approvedAt={req.approvedAt} />}
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
      {onRecycle && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onRecycle(); }}
          disabled={recycling}
          className="flex-shrink-0 bg-hive-paper border border-hive-line rounded-hive px-3 text-[#9B6B3F] font-nunito font-black hover:bg-[#F6EBDD] hover:border-[#E0C4A3] disabled:opacity-50"
          aria-label="Recycle — re-buy these items"
          title="Recycle · re-buy these items"
        >
          {recycling ? '…' : '♻️'}
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
