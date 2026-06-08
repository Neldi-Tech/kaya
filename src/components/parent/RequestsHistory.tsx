'use client';

// RequestsHistory — the parent Requests "History" tab (Fix 1 · 2026-06-08).
//
// Every DECIDED request, on record: salaries, house points, pantry, top-ups.
// Unifies two collections the parent already acts on —
//   • Household purchaseRequests  (closed / rejected)   → salaries, pantry…
//   • Hive approvalRequests       (approved / rejected) → kid wallet items
// — into one newest-first list. Each row shows WHO requested (or ⚙ Auto for
// system-generated salaries), WHO approved/rejected, the date & time, and a
// status pill. Filter by type + search to catch duplicates / repeats.
//
// Read-only — no mutations here. The data already persists; this is the view
// that was missing.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
  type PurchaseRequest, type PurchaseModule,
} from '@/lib/purchase';
import { subscribeToResolvedApprovals, type ApprovalRequest } from '@/lib/hive';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { formatCents } from '@/components/pantry/format';

type Outcome = 'approved' | 'rejected';

interface HistoryRow {
  key: string;
  href: string;
  chipEmoji: string;
  chipLabel: string;
  /** filter bucket: a PurchaseModule, or 'hive' */
  bucket: PurchaseModule | 'hive';
  title: string;
  amount: string | null;
  /** "⚙ Auto" or "Requested by Seif (helper)" */
  requestedBy: string;
  auto: boolean;
  /** "approved by You" / "rejected by You" */
  decidedBy: string;
  outcome: Outcome;
  whenMs: number;
}

/** "24 May 09:02" — compact date + time. */
function fmtWhen(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

const HIVE_TYPE_LABEL: Record<string, string> = {
  hp_to_honey: 'HP → Honey', cash_out: 'Cash out', spend: 'Spend',
};

export default function RequestsHistory() {
  const router = useRouter();
  const { family, children } = useFamily();
  const { config } = useHive();
  const currency = config.currency;

  const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
  const [hive, setHive] = useState<ApprovalRequest[]>([]);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [bucket, setBucket] = useState<PurchaseModule | 'hive' | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!family) return;
    const u1 = subscribeToRecentRequests(family.id, setPurchases);
    const u2 = subscribeToResolvedApprovals(family.id, setHive);
    return () => { u1(); u2(); };
  }, [family]);

  useEffect(() => {
    if (!family) return;
    let alive = true;
    getFamilyMembers(family.id).then((m) => { if (alive) setMembers(m); }).catch(() => {});
    return () => { alive = false; };
  }, [family]);

  // uid → display name. Parents/helpers come from members; kids from children.
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.uid, (m.displayName || m.email || 'Parent').split(' ')[0]);
    for (const c of children) map.set(c.id, c.name);
    return (uid: string | undefined): string => {
      if (!uid) return 'someone';
      return map.get(uid) ?? 'someone';
    };
  }, [members, children]);

  const fmt = (cents: number | null | undefined) => (cents == null ? null : formatCents(cents, currency));

  const rows = useMemo<HistoryRow[]>(() => {
    const out: HistoryRow[] = [];

    for (const r of purchases) {
      const auto = r.generatedBy === 'system';
      const outcome: Outcome = r.status === 'rejected' ? 'rejected' : 'approved';
      const decider = outcome === 'rejected' ? r.rejectedBy : (r.approvedBy?.[0]);
      const whenMs = (r.closedAt?.toMillis?.() ?? r.approvedAt?.toMillis?.() ?? r.createdAt?.toMillis?.() ?? 0);
      const requestedBy = auto
        ? '⚙ Auto'
        : `Requested by ${nameOf(r.createdBy)}${r.createdByRole === 'helper' ? ' · helper' : ''}`;
      out.push({
        key: `p:${r.id}`,
        href: `/pantry/purchase/${r.id}`,
        chipEmoji: MODULE_EMOJI[r.module],
        chipLabel: MODULE_LABEL[r.module],
        bucket: r.module,
        title: r.name || `${MODULE_LABEL[r.module]} request`,
        amount: fmt(r.actualTotalCents ?? r.estimatedTotalCents),
        requestedBy,
        auto,
        decidedBy: `${outcome === 'rejected' ? 'rejected' : 'approved'} by ${nameOf(decider)}`,
        outcome,
        whenMs,
      });
    }

    for (const a of hive) {
      const outcome: Outcome = a.status === 'rejected' ? 'rejected' : 'approved';
      const whenMs = (a.resolvedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0);
      const typeLabel = HIVE_TYPE_LABEL[a.type] ?? a.type;
      out.push({
        key: `h:${a.id}`,
        href: '/parent/approvals',
        chipEmoji: '🍯',
        chipLabel: `Hive · ${typeLabel}`,
        bucket: 'hive',
        title: a.description || `${typeLabel} request`,
        amount: fmt(a.amountCents),
        requestedBy: `Requested by ${nameOf(a.createdBy)}`,
        auto: false,
        decidedBy: `${outcome === 'rejected' ? 'rejected' : 'approved'} by ${nameOf(a.resolvedBy)}`,
        outcome,
        whenMs,
      });
    }

    out.sort((x, y) => y.whenMs - x.whenMs);
    return out;
  }, [purchases, hive, nameOf, currency]);

  // How many times each title appears — surfaces repeats ("3rd time").
  const repeatCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.title, (c.get(r.title) ?? 0) + 1);
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (bucket !== 'all' && r.bucket !== bucket) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, bucket, search]);

  // Build the filter chips from buckets actually present.
  const chips = useMemo(() => {
    const present = new Set(rows.map((r) => r.bucket));
    const list: { id: PurchaseModule | 'hive'; label: string; emoji: string }[] = [];
    if (present.has('payroll')) list.push({ id: 'payroll', label: 'Salary', emoji: MODULE_EMOJI.payroll });
    (['pantry', 'outdoor', 'drivers', 'utility', 'dineOut', 'home', 'subscriptions', 'contributions'] as PurchaseModule[]).forEach((m) => {
      if (present.has(m)) list.push({ id: m, label: MODULE_LABEL[m], emoji: MODULE_EMOJI[m] });
    });
    if (present.has('hive')) list.push({ id: 'hive', label: 'Hive', emoji: '🍯' });
    return list;
  }, [rows]);

  return (
    <div>
      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search requests…"
        className="w-full bg-hive-paper border border-hive-line rounded-hive px-3.5 py-2.5 text-[13px] font-lato focus:outline-none focus:border-hive-honey mb-3"
      />

      {/* Type filter chips */}
      {chips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
          <Chip active={bucket === 'all'} onClick={() => setBucket('all')}>All</Chip>
          {chips.map((c) => (
            <Chip key={c.id} active={bucket === c.id} onClick={() => setBucket(c.id)}>
              <span className="mr-1">{c.emoji}</span>{c.label}
            </Chip>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-3xl mb-2">🗂️</div>
          <p className="font-nunito font-extrabold text-[14px]">No decided requests yet</p>
          <p className="text-hive-muted text-[12px] mt-1">Approved &amp; rejected requests land here for the record.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const repeats = repeatCount.get(r.title) ?? 1;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => router.push(r.href)}
                  className="w-full text-left bg-hive-paper hover:bg-hive-cream/60 border border-hive-line rounded-hive p-3 flex items-start gap-2.5 transition-colors"
                >
                  <span className="w-9 h-9 rounded-hive bg-hive-cream border border-hive-line flex items-center justify-center text-lg flex-shrink-0">
                    {r.chipEmoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-nunito font-extrabold text-[13.5px] text-hive-ink truncate">{r.title}</p>
                    <p className="text-[11px] text-hive-muted leading-relaxed">
                      {r.auto ? <span className="text-hive-blue font-bold">{r.requestedBy}</span> : r.requestedBy}
                      <br />
                      {r.decidedBy} · {fmtWhen(r.whenMs)}
                      {repeats > 1 && <span className="text-hive-honey-dk font-bold"> · {ordinal(repeats)} time</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {r.amount && <p className="font-nunito font-extrabold text-[13px] text-hive-ink">{r.amount}</p>}
                    <StatusPill outcome={r.outcome} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] font-nunito font-extrabold transition-colors ${
        active ? 'bg-hive-navy text-hive-cream border-hive-navy' : 'bg-hive-paper text-hive-navy border-hive-line hover:border-hive-honey'
      }`}
    >
      {children}
    </button>
  );
}

function StatusPill({ outcome }: { outcome: Outcome }) {
  const cls = outcome === 'rejected'
    ? 'bg-hive-rose/12 text-hive-rose border-hive-rose/40'
    : 'bg-hive-green/12 text-hive-green border-hive-green/40';
  return (
    <span className={`inline-block mt-1 rounded-full border px-2 py-0.5 text-[9.5px] font-nunito font-extrabold ${cls}`}>
      {outcome === 'rejected' ? 'Rejected' : 'Approved'}
    </span>
  );
}

/** 1→1st, 2→2nd, 3→3rd, 4→4th… */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
