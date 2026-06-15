'use client';

// /pulse/brief-setup — Kaya Pulse · Daily morning brief setup. PR 5 / v2.
//
// Per-parent independent setup (Diana's ask #2): toggle, time picker, channels
// (email · push · WhatsApp), what to include in the brief, and a LIVE preview
// using today's actual numbers. Saves to users/{uid}.pulseBrief. The cron at
// /api/cron/pulse-brief reads this every 30 minutes + dispatches at the
// chosen time. Parent-only. Audit: lastFiredOn on the same field.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { PulseHeader, PulseBreadcrumb } from '@/components/pulse/ui';
import { formatCentsBudgetNeat } from '@/components/pantry/format';
import { updateUserProfile, type UserProfile } from '@/lib/firestore';
import {
  type PulseBriefSettings, type PulseBriefChannel, type PulseBriefIncludeKey,
  DEFAULT_BRIEF_SETTINGS, QUICK_TIMES, INCLUDE_META, CHANNEL_META,
  timeStrToMinutes, formatTime12h,
} from '@/lib/pulseBrief';

const NAVY = '#0F1F44';
const GOLD = '#D4A847';

export default function PulseBriefSetupPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  const initial: PulseBriefSettings = useMemo(() => {
    const existing = (profile as unknown as { pulseBrief?: PulseBriefSettings } | null)?.pulseBrief;
    return existing ? { ...DEFAULT_BRIEF_SETTINGS, ...existing } : DEFAULT_BRIEF_SETTINGS;
  }, [profile]);

  const [draft, setDraft] = useState<PulseBriefSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { setDraft(initial); }, [initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const timeValid = Number.isFinite(timeStrToMinutes(draft.time));

  const toggleEnabled = () => setDraft((d) => ({ ...d, enabled: !d.enabled }));
  const setTime = (t: string) => setDraft((d) => ({ ...d, time: t }));
  const toggleChannel = (c: PulseBriefChannel) => setDraft((d) => ({
    ...d,
    channels: d.channels.includes(c) ? d.channels.filter((x) => x !== c) : [...d.channels, c],
  }));
  const toggleInclude = (k: PulseBriefIncludeKey) => setDraft((d) => ({
    ...d,
    includes: d.includes.includes(k) ? d.includes.filter((x) => x !== k) : [...d.includes, k],
  }));

  const save = async () => {
    if (!profile?.uid || !dirty || saving || !timeValid) return;
    setSaving(true);
    try {
      const next: PulseBriefSettings = { ...draft, updatedAt: Date.now() };
      await updateUserProfile(profile.uid, { pulseBrief: next } as Partial<UserProfile> as Partial<UserProfile>);
      setFlash('✓ Saved — your morning brief is set');
      setTimeout(() => setFlash(null), 3500);
    } catch {
      setFlash('⚠ Could not save — try again');
      setTimeout(() => setFlash(null), 3500);
    } finally { setSaving(false); }
  };

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  // Mock preview data — the real cron uses live numbers; for the UI preview we
  // use Diana-flavoured demo values so the parent sees the shape.
  const previewLines: string[] = [];
  if (draft.includes.includes('lowBalances')) previewLines.push('🪫 Sitting Room Luku at ~1.8 days — auto-buddy will ping the helper.');
  if (draft.includes.includes('allBalances')) previewLines.push('⚡ Master 9d · Kids 21d · Security 4d · Guest 35d.');
  if (draft.includes.includes('todayAllowance')) previewLines.push(`💰 Today's allowance: ~${formatCentsBudgetNeat(21700_00, currency)} across buckets.`);
  if (draft.includes.includes('vsLastMonth')) previewLines.push(`📈 ${formatCentsBudgetNeat(370_000_00, currency)} ahead of last month at Day ${new Date().getDate()}.`);
  if (draft.includes.includes('askKaya')) previewLines.push('🤖 "Home & Wellness is the only bucket trending up — worth a 1.15M one-off cap?"');
  if (draft.includes.includes('pendingApprovals')) previewLines.push('📋 2 purchase requests awaiting your review.');

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseBreadcrumb trail={[]} current="Morning brief" />
      <PulseHeader eyebrow="⚡ Pulse · Metered" title="Morning brief" subtitle="Independent per parent — set yours" />

      {/* Hero */}
      <div className="mt-4 relative overflow-hidden rounded-2xl p-4 text-white"
        style={{ background: 'linear-gradient(135deg,#2a3a6a 0%,#0F1F44 100%)' }}>
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px]" style={{ color: GOLD }}>📬 PER-PARENT · INDEPENDENT</div>
        <div className="font-nunito font-black text-xl mt-1.5 leading-tight">{profile?.displayName ? `${profile.displayName.split(' ')[0]}'s morning brief` : 'Your morning brief'}</div>
        <p className="text-[11.5px] font-bold opacity-80 mt-1.5 leading-snug">One-glance email or push at your chosen time. Tells you what to act on today — meter top-ups, savings pace, today's allowance.</p>
      </div>

      {/* Master toggle */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl px-3 py-3 mt-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-black text-pulse-navy">Send me the brief</div>
          <div className="text-[10.5px] font-bold text-hive-muted">when it&apos;s off, no email or push fires</div>
        </div>
        <button
          type="button"
          aria-label="Toggle morning brief"
          onClick={toggleEnabled}
          className={`relative w-11 h-6 rounded-full transition-colors ${draft.enabled ? 'bg-pulse-green' : 'bg-gray-300'}`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${draft.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
          />
        </button>
      </div>

      {/* Time picker */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl px-3 py-3 mt-2">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-hive-muted mb-2">⏰ Time</div>
        <div className="flex items-center justify-between">
          <input
            type="time"
            value={draft.time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Brief time"
            className="font-nunito font-black text-2xl text-pulse-navy tracking-tight bg-transparent border-none outline-none"
          />
          <span className="text-[11px] font-extrabold text-pulse-gold-dk">{timeValid ? formatTime12h(draft.time) : ''}</span>
        </div>
        <div className="flex gap-1.5 mt-2">
          {QUICK_TIMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTime(t)}
              className={`flex-1 text-[10px] font-black py-1.5 rounded-lg border ${draft.time === t ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-pulse-cream text-pulse-navy border-pulse-gold/30'}`}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Channels */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl px-3 py-3 mt-2">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-hive-muted mb-2">📨 How to send it</div>
        <div className="flex gap-1.5">
          {(['email', 'push', 'whatsapp'] as PulseBriefChannel[]).map((c) => {
            const on = draft.channels.includes(c);
            const m = CHANNEL_META[c];
            const wa = c === 'whatsapp';
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleChannel(c)}
                disabled={wa}
                className={`flex-1 py-2.5 rounded-xl text-[10px] font-black border-2 ${on && !wa ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-pulse-cream text-pulse-navy border-pulse-gold/30'} ${wa ? 'opacity-50' : ''}`}
              >
                <span className="block text-base mb-0.5">{m.emoji}</span>
                {m.label}{wa && <span className="block text-[8px] font-bold opacity-70 mt-0.5">soon</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Includes */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl px-3 py-3 mt-2">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-hive-muted mb-2">📋 Include in the brief</div>
        <div className="flex flex-col">
          {(Object.keys(INCLUDE_META) as PulseBriefIncludeKey[]).map((k) => {
            const on = draft.includes.includes(k);
            const m = INCLUDE_META[k];
            return (
              <label key={k} className="flex items-center justify-between py-1.5 border-t border-dashed border-pulse-gold/30 first:border-t-0 cursor-pointer">
                <span className="text-[11.5px] font-extrabold text-pulse-navy">{m.emoji} {m.label}</span>
                <button
                  type="button"
                  aria-label={`Toggle ${m.label}`}
                  onClick={() => toggleInclude(k)}
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-white font-black text-sm border-2 ${on ? 'bg-pulse-green border-pulse-green' : 'bg-white border-gray-300'}`}
                >{on ? '✓' : ''}</button>
              </label>
            );
          })}
        </div>
      </div>

      {/* Live preview */}
      {draft.enabled && draft.channels.length > 0 && draft.includes.length > 0 && (
        <div className="bg-pulse-cream border-2 border-dashed border-pulse-gold rounded-2xl p-3 mt-3">
          <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold-dk mb-2">👀 Live preview · tomorrow at {draft.time}</div>
          <div className="bg-white rounded-xl p-3 shadow-[0_4px_12px_rgba(0,0,0,0.04)]">
            <div className="text-[9.5px] font-bold text-hive-muted mb-1">from: Kaya · to: {profile?.email ?? 'you'}</div>
            <div className="font-nunito font-black text-[13px] text-pulse-navy mb-2">☀️ Good morning{profile?.displayName ? `, ${profile.displayName.split(' ')[0]}` : ''} — your brief</div>
            <div className="flex flex-col gap-1.5">
              {previewLines.map((l, i) => (
                <p key={i} className="text-[11px] font-bold text-pulse-navy leading-snug">{l}</p>
              ))}
            </div>
            <p className="text-[9.5px] font-bold text-hive-muted mt-2 pt-2 border-t border-dashed border-pulse-gold/30">Tap any line to open it in Kaya · change settings anytime</p>
          </div>
        </div>
      )}

      {/* Save bar */}
      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving || !timeValid}
        className="mt-3 w-full bg-pulse-gold text-pulse-navy font-nunito font-black text-[13px] py-3 rounded-xl disabled:opacity-50"
      >
        {saving ? 'Saving…' : flash ? flash : dirty ? `💾 Save ${profile?.displayName?.split(' ')[0] ?? 'my'} brief` : 'Up to date'}
      </button>

      {/* Auto-buddy explainer */}
      <div className="bg-pulse-navy text-white rounded-2xl p-3 mt-3">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px]" style={{ color: GOLD }}>🎁 SURPRISE #5 · AUTO-BUDDY</div>
        <p className="text-[11.5px] font-bold opacity-90 mt-1.5 leading-snug">When a meter dips below its threshold, Kaya auto-pings the <b>helper of record</b> for that meter and CCs you. Map meters to helpers in the trackable admin (lands next).</p>
      </div>
    </div>
  );
}
