'use client';

// /pantry/purchase — Household → Purchase home.
//
// Step 1 of the Household v1 build (see Kaya-Household_Design-Proposal
// 2026-05-17 v1.1). Coexists with the legacy /pantry/list flow — this
// is the new request → approve → reconcile surface that actually debits
// the Pantry Budget.
//
// Role-aware:
//   • Parent sees "Awaiting your nod" at the top (the actionable bucket),
//     then their family's active drafts + in-progress + recent.
//   • Helper sees the same shape but the framing is reversed — drafts and
//     approved-ready-to-shop come first; pending approval is informational.

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
import { openModuleGuide } from '@/lib/moduleGuides';
import { useConfirm } from '@/contexts/ConfirmContext';

// Auto-name now comes from createDraftRequest itself (MOD-NNNN ·
// DDMMYY + optional context). Pantry has no module-specific context,
// so we pass nothing — the helper composes `PNT-0042 · 180526`.

export default function PurchaseHomePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';

  const [open, setOpen] = useState<PurchaseRequest[]>([]);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Per-row "recycle" in flight (the closed-invoice → fresh-draft
  // shortcut). Keyed by source request id so only that row's button
  // shows the busy state.
  const [recyclingId, setRecyclingId] = useState<string | null>(null);
  // 2026-05-19 — Recent list collapses to 3 with a "+ See more"
  // toggle. Keeps the actionable piles (pending / drafts / in progress)
  // closer to the top of a long page.
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
      console.error('[purchase] deleteRequest failed:', e);
    }
  };

  // Subscribe to both buckets in parallel; flip loading off as soon as
  // the first listener returns so the empty state lands fast.
  //
  // 2026-05-19 — Helpers use the module-scoped subscription to avoid
  // cross-module bleed. The broad listen reads ALL modules including
  // payroll; the payroll rule blocks non-self reads, which made the
  // whole listen permission-denied for helpers when the family had
  // any non-self payroll doc. Parents keep the broad listen since
  // their rule is unconstrained, and the broad listen also covers
  // legacy module-less docs (rare; pre-2026-05).
  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);
    if (role === 'helper') {
      const a = subscribeToOpenRequestsByModule(profile.familyId, 'pantry', (r) => {
        setOpen(r); flip();
      });
      const b = subscribeToRecentRequestsByModule(profile.familyId, 'pantry', (r) => {
        setRecent(r); flip();
      });
      return () => { clearTimeout(t); a(); b(); };
    }
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter((x) => (x.module ?? 'pantry') === 'pantry'));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter((x) => (x.module ?? 'pantry') === 'pantry'));
      flip();
    });
    return () => { clearTimeout(t); a(); b(); };
  }, [profile?.familyId, role]);

  // `pending` covers both parent-action states: pre-shop approval AND
  // post-shop close review (pending_close — 2026-05-19).
  const pending = open.filter((r) => r.status === 'pending_approval' || r.status === 'pending_close');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraft = async () => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    try {
      const id = await createDraftRequest(profile.familyId, {
        // Module is the default ('pantry'); no context — auto-name
        // resolves to `PNT-NNNN · DDMMYY`.
        createdBy: profile.uid,
        createdByRole: role,
      });
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] startDraft failed:', e);
      setCreating(false);
    }
  };

  // Recycle a closed invoice straight from its list row — re-buy the
  // same basket without opening it first. Seeds from last actuals (see
  // createDraftFromRequest) and jumps into the new draft.
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
      console.error('[purchase] recycle failed:', e);
      setRecyclingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Purchase
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {role === 'parent' ? 'Requests' : 'Shop runs'}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          {role === 'parent'
            ? 'Approve, reject, or watch a shop close out.'
            : 'Build a request, send for the nod, then reconcile after the shop.'}
        </p>
      </div>

      {/* "How it flows" — step-by-step walk-through of the request loop. */}
      <button
        type="button"
        onClick={() => openModuleGuide('purchases')}
        className="w-full flex items-center gap-2.5 rounded-hive-lg bg-hive-navy text-white px-3.5 py-2.5 mb-4 text-left active:scale-[0.99] transition-transform"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-hive-honey text-white text-sm shrink-0">▶</span>
        <span className="leading-tight">
          <span className="block font-nunito font-black text-[13px]">How Purchases flows</span>
          <span className="block text-[10.5px] opacity-75">Step-by-step: request → approve → reconcile</span>
        </span>
        <span className="ml-auto text-[11px] font-nunito font-extrabold opacity-80">Watch →</span>
      </button>

      {/* 2026-05-19 — Top CTA block. Primary new-request action sits
          ABOVE the actionable piles so it's visible without scrolling
          on long pages. Recycle picker rides alongside so past requests
          are equally discoverable for the "make a new one like that"
          flow. */}
      {profile?.familyId && !isGuest && (
        <div className="mb-4">
          <button
            type="button"
            onClick={startDraft}
            disabled={creating}
            className="w-full bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60 mb-2"
          >
            {creating ? 'Starting…' : '＋ New request'}
          </button>
          <TemplatePicker
            familyId={profile.familyId}
            module="pantry"
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

      {/* Parent's actionable pile: pending approval */}
      {role === 'parent' && pending.length > 0 && (
        <Section title="Awaiting your nod" tone="amber" count={pending.length}>
          {pending.map((r) => (
            <RequestRow key={r.id} req={r} currency={currency} />
          ))}
        </Section>
      )}

      {/* Helper's actionable pile: their drafts + anything approved
          (ready to shop) or reconciling. */}
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

      {/* Parent: drafts + in-progress shown after pending */}
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

      {/* Helper: pending approval (informational) */}
      {role === 'helper' && pending.length > 0 && (
        <Section title="Awaiting parent approval" tone="amber" count={pending.length}>
          {pending.map((r) => <RequestRow key={r.id} req={r} currency={currency} />)}
        </Section>
      )}

      {/* Empty state */}
      {!loading && open.length === 0 && recent.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">🧾</div>
          <h3 className="font-nunito font-black text-lg">No requests yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Start the first shop run — pick items from the Pantry, send for approval, then reconcile after.
          </p>
        </div>
      )}

      {/* Recently closed — capped to RECENT_DEFAULT_LIMIT (3) with a
          "+ See more" toggle to reveal the rest. Keeps the page focused
          on actionable items. */}
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
              className="w-full bg-hive-paper border border-hive-line rounded-hive py-2 mt-1 text-pantry-leaf-dk font-nunito font-extrabold text-xs"
            >
              {showAllRecent
                ? '▴ Show less'
                : `＋ See ${recent.length - RECENT_DEFAULT_LIMIT} more`}
            </button>
          )}
        </Section>
      )}

      {/* Bottom fallback "+ New request" — kept so the action is also
          reachable after a long scroll. The top block above is the
          primary CTA; this one is convenience. */}
      <div className="mt-4 mb-32">
        <button
          type="button"
          onClick={startDraft}
          disabled={creating || isGuest}
          className="w-full bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
        >
          {creating ? 'Starting…' : '＋ New request'}
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

// ── Bits ───────────────────────────────────────────────────────

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
  /** Render an inline × delete button at the end of the row when set.
   *  Only passed for draft rows so non-drafts stay click-through-only. */
  onDelete?: () => void | Promise<void>;
  /** Render an inline ♻️ recycle button when set. Only passed for
   *  closed rows — re-buys the basket without opening the invoice. */
  onRecycle?: () => void | Promise<void>;
  /** This row's recycle is in flight (shows a spinner, disables tap). */
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
        <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">
          🧾
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
          className="flex-shrink-0 bg-hive-paper border border-hive-line rounded-hive px-3 text-pantry-leaf-dk font-nunito font-black hover:bg-pantry-leaf-soft hover:border-pantry-leaf disabled:opacity-50"
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
