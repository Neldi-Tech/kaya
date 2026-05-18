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
  STATUS_LABEL,
  subscribeToOpenRequests,
  subscribeToRecentRequests,
  createDraftRequest,
  createDraftFromTemplate,
} from '@/lib/purchase';
import {
  type Vehicle, subscribeToVehicles, vehicleEmoji,
} from '@/lib/vehicles';
import { formatCents } from '@/components/pantry/format';
import TemplatePicker from '@/components/pantry/TemplatePicker';

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
  const [showPicker, setShowPicker] = useState(false);
  // When a template is picked, stash its id while the vehicle picker
  // runs — the actual draft creation needs both pieces. Cleared on
  // create or cancel.
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter((x) => x.module === 'drivers'));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter((x) => x.module === 'drivers'));
      flip();
    });
    const c = subscribeToVehicles(profile.familyId, (v) => { setVehicles(v.filter((x) => x.active)); flip(); });
    return () => { clearTimeout(t); a(); b(); c(); };
  }, [profile?.familyId]);

  const pending = open.filter((r) => r.status === 'pending_approval');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraftWithVehicle = async (vehicle: Vehicle | null) => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    setShowPicker(false);
    try {
      // If a template is pending, branch — the items come from the
      // template snapshot, not a fresh basket.
      let id: string;
      if (pendingTemplateId) {
        id = await createDraftFromTemplate(profile.familyId, pendingTemplateId, {
          createdBy: profile.uid,
          createdByRole: role,
          vehicleId: vehicle?.id,
          context: vehicle?.label,
        });
        setPendingTemplateId(null);
      } else {
        id = await createDraftRequest(profile.familyId, {
          context: vehicle?.label,
          createdBy: profile.uid,
          createdByRole: role,
          module: 'drivers',
          vehicleId: vehicle?.id,
        });
      }
      router.push(`/pantry/purchase/${id}`);
    } catch {
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
            <Section title="Ready to spend · reconcile" tone="leaf" count={inProgress.length}>
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
          <div className="text-3xl mb-2">🚗</div>
          <h3 className="font-nunito font-black text-lg">No driver requests yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Quick-add fuel, a service, spare parts, a car wash or a tolls top-up. Send for approval, then reconcile after.
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
        {profile?.familyId && !isGuest && (
          <TemplatePicker
            familyId={profile.familyId}
            module="drivers"
            currency={currency}
            onPick={async (tpl) => {
              // Stash the template; if the family has vehicles, run
              // the picker first so the new draft is properly pinned.
              // Otherwise jump straight to creating a no-vehicle draft.
              setPendingTemplateId(tpl.id);
              if (vehicles.length === 0) await startDraftWithVehicle(null);
              else setShowPicker(true);
            }}
          />
        )}
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
      <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">
        🚗
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
