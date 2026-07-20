'use client';

// Kaya · Add-a-Kid Welcome Wizard (2026-07-26, Elia-approved design).
//
// Opens the moment a parent adds a child by name (Settings quick-add) —
// and re-opens from the "✎ Finish profile" chip for any kid whose basics
// are missing. Three tiny steps, skippable at any point; skipping never
// loses the kid, it just leaves the profile unfinished.
//
//   1 · Basics — birthday, gender, avatar, house name.
//   2 · Participation — a 🌟 Little Star suggestion computed from the
//       birthday + the family's participation ages, with per-kid
//       override switches (Sparks / meetings). Birthdays & Moments are
//       always on — everyone belongs there.
//   3 · Done — summary + "Open full profile" for the deeper fields.
//
// COPPA note: this wizard only edits profile fields via the existing
// rules-governed updateChild. It never mints Kaya Codes — that stays
// exclusively on /family/add-child (consent + re-auth).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateChild, type Child, type Gender } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { createPost } from '@/lib/moments';
import {
  readParticipationAges, ageOf, participatesInSparks, participatesInMeetings,
} from '@/lib/participation';
import { toDisplayDate } from '@/lib/dates';

const AVATARS = ['🏅', '🤍', '🥈', '❤️', '💚', '💙', '👶', '🦁', '⭐', '🐣', '🚀', '🌸'];

export default function KidWelcomeWizard({
  familyId, child, onClose,
}: {
  familyId: string;
  child: Child;
  onClose: () => void;
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, refresh } = useFamily();
  const ages = readParticipationAges(family);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);

  const [birthday, setBirthday] = useState(child.birthday || '');
  const [gender, setGender] = useState<Gender>(child.gender || 'unspecified');
  const [avatar, setAvatar] = useState(child.avatarEmoji || '⭐');
  const [houseName, setHouseName] = useState(child.houseName || '');

  // Participation switches — seeded from age vs family defaults each time
  // the birthday changes on step 1.
  const draft = useMemo(() => ({ birthday, participationOverrides: child.participationOverrides }), [birthday, child.participationOverrides]);
  const suggestedSparks = participatesInSparks({ ...draft, participationOverrides: undefined }, family);
  const suggestedMeetings = participatesInMeetings({ ...draft, participationOverrides: undefined }, family);
  const [sparksOn, setSparksOn] = useState<boolean | null>(null);   // null = follow age
  const [meetingsOn, setMeetingsOn] = useState<boolean | null>(null);
  const effSparks = sparksOn ?? suggestedSparks;
  const effMeetings = meetingsOn ?? suggestedMeetings;

  const age = ageOf({ birthday });
  const first = (child.name || 'your child').split(' ')[0];
  const ageLabel = age === null ? null : age === 0 ? 'under 1' : `${age}`;
  const littleStar = !effSparks || !effMeetings;

  async function saveStep1(next: 2 | 3) {
    setSaving(true);
    try {
      await updateChild(familyId, child.id, {
        ...(birthday ? { birthday } : {}),
        gender,
        avatarEmoji: avatar,
        ...(houseName.trim() ? { houseName: houseName.trim() } : {}),
      });
      setStep(next);
    } finally { setSaving(false); }
  }

  async function saveStep2() {
    setSaving(true);
    try {
      // Only store an override when the parent flipped a switch away from
      // the age-based suggestion — otherwise the kid simply follows the
      // family's participation ages as they grow.
      const overrides: { sparks?: boolean; meetings?: boolean } = {};
      if (sparksOn !== null && sparksOn !== suggestedSparks) overrides.sparks = sparksOn;
      if (meetingsOn !== null && meetingsOn !== suggestedMeetings) overrides.meetings = meetingsOn;
      const firstArrival = !(child as { arrivedAt?: string }).arrivedAt;
      await updateChild(familyId, child.id, {
        ...(Object.keys(overrides).length ? { participationOverrides: overrides } : {}),
        // Arrival stamp — powers the 🎊 celebration (design §3). Set once.
        ...(firstArrival ? { arrivedAt: new Date().toISOString().slice(0, 10) } : {}),
      } as Partial<Child>);
      // 🎊 Moments welcome post (design §3) — the family keepsake where
      // everyone piles on comments + 💛. Best-effort, created once.
      if (firstArrival && profile?.uid) {
        try {
          await createPost(familyId, {
            authorUid: profile.uid,
            authorName: profile.displayName || 'A proud parent',
            caption: `🎊 A new star has joined the family — welcome, ${child.name}! ${avatar} ${birthday ? `Born ${toDisplayDate(birthday)}. ` : ''}Drop a 💛 and say karibu!`,
            photos: [],
            kidTags: [child.id],
            visibility: 'family',
          } as Parameters<typeof createPost>[1]);
        } catch { /* the celebration hero still shows — never block the wizard */ }
      }
      setStep(3);
    } finally { setSaving(false); }
  }

  async function finish(openProfile: boolean) {
    await refresh();
    onClose();
    if (openProfile) router.push('/profiles');
  }

  const Switch = ({ on, onToggle, disabled }: { on: boolean; onToggle?: () => void; disabled?: boolean }) => (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${on ? 'bg-emerald-500' : 'bg-kaya-warm-dark'} ${disabled ? 'opacity-60' : ''}`}
    >
      <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all ${on ? 'right-[3px]' : 'left-[3px]'}`} />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white rounded-t-3xl sm:rounded-kaya overflow-hidden max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light px-5 py-4">
            <p className="font-display font-black text-base">🎉 Welcome, {first}!</p>
            <p className="text-[11.5px] opacity-75 mt-0.5">
              Step {step} of 3 · {step === 1 ? 'The basics' : step === 2 ? `How ${first} joins in` : 'Done'}
            </p>
            <div className="flex gap-1.5 mt-2.5">
              {[1, 2, 3].map((s) => (
                <span key={s} className="h-1 rounded-full flex-1" style={{ background: s <= step ? '#D4A017' : 'rgba(245,230,184,.25)' }} />
              ))}
            </div>
          </div>

          {/* Step 1 — basics */}
          {step === 1 && (
            <div className="p-5">
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-kaya-sand mb-1.5">Birthday</label>
              <input
                type="date"
                value={birthday}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthday(e.target.value)}
                className="w-full h-11 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              />
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-kaya-sand mt-4 mb-1.5">Gender</label>
              <div className="flex gap-2">
                {([['male', 'Boy'], ['female', 'Girl'], ['other', 'Other']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setGender(v)}
                    className={`flex-1 h-10 rounded-kaya-sm text-[13px] font-bold border-2 transition-colors ${gender === v ? 'border-kaya-gold bg-kaya-gold/10 text-kaya-chocolate' : 'border-kaya-warm-dark bg-white text-kaya-sand'}`}>
                    {l}
                  </button>
                ))}
              </div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-kaya-sand mt-4 mb-1.5">Avatar</label>
              <div className="flex gap-2 flex-wrap">
                {AVATARS.map((a) => (
                  <button key={a} type="button" onClick={() => setAvatar(a)}
                    className={`w-10 h-10 rounded-kaya-sm grid place-items-center text-lg bg-kaya-warm border-2 transition-all ${avatar === a ? 'border-kaya-gold bg-kaya-gold/15' : 'border-transparent'}`}>
                    {a}
                  </button>
                ))}
              </div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-kaya-sand mt-4 mb-1.5">House</label>
              <input
                value={houseName}
                onChange={(e) => setHouseName(e.target.value)}
                placeholder="e.g. Red House"
                className="w-full h-11 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              />
              <div className="flex items-center justify-between mt-5">
                <button type="button" onClick={onClose} className="text-[13px] font-bold text-kaya-sand">Skip for now</button>
                <button type="button" disabled={saving} onClick={() => void saveStep1(2)}
                  className="h-11 px-6 rounded-full bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[13.5px] disabled:opacity-50">
                  {saving ? 'Saving…' : 'Next →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — participation */}
          {step === 2 && (
            <div className="p-5">
              {littleStar && (
                <div className="rounded-kaya border-[1.5px] p-3.5 mb-4" style={{ borderColor: '#F3CD9A', background: '#FDF3E4' }}>
                  <p className="text-[13px] font-black" style={{ color: '#9a5f14' }}>
                    🌟 {first} is {ageLabel === null ? 'brand new' : `${ageLabel === 'under 1' ? 'under 1 year' : `${ageLabel} year${ageLabel === '1' ? '' : 's'}`} old`} — Little Star mode suggested
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: '#8a6d3a' }}>
                    Little Stars appear in birthdays, Moments and the family tree — but get no tasks, ratings, goals or meeting prompts until they&rsquo;re ready.
                  </p>
                </div>
              )}
              <div className="divide-y divide-dashed divide-kaya-warm-dark">
                <div className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[13.5px] font-bold">✨ Kaya Sparks (tasks &amp; routines)</p>
                    <p className="text-[11px] text-kaya-sand font-semibold">Auto-joins at age {ages.sparksFromAge} — your family default</p>
                  </div>
                  <Switch on={effSparks} onToggle={() => setSparksOn(!effSparks)} />
                </div>
                <div className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[13.5px] font-bold">🗓️ Sunday meetings</p>
                    <p className="text-[11px] text-kaya-sand font-semibold">Auto-joins at age {ages.meetingsFromAge} — your family default</p>
                  </div>
                  <Switch on={effMeetings} onToggle={() => setMeetingsOn(!effMeetings)} />
                </div>
                <div className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[13.5px] font-bold">🎂 Birthdays &amp; Moments</p>
                    <p className="text-[11px] text-kaya-sand font-semibold">Always on — everyone belongs here</p>
                  </div>
                  <Switch on disabled />
                </div>
              </div>
              <div className="flex items-center justify-between mt-5">
                <button type="button" onClick={() => setStep(1)} className="text-[13px] font-bold text-kaya-sand">← Back</button>
                <button type="button" disabled={saving} onClick={() => void saveStep2()}
                  className="h-11 px-6 rounded-full bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[13.5px] disabled:opacity-50">
                  {saving ? 'Saving…' : 'Next →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — done */}
          {step === 3 && (
            <div className="p-6 text-center">
              <div className="text-5xl">{avatar}</div>
              <p className="font-display font-black text-[16px] mt-2">
                {child.name}{houseName.trim() ? ` · ${houseName.trim()}` : ''}{littleStar ? ' · 🌟 Little Star' : ''}
              </p>
              <p className="text-[12.5px] text-kaya-sand mt-1">
                {birthday ? `Born ${toDisplayDate(birthday)}` : 'Add a birthday any time from the profile'}
                {littleStar
                  ? ` · joins ${!effSparks ? `Sparks at ${ages.sparksFromAge}` : ''}${!effSparks && !effMeetings ? ' · ' : ''}${!effMeetings ? `meetings at ${ages.meetingsFromAge}` : ''} — Kaya will remind you.`
                  : ' · taking part in everything from day one.'}
              </p>
              <div className="flex items-center justify-center gap-3 mt-6">
                <button type="button" onClick={() => void finish(true)} className="text-[13px] font-bold text-kaya-sand">Open full profile →</button>
                <button type="button" onClick={() => void finish(false)}
                  className="h-11 px-7 rounded-full bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[13.5px]">
                  Done ✓
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
