'use client';

// Kaya · Settings → Celebrations (parent-only). Per-kid reward style for the
// celebrate engine: a big Celebration, Inspiring words, or a Surprise mix —
// plus intensity + sound. Age gives a suggested default; parents can preview.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateChild } from '@/lib/firestore';
import {
  CelebrationStyle, CelebrationIntensity,
  celebrationSettingsFor, defaultCelebrationSettings, ageFromBirthday,
} from '@/lib/celebrate';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';

const STYLES: Array<{ k: CelebrationStyle; ic: string; label: string }> = [
  { k: 'celebration', ic: '🎉', label: 'Celebration' },
  { k: 'inspiring', ic: '🌟', label: 'Inspiring' },
  { k: 'surprise', ic: '🎲', label: 'Surprise mix' },
];
const INTENSITIES: CelebrationIntensity[] = ['calm', 'normal', 'big'];
const STYLE_LABEL: Record<CelebrationStyle, string> = { celebration: 'Celebration', inspiring: 'Inspiring', surprise: 'Surprise mix' };

export default function CelebrationsSettingsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();
  const celebrate = useCelebrate();
  const familyId = profile?.familyId;

  const [kidId, setKidId] = useState('');
  const [style, setStyle] = useState<CelebrationStyle>('celebration');
  const [intensity, setIntensity] = useState<CelebrationIntensity>('normal');
  const [sound, setSound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadedRef = useRef('');

  useEffect(() => { if (profile && profile.role !== 'parent') router.replace('/'); }, [profile, router]);
  useEffect(() => { if (!kidId && children.length) setKidId(children[0].id); }, [children, kidId]);

  const kid = children.find((c) => c.id === kidId);
  useEffect(() => {
    if (!kid || loadedRef.current === kid.id) return;
    loadedRef.current = kid.id;
    const s = celebrationSettingsFor(kid);
    setStyle(s.style); setIntensity(s.intensity); setSound(s.sound); setSaved(false);
  }, [kid]);

  const age = ageFromBirthday(kid?.birthday);
  const suggested = defaultCelebrationSettings(age);
  const dirty = () => setSaved(false);

  const save = async () => {
    if (!familyId || !kid) return;
    setSaving(true); setSaved(false);
    try {
      await updateChild(familyId, kid.id, { celebration: { style, intensity, sound } });
      setSaved(true);
    } finally { setSaving(false); }
  };

  const preview = () => celebrate({ kind: 'stocktake', points: 5, streak: 3 }, { style, intensity, sound });

  const seg = (active: boolean) =>
    `flex-1 h-9 rounded-kaya-sm text-[12px] font-bold border transition ${active ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <h1 className="font-display font-extrabold text-[20px] flex items-center gap-2">🎉 Celebrations</h1>
      <p className="text-[12px] text-kaya-sand mt-0.5 mb-4">How Kaya cheers each child on when they earn points.</p>

      {children.length === 0 ? (
        <p className="text-[13px] text-kaya-sand py-8 text-center">Add a kid first to set their celebrations.</p>
      ) : (
        <>
          {/* Kid picker */}
          <div className="flex gap-2 flex-wrap mb-4">
            {children.map((c) => (
              <button key={c.id} type="button" onClick={() => setKidId(c.id)}
                className={`px-3.5 py-2 rounded-full text-[12.5px] font-bold border transition ${c.id === kidId ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
                {c.avatarEmoji} {c.name}{age !== undefined && c.id === kidId ? ` · ${age}` : ''}
              </button>
            ))}
          </div>

          {/* Style */}
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-3">
            <h2 className="font-bold text-[14px] mb-1">Reward style</h2>
            <p className="text-[11px] text-kaya-sand mb-3">What shows when {kid?.name || 'they'} earn points.</p>
            <div className="flex gap-2">
              {STYLES.map((s) => (
                <button key={s.k} type="button" onClick={() => { setStyle(s.k); dirty(); }}
                  className={`flex-1 rounded-kaya-sm border-2 py-3 px-1 text-center transition ${style === s.k ? 'border-kaya-gold-dark bg-kaya-gold-light' : 'border-kaya-warm-dark bg-kaya-cream'}`}>
                  <span className="block text-[20px] mb-1">{s.ic}</span>
                  <span className="block text-[11px] font-bold">{s.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-kaya-sand mt-2.5">
              Suggested{age !== undefined ? ` for age ${age}` : ''}: <b>{STYLE_LABEL[suggested.style]}</b>
              {style !== suggested.style && (
                <button type="button" onClick={() => { setStyle(suggested.style); setIntensity(suggested.intensity); dirty(); }} className="ml-2 text-kaya-chocolate font-bold underline">use suggested</button>
              )}
            </p>
          </div>

          {/* Intensity */}
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-3">
            <h2 className="font-bold text-[14px] mb-2">Intensity</h2>
            <div className="flex gap-2">
              {INTENSITIES.map((i) => (
                <button key={i} type="button" onClick={() => { setIntensity(i); dirty(); }} className={seg(intensity === i)}>
                  {i === 'calm' ? 'Calm' : i === 'normal' ? 'Normal' : 'Big 🎆'}
                </button>
              ))}
            </div>
          </div>

          {/* Sound */}
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
            <button type="button" onClick={() => { setSound((v) => !v); dirty(); }} className="w-full flex items-center justify-between">
              <span className="text-left">
                <span className="block font-bold text-[14px]">Sound</span>
                <span className="block text-[11px] text-kaya-sand">A little chime when they celebrate. Off by default.</span>
              </span>
              <span className={`w-[46px] h-[26px] rounded-full relative shrink-0 transition-colors ${sound ? 'bg-pantry-leaf' : 'bg-kaya-warm-dark'}`}>
                <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${sound ? 'left-[23px]' : 'left-[3px]'}`} />
              </span>
            </button>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={preview}
              className="h-12 px-4 rounded-kaya bg-white border-2 border-kaya-warm-dark text-kaya-chocolate font-display font-extrabold text-[13px] hover:bg-kaya-warm transition">
              ▶ Preview
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="flex-1 h-12 rounded-kaya bg-kaya-chocolate text-white font-display font-extrabold text-[14px] disabled:opacity-50 hover:brightness-110 transition">
              {saving ? 'Saving…' : saved ? 'Saved ✓' : `Save for ${kid?.name || 'kid'}`}
            </button>
          </div>
          <p className="text-[10.5px] text-kaya-sand mt-3 leading-relaxed">
            Fires when {kid?.name || 'a kid'} saves a stock-take or logs a sale. More moments (milestones, streaks) join in soon.
          </p>
        </>
      )}
    </div>
  );
}
