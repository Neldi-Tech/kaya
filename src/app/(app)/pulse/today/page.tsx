'use client';

// /pulse/today — Kaya Pulse · Today (playful). The signed-in person's reading
// tasks for the local day: kids and helpers log from here. Tapping a card opens
// Quick Entry. Parents have no reading tasks in Phase 1 (they set them up in
// Task setup), so they see a gentle pointer there.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { toDisplayDate, dayKeyInTZ } from '@/lib/dates';
import {
  type PulseTask, type Trackable, type PulseProfile,
  subscribeToOwnerTasks, subscribeToTrackables, subscribeToPulseProfile,
} from '@/lib/pulse';
import { PulseMark } from '@/components/pulse/ui';

const PULSE_TZ = 'Africa/Dar_es_Salaam'; // Phase 1 single-family tz; multi-tz later

function dueLabel(task: PulseTask): string {
  try {
    return task.dueAt
      ? task.dueAt.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: PULSE_TZ })
      : '';
  } catch {
    return '';
  }
}

export default function PulseTodayPage() {
  const { profile } = useAuth();
  const { children: kids } = useFamily();
  const isOwnerRole = profile?.role === 'kid' || profile?.role === 'helper';
  const ownerId = profile?.role === 'kid' ? profile.childId ?? '' : profile?.uid ?? '';
  const firstName = profile?.role === 'kid' ? (kids.find((k) => k.id === ownerId)?.name?.split(' ')[0] ?? '') : '';
  const dayKey = useMemo(() => dayKeyInTZ(new Date(), PULSE_TZ), []);

  const [tasks, setTasks] = useState<PulseTask[]>([]);
  const [trackables, setTrackables] = useState<Trackable[]>([]);
  const [streakProfile, setStreakProfile] = useState<PulseProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.familyId || !ownerId) {
      setLoading(false);
      return;
    }
    const t = setTimeout(() => setLoading(false), 1500);
    const unsubTasks = subscribeToOwnerTasks(profile.familyId, ownerId, dayKey, (list) => {
      setTasks(list);
      setLoading(false);
    });
    const unsubTr = subscribeToTrackables(profile.familyId, setTrackables);
    const unsubProf = subscribeToPulseProfile(profile.familyId, ownerId, setStreakProfile);
    return () => {
      clearTimeout(t);
      unsubTasks();
      unsubTr();
      unsubProf();
    };
  }, [profile?.familyId, ownerId, dayKey]);

  const trackById = useMemo(() => {
    const m = new Map<string, Trackable>();
    trackables.forEach((t) => m.set(t.id, t));
    return m;
  }, [trackables]);

  const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'review');
  const done = tasks.filter((t) => t.status === 'logged' || t.status === 'closed');
  const ptsToday = done.reduce((s, t) => s + (t.pointsValue || 0), 0);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="flex items-center gap-1.5">
        <PulseMark className="w-4 h-4" />
        <span className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-pulse-joy-purple">Kaya Pulse</span>
      </div>
      <h1 className="font-nunito font-black text-2xl text-pulse-joy-ink mt-1">
        {firstName ? `Habari, ${firstName} 👋` : 'Your day'}
      </h1>
      <div className="flex items-center flex-wrap gap-2 mt-0.5 mb-3">
        <span className="text-hive-muted text-sm">{toDisplayDate(dayKey)}</span>
        {isOwnerRole && tasks.length > 0 && (
          <span className="text-[11px] font-nunito font-black text-pulse-joy-green bg-pulse-joy-green/15 px-2 py-0.5 rounded-full">
            {done.length}/{tasks.length} done
          </span>
        )}
      </div>
      {profile?.role === 'kid' && (
        <Link href="/pulse/ledger" className="inline-flex items-center gap-1 text-[12px] font-nunito font-black text-pulse-joy-purple mb-3">🏆 See standings →</Link>
      )}

      {isOwnerRole && streakProfile && streakProfile.currentStreak > 0 && (
        <div
          className="rounded-2xl px-4 py-2.5 mb-4 flex items-center gap-2 text-[#5A3D00] font-nunito font-black text-[13px] shadow-[0_6px_16px_rgba(255,170,51,0.3)]"
          style={{ background: 'linear-gradient(135deg,#FFD93D,#FFAA33)' }}
        >
          🔥 {streakProfile.currentStreak}-day streak — log today to keep it going!
        </div>
      )}

      {loading ? (
        <p className="text-hive-muted text-sm">Loading…</p>
      ) : !isOwnerRole ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center">
          <div className="text-2xl mb-1">📋</div>
          <p className="text-sm text-hive-muted">
            Reading tasks are for kids and helpers. Set them up in{' '}
            <Link href="/pulse/admin" className="text-pulse-gold-dk font-bold underline">Task setup</Link>.
          </p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white border-2 border-pulse-joy-purple/15 rounded-2xl p-6 text-center">
          <div className="text-3xl mb-1">🎉</div>
          <h3 className="font-nunito font-black text-pulse-joy-ink">Nothing due today</h3>
          <p className="text-hive-muted text-sm mt-1">New tasks appear each morning.</p>
        </div>
      ) : (
        <>
          {pending.length === 0 && (
            <div className="rounded-2xl p-4 mb-3 text-center text-white shadow-[0_8px_20px_rgba(107,203,119,0.3)]" style={{ background: 'linear-gradient(135deg,#6BCB77,#4ECDC4)' }}>
              <div className="text-2xl">🎉</div>
              <div className="font-nunito font-black text-[15px] mt-1">All done today!</div>
              <div className="text-[12px] opacity-95 font-bold">+{ptsToday} pts earned{streakProfile?.currentStreak ? ` · 🔥 ${streakProfile.currentStreak}-day streak` : ''}</div>
            </div>
          )}
          {pending.length > 0 && (
            <>
              <div className="text-[11px] font-nunito font-black text-pulse-joy-ink mb-2">To do</div>
              <div className="flex flex-col gap-2.5">
                {pending.map((task) => {
                  const tk = trackById.get(task.trackableId);
                  const due = dueLabel(task);
                  return (
                    <Link
                      key={task.id}
                      href={`/pulse/log/${task.id}`}
                      className="bg-white border-2 border-pulse-joy-purple/15 rounded-2xl p-3.5 block"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-nunito font-black text-pulse-joy-ink text-sm truncate">
                            {tk?.emoji ?? '📊'} {tk?.name ?? 'Reading'}
                          </div>
                          {due && <div className="text-[11px] text-hive-muted font-bold mt-0.5">Due {due}</div>}
                        </div>
                        <div className="bg-pulse-joy-purple text-white text-[11px] font-black px-2.5 py-1 rounded-xl shrink-0">
                          +{task.pointsValue}
                        </div>
                      </div>
                      <div className="mt-2.5 bg-pulse-joy-green text-white text-center rounded-xl py-2.5 text-[13px] font-nunito font-black">
                        Log reading →
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="text-[11px] font-nunito font-black text-pulse-joy-ink mt-5 mb-2">Done</div>
              <div className="flex flex-col gap-2">
                {done.map((task) => {
                  const tk = trackById.get(task.trackableId);
                  return (
                    <div
                      key={task.id}
                      className="bg-pulse-joy-purple/5 border border-pulse-joy-purple/15 rounded-2xl p-3 flex items-center justify-between"
                    >
                      <div className="font-nunito font-black text-pulse-joy-ink text-sm truncate">
                        {tk?.emoji ?? '📊'} {tk?.name ?? 'Reading'}
                      </div>
                      <div className="bg-pulse-joy-green text-white text-[11px] font-black px-2.5 py-1 rounded-xl shrink-0">
                        +{task.pointsValue} ✓
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
