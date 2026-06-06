'use client';

// /pantry/utilities — Recurring household bills + helper salaries.
// Power, water, internet, TV, security, rent… plus a row per helper
// salary. Full CRUD: add, edit (inline), delete. Each row carries an
// amount, a cadence, an optional due-day, account reference and a
// preferred supplier. The monthly roll-up here — alongside what's
// already been paid this month — is the figure that feeds the unified
// Budget.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  UTILITY_CATEGORIES, UtilityCategory, Cadence,
  UTILITY_STARTER_PACKS, UtilityStarterPack,
  UTILITY_PACKS, UtilityPack, DEFAULT_HELPER_SALARY_USD,
  addUtility, updateUtility, deleteUtility,
  seedFromWizard, recordPayment,
  monthlyEquivalentCents, sumMonthlyUtilities, sumPaidThisPeriod, sumOutstanding,
  currentPeriodKey, periodLabel, paymentStatus,
  Utility, Supplier, UtilityStatus,
} from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';
import SupplierBadge from '@/components/pantry/SupplierBadge';
import NumberInput from '@/components/ui/NumberInput';
import BackButton from '@/components/ui/BackButton';

type Filter = 'all' | UtilityCategory;

// Cadence choices for recurring bills. Monthly-first (most common),
// then the two "twice" cadences (2× a month for utilities billed
// mid-cycle; 2× a week for high-frequency top-ups), then the long
// cadences for insurance/levies. (Utilities v2, 2026-05-20)
const CADENCES: { id: Cadence; label: string }[] = [
  { id: 'monthly',     label: 'Monthly' },
  { id: 'semimonthly', label: '2× a month' },
  { id: 'quarterly',   label: 'Quarterly' },
  { id: 'yearly',      label: 'Yearly' },
  { id: 'weekly',      label: 'Weekly' },
  { id: 'biweekly',    label: '2× a week' },
  { id: 'daily',       label: 'Daily' },
  { id: 'as-needed',   label: 'As needed' },
];

export default function UtilitiesPage() {
  const { profile, isGuest } = useAuth();
  const { utilities: rawUtilities, suppliers } = usePantry();
  const { config, fxUsdToFamily } = useHive();
  const currency = config.currency;
  const fxRate = fxUsdToFamily ?? 1;

  // Filter out 'salary' rows everywhere — salaries belong to the
  // upcoming Payroll module, not Utilities. Existing salary docs stay
  // in Firestore until the Payroll migration; they're just hidden
  // from this surface.
  const utilities = useMemo(
    () => rawUtilities.filter((u) => u.category !== 'salary'),
    [rawUtilities],
  );

  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Quick-start pack panel: collapsed by default once the family has
  // any bills (no point pushing seed UI when the list is populated).
  const [packsOpen, setPacksOpen] = useState(utilities.length === 0);
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [packToast, setPackToast] = useState('');

  const visible = useMemo(
    () => (filter === 'all' ? utilities : utilities.filter((u) => u.category === filter)),
    [utilities, filter],
  );

  const monthlyExpected = useMemo(() => sumMonthlyUtilities(utilities), [utilities]);
  const { paidCents, paidCount } = useMemo(() => sumPaidThisPeriod(utilities), [utilities]);
  const activeCount = useMemo(() => utilities.filter((u) => u.active).length, [utilities]);
  // Outstanding = genuinely OWED now (known-amount bills past their due
  // day, unpaid) — NOT the whole month's expected. Amount-less bills
  // inform the budget only. (Elia 2026-05-20: reading the old Expected−
  // Paid as "outstanding" made wrong assumptions.)
  const { outstandingCents: outstanding, count: outstandingCount } = useMemo(
    () => sumOutstanding(utilities), [utilities],
  );

  const showSeedCard = filter === 'all' && utilities.length === 0 && !adding;

  // Existing names (lower-cased) so a pack doesn't double-add a bill
  // the family already tracks. Match the Directory's de-dup approach.
  const ownedNames = useMemo(
    () => new Set(utilities.map((u) => u.name.toLowerCase())),
    [utilities],
  );

  // Categories shown in the filter row + add/edit picker. Salary is
  // suppressed here too — keeps the picker honest about what Utilities
  // covers today.
  const VISIBLE_UTILITY_CATEGORIES = useMemo(
    () => UTILITY_CATEGORIES.filter((c) => c.id !== 'salary'),
    [],
  );

  const addStarterPack = async (pack: UtilityStarterPack) => {
    if (!profile?.familyId || isGuest) return;
    setPackBusy(pack.id);
    let added = 0;
    let skipped = 0;
    for (const item of pack.items) {
      if (ownedNames.has(item.name.toLowerCase())) { skipped++; continue; }
      try {
        await addUtility(profile.familyId, {
          name: item.name,
          category: item.category,
          amountCents: 0,
          cadence: item.cadence,
          dueDay: 0,
          accountRef: '',
          preferredSupplierId: '',
          notes: '',
        });
        added++;
      } catch { skipped++; }
    }
    setPackBusy(null);
    setPackToast(
      added === 0
        ? 'All those bills are already on your list.'
        : `Added ${added} bill${added === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} already had` : ''}. Tap any row to fill in the amount.`,
    );
    setTimeout(() => setPackToast(''), 4000);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <Link href="/pantry/utility/setup" className="text-[12px] text-hive-honey-dk font-bold no-underline hover:underline inline-block mb-2">
        ← Utilities setup
      </Link>
      {/* Category banner — makes it unmistakable which of the two
          utility categories this page configures. (Utilities v2) */}
      <div className="rounded-hive border border-hive-honey bg-[#FFF3D9] p-3 mb-3">
        <p className="font-nunito font-black text-hive-honey-dk text-sm flex items-center gap-1.5">
          🔁 Recurring bills
        </p>
        <p className="text-[12px] text-hive-ink mt-0.5 leading-snug">
          Fixed amount, fixed date (rent, internet, insurance). <strong>You manage these</strong> —
          Kaya rolls them into the Budget and (soon) auto-creates the payment request on the due day.
        </p>
      </div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · Utilities</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Bills 🧾</h1>
        </div>
        {!isGuest && (
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); }}
            className="h-10 px-4 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
          >
            {adding ? 'Close' : '+ Add'}
          </button>
        )}
      </div>

      {/* Monthly roll-up — expected vs paid so far this month. */}
      {utilities.length > 0 && (
        <div className="bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf rounded-hive-lg p-4 mb-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
            Expected this month
          </p>
          <p className="font-nunito font-black text-3xl mt-0.5">
            {formatCents(monthlyExpected, currency)}
          </p>
          <div className="flex items-baseline justify-between gap-3 mt-2 text-[11px] font-nunito font-extrabold">
            <span className="text-pantry-leaf-dk">
              ✓ Paid {formatCents(paidCents, currency)}
              <span className="text-hive-muted font-bold"> · {paidCount}/{activeCount} bills</span>
            </span>
            <span className={outstanding > 0 ? 'text-hive-rose' : 'text-pantry-leaf-dk'}>
              {outstanding > 0
                ? `Outstanding ${formatCents(outstanding, currency)} · ${outstandingCount} bill${outstandingCount === 1 ? '' : 's'}`
                : 'Nothing overdue 🎉'}
            </span>
          </div>
          <p className="text-[10px] text-hive-muted mt-2 leading-relaxed">
            <strong>Expected</strong> is the budgeted monthly figure (non-monthly cadences normalised). <strong>Outstanding</strong> counts only fixed-amount bills past their due day — amount-less bills inform the budget only. Payments record via the <strong>Utility request flow</strong>.
          </p>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
        {VISIBLE_UTILITY_CATEGORIES.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.emoji} {c.label}
          </Chip>
        ))}
      </div>

      {/* Starter packs — one-tap bulk-seed by household size, mirroring
          the Directory's quick-start. Hidden for guests since the demo
          family is already populated. */}
      {!isGuest && (
        <div className="mb-4 bg-pantry-leaf-soft/50 border border-pantry-leaf/40 rounded-hive-lg p-3 lg:p-4">
          <button
            type="button"
            onClick={() => setPacksOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk">
                Quick start · by household size
              </p>
              <p className="font-nunito font-extrabold text-[14px] lg:text-[15px] mt-0.5 truncate">
                Pick a pack — we&apos;ll seed your bills in one tap ✨
              </p>
            </div>
            <span className="text-pantry-leaf-dk font-black text-base shrink-0">{packsOpen ? '−' : '+'}</span>
          </button>

          {packsOpen && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mt-3">
              {UTILITY_STARTER_PACKS.map((pack) => {
                const busy = packBusy === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => addStarterPack(pack)}
                    disabled={isGuest || busy || packBusy !== null}
                    className="text-left bg-hive-paper border border-hive-line rounded-hive p-3 hover:border-pantry-leaf transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl leading-none shrink-0">{pack.emoji}</span>
                      <div className="min-w-0">
                        <p className="font-nunito font-extrabold text-[13px] truncate">{pack.label}</p>
                        <p className="text-[10px] text-hive-muted">{pack.sizeRange}</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-hive-muted mt-2 leading-snug">{pack.description}</p>
                    <p className="mt-2 text-[11px] font-nunito font-extrabold text-pantry-leaf-dk">
                      {busy ? 'Adding…' : `+ Add ${pack.items.length} bill${pack.items.length === 1 ? '' : 's'} →`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {packToast && (
            <p className="mt-3 text-[11px] font-nunito font-extrabold text-pantry-leaf-dk bg-hive-paper border border-pantry-leaf/40 rounded-hive px-3 py-2">
              {packToast}
            </p>
          )}
        </div>
      )}

      {/* Add form (collapsible) */}
      {adding && (
        <UtilityForm
          familyId={profile?.familyId || ''}
          suppliers={suppliers}
          currency={currency}
          onDone={() => setAdding(false)}
        />
      )}

      {/* Seed defaults · only on the fully-empty all-filter state. */}
      {showSeedCard ? (
        <SeedDefaultsCard
          familyId={profile?.familyId || ''}
          isGuest={isGuest}
          existing={utilities}
          currency={currency}
          fxRate={fxRate}
        />
      ) : visible.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <p className="font-nunito font-extrabold text-[14px]">Nothing here yet</p>
          <p className="text-[12px] text-hive-muted mt-1">
            No entries in this category. Tap + Add to add one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((u) => (
            <UtilityRow
              key={u.id}
              utility={u}
              suppliers={suppliers}
              currency={currency}
              editing={editingId === u.id}
              onEditToggle={() => {
                setEditingId((id) => (id === u.id ? null : u.id));
              }}
              familyId={profile?.familyId || ''}
              isGuest={isGuest}
            />
          ))}
        </div>
      )}

      {/* Bridge note → Budget */}
      <div className="rounded-hive border border-dashed border-pantry-leaf bg-gradient-to-br from-pantry-leaf-soft to-white p-4 mt-5 mb-2">
        <p className="font-nunito font-extrabold text-[12px] text-pantry-leaf-dk">💰 Flows into the Budget</p>
        <p className="text-[11px] text-hive-muted leading-relaxed mt-1">
          Utilities sit beside <strong>Staples</strong> in the Pantry. When the unified{' '}
          <Link href="/pantry/budget" className="text-pantry-leaf-dk font-bold hover:underline">Budget</Link>{' '}
          ships, this month's <em>paid</em> + <em>outstanding</em> totals join the weekly grocery spend so the whole household run is one number.
        </p>
      </div>

      <p className="text-center text-[11px] text-hive-muted mt-4 leading-relaxed">
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold hover:underline">← Back to Pantry</Link>
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-hive-pill text-[11px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
        active
          ? 'bg-pantry-leaf text-white border-transparent'
          : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/50'
      }`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status, currency }: { status: UtilityStatus; currency: string }) {
  if (status.kind === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-hive-pill bg-pantry-leaf-soft text-pantry-leaf-dk text-[10px] font-nunito font-extrabold">
        ✓ Paid · {periodLabel(status.periodKey)}
        {status.amountCents > 0 && <span className="opacity-80">· {formatCents(status.amountCents, currency)}</span>}
      </span>
    );
  }
  if (status.kind === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-hive-pill bg-[#FCEAEA] text-hive-rose text-[10px] font-nunito font-extrabold">
        ⚠ Overdue {status.daysOverdue}d
      </span>
    );
  }
  if (status.kind === 'due-soon') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-hive-pill bg-[#FFF4E0] text-[#A2660B] text-[10px] font-nunito font-extrabold">
        🔔 Due in {status.daysUntil === 0 ? 'today' : `${status.daysUntil}d`}
      </span>
    );
  }
  return null;
}

function UtilityRow({
  utility, suppliers, currency, editing,
  onEditToggle, familyId, isGuest,
}: {
  utility: Utility;
  suppliers: Supplier[];
  currency: string;
  editing: boolean;
  onEditToggle: () => void;
  familyId: string;
  isGuest: boolean;
}) {
  const confirmAction = useConfirm();
  const supplier = utility.preferredSupplierId
    ? suppliers.find((s) => s.id === utility.preferredSupplierId)
    : undefined;
  const cat = UTILITY_CATEGORIES.find((c) => c.id === utility.category);
  const cadence = CADENCES.find((c) => c.id === utility.cadence);
  const monthly = monthlyEquivalentCents(utility.amountCents || 0, utility.cadence);
  const status = paymentStatus(utility);
  // Has THIS period's payment request already been auto-created? (register +
  // status so a parent can see it's been sent and jump to it — no double-send.)
  const monthKey = currentPeriodKey();
  const paidThisPeriod = utility.lastPaymentPeriodKey === monthKey;
  const requestSent = !!utility.lastGeneratedKey && utility.lastGeneratedKey.startsWith(monthKey);

  if (editing) {
    return (
      <UtilityForm
        familyId={familyId}
        suppliers={suppliers}
        currency={currency}
        existing={utility}
        onDone={onEditToggle}
        onDelete={async () => {
          if (isGuest) return;
          const ok = await confirmAction({
            title: `Delete "${utility.name}" from utilities?`,
            confirmLabel: 'Delete',
            tone: 'danger',
          });
          if (!ok) return;
          await deleteUtility(familyId, utility.id);
          onEditToggle();
        }}
      />
    );
  }

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-xl shrink-0">
          {cat?.emoji || '✨'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-nunito font-extrabold text-[14px] truncate">{utility.name}</p>
            <StatusPill status={status} currency={currency} />
          </div>
          <p className="text-[11px] text-hive-muted truncate flex items-baseline gap-1 flex-wrap">
            <span className="text-pantry-leaf-dk font-nunito font-extrabold">
              {utility.amountCents > 0 ? formatCents(utility.amountCents, currency) : 'No amount'}
            </span>
            <span>· {cadence?.label || utility.cadence}</span>
            {utility.cadence !== 'monthly' && utility.amountCents > 0 && (
              <span>· ≈ {formatCents(monthly, currency)}/mo</span>
            )}
            {utility.dueDay > 0 && <span>· due {ordinal(utility.dueDay)}</span>}
          </p>
          {/* Sent-register: has this period's payment request already gone out? */}
          {!paidThisPeriod && (
            requestSent ? (
              utility.lastGeneratedRequestId ? (
                <Link href={`/pantry/purchase/${utility.lastGeneratedRequestId}`} className="inline-flex items-center mt-1 text-[10px] font-nunito font-extrabold text-hive-blue bg-[#E5EFF8] rounded-full px-2 py-0.5 no-underline">📤 Request sent · awaiting payment ›</Link>
              ) : (
                <span className="inline-flex items-center mt-1 text-[10px] font-nunito font-extrabold text-hive-blue bg-[#E5EFF8] rounded-full px-2 py-0.5">📤 Request sent · awaiting payment</span>
              )
            ) : utility.dueDay > 0 ? (
              utility.autoRequest && utility.amountCents > 0 ? (
                <span className="inline-flex items-center mt-1 text-[10px] font-nunito font-extrabold text-hive-muted bg-hive-cream rounded-full px-2 py-0.5">⚡ Auto-sends on the {ordinal(utility.dueDay)}</span>
              ) : (
                <span className="inline-flex items-center mt-1 text-[10px] font-nunito font-extrabold text-hive-muted bg-hive-cream rounded-full px-2 py-0.5">✋ Manual · record via the request flow</span>
              )
            ) : null
          )}
          {utility.accountRef && (
            <p className="text-[10px] text-hive-muted truncate mt-0.5">Ref: {utility.accountRef}</p>
          )}
          {supplier && (
            <div className="mt-1"><SupplierBadge supplier={supplier} /></div>
          )}
        </div>
        {!isGuest && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            {/* 2026-05-19 — Elia: /pantry/utilities is for DETAILS
                (name, amount, due day, cadence). "Mark paid" was
                misleading here — payment should come ONLY via the
                request flow (UTL purchase request → reconcile →
                close). The PaymentForm component is preserved
                elsewhere in this file for a future auto-record
                hook from request-close; we just stopped surfacing
                the manual button + form expansion on rows. */}
            <button
              onClick={onEditToggle}
              className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline"
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SeedDefaultsCard({
  familyId, isGuest, existing, currency, fxRate,
}: {
  familyId: string;
  isGuest: boolean;
  existing: Utility[];
  currency: string;
  fxRate: number;
}) {
  // Default-select Family — it's the modal household for this app.
  const [packId, setPackId] = useState<UtilityPack['id'] | null>('family');
  const [helperCount, setHelperCount] = useState<number>(0);
  // Per-helper salary in MAJOR units of the family currency (NumberInput
  // works in major units, not cents). Index = helper position. Grows /
  // shrinks with helperCount, preserving entries the parent already typed.
  const defaultHelperMajor = Math.round(DEFAULT_HELPER_SALARY_USD * fxRate);
  const [helperSalariesMajor, setHelperSalariesMajor] = useState<number[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');

  const selectedPack = useMemo(
    () => UTILITY_PACKS.find((p) => p.id === packId) ?? null,
    [packId],
  );

  const handleCountChange = (n: number) => {
    const next = Math.max(0, Math.min(20, Math.round(n)));
    setHelperCount(next);
    setHelperSalariesMajor((prev) => {
      const out = [...prev];
      while (out.length < next) out.push(defaultHelperMajor);
      out.length = next;
      return out;
    });
  };

  const setHelperSalary = (i: number, value: number) => {
    setHelperSalariesMajor((prev) => {
      const out = [...prev];
      out[i] = Math.max(0, value);
      return out;
    });
  };

  const billCount = selectedPack ? selectedPack.items.length : 0;
  const nothingToSeed = billCount === 0 && helperCount === 0;

  const handleSeed = async () => {
    if (isGuest || nothingToSeed) return;
    setError('');
    setSeeding(true);
    try {
      await seedFromWizard(familyId, existing, {
        pack: selectedPack,
        fxUsdToFamily: fxRate,
        helperSalariesCents: helperSalariesMajor
          .slice(0, helperCount)
          .map((v) => Math.round((v || 0) * 100)),
      });
    } catch (e: any) {
      setError(e?.message || 'Could not seed.');
    }
    setSeeding(false);
  };

  return (
    <div className="bg-pantry-leaf-soft/50 border border-pantry-leaf/40 rounded-hive-lg p-3 lg:p-4">
      <div className="mb-3">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk">
          Quick start · by household size
        </p>
        <p className="font-nunito font-extrabold text-[14px] lg:text-[15px] mt-0.5">
          Pick a pack — we'll seed your utilities in one tap ✨
        </p>
        <p className="text-[11px] text-hive-muted mt-1 leading-snug">
          Default amounts are converted from a USD baseline at today's rate. Adjust per row after seeding.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {UTILITY_PACKS.map((pack) => {
          const selected = pack.id === packId;
          return (
            <button
              key={pack.id}
              type="button"
              onClick={() => setPackId((cur) => (cur === pack.id ? null : pack.id))}
              className={`text-left rounded-hive p-3 transition-colors border bg-hive-paper ${
                selected
                  ? 'border-pantry-leaf ring-2 ring-pantry-leaf/30'
                  : 'border-hive-line hover:border-pantry-leaf/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none shrink-0">{pack.emoji}</span>
                <div className="min-w-0">
                  <p className="font-nunito font-extrabold text-[13px] truncate">{pack.label}</p>
                  <p className="text-[10px] text-hive-muted">{pack.sizeRange}</p>
                </div>
              </div>
              <p className="text-[11px] text-hive-muted mt-2 leading-snug">{pack.description}</p>
              <p className={`mt-2 text-[11px] font-nunito font-extrabold ${
                selected ? 'text-pantry-leaf-dk' : 'text-hive-muted'
              }`}>
                {selected ? `✓ ${pack.items.length} bills selected` : `+ Add ${pack.items.length} bills →`}
              </p>
            </button>
          );
        })}
      </div>

      {/* Helpers · count + per-helper salary inputs. Each helper can
          carry its own budget so the seeded rows are usable on day one. */}
      <div className="mt-3 bg-hive-paper border border-hive-line rounded-hive p-3">
        <div className="flex items-center gap-3">
          <span className="font-nunito font-extrabold text-[13px] flex-1">
            Helper salaries
          </span>
          <NumberInput
            value={helperCount}
            onChange={handleCountChange}
            min={0}
            max={20}
            ariaLabel="Helper count"
            placeholder="0"
            className="w-20 h-9 px-3 bg-hive-cream rounded-[10px] text-center font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
        {helperCount === 0 ? (
          <p className="text-[10px] text-hive-muted mt-1.5">
            How many helpers does the household pay? Each row gets its own salary.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {Array.from({ length: helperCount }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-[8px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-[11px] font-nunito font-black shrink-0">
                  {i + 1}
                </span>
                <span className="text-[11px] font-nunito font-extrabold text-hive-navy w-16 shrink-0">
                  Helper {i + 1}
                </span>
                <span className="font-nunito font-black text-[12px] text-hive-muted">
                  {currency === 'USD' ? '$' : currency}
                </span>
                <NumberInput
                  value={helperSalariesMajor[i] ?? defaultHelperMajor}
                  onChange={(v) => setHelperSalary(i, v)}
                  allowDecimal
                  min={0}
                  ariaLabel={`Helper ${i + 1} salary`}
                  placeholder="0"
                  className="flex-1 h-9 px-3 bg-hive-cream rounded-[10px] font-nunito font-black text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSeed}
        disabled={seeding || isGuest || nothingToSeed}
        className="w-full mt-3 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
      >
        {seeding
          ? 'Seeding…'
          : nothingToSeed
            ? 'Pick a pack or add a helper'
            : `✨ Seed ${seedLabel(billCount, helperCount)}`}
      </button>

      {isGuest && (
        <p className="text-[10px] text-hive-muted text-center mt-2 italic">
          Sign in to save these to your family.
        </p>
      )}
      {error && <p className="text-hive-rose text-[12px] font-bold mt-2 text-center">{error}</p>}
    </div>
  );
}

/** "4 bills" · "4 bills + 2 salaries" · "2 salaries" — composed once
 *  so the seed-button label stays readable. */
function seedLabel(bills: number, helpers: number): string {
  const parts: string[] = [];
  if (bills > 0) parts.push(`${bills} bill${bills === 1 ? '' : 's'}`);
  if (helpers > 0) parts.push(`${helpers} salar${helpers === 1 ? 'y' : 'ies'}`);
  return parts.join(' + ');
}

function PaymentForm({
  familyId, utility, currency, paidByUid, onDone,
}: {
  familyId: string;
  utility: Utility;
  currency: string;
  paidByUid: string;
  onDone: () => void;
}) {
  // Default the amount to the recurring figure so a one-tap save is
  // the common case; parents only touch this when the bill came in
  // higher or lower than expected.
  const [amountMajor, setAmountMajor] = useState<number>(
    utility.lastPaymentCents
      ? utility.lastPaymentCents / 100
      : (utility.amountCents || 0) / 100,
  );
  const [paidAtDate, setPaidAtDate] = useState(todayYmd());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (amountMajor <= 0) { setError('Pick an amount greater than zero.'); return; }
    if (!paidByUid) { setError('Sign-in required to log a payment.'); return; }
    setSaving(true);
    try {
      const paidAtJs = parseYmdLocal(paidAtDate);
      await recordPayment(familyId, utility, {
        amountCents: Math.round(amountMajor * 100),
        paidAt: Timestamp.fromDate(paidAtJs),
        paidBy: paidByUid,
        periodKey: currentPeriodKey(paidAtJs),
        reference: reference.trim(),
        notes: notes.trim(),
      });
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not save payment.');
    }
    setSaving(false);
  };

  return (
    <div className="bg-pantry-leaf-soft/50 border border-pantry-leaf/40 rounded-hive p-3 space-y-2">
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
        Log payment for {periodLabel(currentPeriodKey(parseYmdLocal(paidAtDate)))}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Amount paid</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-nunito font-black text-sm text-hive-muted">{currency === 'USD' ? '$' : currency}</span>
            <NumberInput
              value={amountMajor}
              onChange={setAmountMajor}
              allowDecimal
              min={0}
              ariaLabel="Amount paid"
              placeholder="0"
              className="flex-1 h-9 px-2 bg-hive-paper rounded-[10px] font-nunito font-black text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Paid on</label>
          <input
            type="date"
            value={paidAtDate}
            onChange={(e) => setPaidAtDate(e.target.value)}
            className="w-full mt-1 h-9 px-2 bg-hive-paper rounded-[10px] text-[12px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Reference (optional)</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="receipt or token no."
          maxLength={60}
          className="w-full mt-1 h-9 px-2 bg-hive-paper rounded-[10px] text-[12px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>
      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Notes (optional)</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. paid in cash"
          maxLength={120}
          className="w-full mt-1 h-9 px-2 bg-hive-paper rounded-[10px] text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>
      {error && <p className="text-hive-rose text-[11px] font-bold">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 h-10 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[12px] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : utility.lastPaymentId && utility.lastPaymentPeriodKey === currentPeriodKey(parseYmdLocal(paidAtDate))
            ? 'Update payment'
            : 'Save payment'}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="h-10 px-3 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[11px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function UtilityForm({
  familyId, suppliers, currency, existing, onDone, onDelete,
}: {
  familyId: string;
  suppliers: Supplier[];
  currency: string;
  existing?: Utility;
  onDone: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [category, setCategory] = useState<UtilityCategory>(existing?.category || 'power');
  const [amountMajor, setAmountMajor] = useState<number>(
    existing?.amountCents ? existing.amountCents / 100 : 0,
  );
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence || 'monthly');
  const [dueDay, setDueDay] = useState<number>(existing?.dueDay || 0);
  const [accountRef, setAccountRef] = useState(existing?.accountRef || '');
  const [supplierId, setSupplierId] = useState<string>(existing?.preferredSupplierId || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  // Auto-request defaults ON for new bills (the whole point) — but
  // only meaningful for the cadences the generator handles in v1.
  const [autoRequest, setAutoRequest] = useState<boolean>(existing?.autoRequest ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isSalary = category === 'salary';
  // Auto-request only fires for monthly + 2×-a-month in v1.
  const autoEligible = cadence === 'monthly' || cadence === 'semimonthly';

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Pick a name.'); return; }
    setSaving(true);
    try {
      // Empty optionals are stored as 0 / '' (never undefined) so the
      // Firestore client write never trips on an unsupported value.
      const payload = {
        name: name.trim(),
        category,
        amountCents: amountMajor > 0 ? Math.round(amountMajor * 100) : 0,
        cadence,
        dueDay: dueDay > 0 ? Math.min(31, Math.round(dueDay)) : 0,
        accountRef: accountRef.trim(),
        preferredSupplierId: supplierId,
        notes: notes.trim(),
        active: true,
        // Auto-request only stored as true when the cadence supports it
        // (monthly / 2× a month) AND a salary row never auto-requests.
        autoRequest: autoEligible && !isSalary ? autoRequest : false,
      };
      if (existing) {
        await updateUtility(familyId, existing.id, payload);
      } else {
        await addUtility(familyId, payload);
      }
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    }
    setSaving(false);
  };

  return (
    <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 mb-3 space-y-3">
      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          {isSalary ? 'Helper name / role' : 'Bill name'}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isSalary ? 'e.g. Mama Asha — house help' : 'e.g. Power (TANESCO)'}
          maxLength={80}
          autoFocus
          className="w-full mt-1 h-11 px-3 bg-hive-cream rounded-[12px] text-[15px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Category</label>
        <div className="flex flex-wrap gap-1.5">
          {UTILITY_CATEGORIES.filter((c) => c.id !== 'salary').map((c) => {
            const sel = category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  sel ? 'bg-pantry-leaf text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                }`}
              >
                {c.emoji} {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          {isSalary ? 'Salary amount' : 'Bill amount'}
        </label>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="font-nunito font-black text-base text-hive-muted">{currency === 'USD' ? '$' : currency}</span>
          <NumberInput
            value={amountMajor}
            onChange={setAmountMajor}
            allowDecimal
            min={0}
            ariaLabel="Amount"
            placeholder="0"
            className="flex-1 h-10 px-3 bg-hive-cream rounded-[12px] font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Cadence</label>
        <div className="flex flex-wrap gap-1.5">
          {CADENCES.map((c) => {
            const sel = cadence === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCadence(c.id)}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  sel ? 'bg-pantry-leaf text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Due day</label>
          <NumberInput
            value={dueDay}
            onChange={setDueDay}
            min={0}
            max={31}
            ariaLabel="Day of month the bill is due"
            placeholder="—"
            className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-center font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
            {isSalary ? 'Reference (optional)' : 'Account / meter no. (optional)'}
          </label>
          <input
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
            placeholder={isSalary ? 'e.g. payroll note' : 'e.g. meter 0123456789'}
            maxLength={60}
            className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
      </div>

      {/* Auto-request toggle — only for cadences the generator handles
          (monthly / 2× a month) and never for salary rows. (Utilities v2) */}
      {!isSalary && autoEligible && (
        <button
          type="button"
          onClick={() => setAutoRequest((v) => !v)}
          className={`w-full flex items-center gap-3 rounded-[12px] border p-3 text-left transition-colors ${
            autoRequest ? 'border-hive-blue bg-[#E5EFF8]' : 'border-hive-line bg-hive-cream'
          }`}
        >
          <div className={`w-9 h-5 rounded-full flex-shrink-0 relative transition-colors ${autoRequest ? 'bg-hive-blue' : 'bg-hive-line'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${autoRequest ? 'right-0.5' : 'left-0.5'}`} />
          </div>
          <div className="min-w-0">
            <div className="font-nunito font-extrabold text-[12px] text-hive-ink">⚡ Auto-create request + email me</div>
            <div className="text-[10.5px] text-hive-muted leading-snug">
              On the {dueDay > 0 ? ordinal(dueDay) : 'due day'}{cadence === 'semimonthly' ? ' (1st & 15th)' : ''}, Kaya makes the payment request + emails the parents.
            </div>
          </div>
        </button>
      )}
      {!isSalary && !autoEligible && (
        <p className="text-[10.5px] text-hive-muted leading-snug px-1">
          Auto-request is available on Monthly + 2× a month cadences. This bill still rolls into the budget.
        </p>
      )}

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          {isSalary ? 'Paid via (optional)' : 'Preferred supplier (optional)'}
        </label>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="w-full mt-1 h-10 px-2 bg-hive-cream rounded-[12px] font-nunito font-extrabold text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        >
          <option value="">— none —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {suppliers.length === 0 && (
          <p className="mt-1 text-[10px] text-hive-muted">
            <Link href="/pantry/suppliers" className="text-pantry-leaf-dk font-bold hover:underline">Add a supplier</Link> first to link a provider.
          </p>
        )}
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Notes (optional)</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isSalary ? 'Paid end of month · cash' : 'Prepaid · top up at the kiosk'}
          maxLength={200}
          className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add entry'}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="h-11 px-4 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="h-11 px-3 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-extrabold text-[11px]"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

/** "1st", "2nd", "23rd" — for the due-day label on a row. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Today as YYYY-MM-DD in the user's local timezone — the format the
 *  native <input type="date"> expects. */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD string in local time. Avoids the timezone shift
 *  you get from `new Date('2026-05-15')`, which JS treats as UTC midnight
 *  and may land on the previous day for users east of UTC. */
function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}
