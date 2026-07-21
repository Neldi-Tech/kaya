'use client';

// Kaya Sparks · My Reflection — the PARENT's own daily journal
// (Slice 8e · LOCKED LOGIC v1 rule 9).
//
// Rides the existing sparks_reflections engine with ownerId = the
// parent's uid (the Admin route recognises parent-owned reflections:
// owner-only writes · reads gated by the per-parent visibility toggle).
// No ratings, no points, no streak rewards — a light streak count only.
// Typing is always allowed for adults; scanning works too.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/lib/useLocale';
import {
  type ReflectionEntry,
  reflectionDayKey, subscribeToReflection, subscribeToReflections,
  saveReflection, computeReflectionStreak, setMyReflectionVisibility,
  saveReflectionAIRead, type ReflectionAIRead,
} from '@/lib/sparks/reflection';
import { getMyDiaryMeta } from '@/lib/sparks/diary';
import { toDisplayDate } from '@/lib/dates';

const NAVY = '#1B1547';

export default function MyReflectionPage() {
  const { profile: authProfile } = useAuth();
  const familyId = authProfile?.familyId;
  const uid = authProfile?.uid ?? '';
  const isParent = authProfile?.role === 'parent';
  const firstName = (authProfile?.displayName || 'Me').split(' ')[0];
  const sw = useLocale() === 'sw';

  const today = reflectionDayKey();
  const [todayEntry, setTodayEntry] = useState<ReflectionEntry | null>(null);
  const [recent, setRecent] = useState<ReflectionEntry[]>([]);
  const [visibility, setVisibility] = useState<'personal' | 'visible'>('personal');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!uid || !isParent) return;
    getMyDiaryMeta(uid).then((m) => setVisibility(m.reflection_visibility)).catch(() => {});
  }, [uid, isParent]);

  useEffect(() => {
    if (!familyId || !uid || !isParent) return;
    const u1 = subscribeToReflection(familyId, uid, today, setTodayEntry);
    const u2 = subscribeToReflections(familyId, uid, setRecent);
    return () => { u1(); u2(); };
  }, [familyId, uid, isParent, today]);

  const streak = useMemo(() => computeReflectionStreak(recent), [recent]);

  const toggleVisibility = async () => {
    const next = visibility === 'visible' ? 'personal' : 'visible';
    setVisibility(next);
    try { await setMyReflectionVisibility(uid, next); } catch { setVisibility(visibility); }
  };

  const save = async () => {
    if (!familyId || !draft.trim() || saving) return;
    setSaving(true); setErr('');
    try {
      await saveReflection(familyId, {
        kidId: uid, date: today, text: draft.trim(), source: 'typed', by: uid,
      });
      setEditing(false);
      // Slice 8g · adult mood read too — best-effort, same endpoint the
      // kid reflection uses; the emoji feeds the personal streak header.
      void (async () => {
        try {
          const res = await fetch('/api/sparks/ai/reflection-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: draft.trim(), firstName }),
          });
          const data = await res.json().catch(() => ({}));
          if (data && !data.skipped && !data.error && data.mood_emoji) {
            await saveReflectionAIRead(familyId, uid, today, data as ReflectionAIRead);
          }
        } catch { /* best-effort */ }
      })();
    } catch (e) {
      setErr((e as Error).message || 'Could not save');
    } finally { setSaving(false); }
  };

  if (!isParent) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">
        {sw ? 'Ukurasa huu ni wa wazazi.' : 'This page is for parents.'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF5]">
      <div className="mx-auto max-w-md sm:max-w-3xl lg:max-w-5xl">
        <div className="px-4 pt-4 lg:px-6">
          <Link href="/sparks" className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline hover:border-[#D4A847]">
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>Sparks</span>
          </Link>
        </div>
        <div className="px-4 pt-3 pb-8 lg:px-6">
          <div className="bg-white rounded-[24px] shadow-[0_8px_24px_rgba(15,31,68,0.08)] overflow-hidden">
            <div className="px-5 py-5 text-white" style={{ background: 'linear-gradient(135deg, #1B1547 0%, #5AB7D6 130%)' }}>
              <div className="text-[11px] opacity-85">Kaya › Sparks › {sw ? 'Tafakari yangu' : 'My Reflection'}</div>
              <h1 className="font-display font-extrabold text-[20px] m-0 mt-0.5">🪞 {firstName}&apos;s Reflection</h1>
              <div className="text-[12px] opacity-90 mt-0.5">
                {visibility === 'visible' ? (sw ? 'Inaonekana kwa familia' : 'Visible to family') : (sw ? 'Binafsi' : 'Personal')}
                {streak.current > 1 ? ` · 🔥 ${streak.current}` : ''}
              </div>
            </div>

            <div className="p-4 lg:p-6">
              {/* Guide note — the adult framing of the boundary. */}
              <div className="rounded-xl bg-[#F6EFFF] border-l-[3px] border-[#5A3CB8] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[#2c2056] mb-3">
                <b className="text-[#1B1547]">🪞 {sw ? 'Tafakari yako' : 'Your Reflection'}</b>{' — '}
                {sw
                  ? 'jarida lako la siku: kilichotokea, ulichojifunza, unachoshukuru. Fupi na kweli. Watoto wanaiga wanachokiona.'
                  : 'your journal of the day: what happened, what you learned, what you’re grateful for. Short and honest. Kids copy what they see — sharing yours is powerful modelling.'}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ECE4D3] bg-[#FBF7EE] px-3.5 py-2.5 mb-4">
                <div>
                  <div className="font-nunito font-extrabold text-[13px] text-[#0F1F44]">{sw ? 'Mwonekano' : 'Visibility'}</div>
                  <div className="text-[11px] text-[#5A6488]">{sw ? 'Binafsi = wewe tu · Inaonekana = familia inasoma' : 'Personal = only you · Visible = your family can read'}</div>
                </div>
                <button type="button" onClick={toggleVisibility}
                  className="shrink-0 text-[11px] font-extrabold px-3 py-1.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8]">
                  {visibility === 'visible' ? (sw ? 'Inaonekana ▾' : 'Visible ▾') : (sw ? 'Binafsi ▾' : 'Personal ▾')}
                </button>
              </div>

              <div className="font-nunito font-black text-[15px] text-[#0F1F44] mb-2">{toDisplayDate(today)}</div>

              {todayEntry && !editing ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-[#ECE4D3] bg-white p-3 text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">
                    {todayEntry.ai_read && (
                      <span className="inline-flex items-center gap-1.5 mr-2 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8] align-middle">
                        {todayEntry.ai_read.mood_emoji} {todayEntry.ai_read.mood_word}
                      </span>
                    )}
                    {todayEntry.text}
                  </div>
                  <button type="button" onClick={() => { setDraft(todayEntry.text); setEditing(true); }}
                    className="text-[12px] font-nunito font-extrabold text-[#5A3CB8] underline underline-offset-2">
                    ✏️ {sw ? 'Hariri' : 'Edit today’s reflection'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={5}
                    maxLength={4000}
                    placeholder={sw ? 'Leo…' : 'Today I…'}
                    className="w-full rounded-2xl border border-[#ECE4D3] bg-white p-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#8E7BE0]/40 resize-none"
                  />
                  {err && <p className="text-[12px] font-bold text-[#E36F6F]">{err}</p>}
                  <div className="flex justify-end gap-2">
                    {editing && (
                      <button type="button" onClick={() => setEditing(false)}
                        className="px-3.5 py-2 rounded-xl text-[12.5px] font-bold text-[#5A6488]">{sw ? 'Ghairi' : 'Cancel'}</button>
                    )}
                    <button type="button" onClick={save} disabled={saving || !draft.trim()}
                      className="px-4 py-2 rounded-xl text-white font-nunito font-black text-[13px] disabled:opacity-50"
                      style={{ background: NAVY }}>
                      {saving ? '…' : (sw ? 'Hifadhi' : 'Save')}
                    </button>
                  </div>
                </div>
              )}

              {/* Recent days — light list, no gamification. */}
              {recent.filter((e) => e.date !== today).length > 0 && (
                <div className="mt-5">
                  <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488] mb-2">
                    {sw ? 'Siku za karibuni' : 'Recent days'}
                  </div>
                  <div className="space-y-2">
                    {recent.filter((e) => e.date !== today).slice(0, 7).map((e) => (
                      <div key={e.date} className="rounded-2xl border border-[#ECE4D3] bg-white px-3.5 py-2.5">
                        <div className="text-[11px] font-nunito font-black text-[#5A6488]">{toDisplayDate(e.date)}</div>
                        <div className="text-[12.5px] text-[#0F1F44] mt-0.5 leading-snug line-clamp-2">{e.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
