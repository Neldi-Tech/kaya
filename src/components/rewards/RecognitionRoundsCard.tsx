'use client';

// 🌟 Recognition Rounds — settings card (RR PR-1, approved v3 13-Aug-2026).
// Days · time · reviewer audience · channels (WhatsApp = Neldi seam, shown
// as coming-soon). Lives with the store's other rules on Manage Rewards.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { filterListedMembers } from '@/lib/helperVisibility';
import {
  updateFamily, readRecognitionConfig, getFamilyMembers,
  type UserProfile,
} from '@/lib/firestore';
import KayaLearnedLine from '@/components/rewards/RecognitionLearned';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function RecognitionRoundsCard() {
  const { profile } = useAuth();
  const { family, refresh } = useFamily();
  const cfg = useMemo(() => readRecognitionConfig(family), [family]);

  const [active, setActive] = useState(true);
  const [days, setDays] = useState<number[]>([2, 5]);
  const [hourLocal, setHourLocal] = useState(18);
  const [audience, setAudience] = useState<string[]>([]);
  const [bell, setBell] = useState(true);
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setActive(cfg.active);
    setDays(cfg.days);
    setHourLocal(cfg.hourLocal);
    setAudience(cfg.audienceUids);
    setBell(cfg.channels.bell);
    setEmail(cfg.channels.email);
  }, [cfg.active, cfg.days, cfg.hourLocal, cfg.audienceUids, cfg.channels.bell, cfg.channels.email]);

  // Adults who can be reviewers (parents + helpers).
  const [members, setMembers] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    // 🤝 2026-08-25 — the recognition-nudge audience skips outside
    // helpers (no kid assigned): they have nobody to recognise.
    getFamilyMembers(profile.familyId)
      .then((all) => filterListedMembers(all, profile.uid))
      .then((ms) => setMembers(ms.filter((m) => m.role === 'parent' || m.role === 'helper')))
      .catch(() => setMembers([]));
  }, [profile?.familyId]);

  const toggleDay = (d: number) =>
    setDays((p) => p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort());
  const toggleAudience = (uid: string) =>
    setAudience((p) => p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]);

  const save = async () => {
    if (!profile?.familyId || busy) return;
    setBusy(true);
    try {
      await updateFamily(profile.familyId, {
        recognitionConfig: {
          active,
          days: days.length > 0 ? days : [2, 5],
          hourLocal,
          audienceUids: audience,
          channels: { bell, email },
        },
      });
      await refresh?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  };

  const chip = (on: boolean) =>
    `px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border transition-colors ${
      on ? 'bg-kaya-gold text-white border-kaya-gold-dark' : 'bg-white border-kaya-warm-dark/60 text-kaya-sand'
    }`;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">🌟 Recognition rounds</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">
            A cadenced nudge to celebrate the kids — the longest-unrecognized kid always leads, then a rotating
            spotlight (best · most improved · comeback). Celebrating rides the normal award flow.
          </p>
        </div>
        <button type="button" onClick={() => setActive((v) => !v)} className={chip(active)}>
          {active ? 'On' : 'Off'}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-kaya-sand w-24 shrink-0">🗓️ Round days</span>
        {DAY_LABELS.map((l, d) => (
          <button key={l} type="button" onClick={() => toggleDay(d)} className={chip(days.includes(d))}>{l}</button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-kaya-sand w-24 shrink-0">⏰ Time</span>
        <select
          value={hourLocal}
          onChange={(e) => setHourLocal(parseInt(e.target.value, 10))}
          className="rounded-kaya-sm border border-kaya-warm-dark/70 px-2.5 py-1.5 text-[12px] font-bold bg-white"
        >
          {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-kaya-sand w-24 shrink-0">👥 Who gets it</span>
        {members.map((m) => {
          const on = audience.length === 0 ? m.role === 'parent' : audience.includes(m.uid);
          return (
            <button key={m.uid} type="button" onClick={() => toggleAudience(m.uid)} className={chip(on)}>
              {(m.displayName || 'Member').split(' ')[0]}{m.role === 'helper' ? ' 🤝' : ''}
            </button>
          );
        })}
        {audience.length === 0 && <span className="text-[10px] text-kaya-sand">default: all parents</span>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-kaya-sand w-24 shrink-0">📡 Channels</span>
        <button type="button" onClick={() => setBell((v) => !v)} className={chip(bell)}>🔔 Bell</button>
        <button type="button" onClick={() => setEmail((v) => !v)} className={chip(email)}>📧 Email</button>
        <span className="px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border border-dashed border-kaya-warm-dark/60 text-kaya-sand/70">
          💬 WhatsApp — coming soon
        </span>
      </div>

      {/* 🧠 DL PR-B — what the ✕ dismissals taught Kaya (read-only). */}
      <KayaLearnedLine variant="full" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-kaya-sm bg-kaya-gold text-white text-[12.5px] font-bold hover:bg-kaya-gold-dark disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save rounds'}
        </button>
        {saved && <span className="text-[12px] font-bold text-pantry-leaf-dk">✓ Saved</span>}
      </div>
    </div>
  );
}
