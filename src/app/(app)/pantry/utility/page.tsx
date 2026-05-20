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
import { useEffect, useRef, useState } from 'react';
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
  deleteRequest,
} from '@/lib/purchase';
import {
  type UtilityMeter, subscribeToMeters, meterEmoji,
} from '@/lib/utilityMeters';
import {
  CADENCE_LABEL, type Utility, subscribeToUtilities, paymentStatus,
} from '@/lib/pantry';
import { runUtilityBillGenerator } from '@/lib/utilityBills';
import { getFamilyMembers } from '@/lib/firestore';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import TemplatePicker from '@/components/pantry/TemplatePicker';
import { ReconcileTimerChip } from '@/components/pantry/ReconcileTimer';
import { useConfirm } from '@/contexts/ConfirmContext';

// Auto-name comes from createDraftRequest (`UTL-NNNN · DDMMYY`).
// Meter label is passed as the context suffix when a meter is pinned:
// `UTL-NNNN · DDMMYY · Main House LUKU`.

export default function UtilityHomePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';

  const [open, setOpen] = useState<PurchaseRequest[]>([]);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Recent collapses to 3 with a "+ See more" toggle (2026-05-19).
  const [showAllRecent, setShowAllRecent] = useState(false);
  const RECENT_DEFAULT_LIMIT = 3;
  // Same pattern as Drivers — stash the chosen template id while the
  // meter picker runs.
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
      console.error('[utility] deleteRequest failed:', e);
    }
  };

  useEffect(() => {
    if (!profile?.familyId) { setLoading(false); return; }
    let flipped = false;
    const flip = () => { if (!flipped) { flipped = true; setLoading(false); } };
    const t = setTimeout(flip, 1500);
    // Helpers use module-scoped subscriptions; broad listen fails for
    // them on the payroll rule. See purchase.ts comment.
    const c = subscribeToMeters(profile.familyId, (m) => { setMeters(m.filter((x) => x.active)); flip(); });
    if (role === 'helper') {
      const a = subscribeToOpenRequestsByModule(profile.familyId, 'utility', (r) => {
        setOpen(r); flip();
      });
      const b = subscribeToRecentRequestsByModule(profile.familyId, 'utility', (r) => {
        setRecent(r); flip();
      });
      return () => { clearTimeout(t); a(); b(); c(); };
    }
    const a = subscribeToOpenRequests(profile.familyId, (r) => {
      setOpen(r.filter((x) => x.module === 'utility'));
      flip();
    });
    const b = subscribeToRecentRequests(profile.familyId, (r) => {
      setRecent(r.filter((x) => x.module === 'utility'));
      flip();
    });
    return () => { clearTimeout(t); a(); b(); c(); };
  }, [profile?.familyId, role]);

  // Recurring bills (parent only) — drives the Outstanding banner +
  // the auto-request generator. (Utilities v2, 2026-05-20)
  const [bills, setBills] = useState<Utility[]>([]);
  useEffect(() => {
    if (!profile?.familyId || role !== 'parent') return;
    return subscribeToUtilities(profile.familyId, setBills);
  }, [profile?.familyId, role]);

  // Run the recurring-bill auto-request generator once on parent
  // page-load. Mirrors the payroll generator's on-mount trigger. Fully
  // fire-and-forget — failures are swallowed inside the generator.
  const generatorRan = useRef(false);
  useEffect(() => {
    if (!profile?.familyId || !profile.uid || role !== 'parent' || isGuest) return;
    if (generatorRan.current) return;
    generatorRan.current = true;
    (async () => {
      try {
        const members = await getFamilyMembers(profile.familyId!);
        const parentEmails = members
          .filter((m) => m.role === 'parent' && m.email)
          .map((m) => m.email as string);
        await runUtilityBillGenerator(profile.familyId!, profile.uid!, {
          parentEmails,
          currency,
          appUrl: typeof window !== 'undefined' ? window.location.origin : '',
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[utility] bill generator failed:', e);
      }
    })();
  }, [profile?.familyId, profile?.uid, role, isGuest, currency]);

  // Outstanding = active recurring bills that are OVERDUE this period
  // (past due day, not paid). Regular top-ups never count — they're
  // variable + on-demand. (Utilities v2, 2026-05-20)
  const outstanding = bills.filter((b) => {
    if (!b.active) return false;
    return paymentStatus(b).kind === 'overdue';
  });
  const outstandingCents = outstanding.reduce((sum, b) => sum + (b.amountCents || 0), 0);

  // `pending` covers both parent-action states: pre-shop approval AND
  // post-shop close review (pending_close — 2026-05-19).
  const pending = open.filter((r) => r.status === 'pending_approval' || r.status === 'pending_close');
  const drafts = open.filter((r) => r.status === 'draft');
  const inProgress = open.filter((r) => r.status === 'approved' || r.status === 'reconciling');

  const startDraftWithMeter = async (meter: UtilityMeter | null) => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    setCreating(true);
    setShowPicker(false);
    try {
      let id: string;
      if (pendingTemplateId) {
        id = await createDraftFromTemplate(profile.familyId, pendingTemplateId, {
          createdBy: profile.uid,
          createdByRole: role,
          meterId: meter?.id,
          context: meter?.label,
        });
        setPendingTemplateId(null);
      } else {
        id = await createDraftRequest(profile.familyId, {
          context: meter?.label,
          createdBy: profile.uid,
          createdByRole: role,
          module: 'utility',
          meterId: meter?.id,
        });
      }
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // 2026-05-19 — log so silent failures show up in devtools.
      // The most common cause is a missing firestore rule deploy
      // (counters or purchaseRequests). createDraftRequest now
      // gracefully degrades for counters; permission failures on
      // the request itself surface here.
      // eslint-disable-next-line no-console
      console.error('[utility] startDraftWithMeter failed:', e);
      setCreating(false);
    }
  };

  // If the family has zero meters set up, "+ New utility request"
  // goes straight to a no-meter draft (so the flow isn't gated on
  // meter setup). Otherwise it opens the meter picker.
  const startDraft = () => {
    setPendingTemplateId(null);
    if (meters.length === 0) startDraftWithMeter(null);
    else setShowPicker(true);
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
        {/* One clear entry to BOTH config categories (recurring bills +
            regular top-ups). Replaces the old two scattered deep-links.
            (Utilities v2, 2026-05-20) */}
        {role === 'parent' && (
          <Link
            href="/pantry/utility/setup"
            className="mt-3 inline-flex items-center gap-1.5 rounded-hive-pill border border-hive-honey bg-[#FFF3D9] px-3.5 py-2 text-[12px] font-nunito font-extrabold text-hive-honey-dk no-underline"
          >
            ⚙ Set up utilities →
          </Link>
        )}
        {role === 'parent' && meters.length > 0 && (
          <p className="text-[11px] text-hive-honey-dk mt-2 font-bold">
            🔌 {meters.length} meter{meters.length === 1 ? '' : 's'} registered.
          </p>
        )}
      </div>

      {/* Outstanding banner — recurring bills past their due day + not
          yet paid this period. Parent-only. (Utilities v2, 2026-05-20) */}
      {role === 'parent' && outstanding.length > 0 && (
        <div className="mb-4 rounded-hive border-2 border-hive-rose bg-[#FCEAEA] p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-nunito font-black text-hive-rose text-sm">
              ⚠ Outstanding · {outstanding.length} bill{outstanding.length === 1 ? '' : 's'}
            </p>
            <span className="font-nunito font-black text-hive-rose">
              {formatCents(outstandingCents, currency)}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {outstanding.map((b) => {
              const st = paymentStatus(b);
              const days = st.kind === 'overdue' ? st.daysOverdue : 0;
              const link = b.lastGeneratedRequestId
                ? `/pantry/purchase/${b.lastGeneratedRequestId}`
                : '/pantry/utilities';
              return (
                <Link
                  key={b.id}
                  href={link}
                  className="flex items-center justify-between gap-2 text-[12px] no-underline py-0.5"
                >
                  <span className="font-nunito font-bold text-hive-ink truncate">{b.name}</span>
                  <span className="text-hive-rose font-nunito font-extrabold flex-shrink-0">
                    {formatCents(b.amountCents || 0, currency)} · {days}d late
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="text-[10.5px] text-hive-muted mt-2">
            {bills.some((b) => b.autoRequest)
              ? 'Auto-created requests are waiting in your approval queue.'
              : 'Open a bill to create its payment request.'}
          </p>
        </div>
      )}

      {/* Top CTA: visible without scrolling (2026-05-19). */}
      {profile?.familyId && !isGuest && (
        <div className="mb-4">
          <button
            type="button"
            onClick={startDraft}
            disabled={creating}
            className="w-full bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60 mb-2"
          >
            {creating ? 'Starting…' : '＋ New utility request'}
          </button>
          <TemplatePicker
            familyId={profile.familyId}
            module="utility"
            currency={currency}
            onPick={async (tpl) => {
              setPendingTemplateId(tpl.id);
              if (meters.length === 0) await startDraftWithMeter(null);
              else setShowPicker(true);
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
            <Section title="Ready to pay · reconcile" tone="leaf" count={inProgress.length}>
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
          <div className="text-3xl mb-2">⚡</div>
          <h3 className="font-nunito font-black text-lg">No utility requests yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Request an electricity top-up, internet payment, or gas refill. Send for approval, then reconcile after.
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <Section title="Recent" tone="neutral" count={recent.length}>
          {(showAllRecent ? recent : recent.slice(0, RECENT_DEFAULT_LIMIT)).map((r) => (
            <RequestRow key={r.id} req={r} currency={currency} dimmed />
          ))}
          {recent.length > RECENT_DEFAULT_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllRecent((v) => !v)}
              className="w-full bg-hive-paper border border-hive-line rounded-hive py-2 mt-1 text-hive-honey-dk font-nunito font-extrabold text-xs"
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
          className="w-full bg-hive-honey text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-hive-honey/30 disabled:opacity-60"
        >
          {creating ? 'Starting…' : meters.length === 0 ? '＋ New utility request' : '＋ New utility request · pick a meter'}
        </button>
        {isGuest && (
          <p className="text-center text-xs text-hive-muted mt-2">
            Guest mode — sign in to create a request.
          </p>
        )}
      </div>

      {/* Meter picker sheet */}
      {showPicker && (
        <>
          <div className="fixed inset-0 bg-hive-navy/40 z-40" onClick={() => { setShowPicker(false); setPendingTemplateId(null); }} />
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper rounded-t-3xl shadow-2xl z-50 pb-6 pt-2 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-center pt-1 pb-2">
              <div className="w-12 h-1 rounded-full bg-hive-line"></div>
            </div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk text-center mb-3">
              Pick a meter
            </p>
            <div className="px-3 pb-3">
              {meters.map((m) => (
                <button
                  key={m.id}
                  onClick={() => startDraftWithMeter(m)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-hive-cream text-left mb-1"
                >
                  <span className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-lg flex-shrink-0">
                    {meterEmoji(m.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{m.label}</div>
                    <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {m.providerRef ? `# ${m.providerRef}` : ''}
                      {m.providerRef && (m.frequency || m.cadenceDays != null) && ' · '}
                      {m.frequency
                        ? CADENCE_LABEL[m.frequency]
                        : m.cadenceDays != null ? `~${m.cadenceDays}d cycle` : ''}
                    </div>
                  </div>
                  <span className="text-hive-muted">›</span>
                </button>
              ))}
              <button
                onClick={() => startDraftWithMeter(null)}
                className="w-full mt-3 border border-dashed border-hive-line rounded-2xl py-3 text-hive-muted text-sm font-nunito font-bold"
              >
                Skip meter · free-form request
              </button>
              {role === 'parent' && (
                <Link
                  href="/pantry/utility-meters"
                  onClick={() => { setShowPicker(false); setPendingTemplateId(null); }}
                  className="block text-center mt-2 text-[11px] font-nunito font-bold text-hive-honey-dk hover:underline"
                >
                  ＋ Add a new meter
                </Link>
              )}
            </div>
          </div>
        </>
      )}
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
  req, currency, dimmed, onDelete,
}: {
  req: PurchaseRequest;
  currency: string;
  dimmed?: boolean;
  /** Render an inline × delete button at the end of the row when set.
   *  Only passed for draft rows so non-drafts stay click-through-only. */
  onDelete?: () => void | Promise<void>;
}) {
  const total = req.actualTotalCents ?? req.estimatedTotalCents;
  const isClosed = req.status === 'closed' || req.status === 'rejected';
  return (
    <div className={`flex items-stretch gap-1.5 ${dimmed ? 'opacity-70' : ''}`}>
      <Link
        href={`/pantry/purchase/${req.id}`}
        className="flex-1 bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
      >
        <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-base flex-shrink-0">
          ⚡
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
