'use client';
// 👑 Leader of the Week — Parent Home card (S5 in the approved design):
//   • adult won the wheel → "who is House Leader this week?" appoint chips
//   • a kid wears the crown → week card: day N of 7 · 📒 notes pending ·
//     mission · End / hand over · Guide
//   • no leader, nothing pending → quiet "👑 Appoint a Leader of the Week"
// Parents only (helpers see the LeaderCrownChip instead). Reads the family
// doc from context; all writes go through the /api/leader gateway.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFamily } from '@/contexts/FamilyContext';
import { useAuth } from '@/contexts/AuthContext';
import { readLeaderConfig, termDayNumber, termWeekNumber } from '@/lib/leaderWeek.shared';
import { appointLeader, endLeaderTerm, listLeaderNotes, listLeaderTerms, leaderErrorText } from '@/lib/leaderWeek';
import { participatesInMeetings } from '@/lib/participation';
import LeaderGuideSheet from './LeaderGuideSheet';

export default function LeaderHomeCard({ className = '' }: { className?: string }) {
  const { family, children, refresh } = useFamily();
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [guide, setGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const cfg = readLeaderConfig(family);
  const hl = family?.houseLeader || null;
  const pending = family?.leaderAppointPending || null;
  const isParent = profile?.role === 'parent';

  const eligible = useMemo(
    () => (children || []).filter((c) => participatesInMeetings(c, family)),
    [children, family],
  );

  useEffect(() => {
    if (!family?.id || !isParent || !hl) { setPendingCount(null); return; }
    let alive = true;
    listLeaderNotes(family.id, { status: 'pending' })
      .then((r) => { if (alive) setPendingCount(r.notes.filter((n) => n.termId === hl.termId).length); })
      .catch(() => { if (alive) setPendingCount(null); });
    return () => { alive = false; };
  }, [family?.id, hl?.termId, hl, isParent]);

  useEffect(() => {
    if (!family?.id || !isParent || hl || (!pending && eligible.length === 0)) return;
    let alive = true;
    listLeaderTerms(family.id)
      .then((r) => {
        if (!alive) return;
        const m: Record<string, number> = {};
        r.lifetime.forEach((l) => { m[l.childId] = l.selected; });
        setSelected(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [family?.id, isParent, hl, pending, eligible.length]);

  if (!family || !isParent || !cfg.enabled) return null;

  const appoint = async (childId: string) => {
    setBusy(childId); setError(null);
    try {
      await appointLeader(family.id, childId);
      await refresh();
    } catch (e) {
      setError(leaderErrorText((e as { code?: string }).code));
    } finally { setBusy(null); }
  };
  const endTerm = async () => {
    setBusy('end'); setError(null);
    try {
      await endLeaderTerm(family.id);
      setConfirmEnd(false);
      await refresh();
    } catch (e) {
      setError(leaderErrorText((e as { code?: string }).code));
    } finally { setBusy(null); }
  };

  // ── A kid wears the crown ───────────────────────────────────────
  if (hl) {
    const day = termDayNumber(hl.startAt);
    const week = termWeekNumber(hl.startAt);
    const first = hl.name.split(' ')[0];
    const longTerm = day > 21;
    return (
      <div className={`rounded-2xl border px-4 py-3.5 ${className}`} style={{ background: 'linear-gradient(135deg,#FFF7E5,#FFE9C4)', borderColor: '#E9C867' }}>
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none" aria-hidden>{hl.emoji || '👑'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px]" style={{ color: '#B8860B' }}>👑 Leader of the Week</p>
            <p className="text-[14px] font-nunito font-black text-[#4a3a18] leading-snug">
              {first} · day {Math.min(day, 7)} of 7{week > 1 ? <span className="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: '#fff', color: '#B8860B' }}>week {week}</span> : null}
            </p>
            <p className="text-[11.5px] font-bold text-[#6b5a2a] mt-0.5">
              📒 {pendingCount === null ? 'Notebook' : pendingCount === 0 ? 'no notes waiting' : `${pendingCount} note${pendingCount === 1 ? '' : 's'} waiting for you`}
              {pendingCount ? <Link href="/parent/leader" className="ml-1 underline font-black" style={{ color: '#B8860B' }}>review →</Link> : null}
            </p>
            {longTerm && (
              <p className="text-[11px] font-black mt-1" style={{ color: '#B8860B' }}>⏳ {first} has led for {week} weeks — hand over?</p>
            )}
            {error && <p className="text-[11px] font-bold text-red-600 mt-1">{error}</p>}
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Link href="/parent/leader" className="px-3 py-1.5 rounded-full text-[11.5px] font-black text-white" style={{ background: '#B8860B' }}>👑 Leader hub</Link>
              <button type="button" onClick={() => setGuide(true)} className="px-3 py-1.5 rounded-full text-[11.5px] font-black bg-white border" style={{ color: '#B8860B', borderColor: '#E9C867' }}>📖 Guide</button>
              {!confirmEnd ? (
                <button type="button" onClick={() => setConfirmEnd(true)} className="px-3 py-1.5 rounded-full text-[11.5px] font-black bg-white border" style={{ color: '#8A6800', borderColor: '#E9C867' }}>End / hand over</button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-black">
                  <span className="text-[#6b5a2a]">End {first}&apos;s week now?</span>
                  <button type="button" disabled={busy === 'end'} onClick={endTerm} className="px-2.5 py-1 rounded-full text-white" style={{ background: '#B8860B' }}>{busy === 'end' ? '…' : 'Yes, seal it'}</button>
                  <button type="button" onClick={() => setConfirmEnd(false)} className="px-2.5 py-1 rounded-full bg-white border" style={{ borderColor: '#E9C867', color: '#8A6800' }}>Keep</button>
                </span>
              )}
            </div>
          </div>
        </div>
        <LeaderGuideSheet open={guide} onClose={() => setGuide(false)} isLeader={false} leaderName={hl.name} />
      </div>
    );
  }

  // ── Nobody crowned ──────────────────────────────────────────────
  if (eligible.length === 0 || dismissed) return null;
  const adultName = pending?.byName ? pending.byName.split(' ')[0] : '';
  const meetingLeaderIsMe = family.nextMeetingLeader?.kind === 'parent' && family.nextMeetingLeader.id === profile?.uid;
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${className}`} style={{ background: pending ? 'linear-gradient(135deg,#FFF7E5,#FFE9C4)' : '#FFFDF7', borderColor: '#E9C867' }}>
      <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px]" style={{ color: '#B8860B' }}>👑 Leader of the Week</p>
      <p className="text-[14px] font-nunito font-black text-[#4a3a18] leading-snug mt-0.5">
        {pending
          ? (meetingLeaderIsMe ? 'You’re leading next Sunday — who is House Leader this week?' : `${adultName || 'A parent'} is leading next Sunday — who is House Leader this week?`)
          : 'Appoint a Leader of the Week'}
      </p>
      <p className="text-[11.5px] font-bold text-[#6b5a2a] mt-0.5">
        {pending ? 'The meeting picked an adult. Pick a kid to wear the crown Mon–Sun.' : 'The wheel crowns a kid automatically each Sunday — or pick one now.'}
      </p>
      {error && <p className="text-[11px] font-bold text-red-600 mt-1">{error}</p>}
      <div className="flex flex-wrap gap-2 mt-2.5">
        {eligible.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy !== null}
            onClick={() => appoint(c.id)}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-black bg-white border disabled:opacity-60"
            style={{ color: '#6b5a2a', borderColor: '#E9C867' }}
          >
            {busy === c.id ? '…' : `${c.avatarEmoji || '🧒'} ${c.name.split(' ')[0]}`}
            <span className="ml-1 text-[10px] font-black" style={{ color: '#B8860B' }}>· led {selected[c.id] || 0}×</span>
          </button>
        ))}
        {!pending && (
          <button type="button" onClick={() => setDismissed(true)} className="px-3 py-1.5 rounded-full text-[11.5px] font-black" style={{ color: '#8A6800' }}>Later</button>
        )}
      </div>
    </div>
  );
}
