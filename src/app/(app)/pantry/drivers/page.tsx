'use client';

// /pantry/drivers — Household → Drivers home.
//
// Same request → approve → reconcile loop as Pantry Purchase and
// Outdoor, scoped to the Drivers module — fuel, vehicle service,
// spare parts, car wash, tolls / parking. Driver helpers get
// `household:drivers` by default so they can request what they need
// at the pump or workshop without parent reconfig.
//
// Detail page is shared with the other Purchase modules
// (/pantry/purchase/[id]) — the request doc's `module` field steers
// the picker + Quick-add.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest,
  type DriversRequestKind,
  DRIVERS_KINDS,
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
import {
  type Vehicle, subscribeToVehicles, vehicleEmoji,
} from '@/lib/vehicles';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import TemplatePicker from '@/components/pantry/TemplatePicker';
import { ReconcileTimerChip } from '@/components/pantry/ReconcileTimer';
import { useConfirm } from '@/contexts/ConfirmContext';

// Auto-name comes from createDraftRequest (`CAR-NNNN · DDMMYY`).
// Vehicle label is passed as the context suffix when a vehicle is
// pinned: `CAR-NNNN · DDMMYY · Diana's RAV4`.

export default function DriversHomePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';

  const [open, setOpen] = useState<PurchaseRequest[]>([]);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Per-row "recycle" in flight — the closed-invoice → fresh-draft
  // shortcut, keyed by source request id so only that row goes busy.
  const [recyclingId, setRecyclingId] = useState<string | null>(null);
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
      console.error('[pantry] recycle failed:', e);
      setRecyclingId(null);
    }
  };
  const [showPicker, setShowPicker] = useState(false);
  // Recent collapses to 3 with a "+ See more" toggle (2026-05-19).
  const [showAllRecent, setShowAllRecent] = useState(false);
  const RECENT_DEFAULT_LIMIT = 3;
  // When a template is picked, stash its id while the vehicle picker
  // runs — the actual draft creation needs both pieces. Cleared on
  // create or cancel.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

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
      console.error('[drivers] deleteRequest failed:', e);
    }
  };

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);
    // Helpers use module-scoped subscriptions; broad listen fails for
    // them on the payroll rule. See purchase.ts comment.
    const c = subscribeToVehicles(profile.familyId, (v) => { setVehicles(v.filter((x) => x.active)); flip(); });
    if (role === 'helper') {
      const a = subscribeToOpenRequestsByModule(profile.familyId, 'drivers', (r) => {
        setOpen(r); flip();
      });
      const b = subscribeToRecentRequestsByModule(profile.familyId, 'drivers', (r) => {
        setRecent(r); flip();
      });
      return () => { clearTimeout(t); a(); b(); c(); };
    }
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter((x) => x.module === 'drivers'));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter((x) => x.module === 'drivers'));
      flip();
    });
    return () => { clearTimeout(t); a(); b(); c(); };
  }, [profile?.familyId, role]);

  // `pending` covers both parent-action states: pre-shop approval AND
  // post-shop close review (pending_close — 2026-05-19).
  const pending = open.filter((r) => r.status === 'pending_approval' || r.status === 'pending_close');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  // Drivers v2 (2026-07-05) — after the vehicle pick, a second step
  // asks WHAT the request is (fuel / maintenance / service / other).
  // `kindStage` holds the picked vehicle while the kind panel shows;
  // undefined = panel closed (null = "skip vehicle" was chosen).
  const [kindStage, setKindStage] = useState<Vehicle | null | undefined>(undefined);

  const startDraftWithVehicle = async (vehicle: Vehicle | null) => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setShowPicker(false);
    // Template drafts carry their own basket — the kind step doesn't
    // apply; they stay the generic mixed shape.
    if (pendingTemplateId) {
      setCreating(true);
      try {
        const id = await createDraftFromTemplate(profile.familyId, pendingTemplateId, {
          createdBy: profile.uid,
          createdByRole: role,
          vehicleId: vehicle?.id,
          context: vehicle?.label,
        });
        setPendingTemplateId(null);
        router.push(`/pantry/purchase/${id}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[drivers] startDraftWithVehicle failed:', e);
        setCreating(false);
      }
      return;
    }
    setKindStage(vehicle);
  };

  const createWithKind = async (kind: DriversRequestKind) => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    const vehicle = kindStage ?? null;
    setCreating(true);
    setKindStage(undefined);
    try {
      const id = await createDraftRequest(profile.familyId, {
        context: vehicle?.label,
        createdBy: profile.uid,
        createdByRole: role,
        module: 'drivers',
        vehicleId: vehicle?.id,
        kind,
        fuelType: vehicle?.fuel,
      });
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[drivers] createWithKind failed:', e);
      setCreating(false);
    }
  };

  // No vehicles set up yet → start a no-vehicle draft (don't gate the
  // request flow on setup). Otherwise show the picker.
  const startDraft = () => {
    setPendingTemplateId(null);
    if (vehicles.length === 0) startDraftWithVehicle(null);
    else setShowPicker(true);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Drivers
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {role === 'parent' ? 'Drivers requests' : 'Driver runs'}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          {role === 'parent'
            ? 'Fuel, vehicle service, spare parts, car wash, tolls — pinned to the specific vehicle.'
            : 'Pick a vehicle, build the request, send for the nod, reconcile after.'}
        </p>
        {/* 2026-05-18 — vehicles registry. Future: Kaya Wealth becomes
            the source of truth and this lives there; the path stays
            stable so call sites don't change. */}
        <Link
          href="/pantry/drivers/vehicles"
          className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline mt-2 inline-block"
        >
          🚗 Manage vehicles ({vehicles.length}) →
        </Link>
      </div>

      {/* Top CTA: visible without scrolling (2026-05-19). */}
      {profile?.familyId && !isGuest && (
        <div className="mb-4">
          <button
            type="button"
            onClick={startDraft}
            disabled={creating}
            className="w-full bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60 mb-2"
          >
            {creating ? 'Starting…' : '＋ New driver request'}
          </button>
          <TemplatePicker
            familyId={profile.familyId}
            module="drivers"
            currency={currency}
            onPick={async (tpl) => {
              setPendingTemplateId(tpl.id);
              if (vehicles.length === 0) await startDraftWithVehicle(null);
              else setShowPicker(true);
            }}
          />
        </div>
      )}

      {/* Vehicle picker — opens on "+ New driver request" when at
          least one vehicle is set up. "Skip" lets the helper proceed
          without pinning a vehicle (catch-all for generic spends). */}
      {showPicker && (
        <div className="bg-hive-paper border border-pantry-leaf rounded-hive p-3 mb-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk mb-2">
            Which vehicle is this for?
          </p>
          <div className="flex flex-col gap-1.5">
            {vehicles.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => startDraftWithVehicle(v)}
                disabled={creating}
                className="text-left bg-white border border-hive-line rounded-hive p-2.5 hover:border-pantry-leaf flex items-center gap-2.5 disabled:opacity-60"
              >
                <span className="text-2xl flex-shrink-0">{vehicleEmoji(v.type)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-nunito font-extrabold text-sm truncate">{v.label}</p>
                  <p className="text-[11px] text-hive-muted truncate">
                    {[v.makeModel, v.plate, v.color].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <span className="text-pantry-leaf-dk font-nunito font-black">＋</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => startDraftWithVehicle(null)}
              disabled={creating}
              className="text-left bg-hive-cream border border-dashed border-hive-line rounded-hive p-2.5 text-[12px] font-nunito font-bold text-hive-muted hover:text-hive-ink"
            >
              Skip · don't pin to a vehicle
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setShowPicker(false); setPendingTemplateId(null); }}
            className="text-[11px] text-hive-muted underline mt-2"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Kind picker — step 2 of "+ New driver request" (Drivers v2,
          2026-07-05). Four big tap targets; the kind shapes the form
          on the detail page (fuel = litres × price, service = resets
          the schedule). */}
      {kindStage !== undefined && (
        <div className="bg-hive-paper border border-pantry-leaf rounded-hive p-3 mb-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk mb-0.5">
            {kindStage ? `New request · ${kindStage.label}` : 'New request'}
          </p>
          <p className="font-nunito font-black text-base mb-2">What is this for?</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DRIVERS_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => createWithKind(k.id)}
                disabled={creating}
                className="text-center bg-white border-2 border-hive-line rounded-hive p-3 hover:border-pantry-leaf disabled:opacity-60"
              >
                <span className="block text-2xl mb-1">{k.emoji}</span>
                <span className="block font-nunito font-extrabold text-sm">{k.label}</span>
                <span className="block text-[10px] text-hive-muted font-bold mt-0.5 leading-tight">{k.sub}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setKindStage(undefined)}
            className="text-[11px] text-hive-muted underline mt-2"
          >
            Cancel
          </button>
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
            <Section title="Ready to spend · reconcile" tone="leaf" count={inProgress.length}>
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
          <div className="text-3xl mb-2">🚗</div>
          <h3 className="font-nunito font-black text-lg">No driver requests yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Quick-add fuel, a service, spare parts, a car wash or a tolls top-up. Send for approval, then reconcile after.
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
          {creating ? 'Starting…' : '＋ New driver request'}
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

// ── Bits (mirror of /pantry/outdoor) ───────────────────────────

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
  /** This row's recycle is in flight (spinner + disabled). */
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
          🚗
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
