'use client';

// 🧠 "What Kaya learned" — the visible effect of ✕ dismissals (DL PR-B).
// Two variants: `compact` (one line under the /recognition stats) and
// `full` (settings card: counts by reason + who is paused right now).
// Adults only; reads the learning log through the Admin gateway.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { listDismissals } from '@/lib/shineCards';
import { DISMISS_REASONS, RECOGNITION_CHANGED_EVENT, summarizeDismissals, type DismissalRecord } from '@/lib/recognitionDismiss';
import { toDisplayDate } from '@/lib/dates';

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function KayaLearnedLine({ variant = 'compact', className = '' }: { variant?: 'compact' | 'full'; className?: string }) {
  const { profile } = useAuth();
  const { children } = useFamily();
  const familyId = profile?.familyId;
  const [records, setRecords] = useState<DismissalRecord[] | null>(null);

  useEffect(() => {
    if (!familyId || (profile?.role !== 'parent' && profile?.role !== 'helper')) return;
    const load = () => listDismissals(familyId).then(setRecords).catch(() => setRecords([]));
    void load();
    window.addEventListener(RECOGNITION_CHANGED_EVENT, load);
    return () => window.removeEventListener(RECOGNITION_CHANGED_EVENT, load);
  }, [familyId, profile?.role]);

  const summary = useMemo(() => records ? summarizeDismissals(records, Date.now(), 30) : null, [records]);
  const kidName = (id: string) => {
    const k = children.find((c) => c.id === id);
    return k ? `${k.avatarEmoji || '🧒'} ${k.name.split(' ')[0]}` : 'a kid';
  };
  const kindLabel = (kind?: string) =>
    kind === 'best' ? 'best-week' : kind === 'improved' ? 'most-improved' : kind === 'comeback' ? 'comeback'
      : kind === 'leader' ? 'leader crown' : kind === 'coverage' ? 'longest-wait' : kind || 'proposal';

  if (!summary || !records) return null;
  const rememberRoundsView = () => { try { localStorage.setItem('kayaHitMapView', 'rounds'); } catch { /* ignore */ } };

  // Nothing learned yet — stay quiet on the compact line, say it on full.
  if (records.length === 0) {
    if (variant === 'compact') return null;
    return (
      <div className={`rounded-kaya-sm border border-[#B7A6E6] bg-[#F7F4FF] px-3 py-2 ${className}`}>
        <p className="text-[11.5px] font-black">🧠 What Kaya learned from you</p>
        <p className="text-[11px] text-kaya-sand mt-0.5">Nothing yet — when a proposed recognition isn&apos;t right, tap ✕ on it in the round and tell Kaya why. It adjusts what it proposes next.</p>
      </div>
    );
  }

  const counts = DISMISS_REASONS.map((r) => ({ r, n: summary.byCode.get(r.code) || 0 }));
  const pausedKids = new Set(summary.paused.map((p) => p.kidId));

  if (variant === 'compact') {
    const top = counts.filter((c) => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3)
      .map((c) => `${c.n}× ${c.r.emoji} ${c.r.label.toLowerCase()}`).join(' · ');
    return (
      <Link href="/recognition#recognition-hitmap" onClick={rememberRoundsView}
        className={`block rounded-kaya-sm border border-[#B7A6E6] bg-[#F7F4FF] px-3 py-2 text-[11.5px] hover:border-[#6B3FE0] transition-colors ${className}`}>
        🧠 <b>Kaya learned</b> · {summary.total} dismissal{summary.total === 1 ? '' : 's'} in 30 days{top ? ` — ${top}` : ''}
        {pausedKids.size > 0 && <span className="font-extrabold" style={{ color: '#6B3FE0' }}> · {pausedKids.size} kid{pausedKids.size === 1 ? '' : 's'} paused right now</span>}
      </Link>
    );
  }

  return (
    <div className={`rounded-kaya-sm border border-[#B7A6E6] bg-[#F7F4FF] px-3 py-2.5 ${className}`}>
      <p className="text-[11.5px] font-black">🧠 What Kaya learned from you</p>
      <p className="text-[11px] mt-1">
        {counts.map((c) => `${c.r.emoji} ${c.r.label.toLowerCase()} ×${c.n}`).join(' · ')} <span className="text-kaya-sand">(30 days)</span>
      </p>
      {summary.paused.length > 0 ? (
        <p className="text-[11px] mt-1">
          <b>Paused now:</b>{' '}
          {summary.paused.map((p, i) => (
            <span key={`${p.kidId}-${p.kind || 'all'}-${i}`}>
              {i > 0 ? ' · ' : ''}
              {kidName(p.kidId)}{' '}
              {p.clock
                ? `(clock reset ${toDisplayDate(dayKey(p.clock)) || ''})`
                : p.kind
                  ? `(${kindLabel(p.kind)} until ${toDisplayDate(dayKey(p.until || 0)) || ''})`
                  : `(all rounds until ${toDisplayDate(dayKey(p.until || 0)) || ''})`}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-[11px] mt-1 text-kaya-sand">Nobody paused right now.</p>
      )}
      <p className="text-[10px] text-kaya-sand mt-1">Read-only insight — the log is what Kaya proposes from next. <Link href="/recognition#recognition-hitmap" onClick={rememberRoundsView} className="font-black text-kaya-gold hover:underline">See the rounds →</Link></p>
    </div>
  );
}
