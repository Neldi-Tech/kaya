'use client';

// /pantry/purchase/[id] — Status-aware request detail.
//
// One page, six states:
//   draft            — editable basket, "Send for approval" CTA
//   pending_approval — read-only basket. Parent sees Approve / Reject;
//                       helper sees a waiting banner.
//   approved         — read-only basket. Helper sees "Start reconcile";
//                       parent sees "Approved, helper is on it."
//   reconciling      — basket with per-line actual qty + actual price;
//                       helper sees "Close & post to budget."
//   closed           — read-only summary with variance chips.
//   rejected         — read-only with rejection note.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  type PurchaseRequest, type PurchaseRequestItem, type PurchaseModule,
  subscribeToRequest, updateRequestItems, updateRequestMeta,
  sendForApproval, approveRequest, rejectRequest,
  startReconcile, closeReconcile, deleteRequest,
  sumEstimated, sumActual, variancePct, STATUS_LABEL,
} from '@/lib/purchase';
import { addStaple, type Staple, STAPLE_CATEGORIES } from '@/lib/pantry';
import { subscribeToMeters, meterEmoji, meterLabel, type UtilityMeter } from '@/lib/utilityMeters';
import { subscribeToVehicles, vehicleEmoji, vehicleTypeLabel, type Vehicle } from '@/lib/vehicles';
import { formatCents } from '@/components/pantry/format';

// Per-staple icon for picker + basket rows. Pantry staples surface
// their category emoji (🥬 🥛 🍚 🧴 ✨); Outdoor + Drivers staples
// inherit the module emoji (🌿 / 🚗) — their categories aren't stored
// on the staple yet.
function stapleEmoji(s: { category?: string; module?: PurchaseModule }): string {
  if (s.module === 'outdoor') return '🌿';
  if (s.module === 'drivers') return '🚗';
  if (s.module === 'utility') return '⚡';
  if (s.module === 'payroll') return '🤝';
  const c = STAPLE_CATEGORIES.find((x) => x.id === s.category);
  return c?.emoji ?? '🧺';
}

export default function PurchaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = (params?.id as string) || '';
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const { staples } = usePantry();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';
  // Per-category approval policy: try the explicit `pantry` entry first
  // (set in Settings → Household policies), fall back to the legacy
  // family-wide `approvalMode`, then to 'either'. Keeps existing
  // families on whatever they had set before per-category landed.
  const approvalMode: 'either' | 'both' =
    family?.approvalModes?.pantry
    ?? family?.approvalMode
    ?? 'either';

  const [req, setReq] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [quickAdd, setQuickAdd] = useState<{ name: string; qty: string; cents: string } | null>(null);
  const [rejectNote, setRejectNote] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.familyId || !requestId) { setLoading(false); return; }
    const t = setTimeout(() => setLoading(false), 1500);
    const unsub = subscribeToRequest(profile.familyId, requestId, (r) => {
      setReq(r);
      setLoading(false);
    });
    return () => { clearTimeout(t); unsub(); };
  }, [profile?.familyId, requestId]);

  if (loading) {
    return <div className="mx-auto max-w-md w-full px-4 pt-16 text-center text-hive-muted text-sm">Loading…</div>;
  }
  if (!req) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-hive-muted text-sm">Request not found.</p>
        <Link href="/pantry/purchase" className="text-pantry-leaf-dk font-bold text-sm underline">Back to Purchase</Link>
      </div>
    );
  }

  const isDraft = req.status === 'draft';
  const isPending = req.status === 'pending_approval';
  const isApproved = req.status === 'approved';
  const isReconciling = req.status === 'reconciling';
  const isClosed = req.status === 'closed';
  const isRejected = req.status === 'rejected';
  // Creator (anyone who built this request) may DELETE their own
  // draft or pending request — distinct from parent REJECT during
  // approval review. See deleteRequest in lib/purchase.ts.
  const isCreator = !!profile?.uid && req.createdBy === profile.uid;
  // Items editable in two cases:
  //   • draft — author building it (qty + price)
  //   • pending_approval AND parent reviewer — last-minute corrections
  //     (e.g. helper typed wrong price; parent fixes before approving)
  const editable = isDraft || (isPending && role === 'parent');
  const reconcilable = isReconciling;

  // ── Item mutations ───────────────────────────────────────────

  const patchItems = async (next: PurchaseRequestItem[]) => {
    if (!profile?.familyId) return;
    setBusy(true);
    try {
      await updateRequestItems(profile.familyId, req.id, next, reconcilable ? 'actual' : 'estimated');
    } finally { setBusy(false); }
  };

  const addStapleToBasket = async (s: Staple) => {
    if (req.items.some((i) => i.stapleId === s.id)) return; // already in basket
    const next: PurchaseRequestItem[] = [
      ...req.items,
      {
        id: cryptoRandomId(),
        stapleId: s.id,
        name: s.name,
        category: s.category,
        qty: s.defaultQty || 1,
        unit: s.unit,
        estimatedCents: s.lastBoughtCents,
      },
    ];
    await patchItems(next);
  };

  const setItemQty = (id: string, qty: number) => {
    const next = req.items.map((i) => i.id === id ? { ...i, qty: Math.max(1, qty) } : i);
    patchItems(next);
  };
  // 2026-05-18 — let the helper edit estimated price during draft,
  // and parents edit both qty + price during approval review.
  const setItemPrice = (id: string, cents: number | undefined) => {
    const next = req.items.map((i) =>
      i.id === id ? { ...i, estimatedCents: cents == null || isNaN(cents) ? undefined : Math.max(0, Math.round(cents)) } : i
    );
    patchItems(next);
  };
  const setItemActual = (id: string, patch: Partial<Pick<PurchaseRequestItem, 'actualQty' | 'actualCents'>>) => {
    const next = req.items.map((i) => i.id === id ? { ...i, ...patch } : i);
    patchItems(next);
  };
  const removeItem = (id: string) => {
    patchItems(req.items.filter((i) => i.id !== id));
  };

  const commitQuickAdd = async () => {
    if (!quickAdd || !profile?.familyId) return;
    const name = quickAdd.name.trim();
    if (!name) { setQuickAdd(null); return; }
    const qty = Math.max(1, parseInt(quickAdd.qty || '1', 10));
    const cents = quickAdd.cents ? Math.round(parseFloat(quickAdd.cents) * 100) : undefined;
    setBusy(true);
    try {
      // Create a pending_promote Staple so this item exists in the
      // catalogue for next time — but greyed until a parent promotes it.
      const stapleId = await addStaple(profile.familyId, {
        name,
        category: 'other',
        defaultQty: qty,
        unit: 'x',
        cadence: 'as-needed',
        lastBoughtCents: cents,
        active: true,
        status: 'pending_promote',
        // Tag the new catalogue item so it appears in the right picker
        // next time. Quick-add inside an Outdoor request creates an
        // Outdoor staple; same for Pantry.
        module: req.module ?? 'pantry',
      } as any);
      const next: PurchaseRequestItem[] = [
        ...req.items,
        {
          id: cryptoRandomId(),
          stapleId,
          name,
          qty,
          unit: 'x',
          estimatedCents: cents,
          pendingPromote: true,
        },
      ];
      await patchItems(next);
      setQuickAdd(null);
    } finally { setBusy(false); }
  };

  // ── State transitions ────────────────────────────────────────

  const send = async () => {
    if (!profile?.familyId || req.items.length === 0) return;
    setBusy(true);
    try { await sendForApproval(profile.familyId, req.id); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!profile?.familyId || !profile.uid) return;
    setBusy(true);
    try { await approveRequest(profile.familyId, req.id, profile.uid, approvalMode); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!profile?.familyId || !profile.uid) return;
    setBusy(true);
    try {
      await rejectRequest(profile.familyId, req.id, profile.uid, rejectNote ?? '');
      setRejectNote(null);
    } finally { setBusy(false); }
  };
  const startRec = async () => {
    if (!profile?.familyId) return;
    setBusy(true);
    // Seed actualQty + actualCents from estimates so the helper can
    // just confirm the lines that matched.
    const seeded = req.items.map((i) => ({
      ...i,
      actualQty: i.actualQty ?? i.qty,
      actualCents: i.actualCents ?? i.estimatedCents,
    }));
    try {
      await updateRequestItems(profile.familyId, req.id, seeded, 'actual');
      await startReconcile(profile.familyId, req.id);
    } finally { setBusy(false); }
  };
  const close = async () => {
    if (!profile?.familyId) return;
    setBusy(true);
    try { await closeReconcile(profile.familyId, req.id, req.items); router.push('/pantry/purchase'); }
    finally { setBusy(false); }
  };
  // Hard-delete the creator's own request (draft or pending-approval).
  // Distinct from reject — see comment in lib/purchase.ts. Confirms
  // first because the doc goes away for good.
  const deleteOwn = async () => {
    if (!profile?.familyId) return;
    const noun = req.status === 'draft' ? 'draft' : 'request';
    if (!confirm(`Delete this ${noun}? This can't be undone.`)) return;
    setBusy(true);
    try { await deleteRequest(profile.familyId, req.id); router.push(`/pantry/${req.module === 'pantry' ? 'purchase' : req.module}`); }
    finally { setBusy(false); }
  };

  // Staples available to pick — exclude ones already in basket.
  // Inlined (not useMemo) because this code path runs AFTER the
  // `if (loading)` / `if (!req)` early returns above — a hook here
  // would violate Rules of Hooks (different hook count between the
  // loading and loaded renders → "Rendered more hooks than during
  // the previous render" → client-side exception). Fixes the
  // crash users saw on `/pantry/purchase/[id]`.
  const inBasket = new Set(req.items.map((i) => i.stapleId).filter(Boolean) as string[]);
  // Module-scoped picker: Pantry requests see only pantry staples,
  // Outdoor requests see only outdoor staples. Missing `module` on
  // legacy staples defaults to 'pantry'.
  const reqModule = req.module ?? 'pantry';
  const pickable = staples.filter((s) =>
    !inBasket.has(s.id)
    && s.status !== 'pending_promote'
    && (s.module ?? 'pantry') === reqModule,
  );
  const q = pickerQuery.trim().toLowerCase();
  const filteredPickable = q
    ? pickable.filter((s) => s.name.toLowerCase().includes(q))
    : pickable;

  const total = reconcilable || isClosed
    ? sumActual(req.items)
    : sumEstimated(req.items);
  const vPct = isClosed ? variancePct(req) : 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Link href="/pantry/purchase" className="text-hive-muted text-sm no-underline">‹ Purchase</Link>
        <StatusChip status={req.status} />
      </div>
      <div className="mb-4">
        {editable ? (
          <input
            value={req.name}
            onChange={(e) => updateRequestMeta(profile!.familyId!, req.id, { name: e.target.value })}
            className="bg-transparent font-nunito font-black text-2xl tracking-tight w-full focus:outline-none"
          />
        ) : (
          <h1 className="font-nunito font-black text-2xl tracking-tight">{req.name}</h1>
        )}
        <p className="text-hive-muted text-xs mt-1 font-bold">
          {req.items.length} {req.items.length === 1 ? 'item' : 'items'} · {STATUS_LABEL[req.status]}
        </p>
      </div>

      {/* Banners per status */}
      {isPending && role === 'helper' && (
        <Banner
          tone="amber"
          title={
            approvalMode === 'both' && (req.approvedBy?.length ?? 0) === 1
              ? '1 of 2 parents approved'
              : approvalMode === 'both'
                ? 'Awaiting both parents'
                : 'Awaiting parent approval'
          }
          body={
            approvalMode === 'both'
              ? "This family requires both parents to approve. You'll be pinged the moment the second one signs off."
              : "You'll get a ping the moment a parent approves or rejects."
          }
        />
      )}
      {isPending && role === 'parent' && approvalMode === 'both' && (
        <Banner
          tone="amber"
          title={`${req.approvedBy?.length ?? 0} of 2 parents approved`}
          body={
            (req.approvedBy?.length ?? 0) >= 1 && req.approvedBy?.includes(profile?.uid || '')
              ? 'You already approved. Waiting for the other parent to sign off before the helper can shop.'
              : 'Your family requires both parents to approve before the helper can shop.'
          }
        />
      )}
      {isApproved && role === 'parent' && (
        <Banner tone="leaf" title="Approved · helper can shop now"
          body="The helper will reconcile after the shop. You'll see actuals here." />
      )}
      {isRejected && (
        <Banner tone="rose" title="Rejected"
          body={req.rejectionNote || 'No reason given.'} />
      )}

      {/* Utility meter context — shown only when the request is
          pinned to a meter via /pantry/utility's picker. Banner sits
          above the basket so the helper sees what they're paying
          for without scrolling. */}
      {req.module === 'utility' && req.meterId && (
        <UtilityMeterBanner familyId={profile!.familyId!} meterId={req.meterId} />
      )}
      {/* Drivers requests pin to a vehicle (2026-05-18). Same idea
          as the meter banner — surface what the request is FOR so
          everyone (driver, parent reviewing, future Finances reader)
          knows which car the spend attributes to. */}
      {req.module === 'drivers' && req.vehicleId && (
        <VehicleBanner familyId={profile!.familyId!} vehicleId={req.vehicleId} />
      )}

      {/* Module budget banner — kept lightweight (single Family read).
          Shows the cap + this request's estimated impact so the helper
          can scale their basket without leaving the page. Skipped if
          no cap is set or the request is already closed/rejected. */}
      {(() => {
        const cap = family?.householdBudgets?.[reqModule] ?? 0;
        if (cap === 0 || isClosed || isRejected) return null;
        const est = sumEstimated(req.items);
        const pct = Math.min(100, Math.round((est / cap) * 100));
        const over = est > cap;
        return (
          <div className={`rounded-hive border p-3 mb-3 ${
            over ? 'bg-[#FCEAEA] border-[#E8B5B5]' : 'bg-pantry-leaf-soft border-pantry-leaf'
          }`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
                {reqModule === 'pantry' ? '🛒 Pantry' : reqModule === 'outdoor' ? '🌿 Outdoor' : '🚗 Drivers'} cap
              </p>
              <p className="text-[11px] font-nunito font-extrabold text-hive-navy">
                {formatCents(est, currency)}
                <span className="text-hive-muted font-bold"> of {formatCents(cap, currency)}</span>
              </p>
            </div>
            <div className="mt-2 h-1.5 bg-white/70 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${over ? 'bg-hive-rose' : 'bg-pantry-leaf-dk'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })()}

      {/* Parent · pending hint — let the parent know they can correct
          qty or price right here before approving. Updated 2026-05-18
          (verification pass v2) — items are now click-to-expand to
          keep the list short; copy matches the new interaction. */}
      {isPending && role === 'parent' && (
        <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-2.5 mb-3 text-[11px] text-hive-ink leading-relaxed">
          <span className="font-nunito font-extrabold text-hive-honey-dk">✏️ Fix before you approve.</span>
          {' '}Tap any item to edit its qty or price — the helper sees the corrected numbers.
        </div>
      )}

      {/* Item list */}
      <div className="flex flex-col gap-2">
        {req.items.length === 0 && (
          <div className="text-center text-hive-muted text-sm py-6 border border-dashed border-hive-line rounded-hive">
            Basket is empty.
          </div>
        )}
        {req.items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            module={reqModule}
            currency={currency}
            editable={editable}
            reconcilable={reconcilable}
            onQty={(q) => setItemQty(it.id, q)}
            onPrice={(cents) => setItemPrice(it.id, cents)}
            onActual={(p) => setItemActual(it.id, p)}
            onRemove={() => removeItem(it.id)}
            varianceOnClose={isClosed}
          />
        ))}
      </div>

      {/* Add-from-Pantry + Quick-add — drafts only. Editable is now
          broader (also lets parents fix qty/price on pending), but
          adding NEW items to a pending request would change its
          shape mid-approval — that's a redraft. */}
      {isDraft && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => { setShowPicker((v) => !v); setPickerQuery(''); }}
            className="w-full bg-hive-paper border border-hive-line rounded-hive py-2.5 font-nunito font-bold text-sm text-pantry-leaf-dk"
          >
            {showPicker ? '× Close picker' : `＋ Add from Pantry${pickable.length > 0 ? ` (${pickable.length})` : ''}`}
          </button>
          {showPicker && (
            <div className="mt-2 bg-hive-paper border border-hive-line rounded-hive p-2">
              {/* Search — sticky at the top of the scrollable list. Filters
                  the staples below by name (case-insensitive). Cheap
                  client-side filter; staples are already in memory. */}
              <div className="sticky top-0 bg-hive-paper z-10 pb-2 pt-1 px-1">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hive-muted text-sm pointer-events-none">🔍</span>
                  <input
                    autoFocus
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder={`Search ${pickable.length} staple${pickable.length === 1 ? '' : 's'}…`}
                    className="w-full bg-hive-cream border border-hive-line rounded-lg pl-9 pr-9 py-2 text-sm font-nunito font-bold placeholder:text-hive-muted placeholder:font-normal focus:outline-none focus:border-pantry-leaf"
                  />
                  {pickerQuery && (
                    <button
                      type="button"
                      onClick={() => setPickerQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-hive-line text-hive-muted text-xs font-black"
                      aria-label="Clear search"
                    >×</button>
                  )}
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto">
                {pickable.length === 0 ? (
                  <p className="text-hive-muted text-xs text-center py-6">No more staples to add. Quick-add a new one below.</p>
                ) : filteredPickable.length === 0 ? (
                  <p className="text-hive-muted text-xs text-center py-6">
                    No staples match "<span className="font-bold">{pickerQuery}</span>". Quick-add a new one below.
                  </p>
                ) : (
                  filteredPickable.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addStapleToBasket(s)}
                      className="w-full flex items-center gap-3 py-2 px-2 hover:bg-hive-cream rounded-lg text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-pantry-leaf-soft flex items-center justify-center text-base">{stapleEmoji(s)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-nunito font-extrabold text-sm truncate">{s.name}</div>
                        <div className="text-[11px] text-hive-muted">
                          {s.defaultQty} {s.unit}
                          {s.lastBoughtCents != null && ` · ${formatCents(s.lastBoughtCents, currency)} ea`}
                        </div>
                      </div>
                      <span className="text-pantry-leaf-dk font-nunito font-black">＋</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Quick-add */}
          {quickAdd === null ? (
            <button
              type="button"
              onClick={() => setQuickAdd({ name: '', qty: '1', cents: '' })}
              className="w-full mt-2 bg-hive-paper border border-dashed border-hive-line rounded-hive py-2.5 font-nunito font-bold text-sm text-pantry-leaf-dk"
            >
              ＋ Quick-add a new item
            </button>
          ) : (
            <div className="mt-2 bg-hive-paper border border-hive-line rounded-hive p-3">
              <p className="text-[11px] font-bold text-hive-muted uppercase tracking-[1.5px] mb-2">
                Greyed until a parent promotes it
              </p>
              <input
                autoFocus
                value={quickAdd.name}
                onChange={(e) => setQuickAdd({ ...quickAdd, name: e.target.value })}
                placeholder="Item name (e.g. Fresh tilapia)"
                className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mb-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number" min={1} value={quickAdd.qty}
                  onChange={(e) => setQuickAdd({ ...quickAdd, qty: e.target.value })}
                  placeholder="Qty"
                  className="border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold"
                />
                <input
                  type="number" step="0.01" min={0} value={quickAdd.cents}
                  onChange={(e) => setQuickAdd({ ...quickAdd, cents: e.target.value })}
                  placeholder="Est. price"
                  className="border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button onClick={() => setQuickAdd(null)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
                <button onClick={commitQuickAdd} disabled={busy} className="bg-pantry-leaf text-white rounded-lg py-2 font-nunito font-black text-sm">Add</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Total card */}
      {req.items.length > 0 && (
        <div className={`mt-4 rounded-hive p-4 flex items-center justify-between ${
          isClosed ? 'bg-pantry-leaf-soft border border-pantry-leaf' : 'bg-pantry-leaf-soft border border-pantry-leaf'
        }`}>
          <div>
            <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
              {reconcilable || isClosed ? 'Actual total' : 'Estimated total'}
            </div>
            {isClosed && req.estimatedTotalCents > 0 && (
              <div className="text-[11px] text-hive-muted font-bold mt-1">
                est. {formatCents(req.estimatedTotalCents, currency)}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="font-nunito font-black text-2xl text-hive-ink">{formatCents(total, currency)}</div>
            {isClosed && (
              <span className={`inline-block text-[10px] font-extrabold px-1.5 py-0.5 rounded mt-1 ${
                vPct > 0 ? 'bg-[#FCEAEA] text-hive-rose' : 'bg-[#E6F7EE] text-hive-green'
              }`}>
                {vPct > 0 ? '+' : ''}{Math.round(vPct * 100)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Action buttons per status */}
      <div className="mt-4 flex flex-col gap-2">
        {isDraft && (
          <>
            <button
              type="button"
              onClick={send}
              disabled={busy || req.items.length === 0 || isGuest}
              className="bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
            >
              Send for approval →
            </button>
            {isCreator && (
              <button
                type="button"
                onClick={deleteOwn}
                disabled={busy}
                className="text-hive-rose font-nunito font-bold text-xs py-2"
              >
                Delete draft
              </button>
            )}
          </>
        )}
        {isPending && role === 'parent' && rejectNote === null && (
          <>
            {req.approvedBy?.includes(profile?.uid || '') ? (
              <button
                disabled
                className="bg-pantry-leaf-soft text-pantry-leaf-dk border border-pantry-leaf-soft rounded-hive py-3.5 font-nunito font-black text-sm cursor-default"
              >
                ✓ You approved · waiting for second parent
              </button>
            ) : (
              <button
                onClick={approve}
                disabled={busy}
                className="bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm"
              >
                {approvalMode === 'both' && (req.approvedBy?.length ?? 0) === 1
                  ? 'Add my approval (finalises)'
                  : approvalMode === 'both'
                    ? 'Approve · 1 of 2'
                    : 'Approve ✓'}
              </button>
            )}
            {/* Reject is the parent-only action during approval review.
                Creators get a separate "Delete request" button below
                (renders even when the parent is the creator — they can
                still self-delete what they wrongly created). */}
            <button onClick={() => setRejectNote('')} disabled={busy} className="text-hive-rose font-nunito font-bold text-xs py-2">Reject with note</button>
          </>
        )}
        {/* Creator-self-delete for a pending request — the helper
            (or parent) realised they sent the wrong thing and wants
            to take it back before anyone acts on it. Independent
            from parent Reject (which is for declining someone else's
            request and keeps an audit trail + rejection note). */}
        {isPending && isCreator && rejectNote === null && (
          <button
            type="button"
            onClick={deleteOwn}
            disabled={busy}
            className="text-hive-rose font-nunito font-bold text-xs py-2"
          >
            Delete request (took it back)
          </button>
        )}
        {isPending && role === 'parent' && rejectNote !== null && (
          <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
            <textarea
              autoFocus
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Why are you rejecting? (helps the helper try again)"
              className="w-full border border-hive-line rounded-lg p-2 text-sm font-nunito font-bold mb-2"
              rows={3}
            />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setRejectNote(null)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
              <button onClick={reject} disabled={busy} className="bg-hive-rose text-white rounded-lg py-2 font-nunito font-black text-sm">Reject</button>
            </div>
          </div>
        )}
        {isApproved && role === 'helper' && (
          <button onClick={startRec} disabled={busy} className="bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30">
            Start reconcile →
          </button>
        )}
        {isApproved && role === 'parent' && (
          <button onClick={startRec} disabled={busy} className="bg-hive-paper border border-pantry-leaf-soft text-pantry-leaf-dk rounded-hive py-3.5 font-nunito font-black text-sm">
            Start reconcile (on helper's behalf)
          </button>
        )}
        {isReconciling && (
          <button onClick={close} disabled={busy} className="bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30">
            Close · post to budget →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Bits ──────────────────────────────────────────────────────

function StatusChip({ status }: { status: PurchaseRequest['status'] }) {
  const cls =
    status === 'draft' ? 'bg-hive-cream text-hive-muted border-hive-line'
    : status === 'pending_approval' ? 'bg-[#FFF3D9] text-hive-honey-dk border-hive-honey'
    : status === 'approved' || status === 'reconciling' ? 'bg-pantry-leaf-soft text-pantry-leaf-dk border-pantry-leaf'
    : status === 'closed' ? 'bg-pantry-leaf-soft text-pantry-leaf-dk border-pantry-leaf'
    : 'bg-[#FCEAEA] text-hive-rose border-[#E8B5B5]';
  return (
    <span className={`text-[10px] font-extrabold uppercase tracking-[1.5px] px-2.5 py-1 rounded-full border ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Banner({ tone, title, body }: { tone: 'amber' | 'leaf' | 'rose'; title: string; body: string }) {
  const cls =
    tone === 'amber' ? 'bg-[#FFF3D9] border-hive-honey'
    : tone === 'leaf' ? 'bg-pantry-leaf-soft border-pantry-leaf'
    : 'bg-[#FCEAEA] border-[#E8B5B5]';
  return (
    <div className={`rounded-hive border p-3 mb-3 ${cls}`}>
      <div className="font-nunito font-black text-sm text-hive-ink">{title}</div>
      <div className="text-xs text-hive-ink/80 mt-1">{body}</div>
    </div>
  );
}

function ItemRow({
  item, module: itemModule, currency, editable, reconcilable, onQty, onPrice, onActual, onRemove, varianceOnClose,
}: {
  item: PurchaseRequestItem;
  module: PurchaseModule;
  currency: string;
  editable: boolean;
  reconcilable: boolean;
  onQty: (q: number) => void;
  /** Set the per-unit estimated price (cents). Available during draft
   *  (helper sets the initial estimate) and pending_approval (parent
   *  may correct it before approving). 2026-05-18. */
  onPrice: (cents: number | undefined) => void;
  onActual: (p: Partial<Pick<PurchaseRequestItem, 'actualQty' | 'actualCents'>>) => void;
  onRemove: () => void;
  varianceOnClose: boolean;
}) {
  // 2026-05-18 (verification pass v2) — collapse-by-default. Default
  // is a single tidy line; tap to expand the qty + price inputs +
  // remove. Always-on inputs made the basket noisy + tall — most
  // items are correct as-typed; the parent only needs to fix a few.
  const [open, setOpen] = useState(false);
  const est = (item.estimatedCents ?? 0) * item.qty;
  const act = (item.actualCents ?? 0) * (item.actualQty ?? 0);
  const vDelta = est > 0 ? Math.round(((act - est) / est) * 100) : 0;
  const pending = !!item.pendingPromote;
  const emoji = stapleEmoji({ category: item.category, module: itemModule });
  const totalNow = reconcilable || (varianceOnClose && item.actualCents != null) ? act : est;
  const canExpandEdit = editable && !reconcilable;
  return (
    <div className={`bg-hive-paper border ${open && canExpandEdit ? 'border-pantry-leaf' : 'border-hive-line'} rounded-hive ${pending ? 'opacity-70 bg-[repeating-linear-gradient(135deg,white,white_6px,#FFF8EC_6px,#FFF8EC_12px)]' : ''}`}>
      {/* Always-visible single-line summary. The whole row is clickable
          when editable (cursor + hover hint). Right side shows the
          total + a small ✏️ hint when editable so users know they
          can tap to fix. */}
      <button
        type="button"
        onClick={canExpandEdit ? () => setOpen((v) => !v) : undefined}
        disabled={!canExpandEdit}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 p-3 text-left ${canExpandEdit ? 'hover:bg-hive-cream/40 cursor-pointer' : 'cursor-default'}`}
      >
        <div className="w-10 h-10 rounded-lg bg-pantry-leaf-soft flex items-center justify-center text-lg flex-shrink-0">{emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate flex items-center gap-1.5">
            <span className="truncate">{item.name}</span>
            {pending && (
              <span className="text-[9px] bg-[#FFF3D9] border border-hive-honey text-hive-honey-dk px-1.5 py-0.5 rounded font-extrabold uppercase tracking-[1px]">
                Pending
              </span>
            )}
          </div>
          <div className="text-[11px] text-hive-muted font-bold truncate">
            {item.qty} {item.unit}
            {item.estimatedCents != null && ` · ${formatCents(item.estimatedCents, currency)} ea`}
          </div>
        </div>
        <div className="text-right flex-shrink-0 flex items-center gap-2">
          <div>
            <div className="font-nunito font-black text-sm text-hive-navy">
              {formatCents(totalNow, currency)}
            </div>
            {varianceOnClose && item.actualCents != null && (
              <span className={`text-[10px] font-extrabold px-1 py-0.5 rounded ${vDelta > 0 ? 'bg-[#FCEAEA] text-hive-rose' : 'bg-[#E6F7EE] text-hive-green'}`}>
                {vDelta > 0 ? '+' : ''}{vDelta}%
              </span>
            )}
          </div>
          {canExpandEdit && (
            <span className="text-hive-muted text-xs font-bold w-4 text-center" aria-hidden>
              {open ? '▴' : '▾'}
            </span>
          )}
        </div>
      </button>

      {/* Edit mode (collapsed by default): qty + estimated price.
          Same 2-col grid as the reconcile section so the visual
          rhythm is consistent. Remove (×) moves into the expanded
          section so the collapsed row stays clean. */}
      {open && canExpandEdit && (
        <div className="border-t border-hive-line/60 p-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">Qty ({item.unit})</span>
            <input
              type="number" min={1}
              value={item.qty}
              onChange={(e) => onQty(e.target.value === '' ? 1 : parseInt(e.target.value, 10))}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">Est. price ea</span>
            <input
              type="number" step="0.01" min={0}
              value={item.estimatedCents != null ? (item.estimatedCents / 100).toString() : ''}
              onChange={(e) => onPrice(e.target.value === '' ? undefined : Math.round(parseFloat(e.target.value) * 100))}
              placeholder="0.00"
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
            />
          </label>
          <div className="col-span-2 flex items-center justify-between mt-1">
            <button
              type="button"
              onClick={onRemove}
              className="text-hive-rose font-nunito font-bold text-xs"
            >
              × Remove item
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-hive-muted font-nunito font-bold text-xs"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Reconcile mode: actual qty + actual price. Stays always-on
          here because every line typically needs touching during
          reconcile (helper is at the shop confirming numbers). */}
      {reconcilable && (
        <div className="border-t border-hive-line/60 p-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">Actual qty</span>
            <input
              type="number" min={0}
              value={item.actualQty ?? ''}
              onChange={(e) => onActual({ actualQty: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">Actual price ea</span>
            <input
              type="number" step="0.01" min={0}
              value={item.actualCents != null ? (item.actualCents / 100).toString() : ''}
              onChange={(e) => onActual({ actualCents: e.target.value === '' ? 0 : Math.round(parseFloat(e.target.value) * 100) })}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// Inline meter context for Utility requests. Subscribes to the
// single meter doc; renders a chip-style banner above the basket so
// the helper always sees which meter the request is for. Kept here
// (vs imported as a shared component) to avoid creating one-off
// shared modules.
function UtilityMeterBanner({ familyId, meterId }: { familyId: string; meterId: string }) {
  const [meter, setMeter] = useState<UtilityMeter | null>(null);
  useEffect(() => {
    // We don't have a single-doc subscribe helper for meters; cheap
    // enough to subscribe the whole list (typical < 10 meters) and
    // pluck. If a family scales to dozens of meters we'd add a
    // dedicated subscribeToMeter(id) helper.
    return subscribeToMeters(familyId, (list) => {
      setMeter(list.find((m) => m.id === meterId) ?? null);
    });
  }, [familyId, meterId]);
  if (!meter) return null;
  return (
    <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-3 mb-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center text-lg flex-shrink-0">
        {meterEmoji(meter.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-honey-dk">For meter</p>
        <p className="font-nunito font-extrabold text-sm text-hive-ink truncate">{meter.label}</p>
        <p className="text-[11px] text-hive-muted font-bold mt-0.5">
          {meter.providerRef ? `# ${meter.providerRef}` : meterLabel(meter.type)}
          {meter.cadenceDays != null && ` · ~${meter.cadenceDays}d cycle`}
        </p>
      </div>
    </div>
  );
}

// Drivers vehicle banner — mirror of UtilityMeterBanner, surfaces
// which vehicle a Drivers request is pinned to. New 2026-05-18.
function VehicleBanner({ familyId, vehicleId }: { familyId: string; vehicleId: string }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  useEffect(() => {
    return subscribeToVehicles(familyId, (list) => {
      setVehicle(list.find((v) => v.id === vehicleId) ?? null);
    });
  }, [familyId, vehicleId]);
  if (!vehicle) return null;
  const sub = [vehicle.makeModel, vehicle.plate, vehicle.color].filter(Boolean).join(' · ');
  return (
    <div className="bg-pantry-leaf-soft border border-pantry-leaf rounded-hive p-3 mb-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center text-lg flex-shrink-0">
        {vehicleEmoji(vehicle.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">For vehicle</p>
        <p className="font-nunito font-extrabold text-sm text-hive-ink truncate">{vehicle.label}</p>
        <p className="text-[11px] text-hive-muted font-bold mt-0.5">
          {sub || vehicleTypeLabel(vehicle.type)}
        </p>
      </div>
    </div>
  );
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  return Math.random().toString(36).slice(2, 10);
}
