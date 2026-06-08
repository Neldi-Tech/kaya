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
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  type PurchaseRequest, type PurchaseRequestItem, type PurchaseModule,
  subscribeToRequest, updateRequestItems, updateRequestMeta,
  sendForApproval, postDraftToBudget, approveRequest, rejectRequest,
  startReconcile, deleteRequest, reopenRequest, createDraftFromRequest,
  promotePendingStaple, keepAsOneOff,
  renamePendingItem, findStapleConflict, linkPendingToExisting,
  sumEstimated, sumActual, variancePct, STATUS_LABEL,
  formatRequestSeq, MODULE_EMOJI, MODULE_LABEL,
  recordSavingsDecision, recommendedSavingsDecision,
  submitForCloseReview, approveCloseAndPost, kickBackToReconcile,
  readPurchaseConfig, bandPctFor, priceBandRange, priceWithinBand,
  resolvePriceException, hasUnresolvedPriceException,
  setRequestBudgetMonth, budgetMonthKeyFor,
} from '@/lib/purchase';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';
import { useLocale } from '@/lib/useLocale';
import { downloadImage, suggestedPhotoFilename } from '@/lib/downloadImage';
import {
  addStaple, type Staple, type Cadence, STAPLE_CATEGORIES,
  displayStapleName, secondaryStapleName, stapleMatchesQuery,
  type ViewerRole,
} from '@/lib/pantry';
import {
  DIRECTORY_STAPLES, DIRECTORY_OUTDOOR, DIRECTORY_DRIVERS, DIRECTORY_UTILITIES,
} from '@/lib/pantryDirectory';
import { subscribeToMeters, meterEmoji, meterLabel, type UtilityMeter } from '@/lib/utilityMeters';
import { subscribeToVehicles, vehicleEmoji, vehicleTypeLabel, type Vehicle } from '@/lib/vehicles';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { currencyAllowsDecimals } from '@/lib/hive';
import NumberInput from '@/components/hive/NumberInput';
import {
  notifyPurchaseApprovalRequested, notifyPurchaseApproved,
  notifyPurchaseRejected, notifyPurchaseReconciled,
} from '@/lib/notify';
import { getFamilyMembers } from '@/lib/firestore';
import { ReconcileTimerBanner } from '@/components/pantry/ReconcileTimer';
import { uploadReceipt, clearReceipt } from '@/lib/receiptUpload';
import ReceiptScanModal from '@/components/pantry/ReceiptScanModal';
import type { ScanResult } from '@/lib/receiptScan';
import BudgetBalanceMeter from '@/components/pantry/BudgetBalanceMeter';
import PaidByPicker, { type PaidByValue } from '@/components/household/PaidByPicker';
import { toDisplayDate } from '@/lib/dates';

/** Module → its list-page route. dineOut's URL is /pantry/dine-out (not
 *  /pantry/dineOut), so back-nav can't just template the module id. */
function moduleListRoute(module?: PurchaseModule): string {
  if (!module || module === 'pantry') return '/pantry/purchase';
  if (module === 'dineOut') return '/pantry/dine-out';
  return `/pantry/${module}`;
}

/** For monthly-basis salary cycles, expand the stored period to the full
 *  calendar month containing the pay date — catches legacy narrow rows
 *  (e.g. "2026-05-01 → 2026-05-05") that pre-date the #289 fix. Weekly /
 *  biweekly / hourly / daily cycles keep their stored window. */
function displayPeriod(cycle: { basis: string; periodStart: string; periodEnd: string }): { start: string; end: string } {
  if (cycle.basis !== 'monthly') return { start: cycle.periodStart, end: cycle.periodEnd };
  const [y, m] = cycle.periodEnd.split('-').map(Number);
  if (!y || !m) return { start: cycle.periodStart, end: cycle.periodEnd };
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** Build the display title for a payroll request — pulls the helper's name
 *  from the stored `name` (everything before the date suffix) and prints the
 *  display period via toDisplayDate. Falls back to the raw `name` for
 *  non-payroll requests or when payrollCycle is missing. */
function displayRequestTitle(r: import('@/lib/purchase').PurchaseRequest): string {
  const name = r.name || 'Untitled request';
  if (r.module !== 'payroll' || !r.payrollCycle?.periodStart || !r.payrollCycle?.periodEnd) return name;
  const { start, end } = displayPeriod(r.payrollCycle);
  // Try to extract "Salary · {Name}" prefix from the stored name. If it
  // doesn't match the pattern (parent-renamed), keep the stored name and
  // append the cleaned period.
  const parts = name.split(' · ');
  if (parts.length >= 3 && parts[0] === 'Salary') {
    return `Salary · ${parts[1]} · ${toDisplayDate(start)} → ${toDisplayDate(end)}`;
  }
  // Parent-renamed — keep their text and append the date range underneath
  // (we strip any trailing ISO date range first to avoid stacking).
  const stripped = name.replace(/\s*·\s*\d{4}-\d{2}-\d{2}\s*→\s*\d{4}-\d{2}-\d{2}\s*$/, '');
  return `${stripped} · ${toDisplayDate(start)} → ${toDisplayDate(end)}`;
}

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
  const confirmAction = useConfirm();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';
  // Helper-facing Swahili (Phase 2, 2026-06-06). English is the fallback.
  const sw = useLocale() === 'sw';
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
  // Parent fast-path: post a draft straight to the budget. `null` =
  // collapsed; a number = the form is open with that amount (cents).
  const [directCents, setDirectCents] = useState<number | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState('');

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
        {/* No `req` → can't infer module. Fall back to the Pantry
            section landing so the parent can navigate from there. */}
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold text-sm underline">Back to Pantry</Link>
      </div>
    );
  }

  const isDraft = req.status === 'draft';
  const isPending = req.status === 'pending_approval';
  const isApproved = req.status === 'approved';
  const isReconciling = req.status === 'reconciling';
  const isPendingClose = req.status === 'pending_close';
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
  // 2026-05-19 — Helpers can ADD lines during reconcile too (picked up
  // something extra at the shop). Existing approved lines stay locked
  // for edit; only the add affordances open up. New lines get the
  // `addedDuringReconcile` flag so the audit trail makes ad-hoc
  // additions obvious.
  const canAddItems = editable || reconcilable;

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
        // Snapshot the local-name too so the basket renders bilingual
        // without needing to re-fetch the staple. 2026-05-18.
        ...(s.name2 ? { name2: s.name2 } : {}),
        category: s.category,
        qty: s.defaultQty || 1,
        unit: s.unit,
        // Prefer the parent's expected price; fall back to the last
        // actual. (Other Regulars v2, 2026-05-20)
        estimatedCents: s.defaultPriceCents || s.lastBoughtCents,
        // Tag rows added during reconcile so the audit trail flags
        // them as ad-hoc additions to the approved basket. (2026-05-19)
        ...(reconcilable ? { addedDuringReconcile: true } : {}),
      },
    ];
    await patchItems(next);
  };

  const setItemQty = (id: string, qty: number) => {
    // 2026-05-18 — preserve decimals (0.5 kg garlic, 1.5 L oil).
    // Floor is 0 so the input can be cleared mid-edit; the parent
    // can't send with 0 items per the existing send guard.
    const next = req.items.map((i) => i.id === id ? { ...i, qty: Math.max(0, qty) } : i);
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
  const setItemActual = (
    id: string,
    patch: Partial<Pick<PurchaseRequestItem,
      'actualQty' | 'actualCents' | 'priceException' | 'priceExceptionReason'>>,
  ) => {
    const next = req.items.map((i) => i.id === id ? { ...i, ...patch } : i);
    patchItems(next);
  };
  const removeItem = (id: string) => {
    patchItems(req.items.filter((i) => i.id !== id));
  };

  const onPickReceipt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setScanFile(f);
  };

  // Apply a scanned + reviewed receipt. During reconcile: match scanned
  // lines to existing items by name → fill actuals; unmatched → add as
  // ad-hoc lines. During draft/edit: append scanned lines as estimated.
  // patchItems writes the right total ('actual' vs 'estimated') by state.
  const applyScan = async (r: ScanResult) => {
    if (!profile?.familyId) return;
    const scanned = r.items;
    if (reconcilable) {
      if (scanned.length === 0) return;
      const used = new Set<number>();
      const matched = req.items.map((it) => {
        const mi = scanned.findIndex((s, idx) => !used.has(idx) && s.name.toLowerCase().trim() === it.name.toLowerCase().trim());
        if (mi < 0) return it;
        used.add(mi);
        const s = scanned[mi];
        return { ...it, actualQty: s.qty, actualCents: s.unitPriceCents };
      });
      const extras: PurchaseRequestItem[] = scanned
        .filter((_, idx) => !used.has(idx))
        .map((s) => ({ id: cryptoRandomId(), name: s.name, qty: s.qty, unit: 'x', actualQty: s.qty, actualCents: s.unitPriceCents, addedDuringReconcile: true }));
      await patchItems([...matched, ...extras]);
    } else {
      const additions: PurchaseRequestItem[] = scanned.length
        ? scanned.map((s) => ({ id: cryptoRandomId(), name: s.name, qty: s.qty, unit: 'x', estimatedCents: s.unitPriceCents }))
        : (r.totalCents > 0 ? [{ id: cryptoRandomId(), name: 'Receipt', qty: 1, unit: 'x', estimatedCents: r.totalCents }] : []);
      if (additions.length) await patchItems([...req.items, ...additions]);
    }
  };

  const commitQuickAdd = async () => {
    if (!quickAdd || !profile?.familyId) return;
    const name = quickAdd.name.trim();
    if (!name) { setQuickAdd(null); return; }
    const qty = Math.max(0.001, parseFloat(quickAdd.qty || '1'));
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
          ...(reconcilable ? { addedDuringReconcile: true } : {}),
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
    try {
      await sendForApproval(profile.familyId, req.id);
      // Notify parents that a request needs approval. Fire-and-forget —
      // a notify failure (rule mis-deploy, etc.) shouldn't block the
      // happy-path send.
      try {
        const members = await getFamilyMembers(profile.familyId);
        const parentUids = members
          .filter((m) => m.role === 'parent' && m.uid && m.uid !== profile.uid)
          .map((m) => m.uid);
        void notifyPurchaseApprovalRequested({
          familyId: profile.familyId,
          requestId: req.id,
          requesterName: profile.displayName?.split(' ')[0] || (role === 'helper' ? 'Helper' : 'Parent'),
          requestName: req.name || 'Untitled request',
          estimatedLabel: formatCents(sumEstimated(req.items), currency),
          module: req.module || 'pantry',
          parentUids,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[purchase] notifyApprovalRequested failed:', e);
      }
    } finally { setBusy(false); }
  };
  // Parent fast-path — skip approval + reconcile, post the confirmed
  // amount straight to the budget. Only ever wired up for parents.
  const postDirect = async () => {
    if (!profile?.familyId || !profile.uid || directCents == null) return;
    setBusy(true);
    try {
      await postDraftToBudget(profile.familyId, req.id, profile.uid, directCents);
      setDirectCents(null);
    } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!profile?.familyId || !profile.uid) return;
    setBusy(true);
    try {
      const result = await approveRequest(profile.familyId, req.id, profile.uid, approvalMode);
      // Fire the approval notification ONLY when this approval flipped
      // the status to 'approved'. In 'both' mode the first parent's tap
      // doesn't yet approve — no premature notify to the helper. The
      // creator (helper) is the recipient; if a parent created their
      // own request, no need to notify themselves.
      if (result.status === 'approved' && req.createdBy && req.createdBy !== profile.uid) {
        try {
          void notifyPurchaseApproved({
            familyId: profile.familyId,
            requestId: req.id,
            creatorUid: req.createdBy,
            approverName: profile.displayName?.split(' ')[0] || 'Parent',
            requestName: req.name || 'Untitled request',
            module: req.module || 'pantry',
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[purchase] notifyApproved failed:', e);
        }
      }
    } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!profile?.familyId || !profile.uid) return;
    setBusy(true);
    try {
      const note = rejectNote ?? '';
      await rejectRequest(profile.familyId, req.id, profile.uid, note);
      // Notify the creator (typically a helper) so they don't go
      // shopping on a request that's no longer approved. Fire-and-
      // forget; a notify failure shouldn't block the user-visible step.
      if (req.createdBy && req.createdBy !== profile.uid) {
        try {
          void notifyPurchaseRejected({
            familyId: profile.familyId,
            requestId: req.id,
            creatorUid: req.createdBy,
            rejecterName: profile.displayName?.split(' ')[0] || 'Parent',
            requestName: req.name || 'Untitled request',
            module: req.module || 'pantry',
            variant: 'normal',
            note: note || undefined,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[purchase] notifyRejected failed:', e);
        }
      }
      setRejectNote(null);
    } finally { setBusy(false); }
  };

  // 2026-05-19 — Force reject for accidentally-approved requests.
  // Two confirmation steps because once a parent says yes, the request
  // is locked in 'rejected' and the helper has to rebuild from scratch.
  // Distinct from the normal reject (which fires on pending_approval);
  // this one fires AFTER approval — the parent realised they hit the
  // wrong button. Gated to parents + status='approved' so it can't be
  // used to retroactively cancel a shop that's already in progress
  // (reconciling) or closed (budget posted).
  const forceReject = async () => {
    if (!profile?.familyId || !profile.uid) return;
    const okFirst = await confirmAction({
      title: 'Force reject this approved request?',
      message: "You approved this already. Force-rejecting will cancel it — the helper will need to rebuild from scratch or recycle a past request.",
      confirmLabel: 'Continue',
      tone: 'danger',
    });
    if (!okFirst) return;
    const okSecond = await confirmAction({
      title: 'Are you sure?',
      message: 'Last check: the request will be marked Rejected and can\'t be re-approved. The auto-saved template stays available so a new request can start from it.',
      confirmLabel: 'Yes · force reject',
      tone: 'danger',
    });
    if (!okSecond) return;
    setBusy(true);
    try {
      const note = 'Force-rejected after approval (parent correction).';
      await rejectRequest(profile.familyId, req.id, profile.uid, note);
      // Force-reject = the helper may already be acting on the
      // approval (cash in hand, on the way to the shop). The notify
      // copy is louder than a normal reject so they pull back.
      if (req.createdBy && req.createdBy !== profile.uid) {
        try {
          void notifyPurchaseRejected({
            familyId: profile.familyId,
            requestId: req.id,
            creatorUid: req.createdBy,
            rejecterName: profile.displayName?.split(' ')[0] || 'Parent',
            requestName: req.name || 'Untitled request',
            module: req.module || 'pantry',
            variant: 'force',
            note,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[purchase] notifyForceRejected failed:', e);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] forceReject failed:', e);
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
  // 2026-05-19 — Reconcile now hands off to a parent review step
  // BEFORE posting to budget. Helper presses "Submit for review →";
  // parent reviews + allocates overrun / decides savings / posts.
  // The notify call still fires (parents need to know the shop is
  // ready for review). State flips reconciling → pending_close.
  const submitClose = async () => {
    if (!profile?.familyId || !profile.uid) return;
    // Guardrail (2026-05-31): an over-band price must carry a reason
    // before the helper can hand off. The reconcile rows already flag
    // these; this is the belt-and-braces gate so a no-reason exception
    // can never reach the parent's review as a silent over-band line.
    const missingReason = req.items.find(
      (i) => i.priceException === 'pending' && !(i.priceExceptionReason ?? '').trim(),
    );
    if (missingReason) {
      window.alert(`"${missingReason.name}" is priced over the allowed limit. Add a short reason on that item before submitting.`);
      return;
    }
    setBusy(true);
    try {
      await submitForCloseReview(profile.familyId, req.id, req.items, {
        submittedBy: profile.uid,
        receiptUrl: req.receiptUrl,
      });
      // Notify parents that there's a shop waiting for budget review.
      try {
        const members = await getFamilyMembers(profile.familyId);
        const parentUids = members
          .filter((m) => m.role === 'parent' && m.uid && m.uid !== profile.uid)
          .map((m) => m.uid);
        void notifyPurchaseReconciled({
          familyId: profile.familyId,
          requestId: req.id,
          helperName: profile.displayName?.split(' ')[0] || (role === 'helper' ? 'Helper' : 'Parent'),
          requestName: req.name || 'Untitled request',
          actualLabel: formatCents(sumActual(req.items), currency),
          module: req.module || 'pantry',
          parentUids,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[purchase] notifyReconciled failed:', e);
      }
      router.push(moduleListRoute(req.module));
    } finally { setBusy(false); }
  };

  // 2026-05-19 — Receipt photo upload. Helper attaches a paper-trail
  // during reconcile so the parent has audit evidence on close. The
  // file is downscaled client-side to ~1600px before upload (receipts
  // have small text; lower resolution becomes illegible). One blob per
  // request; re-uploading replaces it and best-effort deletes the old.
  const handleReceiptUpload = async (file: File | null) => {
    if (!file || !profile?.familyId) return;
    setReceiptError('');
    setReceiptBusy(true);
    try {
      await uploadReceipt({
        familyId: profile.familyId,
        requestId: req.id,
        file,
        previousUrl: req.receiptUrl,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] uploadReceipt failed:', e);
      setReceiptError(e instanceof Error ? e.message : 'Could not upload that photo.');
    } finally {
      setReceiptBusy(false);
    }
  };
  const handleReceiptClear = async () => {
    if (!profile?.familyId || !req.receiptUrl) return;
    const ok = await confirmAction({
      title: 'Remove this receipt?',
      message: 'The photo will be removed from storage. You can upload a fresh one anytime before closing.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setReceiptBusy(true);
    try {
      await clearReceipt({ familyId: profile.familyId, requestId: req.id, previousUrl: req.receiptUrl });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] clearReceipt failed:', e);
    } finally {
      setReceiptBusy(false);
    }
  };

  // Hard-delete the creator's own request (draft or pending-approval).
  // Distinct from reject — see comment in lib/purchase.ts. Confirms
  // first because the doc goes away for good.
  const deleteOwn = async () => {
    if (!profile?.familyId) return;
    const noun = req.status === 'draft' ? 'draft' : 'request';
    const ok = await confirmAction({
      title: `Delete this ${noun}?`,
      message: "This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await deleteRequest(profile.familyId, req.id); router.push(moduleListRoute(req.module)); }
    finally { setBusy(false); }
  };

  // Parent reopens a closed request → back to reconciling so actuals
  // can be fixed (then resubmit) or the request deleted. Unwinds the
  // close: a linked bill drops back into Outstanding, and the budget
  // un-counts it. See reopenRequest in lib/purchase.ts. (Reopen v1.)
  const reopen = async () => {
    if (!profile?.familyId || !profile.uid) return;
    const ok = await confirmAction({
      title: 'Reopen this request?',
      message: req.module === 'utility'
        ? 'It goes back to Reconciling so you can fix the actuals or receipt, then resubmit. The linked bill returns to Outstanding and drops out of the budget until you reclose.'
        : 'It goes back to Reconciling so you can fix the actuals or receipt, then resubmit. It drops out of the budget until you reclose.',
      confirmLabel: 'Reopen',
      tone: 'default',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await reopenRequest(profile.familyId, req.id, profile.uid);
      if (res && !res.ok) {
        // Refused (e.g. the savings tip was already paid out). Explain
        // why rather than silently doing nothing.
        await confirmAction({
          title: "Can't reopen yet",
          message: res.reason,
          confirmLabel: 'OK',
          tone: 'default',
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] reopen failed:', e);
    } finally { setBusy(false); }
  };

  // Recycle a closed invoice → spin up a fresh draft pre-filled with
  // the same basket (seeded from last actuals, see
  // createDraftFromRequest), then jump straight into the new draft to
  // tweak + send for approval. Both parents + helpers can recycle since
  // both create requests. (Recycle v1, 2026-05-22)
  const recycle = async () => {
    if (!profile?.familyId || !profile.uid || busy) return;
    const ok = await confirmAction({
      title: 'Recycle this invoice?',
      message: 'Creates a new draft with the same items and the amounts you last bought. You can adjust it before sending for approval.',
      confirmLabel: 'Recycle',
      tone: 'default',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const newId = await createDraftFromRequest(profile.familyId, req.id, {
        createdBy: profile.uid,
        createdByRole: role,
      });
      router.push(`/pantry/purchase/${newId}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] recycle failed:', e);
      await confirmAction({
        title: "Couldn't recycle",
        message: 'Something went wrong creating the new draft. Please try again.',
        confirmLabel: 'OK',
        tone: 'default',
      });
    } finally { setBusy(false); }
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
  // Price-change guardrail band for this module (family default unless a
  // per-module override is set). 0 = guardrail off. (2026-05-31)
  const bandPct = bandPctFor(readPurchaseConfig(family), reqModule);
  // 2026-05-18 — viewer for bilingual display.
  const viewer: ViewerRole = role;
  const pickable = staples.filter((s) =>
    !inBasket.has(s.id)
    && s.status !== 'pending_promote'
    && (s.module ?? 'pantry') === reqModule,
  );
  const q = pickerQuery.trim().toLowerCase();
  const filteredPickable = q
    ? pickable.filter((s) => stapleMatchesQuery(s, q))
    : pickable;

  // 2026-05-19 — Catalogue fallback for the request picker. When the
  // helper / parent searches and the family's list has no match (or
  // few matches), we surface curated DIRECTORY items for the request's
  // module so they can tap-to-add without leaving the request. Hidden
  // until there's a query so the picker stays focused on the family's
  // list by default.
  type CuratedSuggestion = {
    key: string; label: string; emoji: string;
    qty: number; unit: string; cadence: Cadence;
    note?: string;
    /** Maps to the StapleCategory written on the new Staple. For
     *  outdoor / drivers we re-use the curated category ids (they
     *  type-narrow through Staple['category']). For pantry we keep the
     *  catalogue's category as-is. Utility uses its own UtilityCategory
     *  so this field is irrelevant there (no Staple created). */
    stapleCategory?: Staple['category'];
  };
  const curatedSuggestions: CuratedSuggestion[] = (() => {
    if (!q) return [];
    // Names already on the family list — skip suggesting these. We
    // compare against ALL staples (regardless of module) to avoid
    // adding the same name twice when modules overlap loosely.
    const familyNames = new Set(staples.map((s) => s.name.toLowerCase()));
    const matchesQuery = (label: string, aliases: string[]) =>
      label.toLowerCase().includes(q) || aliases.some((a) => a.includes(q));

    if (reqModule === 'outdoor') {
      return DIRECTORY_OUTDOOR
        .filter((r) => matchesQuery(r.label, r.match))
        .filter((r) => !familyNames.has(r.label.toLowerCase()))
        .slice(0, 8)
        .map((r) => ({
          key: `${r.category}:${r.label}`,
          label: r.label,
          emoji: r.emoji,
          qty: r.defaultQty,
          unit: r.unit,
          cadence: r.cadence,
          note: r.note,
          stapleCategory: r.category as Staple['category'],
        }));
    }
    if (reqModule === 'drivers') {
      return DIRECTORY_DRIVERS
        .filter((r) => matchesQuery(r.label, r.match))
        .filter((r) => !familyNames.has(r.label.toLowerCase()))
        .slice(0, 8)
        .map((r) => ({
          key: `${r.category}:${r.label}`,
          label: r.label,
          emoji: r.emoji,
          qty: r.defaultQty,
          unit: r.unit,
          cadence: r.cadence,
          note: r.note,
          stapleCategory: r.category as Staple['category'],
        }));
    }
    if (reqModule === 'utility') {
      // Utility requests don't promote to Staples (they're paid bills
      // not list items) — but the catalogue still helps describe
      // common bill types. Tap-to-add creates a one-off basket item.
      return DIRECTORY_UTILITIES
        .filter((r) => matchesQuery(r.label, r.match))
        .slice(0, 8)
        .map((r) => ({
          key: `${r.category}:${r.label}`,
          label: r.label,
          emoji: r.emoji,
          qty: r.defaultQty,
          unit: r.unit,
          cadence: r.cadence,
          note: r.note,
        }));
    }
    if (reqModule === 'pantry') {
      return DIRECTORY_STAPLES
        .filter((r) => matchesQuery(r.label, r.match))
        .filter((r) => !familyNames.has(r.label.toLowerCase()))
        .slice(0, 8)
        .map((r) => ({
          key: `${r.surface}:${r.label}`,
          label: r.label,
          emoji: r.emoji ?? '🧺',
          qty: r.defaultQty,
          unit: r.unit,
          cadence: r.cadence,
          note: r.note,
          stapleCategory: r.category,
        }));
    }
    return [];
  })();

  // Tap a curated suggestion → add to basket. For modules that have a
  // family Staple list (pantry / outdoor / drivers), we ALSO create
  // the Staple (pending_promote for helpers · active for parents) so
  // the family's regulars grow with use. Utility skips that (its bills
  // live in a separate collection).
  const addCuratedToBasket = async (s: CuratedSuggestion) => {
    if (!profile?.familyId) return;
    setBusy(true);
    try {
      let stapleId: string | undefined;
      if ((reqModule === 'pantry' || reqModule === 'outdoor' || reqModule === 'drivers')
          && s.stapleCategory) {
        stapleId = await addStaple(profile.familyId, {
          name: s.label,
          category: s.stapleCategory,
          defaultQty: s.qty,
          unit: s.unit,
          cadence: s.cadence,
          active: true,
          // Helpers' picks land as pending_promote (parent reviews on
          // the Staples page); parents' picks are active immediately.
          status: role === 'helper' ? 'pending_promote' : 'active',
          module: reqModule,
        } as Omit<Staple, 'id' | 'createdAt' | 'active'> & { active?: boolean });
      }
      const next: PurchaseRequestItem[] = [
        ...req.items,
        {
          id: cryptoRandomId(),
          ...(stapleId ? { stapleId } : {}),
          name: s.label,
          ...(s.stapleCategory ? { category: s.stapleCategory } : {}),
          qty: s.qty,
          unit: s.unit,
          ...(role === 'helper' && stapleId ? { pendingPromote: true } : {}),
          ...(reconcilable ? { addedDuringReconcile: true } : {}),
        },
      ];
      await patchItems(next);
      setPickerQuery('');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] addCuratedToBasket failed:', e);
    } finally {
      setBusy(false);
    }
  };

  // During pending_close the items are frozen actuals — sum them like
  // we do for closed/reconciling so the Total card + comparison strip
  // show the right number to the parent reviewer. (2026-05-19)
  // For closed/pending_close, trust the request-level actualTotalCents
  // when present — a direct-to-budget post sets it without per-item
  // actuals, so sumActual(items) would read 0 ("-100% saved"). (2026-05-21)
  const total = isClosed || isPendingClose
    ? (req.actualTotalCents ?? sumActual(req.items))
    : reconcilable
      ? sumActual(req.items)
      : sumEstimated(req.items);
  const vPct = isClosed ? variancePct(req) : 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      {/* Header — back link is module-aware. A UTL request points back
          to /pantry/utility ("‹ Utility"), an OUT to /pantry/outdoor
          ("‹ Outdoor"), etc. Pantry stays on /pantry/purchase since
          that's its module home. (2026-05-19, fixes "back says
          Purchase even for utility requests".) */}
      <div className="flex items-center justify-between mb-3">
        <Link
          href={moduleListRoute(reqModule)}
          className="text-hive-muted text-sm no-underline"
        >
          ‹ {reqModule === 'pantry' ? 'Purchase' : reqModule === 'utility' ? 'Utility' : reqModule === 'outdoor' ? 'Outdoor' : reqModule === 'drivers' ? 'Drivers' : reqModule === 'payroll' ? 'Payroll' : 'Back'}
        </Link>
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
          <h1 className="font-nunito font-black text-2xl tracking-tight">{displayRequestTitle(req)}</h1>
        )}
        <p className="text-hive-muted text-xs mt-1 font-bold flex items-center gap-1.5 flex-wrap">
          {/* Serial pill — stays visible even after a parent renames
              the request, so the audit ID (e.g. PNT-0042) is always
              one glance away. 2026-05-18 (structured naming). */}
          {typeof req.seq === 'number' && (
            <span className="text-[10px] font-extrabold uppercase tracking-[1px] bg-hive-cream border border-hive-line text-hive-ink px-1.5 py-0.5 rounded">
              {formatRequestSeq(reqModule, req.seq)}
            </span>
          )}
          <span>{req.items.length} {req.items.length === 1 ? 'item' : 'items'} · {STATUS_LABEL[req.status]}</span>
        </p>
      </div>

      {/* Budget balance for this category — stay aware while building +
          reconciling (2026-05-23). Helpers must NOT see family / module
          budgets — the bar is parent-only across every module, including
          payroll where a helper sees only their own slip (2026-05-27). */}
      {role !== 'helper' && (
        <BudgetBalanceMeter
          module={reqModule}
          pendingAmountCents={req.status === 'closed' ? 0 : (req.actualTotalCents ?? req.estimatedTotalCents ?? 0)}
          className="mb-4"
        />
      )}

      {/* Per-parent attribution — parent-only. Saves immediately on
          change so it works at any status (draft → closed). Helpers +
          kids never see this. */}
      {role === 'parent' && profile?.familyId && (
        <div className="mb-4 rounded-kaya bg-white border border-hive-line p-3">
          <PaidByPicker
            familyId={profile.familyId}
            value={(req.paidByUid ?? null) as PaidByValue}
            onChange={async (next) => {
              try { await updateRequestMeta(profile.familyId!, req.id, { paidByUid: next }); }
              catch (e) { console.error('paidBy update failed', e); }
            }}
          />
        </div>
      )}

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
      {/* 12-hour soft reconciliation window. Banner renders only when
          the request was approved and not yet reconciled — applies to
          both helper (their reminder) and parent (audit visibility). */}
      {isApproved && <ReconcileTimerBanner approvedAt={req.approvedAt} />}
      {isRejected && (
        <Banner tone="rose" title="Rejected"
          body={req.rejectionNote || 'No reason given.'} />
      )}

      {/* Reopened banner — a parent reopened this closed request. Makes
          it obvious why a linked bill is back in Outstanding and what to
          do next. (Reopen v1, 2026-05-20) */}
      {isReconciling && req.reopenedAt && (
        <Banner tone="amber" title="↩ Reopened"
          body={req.module === 'utility'
            ? 'This bill is back in Outstanding. Fix the actuals if needed, then resubmit + reclose to mark it paid again.'
            : 'Fix the actuals if needed, then resubmit + reclose to post it to the budget again.'} />
      )}

      {/* Helper-side waiting banner — shop done, parent reviewing.
          Helper can't take further action until parent approves or
          kicks back. (2026-05-19) */}
      {isPendingClose && role === 'helper' && (
        <Banner tone="amber"
          title={sw ? 'Imetumwa · inasubiri mzazi' : 'Submitted · waiting for parent'}
          body={sw
            ? 'Umemaliza kulinganisha. Mzazi anakagua bei halisi kabla ya kuingiza kwenye bajeti.'
            : 'You finished reconciling. Your parent is reviewing the actuals before posting to the budget.'} />
      )}

      {/* Parent close-review card — appears when the helper has
          submitted reconciled actuals for budget review. Parent
          allocates overrun, decides on savings, leaves a note,
          then posts to budget. (2026-05-19) */}
      {isPendingClose && role === 'parent' && profile?.familyId && profile.uid && (
        <CloseReviewCard
          familyId={profile.familyId}
          parentUid={profile.uid}
          request={req}
          onPosted={() => {
            // After posting we want the parent to see how the budget
            // looks with this shop applied — direct deep-link to the
            // budget page is the fastest way to that view.
            router.push('/pantry/budget');
          }}
        />
      )}

      {/* Post-close "View budget →" CTA — shown to parents on a
          freshly closed request so they can immediately see how the
          shop hit the monthly budget. (2026-05-19) */}
      {isClosed && role === 'parent' && (
        <Link
          href="/pantry/budget"
          className="mt-3 block bg-pantry-leaf-soft border border-pantry-leaf rounded-hive p-3 text-center"
        >
          <span className="font-nunito font-extrabold text-pantry-leaf-dk text-sm">
            View Budget →
          </span>
          <span className="block text-[11px] text-hive-muted mt-0.5">
            See how this shop landed against the monthly cap
          </span>
        </Link>
      )}

      {/* Savings decision card — legacy fallback for closed requests
          that didn't go through pending_close (created before the
          submit-for-review flow shipped). Hides automatically once
          `request.savingsDecision` is set, so post-pending_close
          requests don't double-prompt. (2026-05-19) */}
      {isClosed && role === 'parent' && profile?.familyId && profile.uid && req.module !== 'payroll' && (
        <SavingsDecisionCard
          familyId={profile.familyId}
          parentUid={profile.uid}
          request={req}
        />
      )}

      {/* Utility meter context — shown only when the request is
          pinned to a meter via /pantry/utility's picker. Banner sits
          above the basket so the helper sees what they're paying
          for without scrolling. */}
      {req.module === 'utility' && req.meterId && (
        <UtilityMeterBanner
          familyId={profile!.familyId!}
          meterId={req.meterId}
          totalCents={total}
          currency={currency}
        />
      )}
      {/* Drivers requests pin to a vehicle (2026-05-18). Same idea
          as the meter banner — surface what the request is FOR so
          everyone (driver, parent reviewing, future Finances reader)
          knows which car the spend attributes to. */}
      {req.module === 'drivers' && req.vehicleId && (
        <VehicleBanner familyId={profile!.familyId!} vehicleId={req.vehicleId} />
      )}

      {/* Auto-generated payroll paystub (v3 — 2026-05-19). Renders
          the cycle summary in a tight pill row so the parent sees
          basic + allowances − deductions = net at a glance before
          scrolling into the line items. */}
      {req.generatedBy === 'system' && req.payrollCycle && (
        <PayrollPaystubBanner cycle={req.payrollCycle} currency={currency} />
      )}

      {/* Budget month — parent correction for a salary stamped to the wrong
          month (e.g. May's pay paid on the 1st–5th of June). Sets budgetMonth
          so the cost reads in the month worked. Parent + payroll only. */}
      {req.module === 'payroll' && role === 'parent' && profile?.familyId && (
        <PayrollBudgetMonthCard familyId={profile.familyId} req={req} />
      )}

      {/* Module budget banner — kept lightweight (single Family read).
          PARENT-ONLY (2026-05-27): helpers must not see family budgets.
          The original "scale your basket" rationale is outweighed by
          the privacy principle — the basket itself is still visible,
          parents review before approval. Also skipped when there's no
          cap or the request is already closed/rejected. */}
      {role !== 'helper' && (() => {
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
                {MODULE_EMOJI[reqModule]} {MODULE_LABEL[reqModule]} cap
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

      {/* New-items count — 2026-05-18 (verification v3). Surface a
          parent-visible cue at the top of the basket whenever the
          helper has quick-added new items. Tapping each pending row
          reveals the inline Promote / Keep-as-one-off choice. */}
      {(() => {
        const pendingCount = req.items.filter((i) => i.pendingPromote).length;
        if (pendingCount === 0 || role !== 'parent' || (!isPending && !isDraft)) return null;
        return (
          <div className="bg-pantry-leaf-soft border border-pantry-leaf rounded-hive p-2.5 mb-3 text-[11px] text-hive-ink leading-relaxed">
            <span className="font-nunito font-extrabold text-pantry-leaf-dk">
              ✨ {pendingCount} new item{pendingCount === 1 ? '' : 's'} to decide.
            </span>
            {' '}Tap each striped row → <strong>Add to {reqModule === 'pantry' ? 'Staples' : 'Regulars'}</strong> (keep forever) or <strong>Keep one-off</strong> (this shop only).
          </div>
        );
      })()}

      {/* AI receipt scan — fills line items (draft) or actuals (reconcile).
          Shown wherever the basket is editable. (2026-05-23) */}
      {canAddItems && (
        <label className="flex items-center justify-center gap-2 border-2 border-dashed rounded-hive py-2.5 mb-3 cursor-pointer font-nunito font-black text-[13px] transition-colors"
          style={{ borderColor: '#E8C3AE', background: '#FBF3DF', color: '#B8860B' }}>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickReceipt} />
          {sw
            ? <>📷 Piga picha risiti {reconcilable ? '· jaza bei halisi' : '· ongeza vitu'}</>
            : <>📷 Scan receipt {reconcilable ? '· fill actual prices' : '· add items'}</>}
        </label>
      )}
      {scanFile && (
        <ReceiptScanModal
          file={scanFile}
          currency={currency}
          existingItemNames={req.items.map((i) => i.name)}
          applyLabel={reconcilable ? 'Fill actuals' : 'Add items'}
          onApply={applyScan}
          onClose={() => setScanFile(null)}
        />
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
            viewer={viewer}
            module={reqModule}
            currency={currency}
            editable={editable}
            reconcilable={reconcilable}
            onQty={(q) => setItemQty(it.id, q)}
            onPrice={(cents) => setItemPrice(it.id, cents)}
            onActual={(p) => setItemActual(it.id, p)}
            onRemove={() => removeItem(it.id)}
            bandPct={bandPct}
            canPromote={role === 'parent'}
            pendingCard={
              role === 'parent' && it.pendingPromote && it.stapleId
                ? <PendingDecisionCard
                    familyId={profile?.familyId || ''}
                    requestId={req.id}
                    item={it}
                    staples={staples}
                    setBusy={setBusy}
                    localLanguage={(family?.localLanguage ?? '').trim()}
                    module={reqModule}
                  />
                : null
            }
            varianceOnClose={isClosed || isPendingClose}
          />
        ))}
      </div>

      {/* Add-from-Pantry + Quick-add — available whenever items can
          be added. As of 2026-05-18: parent reviewing a pending
          request CAN also add items ("while you're at it, grab
          garlic too"). 2026-05-19: helpers can ALSO add during
          reconcile when they picked up something extra at the shop;
          those new lines get `addedDuringReconcile: true` so they're
          visibly marked in the audit trail. Existing approved lines
          stay locked from edit/remove during reconcile. */}
      {canAddItems && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => { setShowPicker((v) => !v); setPickerQuery(''); }}
            className="w-full bg-hive-paper border border-hive-line rounded-hive py-2.5 font-nunito font-bold text-sm text-pantry-leaf-dk"
          >
            {showPicker
              ? '× Close picker'
              : `＋ Pick from ${
                  reqModule === 'pantry'  ? 'Staples'
                : reqModule === 'utility' ? 'Utilities'
                : reqModule === 'outdoor' ? 'Outdoor'
                : reqModule === 'drivers' ? 'Drivers'
                : reqModule === 'payroll' ? 'Payroll'
                : 'list'
              }${pickable.length > 0 ? ` (${pickable.length})` : ''}`}
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
                    placeholder={`Search ${pickable.length} ${reqModule === 'pantry' ? 'staple' : reqModule + ' regular'}${pickable.length === 1 ? '' : 's'} + catalogue…`}
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
                {/* Family staples — primary block. Always rendered first
                    when there are matches; the catalogue suggestions
                    below act as a fallback for typos / new items. */}
                {filteredPickable.length > 0 && (
                  filteredPickable.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addStapleToBasket(s)}
                      className="w-full flex items-center gap-3 py-2 px-2 hover:bg-hive-cream rounded-lg text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-pantry-leaf-soft flex items-center justify-center text-base">{stapleEmoji(s)}</div>
                      <div className="flex-1 min-w-0">
                        {/* Bilingual headline — helper sees name2 first */}
                        <div className="font-nunito font-extrabold text-sm truncate">{displayStapleName(s, viewer)}</div>
                        {secondaryStapleName(s, viewer) && (
                          <div className="text-[10px] text-hive-muted/80 italic truncate">{secondaryStapleName(s, viewer)}</div>
                        )}
                        <div className="text-[11px] text-hive-muted">
                          {s.defaultQty} {s.unit}
                          {s.lastBoughtCents != null && ` · ${formatCents(s.lastBoughtCents, currency)} ea`}
                        </div>
                      </div>
                      <span className="text-pantry-leaf-dk font-nunito font-black">＋</span>
                    </button>
                  ))
                )}

                {/* Catalogue fallback — surfaces when the user has typed
                    a query and we have curated suggestions to offer.
                    Tap-to-add creates the Staple (pending_promote for
                    helpers · active for parents) + adds to the basket
                    in one step, so the family's regulars grow with use. */}
                {curatedSuggestions.length > 0 && (
                  <>
                    <div className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-honey-dk px-2 pt-3 pb-1 flex items-center gap-1.5">
                      <span>From the catalogue</span>
                      <span className="bg-hive-paper border border-hive-line rounded-full px-1.5 py-0.5 text-[9px] text-hive-muted">{curatedSuggestions.length}</span>
                    </div>
                    {curatedSuggestions.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => addCuratedToBasket(c)}
                        disabled={busy}
                        className="w-full flex items-center gap-3 py-2 px-2 hover:bg-hive-cream rounded-lg text-left disabled:opacity-50"
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#FFF3D9] flex items-center justify-center text-base">{c.emoji}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-nunito font-extrabold text-sm truncate">{c.label}</div>
                          <div className="text-[10px] text-hive-honey-dk/80 italic truncate">Catalogue suggestion</div>
                          <div className="text-[11px] text-hive-muted truncate">
                            {c.qty} {c.unit} · {c.cadence}{c.note ? ` · ${c.note}` : ''}
                          </div>
                        </div>
                        <span className="text-hive-honey-dk font-nunito font-black">＋</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Empty states — only fire when BOTH blocks are empty */}
                {filteredPickable.length === 0 && curatedSuggestions.length === 0 && (
                  pickable.length === 0
                    ? <p className="text-hive-muted text-xs text-center py-6">
                        No more {reqModule === 'pantry' ? 'staples' : reqModule + ' regulars'} to add. Quick-add a new one below.
                      </p>
                    : q
                      ? <p className="text-hive-muted text-xs text-center py-6">
                          Nothing matches "<span className="font-bold">{pickerQuery}</span>" — in your list or the catalogue. Quick-add it below.
                        </p>
                      : null
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
                  type="number" min={0} step="0.01" value={quickAdd.qty}
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

      {/* Total card — the de-facto receipt summary. Shows the actual
          total prominently + an approved-vs-actual variance line below
          (both %-chip AND absolute amount labelled "saved" / "over").
          (2026-05-19 — Elia's "show savings or overrun amount, not
          just %" ask + "update in the receipt".) The variance line
          renders during reconcile too so the helper sees the running
          budget impact, not only post-close. */}
      {req.items.length > 0 && (() => {
        const approved = req.estimatedTotalCents ?? sumEstimated(req.items);
        const showVariance =
          (reconcilable || isClosed || isPendingClose) &&
          approved > 0 &&
          // Direct-to-budget posts have no estimate-vs-actual step — the
          // posted amount IS the spend, so a savings/overrun line is
          // meaningless. (2026-05-21)
          !req.postedDirect &&
          // During reconcile, only once the helper has filled actuals
          // for at least one line — avoids a misleading "−100% saved"
          // on an empty actuals page.
          (isClosed || req.items.some((i) => i.actualCents != null && i.actualQty != null));
        const varianceCents = total - approved;
        const variancePctNow = approved > 0 ? Math.round((varianceCents / approved) * 100) : 0;
        const variancePositive = varianceCents > 0;
        const exactly = varianceCents === 0;
        return (
          <div className="mt-4 rounded-hive p-4 flex items-center justify-between bg-pantry-leaf-soft border border-pantry-leaf">
            <div>
              <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
                {reconcilable || isClosed ? 'Actual total' : 'Estimated total'}
              </div>
              {(reconcilable || isClosed || isPendingClose) && approved > 0 && (
                <div className="text-[11px] text-hive-muted font-bold mt-1">
                  approved {formatCents(approved, currency)}
                </div>
              )}
            </div>
            <div className="text-right">
              {/* Estimated total renders to a "budget-neat" bucket
                  (round-up to nearest 10/100/1000 depending on
                  magnitude) so the parent sees a clean number when
                  planning. Actuals stay precise — they're facts.
                  (2026-05-19 — Elia's "round up totals in the nearest
                  100 to make the budget neat".) */}
              <div className="font-nunito font-black text-2xl text-hive-ink">
                {(reconcilable || isClosed || isPendingClose)
                  ? formatCents(total, currency)
                  : <>≈ {formatCentsBudgetNeat(total, currency)}</>}
              </div>
              {showVariance && (
                <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] font-nunito font-extrabold">
                  <span className={`px-1.5 py-0.5 rounded ${
                    exactly
                      ? 'bg-hive-cream text-hive-muted'
                      : variancePositive
                        ? 'bg-[#FCEAEA] text-hive-rose'
                        : 'bg-[#E6F7EE] text-hive-green'
                  }`}>
                    {variancePositive ? '+' : ''}{variancePctNow}%
                  </span>
                  <span className={exactly
                    ? 'text-hive-muted'
                    : variancePositive ? 'text-hive-rose' : 'text-hive-green'}>
                    {exactly
                      ? 'on the dot'
                      : variancePositive
                        ? `+${formatCents(varianceCents, currency)} over`
                        : `${formatCents(-varianceCents, currency)} saved`}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Receipt photo — shown during reconcile + closed states.
          (2026-05-19) Helper attaches the paper trail during reconcile;
          parent sees it post-close as audit evidence. Hidden in earlier
          states (draft / pending / approved) since there's nothing to
          photograph yet. The thumbnail is the uploaded receipt itself
          — tap to open in a new tab for full-size review. */}
      {(reconcilable || isClosed || isPendingClose) && (
        <div className="mt-3 bg-hive-paper border border-hive-line rounded-hive p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
              📷 Receipt photo
            </div>
            {req.receiptUrl && !isClosed && (
              <button
                type="button"
                onClick={handleReceiptClear}
                disabled={receiptBusy}
                className="text-hive-rose text-[10px] font-nunito font-extrabold disabled:opacity-50"
              >
                ✕ Remove
              </button>
            )}
          </div>
          {req.receiptUrl ? (
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => downloadImage(req.receiptUrl!, suggestedPhotoFilename()).catch((err) => console.error('Receipt download failed', err))}
                aria-label="Download receipt"
                className="block w-24 h-24 rounded-lg overflow-hidden border border-hive-line bg-hive-cream flex-shrink-0 p-0 cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={req.receiptUrl} alt="Receipt" className="w-full h-full object-cover" />
              </button>
              <div className="flex-1 min-w-0 text-[11px] text-hive-muted font-bold">
                <p>Tap the photo to save the receipt.</p>
                {!isClosed && (
                  <label className="inline-block mt-2 cursor-pointer text-pantry-leaf-dk font-extrabold underline">
                    📷 Replace receipt
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={receiptBusy}
                      onChange={(e) => { void handleReceiptUpload(e.target.files?.[0] ?? null); e.target.value = ''; }}
                    />
                  </label>
                )}
              </div>
            </div>
          ) : isClosed ? (
            /* Closed without a receipt — the audit trail has a gap.
               Show a passive placeholder rather than an active upload
               card; receipts are an in-reconcile artefact. */
            <div className="border-2 border-dashed border-hive-line rounded-hive p-3 text-center bg-hive-cream/40">
              <div className="text-2xl mb-1 opacity-60">📷</div>
              <div className="font-nunito font-extrabold text-sm text-hive-muted">
                No receipt attached
              </div>
              <div className="text-[11px] text-hive-muted/80 font-bold mt-0.5">
                The shop closed without an uploaded photo.
              </div>
            </div>
          ) : (
            <label className={`block w-full border-2 border-dashed rounded-hive p-4 text-center cursor-pointer transition-colors ${
              receiptBusy
                ? 'border-hive-line text-hive-muted opacity-60 cursor-default'
                : 'border-pantry-leaf/40 text-pantry-leaf-dk hover:bg-pantry-leaf-soft/40'
            }`}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={receiptBusy}
                onChange={(e) => { void handleReceiptUpload(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
              <div className="text-2xl mb-1">📷</div>
              <div className="font-nunito font-extrabold text-sm">
                {receiptBusy ? 'Uploading…' : 'Add receipt photo'}
              </div>
              <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                Snap or pick from your gallery. Helps the parent close the audit trail.
              </div>
            </label>
          )}
          {receiptError && (
            <p className="text-[11px] text-hive-rose font-bold mt-2">{receiptError}</p>
          )}
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

            {/* Parent fast-path: skip approval + reconcile and post the
                spend straight to the budget. Helpers never see this. */}
            {role === 'parent' && directCents === null && (
              <button
                type="button"
                onClick={() => setDirectCents(sumEstimated(req.items))}
                disabled={busy || req.items.length === 0 || isGuest}
                className="bg-hive-paper border border-pantry-leaf-soft text-pantry-leaf-dk rounded-hive py-3.5 font-nunito font-black text-sm disabled:opacity-60"
              >
                Post straight to budget →
              </button>
            )}
            {role === 'parent' && directCents !== null && (
              <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
                <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
                  Amount to post to budget
                </label>
                <div className="mt-1 flex items-center gap-1 bg-hive-cream border border-hive-line rounded-lg px-2 py-1.5">
                  <span className="text-xs text-hive-muted font-bold">{currency}</span>
                  <NumberInput
                    value={directCents / 100}
                    onChange={(n) => setDirectCents(Math.round(n * 100))}
                    allowDecimal={currencyAllowsDecimals(currency)}
                    placeholder="0"
                    ariaLabel="Amount to post to budget"
                    className="flex-1 bg-transparent font-nunito font-extrabold text-sm focus:outline-none w-0"
                  />
                </div>
                <p className="text-[10px] text-hive-muted font-bold mt-1">
                  Skips approval + reconcile — records this directly against the budget.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setDirectCents(null)}
                    disabled={busy}
                    className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={postDirect}
                    disabled={busy || directCents <= 0}
                    className="bg-pantry-leaf text-white rounded-lg py-2 font-nunito font-black text-sm disabled:opacity-60"
                  >
                    Post to budget →
                  </button>
                </div>
              </div>
            )}
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
        {/* Force reject — only when approved, parent only, only after
            approval. Visually de-emphasised (small text-link style) so
            it doesn't compete with Start reconcile. Two confirmations
            fire inside forceReject() — see lib/purchase.ts comment. */}
        {isApproved && role === 'parent' && (
          <button
            type="button"
            onClick={forceReject}
            disabled={busy}
            className="text-hive-rose text-xs font-nunito font-extrabold underline underline-offset-2 mt-1 self-center"
          >
            ⚠ Force reject (approved by mistake)
          </button>
        )}
        {isReconciling && (
          <button onClick={submitClose} disabled={busy} className="bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30">
            {sw ? 'Tuma kwa ukaguzi →' : 'Submit for review →'}
          </button>
        )}
        {/* Delete a reopened request — appears only after a parent has
            reopened a closed request (reopenedAt set). "Reopen first"
            is the deliberate guard: closed requests can't be deleted
            outright. (Reopen v1, 2026-05-20) */}
        {isReconciling && req.reopenedAt && role === 'parent' && (
          <button
            type="button"
            onClick={deleteOwn}
            disabled={busy}
            className="text-hive-rose font-nunito font-bold text-xs py-2"
          >
            🗑 Delete request
          </button>
        )}
        {/* Recycle a closed invoice → re-buy the same basket. Closed
            invoices only (the "old invoices" you'd re-order), excludes
            auto-generated payroll. Available to parent + helper since
            both create requests. Spawns a fresh draft seeded from last
            actuals and navigates straight into it. (Recycle v1,
            2026-05-22) */}
        {isClosed && req.module !== 'payroll' && profile?.familyId && profile?.uid && (
          <button
            type="button"
            onClick={recycle}
            disabled={busy}
            className="bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
          >
            ♻️ Recycle · re-buy these items
          </button>
        )}
        {/* Reopen a closed request — parent-only, excludes payroll in
            v1. Flips back to reconciling + unwinds the close (bill back
            to Outstanding, budget un-counts). (Reopen v1, 2026-05-20) */}
        {isClosed && role === 'parent' && req.module !== 'payroll' && (
          <button
            type="button"
            onClick={reopen}
            disabled={busy}
            className="bg-hive-paper border border-hive-honey text-hive-honey-dk rounded-hive py-3 font-nunito font-black text-sm"
          >
            ↩ Reopen to edit
          </button>
        )}

        {/* Save & exit — explicit "pause" affordance for draft +
            reconcile states. Inputs already auto-save on every
            change; this is the affirmative UX so the helper /
            parent feels safe stepping away mid-edit (no internet,
            another task, etc.) and resuming later. Routes back to
            the module home with the request safely persisted. */}
        {(isDraft || isReconciling) && (
          <button
            type="button"
            onClick={() => router.push(moduleListRoute(req.module))}
            className="text-hive-muted text-xs font-nunito font-extrabold underline underline-offset-2 mt-1 self-center"
          >
            💾 Save &amp; exit · pick up later
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
    // pending_close uses the same amber styling as pending_approval —
    // it's "awaiting parent action" with the same visual urgency.
    : status === 'pending_close' ? 'bg-[#FFF3D9] text-hive-honey-dk border-hive-honey'
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
  item, viewer, module: itemModule, currency, editable, reconcilable,
  onQty, onPrice, onActual, onRemove, bandPct,
  canPromote, pendingCard,
  varianceOnClose,
}: {
  item: PurchaseRequestItem;
  /** Bilingual viewer — helper sees name2 first, parent sees name. */
  viewer: ViewerRole;
  module: PurchaseModule;
  currency: string;
  editable: boolean;
  reconcilable: boolean;
  onQty: (q: number) => void;
  /** Set the per-unit estimated price (cents). Available during draft
   *  (helper sets the initial estimate) and pending_approval (parent
   *  may correct it before approving). 2026-05-18. */
  onPrice: (cents: number | undefined) => void;
  onActual: (p: Partial<Pick<PurchaseRequestItem, 'actualQty' | 'actualCents' | 'priceException' | 'priceExceptionReason'>>) => void;
  onRemove: () => void;
  /** ± price-change band percent for this module (0 = guardrail off).
   *  An actual per-unit price outside ± this of the approved price needs
   *  a parent OK before the request can close. (2026-05-31) */
  bandPct: number;
  /** Whether the viewer is allowed to promote/keep this pending
   *  item. Parents only — helpers can't write to the catalogue. */
  canPromote: boolean;
  /** Pre-rendered pending-decision card (parent passes a stateful
   *  card so it can chain rename / cross-check / promote in one
   *  scope). Only used when canPromote && item.pendingPromote. */
  pendingCard: React.ReactNode;
  varianceOnClose: boolean;
}) {
  // 2026-05-18 (verification pass v2) — collapse-by-default. Default
  // is a single tidy line; tap to expand the qty + price inputs +
  // remove. Always-on inputs made the basket noisy + tall — most
  // items are correct as-typed; the parent only needs to fix a few.
  const [open, setOpen] = useState(false);
  const sw = useLocale() === 'sw';
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
          {/* Bilingual headline — helper sees name2 first if present. */}
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate flex items-center gap-1.5">
            <span className="truncate">{displayStapleName(item, viewer)}</span>
            {pending && (
              <span className="text-[9px] bg-[#FFF3D9] border border-hive-honey text-hive-honey-dk px-1.5 py-0.5 rounded font-extrabold uppercase tracking-[1px]">
                Pending
              </span>
            )}
            {item.addedDuringReconcile && (
              <span className="text-[9px] bg-pantry-leaf-soft border border-pantry-leaf text-pantry-leaf-dk px-1.5 py-0.5 rounded font-extrabold uppercase tracking-[1px]">
                {sw ? '+ Imeongezwa dukani' : '+ Added at shop'}
              </span>
            )}
          </div>
          {secondaryStapleName(item, viewer) && (
            <div className="text-[10px] text-hive-muted/80 italic truncate">{secondaryStapleName(item, viewer)}</div>
          )}
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
            {/* Variance chip — was only post-close; also show during
                reconcile so the helper sees the running delta as they
                fill actuals. 2026-05-19. */}
            {(varianceOnClose || reconcilable) && item.actualCents != null && item.actualQty != null && est > 0 && (
              <span className={`text-[10px] font-extrabold px-1 py-0.5 rounded ${vDelta === 0 ? 'bg-hive-cream text-hive-muted' : vDelta > 0 ? 'bg-[#FCEAEA] text-hive-rose' : 'bg-[#E6F7EE] text-hive-green'}`}>
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
        <div className="border-t border-hive-line/60 p-3 space-y-3">
          {/* PENDING decision strip (parent only) — added 2026-05-18
              per Elia's verification ask: close the loop on new items
              right here in the request flow, no separate review screen
              needed. Helpers see the badge but the action is gated to
              parents (they own the catalogue). */}
          {pending && canPromote && item.stapleId && pendingCard}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">Qty ({item.unit})</span>
            <input
              type="number" min={0} step="0.01"
              value={item.qty}
              onChange={(e) => onQty(e.target.value === '' ? 0 : parseFloat(e.target.value))}
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
        </div>
      )}

      {/* Reconcile mode: actual qty + actual price + live deltas vs the
          approved baseline. (2026-05-19 — Elia's reconcile-visibility
          ask: helper at the shop should see what the parent approved
          AND how their entry compares, in one glance.) Stays always-on
          here because every line typically needs touching during
          reconcile (helper is at the shop confirming numbers). */}
      {reconcilable && (() => {
        const aQty = item.actualQty;
        const aPrice = item.actualCents;
        const ePrice = item.estimatedCents;
        const eQty = item.qty;
        const qtyDelta = (aQty != null && aQty > 0 && eQty > 0) ? aQty - eQty : null;
        const qtyPct = (qtyDelta != null && eQty > 0) ? Math.round((qtyDelta / eQty) * 100) : null;
        const priceDelta = (aPrice != null && ePrice != null && ePrice > 0) ? aPrice - ePrice : null;
        const pricePct = (priceDelta != null && ePrice != null && ePrice > 0) ? Math.round((priceDelta / ePrice) * 100) : null;
        const aTotal = (aPrice ?? 0) * (aQty ?? 0);
        const eTotal = (ePrice ?? 0) * eQty;
        const totalDelta = aTotal - eTotal;
        const totalPct = eTotal > 0 ? Math.round((totalDelta / eTotal) * 100) : 0;
        const fmt = (pct: number) => `${pct > 0 ? '+' : ''}${pct}%`;
        const chipCls = (pct: number) => pct === 0
          ? 'bg-hive-cream text-hive-muted'
          : pct > 0
            ? 'bg-[#FCEAEA] text-hive-rose'
            : 'bg-[#E6F7EE] text-hive-green';
        // ── Price-change band (2026-05-31) ──────────────────────────
        // Band is anchored to the APPROVED per-unit price. An ad-hoc line
        // added at the shop has no approval baseline, so the guardrail
        // doesn't apply to it. Over-band → the helper must leave a reason
        // and the line travels as a pending exception for the parent.
        const band = item.addedDuringReconcile ? null : priceBandRange(ePrice, bandPct);
        const overBand = band != null && aPrice != null && (aPrice < band.minCents || aPrice > band.maxCents);
        return (
          <div className="border-t border-hive-line/60 p-3 space-y-2">
            {/* PRIMARY entry — receipt shape: Total spent + How many.
                Per-unit auto-computes (read-only) so the helper never does
                per-unit math in their head (the #1 mistake source).
                (2026-05-31 — Diana's ask.) */}
            <TotalCountEntry
              currency={currency}
              unit={item.unit}
              actualQty={aQty}
              actualCents={aPrice}
              approvedPriceCents={ePrice}
              band={band}
              onChange={({ totalCents, qty }) => {
                const perUnit = qty > 0 ? Math.round(totalCents / qty) : 0;
                const within = band == null || (perUnit >= band.minCents && perUnit <= band.maxCents);
                onActual({
                  actualQty: qty,
                  actualCents: perUnit,
                  // Clear a stale exception once the helper brings it back
                  // in band; over-band keeps whatever reason they've typed.
                  ...(within ? { priceException: undefined, priceExceptionReason: undefined } : {}),
                });
              }}
            />

            {/* Advanced — edit per-unit directly (rare). Collapsed; the
                band still checks whatever per-unit they set here. */}
            <AdvancedPerUnit
              currency={currency}
              actualQty={aQty}
              actualCents={aPrice}
              qtyPct={qtyPct}
              pricePct={pricePct}
              chipCls={chipCls}
              fmt={fmt}
              onActual={onActual}
            />

            {/* Over-band → required reason + ⚠ held-for-parent state. */}
            {overBand && band && (
              <div className="bg-[#FCEEEE] border border-[#E8B5B5] rounded-lg p-2.5 space-y-1.5">
                <div className="text-[11px] font-nunito font-extrabold text-hive-rose">
                  {sw
                    ? <>⚠ Zaidi ya kiwango cha ±{bandPct}% · kinachoruhusiwa {formatCents(band.minCents, currency)}–{formatCents(band.maxCents, currency)} kila moja</>
                    : <>⚠ Over the ±{bandPct}% limit · allowed {formatCents(band.minCents, currency)}–{formatCents(band.maxCents, currency)} ea</>}
                </div>
                <div className="text-[10.5px] text-hive-navy/70 font-bold">{sw ? 'Bei hii inahitaji ruhusa ya mzazi. Andika sababu:' : 'This price needs a parent OK. Add a reason:'}</div>
                <textarea
                  value={item.priceExceptionReason ?? ''}
                  onChange={(e) => onActual({
                    priceException: 'pending',
                    priceExceptionReason: e.target.value,
                  })}
                  placeholder={sw ? 'mf. Bei sokoni imepanda wiki hii — soko zima ni hivyo' : 'e.g. Market price jumped this week — whole market the same'}
                  rows={2}
                  className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-[12px] font-bold resize-none"
                />
                {!(item.priceExceptionReason ?? '').trim() && (
                  <div className="text-[10px] text-hive-rose font-bold">{sw ? 'Sababu inahitajika kabla ya kutuma.' : 'A reason is required before you can submit.'}</div>
                )}
              </div>
            )}

            {/* Approved-vs-actual comparison strip — gives the helper a
                clear anchor for what the parent signed off on, with a
                live total delta + absolute savings/over so they see
                the budget impact as they type. Only renders once
                they've entered numbers (avoids −100% on empty input).
                Skipped entirely for ad-hoc items added during
                reconcile — they have no approval baseline to compare
                against (the badge in the row header makes their
                provenance obvious). */}
            {!item.addedDuringReconcile && (
            <div className="bg-hive-cream/60 border border-hive-line/50 rounded-lg p-2 text-[11px] font-bold">
              <div className="flex items-center justify-between gap-2 text-hive-muted">
                <span>
                  <span className="uppercase tracking-[1px] text-[9px]">{sw ? 'Imeidhinishwa' : 'Approved'}</span>
                  <span className="ml-1.5 text-hive-navy">
                    {eQty} {item.unit}{ePrice != null && ` × ${formatCents(ePrice, currency)}`}
                  </span>
                </span>
                <span className="text-hive-navy">{formatCents(eTotal, currency)}</span>
              </div>
              {(aQty != null || aPrice != null) && (
                <>
                  <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-hive-line/40">
                    <span>
                      <span className="uppercase tracking-[1px] text-[9px] text-hive-muted">{sw ? 'Halisi' : 'Actual'}</span>
                      <span className="ml-1.5 text-hive-navy">
                        {aQty ?? 0} {item.unit}{aPrice != null && ` × ${formatCents(aPrice, currency)}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-hive-navy">
                      {formatCents(aTotal, currency)}
                      {eTotal > 0 && (
                        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${chipCls(totalPct)}`}>
                          {fmt(totalPct)}
                        </span>
                      )}
                    </span>
                  </div>
                  {eTotal > 0 && totalDelta !== 0 && (
                    <div className={`text-[10px] mt-0.5 text-right font-nunito font-extrabold ${
                      totalDelta > 0 ? 'text-hive-rose' : 'text-hive-green'
                    }`}>
                      {totalDelta > 0
                        ? `+${formatCents(totalDelta, currency)} ${sw ? 'zaidi' : 'over'}`
                        : `${formatCents(-totalDelta, currency)} ${sw ? 'umeokoa' : 'saved'}`}
                    </div>
                  )}
                </>
              )}
            </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/** PRIMARY reconcile entry (2026-05-31 — Diana's ask). The helper enters
 *  what the receipt shows — Total spent + How many — and the per-unit
 *  price auto-computes (shown read-only). Canonical storage stays
 *  per-unit so Finances + Staples last-price keep working. The unit
 *  label is whatever the line already uses (kg/pcs/×) — unchanged. */
function TotalCountEntry({
  currency, unit, actualQty, actualCents, approvedPriceCents, band, onChange,
}: {
  currency: string;
  unit: string;
  actualQty: number | undefined;
  actualCents: number | undefined;
  approvedPriceCents: number | undefined;
  band: { minCents: number; maxCents: number } | null;
  onChange: (v: { totalCents: number; qty: number }) => void;
}) {
  // Seed the visible fields from any existing actuals so re-opening a
  // line shows what was entered. Total = per-unit × qty.
  const sw = useLocale() === 'sw';
  const seededTotal = (actualCents != null && actualQty != null && actualQty > 0)
    ? ((actualCents * actualQty) / 100).toString() : '';
  const seededQty = actualQty != null && actualQty > 0 ? String(actualQty) : '';
  const [totalDraft, setTotalDraft] = useState(seededTotal);
  const [qtyDraft, setQtyDraft] = useState(seededQty);

  const totalNum = totalDraft === '' ? null : parseFloat(totalDraft);
  const qtyNum = qtyDraft === '' ? null : parseFloat(qtyDraft);
  const perUnitCents = (totalNum != null && qtyNum != null && qtyNum > 0 && totalNum >= 0)
    ? Math.round((totalNum / qtyNum) * 100) : null;
  const within = band == null || perUnitCents == null || (perUnitCents >= band.minCents && perUnitCents <= band.maxCents);

  // Push computed values up whenever both fields are valid.
  const push = (t: string, q: string) => {
    const tn = t === '' ? null : parseFloat(t);
    const qn = q === '' ? null : parseFloat(q);
    if (tn != null && qn != null && qn > 0 && tn >= 0) {
      onChange({ totalCents: Math.round(tn * 100), qty: qn });
    }
  };

  return (
    <div className="bg-pantry-leaf-soft/30 border border-pantry-leaf/30 rounded-lg p-2.5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] font-bold text-pantry-leaf-dk uppercase tracking-[1px]">{sw ? 'Jumla uliyolipa' : 'Total spent'} ({currency})</span>
          <input
            type="number" min={0} step="0.01" inputMode="decimal"
            value={totalDraft}
            onChange={(e) => { setTotalDraft(e.target.value); push(e.target.value, qtyDraft); }}
            placeholder="0.00"
            className="w-full border border-hive-line rounded-lg px-2 py-2 text-base font-nunito font-black mt-0.5"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-pantry-leaf-dk uppercase tracking-[1px]">{sw ? 'Idadi (ngapi)' : 'How many'} ({unit})</span>
          <input
            type="number" min={0} step="0.01" inputMode="decimal"
            value={qtyDraft}
            onChange={(e) => { setQtyDraft(e.target.value); push(totalDraft, e.target.value); }}
            placeholder="0"
            className="w-full border border-hive-line rounded-lg px-2 py-2 text-base font-nunito font-black mt-0.5"
          />
        </label>
      </div>
      <div className={`text-[12px] font-nunito font-extrabold flex items-center gap-1.5 ${within ? 'text-pantry-leaf-dk' : 'text-hive-rose'}`}>
        {perUnitCents != null ? (
          <>= <span className="font-black">{formatCents(perUnitCents, currency)}</span> {sw ? 'kila moja (otomatiki)' : 'each (auto)'}
            {band != null && (within
              ? <span className="text-hive-green">· {sw ? 'ndani ya kiwango ✓' : 'within range ✓'}</span>
              : <span>· {sw ? 'zaidi ya kiwango ⚠' : 'over the limit ⚠'}</span>)}
          </>
        ) : (
          <span className="text-hive-muted italic font-bold">{sw ? 'Weka jumla + idadi — Kaya itahesabu bei ya kila moja' : 'Enter total + how many — Kaya works out the price each'}</span>
        )}
      </div>
    </div>
  );
}

/** Advanced — edit the per-unit price directly. Collapsed by default so
 *  the receipt-shape entry above is the obvious path; kept for the rare
 *  case a helper genuinely wants per-unit. The band still checks it. */
function AdvancedPerUnit({
  currency, actualQty, actualCents, qtyPct, pricePct, chipCls, fmt, onActual,
}: {
  currency: string;
  actualQty: number | undefined;
  actualCents: number | undefined;
  qtyPct: number | null;
  pricePct: number | null;
  chipCls: (pct: number) => string;
  fmt: (pct: number) => string;
  onActual: (p: Partial<Pick<PurchaseRequestItem, 'actualQty' | 'actualCents'>>) => void;
}) {
  const [open, setOpen] = useState(false);
  const sw = useLocale() === 'sw';
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] text-hive-muted font-nunito font-extrabold underline underline-offset-2"
      >
        {sw ? '· badili bei ya kila moja (ya juu)' : '· edit per-unit instead (advanced)'}
      </button>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 bg-hive-cream/40 border border-hive-line/60 rounded-lg p-2">
      <label className="block">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px] flex items-center justify-between gap-1">
          <span>{sw ? 'Idadi halisi' : 'Actual qty'}</span>
          {qtyPct != null && qtyPct !== 0 && (
            <span className={`text-[9px] font-extrabold px-1 py-0.5 rounded ${chipCls(qtyPct)}`}>{fmt(qtyPct)}</span>
          )}
        </span>
        <input
          type="number" min={0} step="0.01"
          value={actualQty ?? ''}
          onChange={(e) => onActual({ actualQty: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
          className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
        />
      </label>
      <label className="block">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px] flex items-center justify-between gap-1">
          <span>{sw ? 'Bei halisi kila moja' : 'Actual price ea'}</span>
          {pricePct != null && pricePct !== 0 && (
            <span className={`text-[9px] font-extrabold px-1 py-0.5 rounded ${chipCls(pricePct)}`}>{fmt(pricePct)}</span>
          )}
        </span>
        <NumberInput
          value={actualCents != null ? actualCents / 100 : 0}
          onChange={(n) => onActual({ actualCents: n > 0 ? Math.round(n * 100) : 0 })}
          allowDecimal={currencyAllowsDecimals(currency)}
          min={0}
          ariaLabel="Actual price each"
          placeholder="0"
          className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
        />
      </label>
    </div>
  );
}

// PendingDecisionCard — parent-only review surface for items the
// helper quick-added at the shop. Three actions in one card:
//   1. EDIT NAME — primary + optional local (Swahili) secondary,
//      so the parent can correct the helper's quick-typed label
//      before promoting (e.g. helper typed "Asali" → parent renames
//      to "Honey" + sets secondary "Asali" for nanny searchability).
//   2. ADD TO STAPLES — promote to catalogue. Cross-checks against
//      existing staples first; if a duplicate is found, surfaces an
//      in-app confirm asking the parent to link to the existing
//      staple instead of creating a near-twin.
//   3. KEEP ONE-OFF — delete placeholder; item stays in basket only.
// Lifted into its own component because the rename + cross-check
// state is local + the JSX is non-trivial. 2026-05-18.
function PendingDecisionCard({
  familyId, requestId, item, staples, setBusy, localLanguage, module,
}: {
  familyId: string;
  requestId: string;
  item: PurchaseRequestItem;
  staples: Staple[];
  setBusy: (b: boolean) => void;
  /** Family-configured local language label ('Swahili', 'Hindi', …)
   *  or '' for none. Drives the secondary-name input copy. */
  localLanguage: string;
  /** Request module — drives the "regulars" wording (2026-05-21).
   *  Pantry promotes to "Staples"; other modules promote to their
   *  "Regulars" list, so "Add to Staples" was wrong everywhere but
   *  Pantry. */
  module: PurchaseModule;
}) {
  // Module-aware wording for the promote affordance.
  const savedNoun = module === 'pantry' ? 'Staples' : 'Regulars';
  const savedKind = module === 'pantry' ? 'Staple' : `${MODULE_LABEL[module]} regular`;
  const pickFrom = MODULE_LABEL[module];
  const confirmAction = useConfirm();
  // Edit-mode toggle — collapsed by default so the card stays small;
  // tap "✏️ Edit name" to expand the two inputs.
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const [name2Draft, setName2Draft] = useState(item.name2 ?? '');
  const [saving, setSaving] = useState(false);

  // Re-sync drafts when the item itself changes (e.g. external
  // basket edit). Avoids stale inputs if the parent navigates away
  // and back without closing the row.
  useEffect(() => {
    if (!editing) {
      setNameDraft(item.name);
      setName2Draft(item.name2 ?? '');
    }
  }, [item.name, item.name2, editing]);

  const saveRename = async () => {
    if (!item.stapleId) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await renamePendingItem(familyId, {
        requestId,
        itemId: item.id,
        stapleId: item.stapleId,
        name: trimmed,
        name2: name2Draft.trim() || undefined,
      });
      setEditing(false);
    } finally { setSaving(false); }
  };

  const promote = async () => {
    if (!item.stapleId) return;
    // Cross-check against existing family staples BEFORE creating a
    // duplicate catalogue entry. Match by name OR name2 (case- +
    // punctuation-insensitive) so "Honey" finds "honey" finds "Asali".
    const candidate = { id: item.stapleId, name: item.name, name2: item.name2 };
    const conflict = findStapleConflict(staples, candidate);
    if (conflict) {
      const ok = await confirmAction({
        title: `Already a Staple — "${conflict.name}"`,
        message:
          `Looks like you already have this in your Staples${conflict.name2 ? ` (local: ${conflict.name2})` : ''}. ` +
          `Link this purchase to the existing one instead of creating a duplicate?`,
        confirmLabel: 'Use existing',
        cancelLabel: 'Add as new anyway',
      });
      if (ok) {
        setBusy(true);
        try {
          await linkPendingToExisting(familyId, {
            requestId,
            itemId: item.id,
            pendingStapleId: item.stapleId,
            existingStapleId: conflict.id,
            existingName: conflict.name,
            existingName2: conflict.name2,
          });
        } finally { setBusy(false); }
        return;
      }
      // Parent chose "Add as new anyway" → fall through to promote.
    }
    setBusy(true);
    try {
      await promotePendingStaple(familyId, {
        requestId,
        itemId: item.id,
        stapleId: item.stapleId,
      });
    } finally { setBusy(false); }
  };

  const keepOneOff = async () => {
    if (!item.stapleId) return;
    setBusy(true);
    try {
      await keepAsOneOff(familyId, {
        requestId,
        itemId: item.id,
        stapleId: item.stapleId,
      });
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-3">
      <p className="text-[11px] font-nunito font-extrabold text-hive-honey-dk leading-snug">
        ✨ New item — save it as a {savedKind}?
      </p>
      <p className="text-[10px] text-hive-ink/80 mt-1 leading-relaxed">
        Save it and helpers can pick it from {pickFrom} next time.
        Keep one-off and it stays in this basket only. We&apos;ll check for duplicates before adding.
      </p>

      {/* Rename strip — collapsed by default. */}
      {editing ? (
        <div className="mt-2.5 bg-white border border-hive-honey-dk/40 rounded-lg p-2.5 space-y-2">
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">Primary name</span>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="e.g. Honey"
              maxLength={60}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1px]">
              {localLanguage
                ? `Local name · ${localLanguage} — optional, what helpers see first`
                : 'Local / native language name — optional, what helpers see first'}
            </span>
            <input
              value={name2Draft}
              onChange={(e) => setName2Draft(e.target.value)}
              placeholder={localLanguage ? `e.g. the ${localLanguage} word` : 'e.g. the local-language equivalent'}
              maxLength={60}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold mt-0.5"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setEditing(false); setNameDraft(item.name); setName2Draft(item.name2 ?? ''); }}
              disabled={saving}
              className="text-[11px] font-nunito font-bold text-hive-muted px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveRename}
              disabled={saving || !nameDraft.trim()}
              className="flex-1 bg-hive-honey-dk text-white rounded-lg py-1.5 font-nunito font-black text-[11px] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save names'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 text-[11px] font-nunito font-extrabold text-hive-honey-dk underline"
        >
          ✏️ Edit name {item.name2 ? `(${item.name} / ${item.name2})` : `(${item.name})`}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2.5">
        <button
          type="button"
          onClick={promote}
          className="bg-pantry-leaf hover:bg-pantry-leaf-dk text-white rounded-lg py-2 font-nunito font-black text-xs"
        >
          ＋ Add to {savedNoun}
        </button>
        <button
          type="button"
          onClick={keepOneOff}
          className="bg-hive-paper border border-hive-line text-hive-ink hover:bg-hive-cream rounded-lg py-2 font-nunito font-bold text-xs"
        >
          Keep one-off
        </button>
      </div>
    </div>
  );
}

// Inline meter context for Utility requests. Subscribes to the
// single meter doc; renders a chip-style banner above the basket so
// the helper always sees which meter the request is for. Kept here
// (vs imported as a shared component) to avoid creating one-off
// shared modules.
function UtilityMeterBanner({ familyId, meterId, totalCents, currency }: {
  familyId: string; meterId: string; totalCents: number; currency: string;
}) {
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
  // Read-only consumption estimate: how many units the current top-up
  // amount buys (total ÷ price per unit). Updates live as the helper
  // edits the amount. Only shown when the parent set a price/unit on
  // the meter. (2026-05-21 — Kaya Pulse groundwork.)
  const pricePerUnit = meter.pricePerUnitCents;
  const showUnits = pricePerUnit != null && pricePerUnit > 0 && totalCents > 0;
  const estUnits = showUnits ? totalCents / pricePerUnit! : 0;
  const unitLabel = meter.unit || 'units';
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
      {showUnits && (
        <div className="text-right flex-shrink-0">
          <p className="font-nunito font-black text-sm text-hive-honey-dk leading-tight">
            ≈ {estUnits.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unitLabel}
          </p>
          <p className="text-[10px] text-hive-muted font-bold">
            {formatCents(pricePerUnit!, currency)}/{meter.unit || 'unit'}
          </p>
        </div>
      )}
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

// ── Close-review card (2026-05-19) ─────────────────────────────────
// Shown to parents on a `pending_close` request — helper finished
// reconciling and submitted the actuals for budget review. Three
// decisions land here in one screen:
//   1. Overrun allocation (if actual > approved): "absorb in this
//      month's budget" or "mark as one-off / unbudgeted"
//   2. Savings decision (if actual < approved): tip / balance / skip
//      (same logic as the legacy post-close SavingsDecisionCard)
//   3. Optional note from the parent
// Single "Approve & post to budget" CTA fires all three atomically,
// then redirects to /pantry/budget so the parent sees the budget
// view immediately after posting.
/** Parent-facing review of one over-band price line (2026-05-31).
 *  Shows approved vs entered + the helper's reason, then Approve / Reject.
 *  Either decision keeps the comment; only an approved/rejected line lets
 *  the request post. The parent can also add a short note. */
function PriceExceptionRow({
  familyId, requestId, parentUid, item, currency,
}: {
  familyId: string;
  requestId: string;
  parentUid: string;
  item: PurchaseRequestItem;
  currency: string;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const approved = item.estimatedCents ?? 0;
  const entered = item.actualCents ?? 0;
  const pct = approved > 0 ? Math.round(((entered - approved) / approved) * 100) : 0;
  const resolve = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    try {
      await resolvePriceException(familyId, requestId, item.id, decision, parentUid, note);
    } finally { setBusy(false); }
  };
  return (
    <div className="bg-[#FCEEEE] border border-[#E8B5B5] rounded-lg p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-nunito font-extrabold text-[13px] text-hive-navy">{item.name}</span>
        <span className="text-[10px] font-extrabold text-hive-rose bg-white/70 rounded px-1.5 py-0.5">
          {pct > 0 ? '+' : ''}{pct}%
        </span>
      </div>
      <div className="text-[11px] text-hive-navy/70 font-bold mt-0.5">
        approved {formatCents(approved, currency)} → entered <strong className="text-hive-rose">{formatCents(entered, currency)}</strong> ea
      </div>
      {(item.priceExceptionReason ?? '').trim() && (
        <div className="text-[11px] text-hive-navy mt-1.5 bg-white/60 rounded p-1.5">
          💬 <span className="italic">“{item.priceExceptionReason}”</span>
        </div>
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-[12px] font-bold mt-2 bg-white"
      />
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve('rejected')}
          className="rounded-lg border border-hive-line bg-white text-hive-muted font-nunito font-extrabold text-[12px] py-2 disabled:opacity-50"
        >
          Reject price
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve('approved')}
          className="rounded-lg bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] py-2 disabled:opacity-50"
        >
          {busy ? '…' : `Approve ${formatCents(entered, currency)}`}
        </button>
      </div>
    </div>
  );
}

function CloseReviewCard({
  familyId, parentUid, request, onPosted,
}: {
  familyId: string;
  parentUid: string;
  request: PurchaseRequest;
  onPosted: () => void;
}) {
  const { config } = useHive();
  const currency = config.currency;

  const approved = request.estimatedTotalCents;
  const actual = request.actualTotalCents ?? sumActual(request.items);
  const savings = approved - actual;
  const overrun = actual - approved;
  const isOver = overrun > 0;
  const isUnder = savings > 0;
  const variancePctValue = approved > 0 ? Math.round((Math.abs(actual - approved) / approved) * 100) : 0;

  // Helper attribution for tip path — same as SavingsDecisionCard.
  const [helpers, setHelpers] = useState<HelperLink[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listHelpers(familyId);
        if (!cancelled) setHelpers(list.filter((h) => h.status !== 'removed'));
      } catch {
        if (!cancelled) setHelpers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  // Pre-pick recommendations:
  //   • Overrun → default to 'absorb' (most common; budget eats it)
  //   • Savings → AI default per ratio (tip < 1%, balance otherwise)
  const [overrunChoice, setOverrunChoice] = useState<'absorb' | 'unbudgeted'>('absorb');
  const recommendedSavings = recommendedSavingsDecision(approved, savings);
  const [savingsChoice, setSavingsChoice] = useState<'tip' | 'balance' | 'skip'>(recommendedSavings);
  const [helperUid, setHelperUid] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-select the request's creator if they're a helper.
  useEffect(() => {
    if (!helpers || helperUid) return;
    const creatorIsHelper = helpers.find((h) => h.uid === request.createdBy);
    if (creatorIsHelper) setHelperUid(creatorIsHelper.uid);
    else if (helpers.length === 1) setHelperUid(helpers[0].uid);
  }, [helpers, request.createdBy, helperUid]);

  const apply = async () => {
    setError('');
    if (hasUnresolvedPriceException(request)) {
      setError('Resolve the over-limit price(s) above — approve or reject each — before posting.');
      return;
    }
    if (isUnder && savingsChoice === 'tip' && !helperUid) {
      setError('Pick a helper to tip, or change the savings choice.');
      return;
    }
    setSaving(true);
    try {
      await approveCloseAndPost(familyId, request.id, {
        decidedBy: parentUid,
        closeApprovalNote: note.trim() || undefined,
        overrunAllocation: isOver ? { kind: overrunChoice } : undefined,
        savings: isUnder ? {
          kind: savingsChoice,
          helperUid: savingsChoice === 'tip' ? helperUid : undefined,
        } : undefined,
      });
      onPosted();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] approveCloseAndPost failed:', e);
      setError('Could not post to budget. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const kickBack = async () => {
    if (!window.confirm('Send this request back to the helper for revisions?')) return;
    setSaving(true);
    try {
      await kickBackToReconcile(familyId, request.id, {
        decidedBy: parentUid,
        reason: note.trim() || undefined,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] kickBackToReconcile failed:', e);
      setError('Could not send back. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 bg-[#FFF8E6] border-2 border-hive-honey rounded-hive p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="font-nunito font-extrabold text-hive-honey-dk text-[11px] uppercase tracking-[1.5px]">
          📋 Review &amp; post to budget
        </p>
        <span className={`text-[10px] font-extrabold uppercase tracking-[1px] px-2 py-0.5 rounded ${
          isOver ? 'bg-[#FCEAEA] text-hive-rose' : isUnder ? 'bg-[#E6F7EE] text-pantry-leaf-dk' : 'bg-hive-cream text-hive-muted'
        }`}>
          {isOver ? `+${formatCents(overrun, currency)} over` : isUnder ? `${formatCents(savings, currency)} saved` : 'on the dot'}
        </span>
      </div>
      <p className="text-[11px] text-hive-ink/80 mb-3">
        Helper submitted actuals of <strong>{formatCents(actual, currency)}</strong> against approved <strong>{formatCents(approved, currency)}</strong>
        {(isOver || isUnder) && <> ({variancePctValue}% {isOver ? 'over' : 'under'})</>}.
        Allocate the {isOver ? 'overrun' : 'savings'}, add a note if useful, then post to the budget.
      </p>

      {/* Over-band price exceptions — each must be resolved before posting.
          (2026-05-31) The helper flagged a price beyond the ±band with a
          reason; the parent OKs or rejects each here. */}
      {request.items.filter((i) => i.priceException === 'pending').length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-[10px] font-bold text-hive-rose uppercase tracking-[1.5px]">
            ⚠ Prices over the limit · needs your OK
          </p>
          {request.items.filter((i) => i.priceException === 'pending').map((i) => (
            <PriceExceptionRow
              key={i.id}
              familyId={familyId}
              requestId={request.id}
              parentUid={parentUid}
              item={i}
              currency={currency}
            />
          ))}
        </div>
      )}

      {/* Overrun allocation (only when actual > approved) */}
      {isOver && (
        <div className="mb-3">
          <p className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] mb-1.5">
            Allocate overrun · {formatCents(overrun, currency)}
          </p>
          <div className="space-y-2">
            <ChoiceRow
              active={overrunChoice === 'absorb'}
              recommended={true}
              onClick={() => setOverrunChoice('absorb')}
              icon="📉"
              label="Absorb in this month's budget"
              sub="Counts against the monthly cap. Default — money's spent, budget eats it."
            />
            <ChoiceRow
              active={overrunChoice === 'unbudgeted'}
              recommended={false}
              onClick={() => setOverrunChoice('unbudgeted')}
              icon="📌"
              label="Mark as one-off / unbudgeted"
              sub="Tagged as exceptional so monthly trend reports don't get distorted."
            />
          </div>
        </div>
      )}

      {/* Savings decision (only when actual < approved AND not payroll) */}
      {isUnder && request.module !== 'payroll' && (
        <div className="mb-3">
          <p className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] mb-1.5">
            What about the savings · {formatCents(savings, currency)}?
          </p>
          <div className="space-y-2">
            <ChoiceRow
              active={savingsChoice === 'tip'}
              recommended={recommendedSavings === 'tip'}
              onClick={() => setSavingsChoice('tip')}
              icon="🎁"
              label="Tip the helper"
              sub="Creates a payroll bonus tagged Savings tip in their pay history."
            />
            {savingsChoice === 'tip' && (
              <div className="pl-7">
                <label className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] block mb-1">
                  Tip to
                </label>
                <select
                  value={helperUid}
                  onChange={(e) => setHelperUid(e.target.value)}
                  className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold bg-white"
                >
                  <option value="">— Pick a helper —</option>
                  {(helpers ?? []).map((h) => (
                    <option key={h.uid} value={h.uid}>{h.displayName}</option>
                  ))}
                </select>
                {helpers && helpers.length === 0 && (
                  <p className="text-[10px] text-hive-rose mt-1">
                    No active helpers in your family. Add one in Settings → Helpers, or carry as balance.
                  </p>
                )}
              </div>
            )}
            <ChoiceRow
              active={savingsChoice === 'balance'}
              recommended={recommendedSavings === 'balance'}
              onClick={() => setSavingsChoice('balance')}
              icon="💰"
              label="Carry as balance"
              sub={`Credits the next ${request.module} request by ${formatCents(savings, currency)}.`}
            />
            <ChoiceRow
              active={savingsChoice === 'skip'}
              recommended={false}
              onClick={() => setSavingsChoice('skip')}
              icon="✓"
              label="Skip — retain by family"
              sub="No payroll movement; savings stays in the family pot."
            />
          </div>
        </div>
      )}

      {/* Optional note */}
      <div className="mb-3">
        <label className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] block mb-1">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isOver
            ? 'e.g. shop was further this week so transport added $5'
            : isUnder
              ? 'e.g. found vegetables on discount'
              : 'Add any context for the audit trail…'}
          rows={2}
          className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito bg-white resize-none"
        />
      </div>

      {error && <p className="text-[11px] text-hive-rose font-bold mb-2">{error}</p>}

      <button
        type="button"
        disabled={saving || (isUnder && savingsChoice === 'tip' && !helperUid)}
        onClick={apply}
        className="w-full bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
      >
        {saving ? 'Posting…' : 'Approve & post to budget →'}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={kickBack}
        className="w-full text-hive-muted text-xs font-nunito font-extrabold underline underline-offset-2 mt-2 py-1"
      >
        ↺ Send back to helper for revisions
      </button>
    </div>
  );
}

// ── Savings decision card (2026-05-19) ─────────────────────────────
// When a request closes UNDER approved budget, the parent picks what
// to do with the leftover: tip the helper (creates a PAY-* request
// with category 'savings_tip'), carry forward as a balance for the
// next request in the same module, or skip. AI default: tip when
// savings < 1% of approved (too small to matter for carry-forward),
// else carry — but the parent can always override.
//
// Card hides once `req.savingsDecision` is set so re-renders post-
// decision don't re-prompt. Helper attribution: parent picks from
// active helpers in family via dropdown; pre-filled with the
// request's creator if they're a helper.
//
// 2026-05-19 update: the close-review flow now makes this decision
// PRE-close inside CloseReviewCard. This component is preserved as
// a fallback for closed requests created before the submit-for-review
// flow shipped (no `pending_close` in their history). Hides once
// `savingsDecision` is set on either path.
function SavingsDecisionCard({
  familyId, parentUid, request,
}: {
  familyId: string;
  parentUid: string;
  request: PurchaseRequest;
}) {
  const { config } = useHive();
  const currency = config.currency;

  const approved = request.estimatedTotalCents;
  const actual = request.actualTotalCents ?? sumActual(request.items);
  const savings = approved - actual;

  const [helpers, setHelpers] = useState<HelperLink[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listHelpers(familyId);
        if (!cancelled) setHelpers(list.filter((h) => h.status !== 'removed'));
      } catch {
        if (!cancelled) setHelpers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  const recommended = recommendedSavingsDecision(approved, savings);
  const [choice, setChoice] = useState<'tip' | 'balance' | 'skip'>(recommended);
  const [helperUid, setHelperUid] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pre-select the request's creator if they're a helper in the family.
  useEffect(() => {
    if (!helpers || helperUid) return;
    const creatorIsHelper = helpers.find((h) => h.uid === request.createdBy);
    if (creatorIsHelper) setHelperUid(creatorIsHelper.uid);
    else if (helpers.length === 1) setHelperUid(helpers[0].uid);
  }, [helpers, request.createdBy, helperUid]);

  // Hide once a decision has been recorded.
  if (request.savingsDecision) {
    const d = request.savingsDecision;
    return (
      <div className="mt-3 bg-pantry-leaf-soft border border-pantry-leaf rounded-hive p-3 text-[12px]">
        <p className="font-nunito font-extrabold text-pantry-leaf-dk text-[11px] uppercase tracking-[1.5px]">
          🌱 Savings decision · recorded
        </p>
        <p className="font-nunito text-hive-ink mt-1">
          {d.kind === 'tip' && (
            <>Tipped helper · {formatCents(d.amountCents, currency)}</>
          )}
          {d.kind === 'balance' && (
            <>Carried forward · {formatCents(d.amountCents, currency)} credit on next {request.module} request</>
          )}
          {d.kind === 'skip' && (
            <>Skipped · {formatCents(d.amountCents, currency)} savings retained by family (no payroll movement)</>
          )}
        </p>
      </div>
    );
  }

  // No savings → no card.
  if (savings <= 0) return null;

  const savingsPct = approved > 0 ? (savings / approved) * 100 : 0;
  const isSmall = savingsPct < 1;

  const apply = async () => {
    setError('');
    if (choice === 'tip' && !helperUid) {
      setError('Pick a helper to tip.');
      return;
    }
    setSaving(true);
    try {
      await recordSavingsDecision(familyId, request.id, {
        kind: choice,
        amountCents: savings,
        helperUid: choice === 'tip' ? helperUid : undefined,
        module: choice === 'balance' ? request.module : undefined,
        decidedBy: parentUid,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[purchase] recordSavingsDecision failed:', e);
      setError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 bg-[#E6F7EE] border border-hive-green rounded-hive p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="font-nunito font-extrabold text-hive-green text-[11px] uppercase tracking-[1.5px]">
          🌱 Savings · what should happen?
        </p>
        <span className="font-nunito font-black text-hive-green">
          {formatCents(savings, currency)}
        </span>
      </div>
      <p className="text-[11px] text-hive-ink/80 mb-3">
        This shop closed <strong>{formatCents(savings, currency)} under</strong> approved
        ({Math.round(savingsPct)}%). Tip the helper as a thank-you, or carry the balance into the next {request.module} request.
        {isSmall && (
          <>
            {' '}<strong className="text-pantry-leaf-dk">Recommended: tip</strong> — savings is small enough that tipping has more impact than carrying.
          </>
        )}
        {!isSmall && (
          <>
            {' '}<strong className="text-pantry-leaf-dk">Recommended: carry forward</strong> — savings is meaningful; banking it gives the next shop more headroom.
          </>
        )}
      </p>

      <div className="space-y-2">
        <ChoiceRow
          active={choice === 'tip'}
          recommended={recommended === 'tip'}
          onClick={() => setChoice('tip')}
          icon="🎁"
          label="Tip the helper"
          sub="Creates a payroll bonus tagged Savings tip in their pay history."
        />
        {choice === 'tip' && (
          <div className="pl-7">
            <label className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] block mb-1">
              Tip to
            </label>
            <select
              value={helperUid}
              onChange={(e) => setHelperUid(e.target.value)}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-sm font-nunito font-bold bg-white"
            >
              <option value="">— Pick a helper —</option>
              {(helpers ?? []).map((h) => (
                <option key={h.uid} value={h.uid}>{h.displayName}</option>
              ))}
            </select>
            {helpers && helpers.length === 0 && (
              <p className="text-[10px] text-hive-rose mt-1">No active helpers in your family. Add one in Settings → Helpers, or carry as balance.</p>
            )}
          </div>
        )}
        <ChoiceRow
          active={choice === 'balance'}
          recommended={recommended === 'balance'}
          onClick={() => setChoice('balance')}
          icon="💰"
          label="Carry as balance"
          sub={`Credits the next ${request.module} request by ${formatCents(savings, currency)}.`}
        />
        <ChoiceRow
          active={choice === 'skip'}
          recommended={false}
          onClick={() => setChoice('skip')}
          icon="✓"
          label="Skip — retain by family"
          sub="No payroll movement; just close the shop. Savings stays in the family pot."
        />
      </div>

      {error && <p className="text-[11px] text-hive-rose font-bold mt-2">{error}</p>}

      <button
        type="button"
        disabled={saving || (choice === 'tip' && !helperUid)}
        onClick={apply}
        className="w-full mt-3 bg-pantry-leaf text-white rounded-hive py-2.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Apply decision'}
      </button>
    </div>
  );
}

function ChoiceRow({
  active, recommended, onClick, icon, label, sub,
}: {
  active: boolean;
  recommended: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg border-2 text-left transition-colors ${
        active
          ? 'border-pantry-leaf bg-white'
          : 'border-hive-line bg-hive-paper/60 hover:border-pantry-leaf/40'
      }`}
    >
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] flex-shrink-0 ${
        active ? 'bg-pantry-leaf text-white' : 'bg-hive-cream text-hive-muted border border-hive-line'
      }`}>{active ? '✓' : icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-nunito font-extrabold text-[13px] text-hive-ink">{label}</span>
          {recommended && (
            <span className="text-[9px] font-extrabold uppercase tracking-[1px] bg-pantry-leaf-soft text-pantry-leaf-dk px-1.5 py-0.5 rounded">
              Recommended
            </span>
          )}
        </div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5">{sub}</div>
      </div>
    </button>
  );
}

// ── Payroll paystub banner (v3 — 2026-05-19) ────────────────────
// Renders the pay-cycle summary for a system-generated salary
// request: period + basis (with hours/days breakdown) + basic +
// allowances − deductions = net. Sits above the item list which
// has the per-line detail.
// ── Budget month corrector (2026-06-08) ─────────────────────────────
// Parent-only control to re-attribute a salary to the right budget month.
// Use when a payment made on the 1st–5th of a month belongs to the month
// just worked (e.g. May's pay paid early June should read in May).
function monthLabel(mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  if (!y || !m) return mk;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function prevMonthKey(mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function PayrollBudgetMonthCard({ familyId, req }: { familyId: string; req: PurchaseRequest }) {
  const current = budgetMonthKeyFor(req) ?? '';
  const [month, setMonth] = useState(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Quick "previous month" relative to the work-period start (the common fix).
  const periodStartMk = req.payrollCycle?.periodStart?.slice(0, 7) || current;
  const prevMk = periodStartMk ? prevMonthKey(periodStartMk) : '';

  const save = async (mk: string) => {
    if (!mk) return;
    setSaving(true); setSaved(false);
    try {
      await setRequestBudgetMonth(familyId, req.id, mk);
      setMonth(mk);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-kaya bg-[#F4EFFB] border border-[#C9B8E5] px-4 py-3 mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider font-bold text-[#6B4FA0]">Budget month</p>
        {saved && <span className="text-[10px] font-bold text-pantry-leaf-dk">✓ Saved</span>}
      </div>
      <p className="font-nunito font-black text-[17px] text-hive-navy mt-0.5">
        Counts in {current ? monthLabel(current) : '—'}
      </p>
      <p className="text-[11px] text-hive-muted mt-1 leading-relaxed">
        Paid on the 1st–5th for the month just worked? Set this to the month worked
        (e.g. May&apos;s pay paid in June should read in <b>May</b>). History isn&apos;t changed —
        only which month the cost lands in.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        {prevMk && prevMk !== current && (
          <button
            type="button" disabled={saving}
            onClick={() => save(prevMk)}
            className="rounded-kaya-sm bg-white border border-[#C9B8E5] px-3 h-9 text-[12.5px] font-nunito font-extrabold text-[#6B4FA0] hover:bg-[#6B4FA0]/5 disabled:opacity-50"
          >
            ← {monthLabel(prevMk)}
          </button>
        )}
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 px-2 bg-white border border-[#C9B8E5] rounded-kaya-sm text-[12.5px] font-bold text-hive-navy focus:outline-none focus:border-[#6B4FA0]"
        />
        <button
          type="button" disabled={saving || !month || month === current}
          onClick={() => save(month)}
          className="rounded-kaya-sm bg-[#6B4FA0] text-white px-4 h-9 text-[12.5px] font-nunito font-extrabold disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Set month'}
        </button>
      </div>
    </div>
  );
}

function PayrollPaystubBanner({
  cycle, currency,
}: {
  cycle: NonNullable<PurchaseRequest['payrollCycle']>;
  currency: string;
}) {
  const basisLine =
    cycle.basis === 'hourly' ? `${cycle.hours ?? 0}h logged` :
    cycle.basis === 'daily'  ? `${cycle.daysWorked ?? 0} day${cycle.daysWorked === 1 ? '' : 's'} worked` :
                                'Monthly fixed';
  return (
    <div className="bg-[#F4EFFB] border border-[#C9B8E5] rounded-hive p-3 mb-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-[#5E4A8F] mb-1 break-words">
        {(() => {
          const { start, end } = displayPeriod(cycle);
          return `🤝 Auto-generated salary · ${toDisplayDate(start)} → ${toDisplayDate(end)}`;
        })()}
      </p>
      <p className="text-[11px] text-hive-ink mb-2">{basisLine}</p>
      {/* 2-col on phones, 4-col on tablets+. The previous grid-cols-4 ran
          adjacent TZS values into each other on narrow screens (e.g.
          "TZS 130,000−TZS 0"). break-words guards long-currency amounts. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="min-w-0">
          <p className="text-hive-muted uppercase tracking-wider text-[9px] font-bold">Basic</p>
          <p className="font-nunito font-extrabold text-sm break-words">{formatCents(cycle.basicCents, currency)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-hive-muted uppercase tracking-wider text-[9px] font-bold">Allowances</p>
          <p className="font-nunito font-extrabold text-sm break-words">+{formatCents(cycle.allowancesCents, currency)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-hive-muted uppercase tracking-wider text-[9px] font-bold">Deductions</p>
          <p className="font-nunito font-extrabold text-sm text-hive-rose break-words">−{formatCents(cycle.deductionsCents, currency)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-hive-muted uppercase tracking-wider text-[9px] font-bold">Net</p>
          <p className="font-nunito font-black text-sm text-[#5E4A8F] break-words">{formatCents(cycle.netCents, currency)}</p>
        </div>
      </div>
    </div>
  );
}
