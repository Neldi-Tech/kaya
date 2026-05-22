'use client';

// /pulse/ledger — Kaya Pulse · Ledger. Kids · Points (playful leaderboard from
// Pulse-earned points this month + readings logged + streak) and Helpers · Score
// (a placeholder until helper owners land with the assignment engine).

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getAwardsInDateRange } from '@/lib/firestore';
import { dayKeyInTZ } from '@/lib/dates';
import { PulseMark } from '@/components/pulse/ui';
import {
  type PulseReading, type PulseProfile,
  subscribeToReadingsInMonth, subscribeToAllPulseProfiles,
} from '@/lib/pulse';

const PULSE_TZ = 'Africa/Dar_es_Salaam';

export default function PulseLedgerPage() {
  const { profile } = useAuth();
  const { children: kids } = useFamily();
  const [tab, setTab] = useState<'kids' | 'helpers'>('kids');
  const thisMonth = dayKeyInTZ(new Date(), PULSE_TZ).slice(0, 7);

  const [readings, setReadings] = useState<PulseReading[]>([]);
  const [profiles, setProfiles] = useState<PulseProfile[]>([]);
  const [points, setPoints] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!profile?.familyId) return;
    const u1 = subscribeToReadingsInMonth(profile.familyId, thisMonth, setReadings);
    const u2 = subscribeToAllPulseProfiles(profile.familyId, setProfiles);
    // Pulse points this month — one-shot (awards are append-only; createdAt
    // range only, so no composite index). Filter to the 'pulse' category.
    let cancelled = false;
    (async () => {
      const awards = await getAwardsInDateRange(profile.familyId, `${thisMonth}-01`, `${thisMonth}-31`);
      if (cancelled) return;
      const byKid: Record<string, number> = {};
      awards
        .filter((a) => a.category === 'pulse')
        .forEach((a) => { byKid[a.childId] = (byKid[a.childId] ?? 0) + (a.points ?? 0); });
      setPoints(byKid);
    })();
    return () => { cancelled = true; u1(); u2(); };
  }, [profile?.familyId, thisMonth]);

  const streakById = useMemo(() => {
    const m: Record<string, number> = {};
    profiles.forEach((p) => { m[p.id] = p.currentStreak ?? 0; });
    return m;
  }, [profiles]);

  const readingsById = useMemo(() => {
    const m: Record<string, number> = {};
    readings.filter((r) => r.capturedByKind === 'kid').forEach((r) => { m[r.capturedBy] = (m[r.capturedBy] ?? 0) + 1; });
    return m;
  }, [readings]);

  const rows = useMemo(
    () =>
      kids
        .map((k) => ({
          id: k.id,
          name: k.name,
          emoji: k.avatarEmoji ?? '🧒',
          points: points[k.id] ?? 0,
          count: readingsById[k.id] ?? 0,
          streak: streakById[k.id] ?? 0,
        }))
        .sort((a, b) => b.points - a.points || b.count - a.count),
    [kids, points, readingsById, streakById],
  );

  const maxPoints = Math.max(1, ...rows.map((r) => r.points));
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const empty = rows.length === 0 || rows.every((r) => r.points === 0 && r.count === 0);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="flex items-center gap-1.5">
        <PulseMark className="w-4 h-4" />
        <span className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-pulse-joy-purple">Kaya Pulse</span>
      </div>
      <h1 className="font-nunito font-black text-2xl text-pulse-joy-ink mt-1">Ledger</h1>
      <p className="text-hive-muted text-sm mt-0.5 mb-4">{monthName} standings</p>

      <div className="flex bg-white border border-pulse-gold/30 rounded-xl p-1 mb-4">
        <button
          onClick={() => setTab('kids')}
          className={`flex-1 text-center py-2 rounded-lg text-[12px] font-nunito font-black ${tab === 'kids' ? 'bg-pulse-joy-purple text-white' : 'text-hive-muted'}`}
        >Kids · Points</button>
        <button
          onClick={() => setTab('helpers')}
          className={`flex-1 text-center py-2 rounded-lg text-[12px] font-nunito font-black ${tab === 'helpers' ? 'bg-pulse-navy text-pulse-gold' : 'text-hive-muted'}`}
        >Helpers · Score</button>
      </div>

      {tab === 'kids' ? (
        empty ? (
          <div className="bg-white border-2 border-pulse-joy-purple/15 rounded-2xl p-6 text-center">
            <div className="text-3xl mb-1">🏁</div>
            <h3 className="font-nunito font-black text-pulse-joy-ink">No points yet this month</h3>
            <p className="text-hive-muted text-sm mt-1">Points appear as kids log their reading tasks.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((r, i) => (
              <div key={r.id} className="bg-white border-2 border-pulse-joy-purple/15 rounded-2xl p-3 flex items-center gap-3">
                <div className="text-[13px] font-nunito font-black text-pulse-joy-purple w-5 text-center">{i + 1}</div>
                <div className="w-9 h-9 rounded-xl bg-pulse-joy-yellow flex items-center justify-center text-base shrink-0">{r.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-black text-pulse-joy-ink text-sm">{r.name}</div>
                  <div className="h-2 bg-[#eee] rounded-full overflow-hidden mt-1">
                    <div className="h-full rounded-full" style={{ width: `${Math.round((r.points / maxPoints) * 100)}%`, background: 'linear-gradient(90deg,#9B5DE5,#FF6B6B)' }} />
                  </div>
                  <div className="text-[10px] text-hive-muted font-bold mt-1">
                    {r.count} reading{r.count === 1 ? '' : 's'}{r.streak > 0 ? ` · 🔥 ${r.streak}-day` : ''}
                  </div>
                </div>
                <div className="font-nunito font-black text-pulse-joy-ink text-sm shrink-0">{r.points} pts</div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-6 text-center">
          <div className="text-2xl mb-1">🧑‍🔧</div>
          <h3 className="font-nunito font-black text-pulse-navy">Helper scoring is coming</h3>
          <p className="text-hive-muted text-sm mt-1">Helper reading-tasks and their performance score arrive with the assignment engine.</p>
        </div>
      )}
    </div>
  );
}
