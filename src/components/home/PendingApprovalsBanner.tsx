'use client';

// PendingApprovalsBanner — v4-final §02 Step 9, reworked as the Home
// Deck focused bar (HD PR-A, approved 14-Aug-2026).
//
// Collapsed by default: "✅ Approvals · 11 · 🔴 3 urgent". Expanding shows
// URGENT first (categories each parent picks for themselves — saved on
// their user profile) with the normal rest behind a count. Extras:
//   🎯 urgent-only focus toggle (remembered per device)
//   ⏫ aging auto-escalation — any NORMAL item older than 7 days turns
//      urgent by itself so nothing rots at the bottom of a list
//   🧹 cleared-this-week pulse — cleared vs added, the deck's own rhythm
// Sources: purchaseRequests (5 household modules) + Hive approvalRequests
// (kid wallets + reward redeems/chip-ins) + 🎮 pending game plays (NEW —
// "Kid points"). Reward IDEAS are excluded (they have their own inbox on
// Manage Rewards). Renders nothing when nothing is pending.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  subscribeToOpenRequests, MODULE_EMOJI, MODULE_LABEL,
  type PurchaseRequest, type PurchaseModule,
} from '@/lib/purchase';
import { subscribeToPendingGameApprovals } from '@/lib/gamesApprovals';
import type { GamePlay } from '@/lib/games';
import { formatCents } from '@/components/pantry/format';
import { updateUserProfile } from '@/lib/firestore';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

const AGING_URGENT_DAYS = 7;

// The focus categories a parent can mark urgent. Chores approvals have no
// aggregated queue yet (workplan reviews happen in place) — the category
// system extends the moment one lands.
const CATEGORIES: Array<{ id: string; emoji: string; label: string }> = [
  { id: 'kidpoints', emoji: '🎮', label: 'Kid points' },
  { id: 'kidfunds',  emoji: '🪙', label: 'Kid fund requests' },
  { id: 'redeems',   emoji: '🎁', label: 'Reward redeems' },
  { id: 'business',  emoji: '🌳', label: 'Kid business' },
  { id: 'pantry',    emoji: '🛒', label: 'Pantry' },
  { id: 'utility',   emoji: '⚡', label: 'Utilities' },
  { id: 'outdoor',   emoji: '🌿', label: 'Outdoor' },
  { id: 'drivers',   emoji: '🚗', label: 'Drivers' },
  { id: 'payroll',   emoji: '💼', label: 'Payroll' },
];
const DEFAULT_URGENT = ['kidpoints', 'kidfunds'];

const HIVE_TYPE_LABEL: Record<string, string> = {
  hp_to_honey: 'HP → Honey',
  cash_out:    'Cash out',
  spend:       'Spend',
  treasury_to_cash: 'Withdraw',
  reward_redeem: 'Reward',
  reward_contribute: 'Chip-in',
};

interface UnifiedRow {
  key: string;
  category: string;
  chipEmoji: string;
  chipLabel: string;
  title: string;
  subtitle: string;
  createdAtMs: number;
  href: string;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function hiveCategory(type: string): string {
  if (type === 'reward_redeem' || type === 'reward_contribute') return 'redeems';
  if (type.startsWith('business_') || type === 'investment_buy' || type === 'investment_sell' || type === 'capital_injection' || type === 'neighbours_unlock') return 'business';
  return 'kidfunds';
}

export default function PendingApprovalsBanner() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const { pendingApprovals: hivePending, config } = useHive();
  const currency = config.currency;
  const fmt = (cents: number | undefined): string | null =>
    cents == null ? null : formatCents(cents, currency);

  const [purchaseOpen, setPurchaseOpen] = useState<PurchaseRequest[]>([]);
  const [gamePlays, setGamePlays] = useState<GamePlay[]>([]);
  useEffect(() => {
    if (!family) return;
    const unsub = subscribeToOpenRequests(family.id, setPurchaseOpen);
    const unsub2 = subscribeToPendingGameApprovals(family.id, setGamePlays);
    return () => { unsub(); unsub2(); };
  }, [family]);

  // ── Per-parent urgency choices + per-device view state ──────────
  const [urgentCats, setUrgentCats] = useState<string[]>(DEFAULT_URGENT);
  useEffect(() => {
    if (profile?.approvalUrgentCategories) setUrgentCats(profile.approvalUrgentCategories);
  }, [profile?.approvalUrgentCategories]);
  const toggleCat = (id: string) => {
    const next = urgentCats.includes(id) ? urgentCats.filter((c) => c !== id) : [...urgentCats, id];
    setUrgentCats(next);
    if (profile) void updateUserProfile(profile.uid, { approvalUrgentCategories: next }).catch(() => {});
  };
  const [open, setOpen] = useState(false);
  // FX PR-1 — three filters: all | urgent (chosen cats) | aging (>7d rest).
  const [focus, setFocusState] = useState<'all' | 'urgent' | 'aging'>(() => {
    try {
      const v = localStorage.getItem('kayaApprovalsFocus');
      return v === 'urgent' || v === 'aging' ? v : 'all';
    } catch { return 'all'; }
  });
  const setFocus = (v: 'all' | 'urgent' | 'aging') => {
    setFocusState(v);
    try { localStorage.setItem('kayaApprovalsFocus', v); } catch { /* ignore */ }
  };
  const [showNormal, setShowNormal] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // ── 🧹 cleared-this-week pulse (one-shot reads, best-effort) ────
  const [pulse, setPulse] = useState<{ cleared: number; added: number } | null>(null);
  useEffect(() => {
    if (!family) return;
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekMs = monday.getTime();
    (async () => {
      try {
        const [hiveResolved, purchasesClosed] = await Promise.all([
          getDocs(query(collection(db, 'families', family.id, 'approvalRequests'), where('status', 'in', ['approved', 'rejected']))),
          getDocs(query(collection(db, 'families', family.id, 'purchaseRequests'), where('status', '==', 'closed'))),
        ]);
        const cleared =
          hiveResolved.docs.filter((d) => ((d.data() as { resolvedAt?: { toMillis?: () => number } }).resolvedAt?.toMillis?.() ?? 0) >= weekMs).length +
          purchasesClosed.docs.filter((d) => ((d.data() as { closedAt?: { toMillis?: () => number } }).closedAt?.toMillis?.() ?? 0) >= weekMs).length;
        setPulse({ cleared, added: 0 });
      } catch { setPulse(null); }
    })();
  }, [family]);

  // ── Unified rows ────────────────────────────────────────────────
  const rows = useMemo<UnifiedRow[]>(() => {
    const out: UnifiedRow[] = [];
    for (const r of purchaseOpen) {
      if (r.status !== 'pending_approval' && r.status !== 'pending_close') continue;
      const itemCount = r.items?.length ?? 0;
      const isCloseReview = r.status === 'pending_close';
      const amount = fmt(isCloseReview ? (r.actualTotalCents ?? r.estimatedTotalCents) : r.estimatedTotalCents);
      const itemLabel = itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : null;
      const reviewTag = isCloseReview ? 'Reconciled — review' : null;
      out.push({
        key: `p:${r.id}`,
        category: r.module as PurchaseModule,
        chipEmoji: MODULE_EMOJI[r.module],
        chipLabel: MODULE_LABEL[r.module],
        title: r.name || `${MODULE_LABEL[r.module]} request`,
        subtitle: [reviewTag, amount, itemLabel].filter(Boolean).join(' · ') || 'No items',
        createdAtMs: r.createdAt?.toMillis?.() ?? 0,
        href: `/pantry/purchase/${r.id}`,
      });
    }
    for (const a of hivePending) {
      if (a.type === 'reward_proposal') continue; // 💡 ideas live in Manage Rewards
      const kidName = children.find((c) => c.id === a.kidId)?.name ?? 'Kid';
      const typeLabel = HIVE_TYPE_LABEL[a.type] ?? a.type;
      const amount = fmt(a.amountCents);
      out.push({
        key: `h:${a.id}`,
        category: hiveCategory(a.type),
        chipEmoji: a.type === 'reward_redeem' || a.type === 'reward_contribute' ? '🎁' : '🍯',
        chipLabel: typeLabel,
        title: a.description || `${typeLabel} request`,
        subtitle: amount ? `${kidName} · ${amount}` : kidName,
        createdAtMs: a.createdAt?.toMillis?.() ?? 0,
        href: '/parent/approvals',
      });
    }
    for (const g of gamePlays) {
      const kidName = g.kidName || children.find((c) => c.id === g.kidId)?.name || 'Kid';
      out.push({
        key: `g:${g.id}`,
        category: 'kidpoints',
        chipEmoji: '🎮',
        chipLabel: 'Kid points',
        title: `${g.gameName || 'Game win'} — HP to approve`,
        subtitle: kidName,
        createdAtMs: (g.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0,
        href: '/games/approvals',
      });
    }
    out.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return out;
  }, [purchaseOpen, hivePending, gamePlays, children, currency]);

  if (rows.length === 0) return null;

  // Three buckets (FX PR-1 — aging no longer floods urgent):
  //   🔴 urgent = the categories THIS parent chose. Nothing else.
  //   ⏫ aging  = everything else older than the escalation threshold —
  //              its own section, clearly separate.
  //   normal   = the rest.
  const isAged = (r: UnifiedRow) =>
    r.createdAtMs > 0 && Date.now() - r.createdAtMs > AGING_URGENT_DAYS * 86_400_000;
  const urgent = rows.filter((r) => urgentCats.includes(r.category));
  const aging = rows.filter((r) => !urgentCats.includes(r.category) && isAged(r));
  const normal = rows.filter((r) => !urgentCats.includes(r.category) && !isAged(r));

  const Row = ({ r, aged }: { r: UnifiedRow; aged?: boolean }) => (
    <li>
      <button
        type="button"
        onClick={() => router.push(r.href)}
        className="w-full text-left bg-white hover:bg-hive-cream/60 border border-hive-line rounded-hive p-2.5 flex items-center gap-2.5 transition-colors"
      >
        <span className="text-[10px] font-nunito font-extrabold uppercase tracking-wider px-2 py-1 rounded-full bg-hive-cream border border-hive-line flex-shrink-0 inline-flex items-center gap-1">
          <span className="text-sm leading-none">{r.chipEmoji}</span>
          <span className="hidden sm:inline">{r.chipLabel}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-nunito font-extrabold text-[13px] text-hive-ink truncate">{r.title}</p>
          <p className="text-[11px] text-hive-muted truncate">{r.subtitle}</p>
        </div>
        <span className={`text-[10px] font-bold flex-shrink-0 ${aged ? 'text-[#c23b52]' : 'text-hive-muted'}`}>
          {aged ? '⏫ ' : ''}{timeAgo(r.createdAtMs)}
        </span>
      </button>
    </li>
  );

  return (
    <div className="bg-[#FFF3D9] border-2 border-hive-honey rounded-hive-lg p-3 lg:p-4 mb-5 lg:mb-6">
      {/* Collapsed line — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
          ✅ Approvals · {rows.length}
          {urgent.length > 0 && <span className="text-[#c23b52]"> · 🔴 {urgent.length} urgent</span>}
          {aging.length > 0 && <span className="text-[#b06a1f]"> · ⏫ {aging.length} aging</span>}
        </p>
        <span className="text-[11px] font-nunito font-extrabold text-hive-honey-dk">{open ? 'close ▴' : 'open ▾'}</span>
      </button>

      {open && (
        <div className="mt-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            {([['all', 'All', ''], ['urgent', `🔴 Urgent${urgent.length ? ` · ${urgent.length}` : ''}`, '#c23b52'], ['aging', `⏫ Aging${aging.length ? ` · ${aging.length}` : ''}`, '#b06a1f']] as const).map(([id, label, color]) => (
              <button key={id} type="button" onClick={() => setFocus(id)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-nunito font-extrabold border ${focus === id
                  ? (color ? 'text-white border-transparent' : 'bg-hive-ink text-white border-transparent')
                  : 'bg-white text-hive-muted border-hive-line'}`}
                style={focus === id && color ? { background: color } : {}}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setShowConfig((v) => !v)}
              className="ml-auto text-[10.5px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
              ⚙️ what&apos;s urgent?
            </button>
          </div>

          {showConfig && (
            <div className="bg-white border border-dashed border-hive-line rounded-hive p-2.5 mb-2">
              <p className="text-[10px] font-nunito font-extrabold text-hive-muted mb-1.5">
                Tap a category to make it 🔴 urgent for YOU (each parent chooses their own). Anything older than {AGING_URGENT_DAYS} days escalates by itself ⏫.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggleCat(c.id)}
                    className={`px-2.5 py-1 rounded-full text-[10.5px] font-nunito font-extrabold border ${urgentCats.includes(c.id) ? 'bg-[#FDE9EC] border-[#f2b9c2] text-[#c23b52]' : 'bg-white border-hive-line text-hive-muted'}`}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 🔴 Urgent — ONLY the parent's chosen categories. */}
          {focus !== 'aging' && urgent.length > 0 && (
            <ul className="space-y-1.5">
              {urgent.map((r) => <Row key={r.key} r={r} />)}
            </ul>
          )}
          {focus === 'urgent' && urgent.length === 0 && (
            <p className="text-[11px] text-hive-muted font-bold text-center py-1.5">Nothing urgent in your chosen categories — nice. 🎈</p>
          )}

          {/* ⏫ Aging — its own clearly-labelled section, never mixed in. */}
          {focus !== 'urgent' && aging.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-[#b06a1f] mb-1">
                ⏫ Aging — sitting longer than {AGING_URGENT_DAYS} days
              </p>
              <ul className="space-y-1.5">
                {aging.map((r) => <Row key={r.key} r={r} aged />)}
              </ul>
            </div>
          )}
          {focus === 'aging' && aging.length === 0 && (
            <p className="text-[11px] text-hive-muted font-bold text-center py-1.5">Nothing aging — the deck is fresh. 🌿</p>
          )}

          {/* Normal — behind a per-module count. */}
          {focus === 'all' && normal.length > 0 && (
            showNormal ? (
              <ul className="space-y-1.5 mt-1.5">
                {normal.map((r) => <Row key={r.key} r={r} />)}
              </ul>
            ) : (
              <button type="button" onClick={() => setShowNormal(true)}
                className="w-full mt-1.5 bg-white/70 border border-hive-line rounded-hive p-2 text-[11px] font-nunito font-extrabold text-hive-muted">
                {normal.length} normal — {Object.entries(normal.reduce((m, r) => { m[r.chipLabel] = (m[r.chipLabel] || 0) + 1; return m; }, {} as Record<string, number>)).map(([l, n]) => `${l} ×${n}`).join(' · ')} · show ▾
              </button>
            )
          )}

          {pulse && pulse.cleared > 0 && (
            <p className="text-[10px] text-hive-muted text-center mt-2 font-bold">
              🧹 You cleared {pulse.cleared} this week — keep the deck shrinking 👏
            </p>
          )}
        </div>
      )}
    </div>
  );
}
