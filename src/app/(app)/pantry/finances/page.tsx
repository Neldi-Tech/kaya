'use client';

// /pantry/finances — Household money roll-up.
//
// Reads every closed PurchaseRequest this month, groups by module
// (Pantry / Outdoor / Drivers — and Utility + Payroll as those ship),
// and shows a per-module spend card + the family total. Parent-only;
// helpers shouldn't see cross-module totals.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, budgetMonthKeyFor,
  MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { subscribeToSpendLedger, type SpendLedgerEntry } from '@/lib/spendLedger';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { subscribeToSubscriptions, type Subscription } from '@/lib/subscriptions';
import { subscribeToContributions, type Contribution } from '@/lib/contributions';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import PerParentTotals from '@/components/household/PerParentTotals';
import TimeRangeFilter from '@/components/finance/TimeRangeFilter';
import {
  type TimeRange, currentMonthRange, monthKeysInRange, monthSpan,
  rangeLabel, rangePeriodWord,
} from '@/lib/timeRange';

const monthKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Every Household money bucket rolled up here. Pantry/Outdoor/Drivers/
// Utility/Payroll/Dine Out/Home come from purchaseRequests; Subscriptions
// + Contributions come from spend_ledger (the server writes ledger
// entries when a sub cycle is marked paid or a contribution is logged).
const LIVE_MODULES: PurchaseModule[] = [
  'pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'dineOut', 'home',
  'subscriptions', 'contributions',
];

const MODULE_HREF: Record<PurchaseModule, string> = {
  pantry:         '/pantry/purchase',
  outdoor:        '/pantry/outdoor',
  drivers:        '/pantry/drivers',
  utility:        '/pantry/utility',
  payroll:        '/pantry/payroll',
  dineOut:        '/pantry/dine-out',
  home:           '/pantry/home',
  subscriptions:  '/household/subscriptions',
  contributions:  '/household/contributions',
};

const MODULE_TINT: Record<PurchaseModule, { card: string; border: string; bar: string }> = {
  pantry:         { card: 'bg-pantry-leaf-soft', border: 'border-pantry-leaf', bar: 'bg-pantry-leaf-dk' },
  outdoor:        { card: 'bg-[#E6F2EC]',        border: 'border-pantry-leaf', bar: 'bg-pantry-leaf' },
  drivers:        { card: 'bg-[#E5EFF8]',        border: 'border-[#B5CFE5]',   bar: 'bg-hive-blue' },
  utility:        { card: 'bg-[#FFF3D9]',        border: 'border-hive-honey',  bar: 'bg-hive-honey-dk' },
  payroll:        { card: 'bg-[#F4EFFB]',        border: 'border-[#C9B8E5]',   bar: 'bg-[#8A6FBF]' },
  dineOut:        { card: 'bg-[#FBEAE0]',        border: 'border-[#E8C3AE]',   bar: 'bg-[#C2562E]' },
  home:           { card: 'bg-[#F6EBDD]',        border: 'border-[#E0C4A3]',   bar: 'bg-[#9B6B3F]' },
  // Subs + Contribs use the Premium pulse-* tokens to match their own
  // surfaces (kept distinct from the leaf-green pantry family).
  subscriptions:  { card: 'bg-pulse-cream',      border: 'border-pulse-navy/20', bar: 'bg-pulse-navy' },
  contributions:  { card: 'bg-pulse-gold/10',    border: 'border-pulse-gold/35', bar: 'bg-pulse-gold' },
};

export default function FinancesPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;

  // Parent-only — bounce helpers back to the Pantry home and render a
  // polite blocker for the brief moment before the redirect fires.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [ledger, setLedger] = useState<SpendLedgerEntry[]>([]);
  // Source collections for the per-parent card — these carry paidByUid
  // (the spend_ledger doesn't yet), so the attribution sum reads them
  // directly. Subs use monthly-equivalent; contributions use this
  // month's actual; purchases use closed-this-month actuals.
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [parents, setParents] = useState<UserProfile[]>([]);
  // Per-parent filter: 'all' | uid | null(=shared).
  const [paidByFilter, setPaidByFilter] = useState<'all' | string | null>('all');
  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent') return;
    const u1 = subscribeToRecentRequests(profile.familyId, setRecent);
    const u2 = subscribeToSpendLedger(profile.familyId, setLedger);
    const u3 = subscribeToSubscriptions(profile.familyId, setSubs);
    const u4 = subscribeToContributions(profile.familyId, setContribs);
    let alive = true;
    getFamilyMembers(profile.familyId).then((m) => {
      if (alive) setParents(m.filter((x) => x.role === 'parent'));
    });
    return () => { u1(); u2(); u3(); u4(); alive = false; };
  }, [profile?.familyId, profile?.role]);

  // Time range — default the current month; parent can switch to a
  // quarter / year / custom span. Everything below filters by the SET of
  // month keys the range spans (see lib/timeRange).
  const [range, setRange] = useState<TimeRange>(() => currentMonthRange());
  const monthSet = useMemo(() => new Set(monthKeysInRange(range)), [range]);
  const closedInRange = useMemo(
    () => recent.filter((r) => {
      if (r.status !== 'closed') return false;
      const k = budgetMonthKeyFor(r);
      return !!k && monthSet.has(k);
    }),
    [recent, monthSet],
  );

  // Ledger entries that fall in the range, EXCLUDING anything tagged
  // isProfessionalExpense — per spec §5 those are work expenses and
  // shouldn't pollute household roll-ups.
  const ledgerInRange = useMemo(
    () => ledger.filter((e) => {
      if (e.isProfessionalExpense) return false;
      const at = e.occurredOn?.toDate?.();
      return !!at && monthSet.has(monthKey(at));
    }),
    [ledger, monthSet],
  );

  // Per-module roll-up — purchaseRequests for the existing 7 modules,
  // spend_ledger for subscriptions + contributions.
  const perModule = useMemo(() => {
    const result: Record<PurchaseModule, { spent: number; cap: number; count: number; over: boolean; pct: number }> = {
      pantry:         { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      outdoor:        { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      drivers:        { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      utility:        { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      payroll:        { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      dineOut:        { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      home:           { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      subscriptions:  { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
      contributions:  { spent: 0, cap: 0, count: 0, over: false, pct: 0 },
    };
    for (const r of closedInRange) {
      const m = (r.module ?? 'pantry') as PurchaseModule;
      if (!result[m]) continue;
      result[m].spent += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
      result[m].count += 1;
    }
    for (const e of ledgerInRange) {
      const m = e.sourceModule as PurchaseModule;
      if (!result[m]) continue;
      result[m].spent += e.amountHousehold || 0;
      result[m].count += 1;
    }
    const budgets = (family?.householdBudgets ?? {}) as Record<string, number | undefined>;
    for (const m of LIVE_MODULES) {
      // Caps live on the family doc as householdBudgets.{module}. New
      // 'subscriptions' / 'contributions' caps work the same — when a
      // parent sets them in /pantry/budget they'll just appear here.
      result[m].cap = budgets[m] ?? 0;
      const { spent, cap } = result[m];
      result[m].over = cap > 0 && spent > cap;
      result[m].pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
    }
    return result;
  }, [closedInRange, ledgerInRange, family?.householdBudgets]);

  // NOTE (2026-05-17): The "Utility Bills · Monthly" rollup card was
  // removed from this page. It double-surfaced utility spend alongside
  // the `utility` PurchaseModule card — two near-identically-named
  // cards both feeding the Household Total, which read as double-
  // counting and inflated the headline cap. The recurring-bills
  // catalogue still lives at /pantry/utilities (planning tool); the
  // `utility` PurchaseModule below covers utility spend in the
  // request→approve→reconcile loop. Household Total now sums the live
  // PurchaseModules only.
  // ── Per-parent attribution (2026-05-30) ──────────────────────────
  // Flat list of attributable items this month, read from the SOURCE
  // collections (paidByUid lives there, not on the ledger). Each carries
  // a paidByUid (null = Shared). Subs contribute their monthly-equivalent
  // (the recurring commitment); contributions + purchases their actuals.
  type AttribItem = { id: string; label: string; sub: string; cents: number; paidByUid: string | null };
  const months = monthSpan(range);
  const attributable = useMemo<AttribItem[]>(() => {
    const out: AttribItem[] = [];
    for (const r of closedInRange) {
      out.push({
        id: `p_${r.id}`,
        label: r.name || 'Purchase',
        sub: MODULE_LABEL[(r.module ?? 'pantry') as PurchaseModule] ?? 'Purchase',
        cents: r.actualTotalCents ?? r.estimatedTotalCents ?? 0,
        paidByUid: r.paidByUid ?? null,
      });
    }
    for (const s of subs) {
      if (s.status === 'cancelled' || s.status === 'paused') continue;
      if (s.isProfessionalExpense) continue;
      // Monthly commitment × number of months in the range.
      out.push({
        id: `s_${s.id}`,
        label: s.name,
        sub: months > 1 ? `Subscription · ${months}× monthly equiv.` : 'Subscription · monthly equiv.',
        cents: (s.monthlyEquivalent || 0) * months,
        paidByUid: s.paidByUid ?? null,
      });
    }
    for (const c of contribs) {
      const at = c.dateGiven?.toDate?.();
      if (!at || !monthSet.has(monthKey(at))) continue;
      out.push({
        id: `c_${c.id}`,
        label: c.recipientName || 'Contribution',
        sub: 'Contribution',
        cents: c.amountHousehold || 0,
        paidByUid: c.paidByUid ?? null,
      });
    }
    return out;
  }, [closedInRange, subs, contribs, monthSet, months]);

  const byUid = useMemo(() => {
    const m: Record<string, number> = { shared: 0 };
    for (const it of attributable) {
      const k = it.paidByUid ?? 'shared';
      m[k] = (m[k] ?? 0) + it.cents;
    }
    return m;
  }, [attributable]);

  // Items matching the active filter (for the drill-down list).
  const filteredAttrib = useMemo(() => {
    if (paidByFilter === 'all') return [];
    return attributable
      .filter((it) => (it.paidByUid ?? null) === paidByFilter && it.cents > 0)
      .sort((a, b) => b.cents - a.cents);
  }, [attributable, paidByFilter]);

  const totalSpent = LIVE_MODULES.reduce((acc, m) => acc + perModule[m].spent, 0);
  const totalCap = LIVE_MODULES.reduce((acc, m) => acc + perModule[m].cap, 0);
  const totalPct = totalCap > 0 ? Math.min(100, Math.round((totalSpent / totalCap) * 100)) : 0;
  const totalOver = totalCap > 0 && totalSpent > totalCap;

  // Polite blocker for non-parents who reach this URL before redirect.
  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Finances is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Household money roll-ups are visible to parents in the family. Ask a parent to share what's relevant.
        </p>
        <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Pantry
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Finances
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {rangeLabel(range)}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Every closed request {rangePeriodWord(range)}, rolled up across Household modules.
        </p>
      </div>

      {/* Time-range filter — month (default) · quarter · year · custom. */}
      <div className="mb-1">
        <TimeRangeFilter
          value={range}
          onChange={setRange}
          countLabel={`${closedInRange.length} closed request${closedInRange.length === 1 ? '' : 's'}`}
        />
      </div>

      {/* Family total */}
      <div className={`mt-4 rounded-hive border p-4 ${
        totalOver ? 'bg-[#FCEAEA] border-[#E8B5B5]' : 'bg-pantry-leaf-soft border-pantry-leaf'
      }`}>
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
          🏡 Household total
        </p>
        <p className="font-nunito font-black text-3xl text-hive-ink mt-1">
          {formatCentsBudgetNeat(totalSpent, currency)}
          <span className="text-hive-muted text-sm font-bold">
            {' '}of {totalCap > 0 ? formatCentsBudgetNeat(totalCap, currency) : '—'}
          </span>
        </p>
        {totalCap > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 bg-white/70 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${totalOver ? 'bg-hive-rose' : 'bg-pantry-leaf-dk'}`}
                style={{ width: `${totalPct}%` }}
              />
            </div>
            <span className={`text-sm font-nunito font-black tabular-nums flex-shrink-0 ${totalOver ? 'text-hive-rose' : 'text-hive-ink'}`}>
              {totalPct}%
            </span>
          </div>
        )}
        <p className="text-[11px] text-hive-muted mt-2 font-bold">
          {closedInRange.length} closed request{closedInRange.length === 1 ? '' : 's'} {rangePeriodWord(range)}
        </p>
      </div>

      {/* Per-parent attribution card — stacked bar + tappable rows.
          Reads source collections (subs / contribs / closed purchases)
          so paidByUid is accurate. Only renders when ≥2 parents +
          some attributable spend exists. */}
      {parents.length >= 1 && (
        <div className="mt-4">
          <PerParentTotals
            byUid={byUid}
            parents={parents}
            format={(c) => formatCentsBudgetNeat(c, currency)}
            selected={paidByFilter}
            onSelect={setPaidByFilter}
            monthLabel={rangeLabel(range)}
          />
          {/* Drill-down — the selected parent's / shared items, biggest
              first. The cost-cutting view: see exactly what's driving
              one person's spend so you can trim the bottom of the list. */}
          {paidByFilter !== 'all' && filteredAttrib.length > 0 && (
            <div className="mt-2 rounded-hive border border-pulse-navy/10 bg-pulse-cream/40 divide-y divide-pulse-navy/8">
              {filteredAttrib.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold text-pulse-navy truncate">{it.label}</div>
                    <div className="text-[10.5px] text-pulse-navy/55">{it.sub}</div>
                  </div>
                  <div className="text-[12.5px] font-extrabold text-pulse-navy tabular-nums shrink-0">
                    {formatCentsBudgetNeat(it.cents, currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {paidByFilter !== 'all' && filteredAttrib.length === 0 && (
            <p className="mt-2 text-[11px] text-hive-muted px-1">
              No attributable items in this bucket yet — tag costs with “Paid by” on each entry.
            </p>
          )}
        </div>
      )}

      {/* Per-module cards */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LIVE_MODULES.map((m) => {
          const { spent, cap, count, over, pct } = perModule[m];
          const tint = MODULE_TINT[m];
          return (
            <Link
              key={m}
              href={MODULE_HREF[m]}
              className={`block rounded-hive border p-4 no-underline text-inherit ${
                over ? 'bg-[#FCEAEA] border-[#E8B5B5]' : `${tint.card} ${tint.border}`
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
                  {MODULE_EMOJI[m]} {MODULE_LABEL[m]}
                </p>
                <span className="text-[10px] text-hive-muted font-bold">
                  {count} {count === 1 ? 'shop' : 'shops'}
                </span>
              </div>
              <p className="font-nunito font-black text-xl text-hive-ink">
                {formatCents(spent, currency)}
                <span className="text-hive-muted text-xs font-bold">
                  {' '}of {cap > 0 ? formatCents(cap, currency) : '—'}
                </span>
              </p>
              {cap > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/70 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${over ? 'bg-hive-rose' : tint.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-[11px] font-nunito font-black tabular-nums flex-shrink-0 ${over ? 'text-hive-rose' : 'text-hive-ink'}`}>
                    {pct}%
                  </span>
                </div>
              )}
              {cap === 0 && (
                <p className="text-[10px] text-hive-muted mt-2 font-bold">
                  Set a cap in <span className="text-pantry-leaf-dk">/pantry/budget</span> →
                </p>
              )}
            </Link>
          );
        })}

      </div>

      {/* Recent closed across all modules */}
      <div className="mt-6">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-2">
          Recent · all modules · {closedInRange.length}
        </p>
        {closedInRange.length === 0 ? (
          <div className="bg-hive-paper border border-hive-line rounded-hive p-5 text-center text-hive-muted text-sm">
            No closed requests {rangePeriodWord(range)} yet. They'll appear here as soon as helpers reconcile shops.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {closedInRange.slice(0, 10).map((r) => {
              const m = (r.module ?? 'pantry') as PurchaseModule;
              const total = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
              return (
                <Link
                  key={r.id}
                  href={`/pantry/purchase/${r.id}`}
                  className="bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
                >
                  <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base">
                    {MODULE_EMOJI[m] ?? '🧾'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{r.name}</div>
                    <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {MODULE_LABEL[m] ?? 'Pantry'} · {r.items.length} items · closed {r.closedAt?.toDate?.().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="font-nunito font-black text-sm text-hive-navy">
                    {formatCents(total, currency)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-hive-muted text-center mt-8 font-bold">
        Subscriptions + Contributions feed in from the new Household modules.
        Professional-tagged subs are excluded from the household roll-up.
      </p>
    </div>
  );
}
