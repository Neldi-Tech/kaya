'use client';
// 👑 Kid Home strip (S1/S2 in the approved design):
//   • the LEADER sees a gold card — day N of 7 · 📒 Notebook (unseen-outcome
//     dot) · 🎯 mission progress · 📖 guide · 👀 whisper; the Guide auto-opens
//     once on a kid's FIRST week (remembered per device + term).
//   • SIBLINGS see the compact "👑 Ama is Leader of the Week" chip.
// Reads the crown from the family doc; the bundle comes via /api/leader.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { readLeaderConfig, termDayNumber, termWeekNumber } from '@/lib/leaderWeek.shared';
import { loadNotebook, type NotebookBundle } from '@/lib/leaderWeek';
import LeaderCrownChip from './LeaderCrownChip';
import LeaderGuideSheet from './LeaderGuideSheet';

const GOLD = '#B8860B';

export default function KidLeaderStrip({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [bundle, setBundle] = useState<NotebookBundle | null>(null);
  const [guide, setGuide] = useState(false);
  const hl = family?.houseLeader || null;
  const cfg = readLeaderConfig(family);
  const isLeader = !!(hl && profile?.role === 'kid' && profile.childId === hl.childId);

  useEffect(() => {
    if (!isLeader || !profile?.familyId) { setBundle(null); return; }
    let alive = true;
    loadNotebook(profile.familyId).then((b) => { if (alive) setBundle(b); }).catch(() => {});
    return () => { alive = false; };
  }, [isLeader, profile?.familyId, hl?.termId]);

  // First-week auto-open of the guide (once per kid per device).
  useEffect(() => {
    if (!isLeader || !hl || !profile?.childId) return;
    try {
      const key = `kayaLeaderGuideSeen:${profile.childId}`;
      if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setGuide(true); }
    } catch { /* ignore */ }
  }, [isLeader, hl, profile?.childId]);

  if (!hl || !cfg.enabled) return null;
  if (!isLeader) return <LeaderCrownChip className={className} />;

  const day = termDayNumber(hl.startAt);
  const week = termWeekNumber(hl.startAt);
  const unseen = bundle?.unseen || 0;
  const sent = bundle?.notes.length || 0;
  const approved = bundle?.notes.filter((n) => n.status === 'approved' || n.status === 'adjusted').length || 0;
  const waiting = bundle?.notes.filter((n) => n.status === 'pending' || n.status === 'resolving').length || 0;

  return (
    <div className={className}>
      <div className="rounded-2xl border p-3.5" style={{ background: 'linear-gradient(135deg,#FFF7E5,#FFE9C4)', borderColor: '#E9C867' }}>
        <div className="flex items-center gap-2.5">
          <span className="text-2xl" aria-hidden>👑</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px]" style={{ color: GOLD }}>You are Leader of the Week</p>
            <p className="text-[13.5px] font-nunito font-black text-[#4a3a18] leading-snug">Day {Math.min(day, 7)} of 7{week > 1 ? ` · week ${week}` : ''} · lead with a big heart 💛</p>
          </div>
          <button type="button" onClick={() => setGuide(true)} className="text-[11px] font-black px-2.5 py-1 rounded-full bg-white border" style={{ color: GOLD, borderColor: '#E9C867' }}>📖 Guide</button>
        </div>
        <Link href="/kid/notebook" className="mt-3 flex items-center gap-3 rounded-xl bg-white border px-3 py-2.5" style={{ borderColor: '#E9C867' }}>
          <span className="w-9 h-9 rounded-xl grid place-items-center text-lg" style={{ background: '#FFF1C9' }}>📒</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-black text-kaya-chocolate">Leader&apos;s Notebook{unseen > 0 ? <span className="ml-1.5 inline-block min-w-[18px] text-center text-[10px] font-black text-white rounded-full px-1.5" style={{ background: '#D64550' }}>{unseen}</span> : null}</span>
            <span className="block text-[11px] font-bold text-kaya-sand">{bundle ? (sent === 0 ? 'Take your first note — a shout-out or a heads-up' : `${sent} note${sent === 1 ? '' : 's'} sent · ${approved} approved ✅${waiting ? ` · ${waiting} waiting ⏳` : ''}`) : 'Take a note →'}</span>
          </span>
          <span className="text-[11px] font-black px-2.5 py-1 rounded-full" style={{ background: '#FFF1C9', color: '#8A6800' }}>Take a note →</span>
        </Link>
        {bundle?.mission && (
          <div className="mt-2 rounded-xl bg-white border px-3 py-2" style={{ borderColor: '#E9C867' }}>
            <p className="text-[12px] font-black text-kaya-chocolate">🎯 Your mission: {bundle.mission.label}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="flex-1 h-2 rounded-full bg-kaya-warm overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (bundle.mission.progress / Math.max(1, bundle.mission.target)) * 100)}%`, background: bundle.mission.done ? '#2E9E5B' : GOLD }} /></span>
              <span className="text-[10.5px] font-black text-kaya-sand">{bundle.mission.done ? 'done ✓' : `${bundle.mission.progress} of ${bundle.mission.target}`}</span>
            </div>
          </div>
        )}
        {bundle?.prevAdvice && (
          <p className="text-[11.5px] font-bold text-[#6b5a2a] mt-2">🔑 {bundle.prevAdvice.emoji} {bundle.prevAdvice.name}&apos;s advice to you: <i>“{bundle.prevAdvice.advice}”</i></p>
        )}
        {bundle?.whisper && <p className="text-[11.5px] font-bold text-[#6b5a2a] mt-2">👀 Kaya whisper: {bundle.whisper}</p>}
      </div>
      <LeaderGuideSheet open={guide} onClose={() => setGuide(false)} isLeader leaderName={hl.name} />
    </div>
  );
}
