'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { submitRating, getTodayRatings, getRatingsByDate, getFamilyMembers, getFamily, todayString, RatingValue } from '@/lib/firestore';
import { notifyRating } from '@/lib/notify';
import { fmt } from '@/lib/format';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import CoachMark from '@/components/ui/CoachMark';
import NextUp from '@/components/ui/NextUp';

const RATING_OPTIONS: { value: RatingValue; label: string; emoji: string; color: string }[] = [
  { value: 'excellent', label: 'Excellent', emoji: '🌟', color: '#27AE60' },
  { value: 'good',      label: 'Good',      emoji: '👍', color: '#D4A017' },
  { value: 'bad',       label: 'Bad',       emoji: '👎', color: '#E74C3C' },
];

// Auto-save draft key — scoped to family + child + period + TODAY so a
// yesterday draft never bleeds into today, and each kid/period has its
// own in-progress state on the device. (2026-05-20)
const draftKey = (familyId: string, childId: string, period: string) =>
  `kaya:ratedraft:${familyId}:${childId}:${period}:${todayString()}`;

interface RatingDraft {
  ratings?: Record<string, RatingValue>;
  ratingNotes?: Record<string, string>;
  comment?: string;
}
function readDraft(key: string): RatingDraft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as RatingDraft) : null;
  } catch { return null; }
}
function writeDraft(key: string, d: RatingDraft) {
  try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* private mode / quota */ }
}
function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export default function RatePage() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const { family, children } = useFamily();

  const [selectedChild, setSelectedChild] = useState(0);
  const [period, setPeriod] = useState<'morning' | 'evening'>(
    (searchParams.get('period') as 'morning' | 'evening') || 'morning'
  );
  // Date stepper — defaults to today; stepping back shows a past day's ratings
  // read-only (history). Only today is editable.
  const [selectedDate, setSelectedDate] = useState<string>(() => todayString());
  const [ratings, setRatings] = useState<Record<string, RatingValue>>({});
  // Per-item notes — required on 'bad' (so meetings can address what went
  // wrong), optional on 'excellent' (so wins get context). Keyed by
  // routine id. Cleared when the child/period switches.
  const [ratingNotes, setRatingNotes] = useState<Record<string, string>>({});
  // Overall comment for this (child, period). Free text — surfaced in
  // the Reports Notes panel for the Sunday meeting.
  const [overallComment, setOverallComment] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  // Auto-save (2026-05-20) — ticks persist to the device as she goes, so
  // an interruption never loses progress; she just submits when done.
  // `hydrated` gates the save effect until the initial load resolves, so
  // the empty starting state can't wipe a saved draft on mount.
  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  // Map of `${childId}|${period}` → boolean, used by the desktop kid list to
  // show a "Done" badge next to kids already rated for the chosen period.
  const [ratedMap, setRatedMap] = useState<Record<string, boolean>>({});

  const routines = (family?.routines || []).filter((r) => r.period === period && r.active);
  const child = children[selectedChild];
  const isToday = selectedDate === todayString();
  const readOnly = !isToday;   // past days are review-only

  // Load the currently selected child's rating + repopulate the form.
  // If there's no submitted rating yet, restore an auto-saved draft so
  // an interrupted session picks up where she left off.
  useEffect(() => {
    if (!profile?.familyId || !child) return;
    const fid = profile.familyId;
    const cid = child.id;
    setHydrated(false);
    setDraftRestored(false);
    (async () => {
      const existing = await getRatingsByDate(fid, cid, period, selectedDate);
      if (existing) {
        setRatings(existing.ratings);
        setRatingNotes(existing.ratingNotes || {});
        setOverallComment(existing.comment || '');
        setAlreadyRated(true);
      } else {
        const draft = selectedDate === todayString() ? readDraft(draftKey(fid, cid, period)) : null;
        if (draft && (Object.keys(draft.ratings || {}).length > 0 || (draft.comment || '').trim())) {
          setRatings(draft.ratings || {});
          setRatingNotes(draft.ratingNotes || {});
          setOverallComment(draft.comment || '');
          setDraftRestored(true);
        } else {
          setRatings({});
          setRatingNotes({});
          setOverallComment('');
        }
        setAlreadyRated(false);
      }
      // Mark hydrated LAST so the auto-save effect can't run with the
      // empty starting state and wipe the draft we just restored.
      setHydrated(true);
    })();
  }, [profile?.familyId, child?.id, period, selectedDate]);

  // Auto-save the in-progress ticks/notes to the device as they change.
  // Gated on `hydrated` (post-load) + skipped once submitted. Removes the
  // draft when the form is emptied so stale drafts don't linger.
  useEffect(() => {
    if (!hydrated || alreadyRated || readOnly || !profile?.familyId || !child) return;
    const key = draftKey(profile.familyId, child.id, period);
    const hasContent =
      Object.keys(ratings).length > 0 ||
      Object.keys(ratingNotes).length > 0 ||
      overallComment.trim().length > 0;
    if (hasContent) writeDraft(key, { ratings, ratingNotes, comment: overallComment });
    else clearDraft(key);
  }, [hydrated, alreadyRated, readOnly, profile?.familyId, child?.id, period, ratings, ratingNotes, overallComment]);

  // Refresh the per-kid "already rated this period today" map for the kid list.
  useEffect(() => {
    if (!profile?.familyId || children.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        children.map(async (c) => {
          const rated = await getTodayRatings(profile.familyId, c.id, period);
          return [`${c.id}|${period}`, !!rated] as const;
        }),
      );
      if (cancelled) return;
      setRatedMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [profile?.familyId, children, period, saved]);

  const setRating = (routineId: string, value: RatingValue) => {
    if (alreadyRated || readOnly) return;
    setRatings((prev) => ({ ...prev, [routineId]: value }));
    // Clear stale note when rating drops to 'good' — only 'bad' /
    // 'excellent' surface the note input, so a leftover note would just
    // sit invisibly in state.
    if (value === 'good') {
      setRatingNotes((prev) => {
        if (!prev[routineId]) return prev;
        const { [routineId]: _, ...rest } = prev;
        return rest;
      });
    }
  };
  const setNote = (routineId: string, text: string) => {
    if (alreadyRated || readOnly) return;
    setRatingNotes((prev) => ({ ...prev, [routineId]: text }));
  };

  // Bad ratings must carry a reason — flag any that don't, so the
  // submit button can soft-block until the parent adds context.
  const badRoutinesMissingNotes = routines.filter(
    (r) => ratings[r.id] === 'bad' && !(ratingNotes[r.id] || '').trim(),
  );
  const submitBlockedByNotes = !alreadyRated && badRoutinesMissingNotes.length > 0;

  const totalPoints = routines.reduce((sum, r) => {
    const val = ratings[r.id];
    if (val === 'excellent') return sum + r.pointsExcellent;
    if (val === 'good') return sum + r.pointsGood;
    return sum + r.pointsBad;
  }, 0);

  const allRated = routines.every((r) => ratings[r.id]);

  // ── Note input shown conditionally below each routine ─────
  // Renders only when the current rating is 'bad' (required, red) or
  // 'excellent' (optional, green). Stays mounted across re-renders so
  // the cursor doesn't jump while typing.
  const noteInputFor = (routineId: string) => {
    const r = ratings[routineId];
    if (r !== 'bad' && r !== 'excellent') return null;
    const isBad = r === 'bad';
    const text = ratingNotes[routineId] || '';
    const missing = isBad && !text.trim();
    const disabled = alreadyRated || readOnly;
    if (isBad) {
      // Strengthened "Bad" prompt — a clear red callout that invites real
      // detail (roomy textarea + example) so the family meeting has context.
      return (
        <div className="mt-2 rounded-kaya-sm border border-red-300 bg-red-50/60 p-2.5">
          <p className="text-[11px] font-extrabold text-red-700 mb-1.5">
            👎 What happened? Add a detail for the family meeting <span className="font-bold">(required)</span>
          </p>
          <textarea
            value={text}
            onChange={(e) => setNote(routineId, e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder="e.g. Rushed out for school and didn't make the bed — reminded for tomorrow."
            className={`w-full px-3 py-2 text-xs rounded-kaya-sm border bg-white focus:outline-none focus:ring-2 resize-none ${
              missing ? 'border-red-400 focus:ring-red-300' : 'border-red-300 focus:ring-red-200'
            } ${disabled ? 'opacity-60' : ''}`}
          />
          {missing && (
            <p className="text-[10px] text-red-600 mt-1">Tell us why — needed for the family meeting review.</p>
          )}
        </div>
      );
    }
    return (
      <div className="mt-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setNote(routineId, e.target.value)}
          disabled={disabled}
          placeholder="Add detail (optional) — what made it stand out?"
          className={`w-full h-9 px-3 text-xs rounded-kaya-sm border bg-white focus:outline-none focus:ring-2 border-emerald-300 focus:ring-emerald-200 ${disabled ? 'opacity-60' : ''}`}
        />
      </div>
    );
  };

  const handleSubmit = async () => {
    if (!profile?.familyId || !child || !allRated || alreadyRated || readOnly) return;
    if (submitBlockedByNotes) return;
    setSaving(true);
    // Only include `ratingNotes` / `comment` when non-empty — keeps
    // legacy rating docs clean and avoids storing empty strings.
    const cleanedNotes: Record<string, string> = {};
    for (const [id, text] of Object.entries(ratingNotes)) {
      const t = text.trim();
      if (t) cleanedNotes[id] = t;
    }
    const trimmedComment = overallComment.trim();
    await submitRating(profile.familyId, {
      childId: child.id,
      date: todayString(),
      period,
      ratings,
      totalPoints,
      ratedBy: profile.uid,
      ratedByName: profile.displayName,
      ...(Object.keys(cleanedNotes).length > 0 ? { ratingNotes: cleanedNotes } : {}),
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    } as any);
    // Submitted → clear the auto-saved draft for this kid/period/day.
    clearDraft(draftKey(profile.familyId, child.id, period));
    setDraftRestored(false);
    setSaved(true);
    setAlreadyRated(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 3000);

    // Fire-and-forget email notification to other family members and
    // any external contacts opted in for rating notifications.
    (async () => {
      const [members, fam] = await Promise.all([
        getFamilyMembers(profile.familyId),
        getFamily(profile.familyId),
      ]);
      const familyEmails = members
        .filter((m) => m.uid !== profile.uid && m.email && m.role !== 'kid')
        .filter((m) => m.notifyOnRating !== false) // default true
        .map((m) => m.email);
      const externalEmails = (fam?.externalContacts || [])
        .filter((c) => c.notifyOnRating !== false)
        .map((c) => c.email);
      const recipients = Array.from(new Set([...familyEmails, ...externalEmails]));
      notifyRating({
        to: recipients,
        childName: child.name,
        actorName: profile.displayName,
        points: totalPoints,
        period,
      });
    })();
  };

  if (children.length === 0) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 pt-12 lg:pt-16 text-center">
        <p className="text-5xl mb-3">👶</p>
        <p className="text-kaya-sand text-sm">No children added yet. Go to Settings to add children.</p>
      </div>
    );
  }

  const submitLabel = saving
    ? 'Saving…'
    : saved
      ? '✅ Saved'
      : alreadyRated
        ? 'Already rated'
        : submitBlockedByNotes
          ? `Add reason for ${badRoutinesMissingNotes.length} bad ${badRoutinesMissingNotes.length === 1 ? 'rating' : 'ratings'}`
          : 'Submit';

  // ── Period toggle (shared markup) ─────────────────────────────
  const periodToggle = (size: 'sm' | 'lg' = 'sm') => (
    <div className={`flex gap-2 ${size === 'lg' ? 'inline-flex' : ''}`}>
      {(['morning', 'evening'] as const).map((p) => (
        <button
          key={p}
          onClick={() => { setPeriod(p); setRatings({}); setAlreadyRated(false); }}
          className={`${size === 'lg' ? 'h-10 px-5 text-[13px]' : 'flex-1 h-10 text-sm'} rounded-kaya-sm font-semibold transition-colors ${
            period === p ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
          }`}
        >
          {p === 'morning' ? '☀️ Morning' : '🌙 Evening'}
        </button>
      ))}
    </div>
  );

  // ── Date stepper — step back to any past day (read-only); today is editable.
  const stepDate = (delta: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + delta);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (next > todayString()) return;   // never the future
    setSelectedDate(next); setRatings({}); setRatingNotes({}); setOverallComment(''); setAlreadyRated(false);
  };
  const goToday = () => { setSelectedDate(todayString()); setRatings({}); setRatingNotes({}); setOverallComment(''); setAlreadyRated(false); };
  const selectedDateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const dateStepper = () => (
    <div className="inline-flex items-center gap-1 bg-kaya-warm rounded-kaya-sm p-1">
      <button type="button" onClick={() => stepDate(-1)} aria-label="Previous day" className="w-8 h-8 rounded-kaya-sm bg-white text-kaya-chocolate font-black">‹</button>
      <span className="font-semibold text-[13px] px-2 min-w-[120px] text-center">📅 {isToday ? 'Today' : selectedDateLabel}</span>
      <button type="button" onClick={() => stepDate(1)} disabled={isToday} aria-label="Next day" className="w-8 h-8 rounded-kaya-sm bg-white text-kaya-chocolate font-black disabled:opacity-40">›</button>
      {!isToday && <button type="button" onClick={goToday} className="text-[11px] font-bold text-kaya-chocolate px-2">Today</button>}
    </div>
  );

  return (
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">{selectedDateLabel}</p>
          <h1 className="font-display text-2xl font-black">Rate Routines</h1>
        </div>

        <div className="mb-3">{dateStepper()}</div>
        {!isToday && (
          <div className="mb-3 rounded-kaya-sm bg-kaya-warm/60 border border-kaya-warm-dark px-3 py-2 text-[12px] font-semibold text-kaya-chocolate">
            👀 Viewing a past day — read-only. Step to Today to rate.
          </div>
        )}
        {periodToggle()}

        <div className="flex gap-2 mt-4 mb-5 overflow-x-auto pb-1">
          {children.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { setSelectedChild(i); setRatings({}); setAlreadyRated(false); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
                selectedChild === i ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand'
              }`}
              style={selectedChild === i ? { backgroundColor: c.houseColor } : {}}
            >
              <span>{c.avatarEmoji}</span>{c.name}
            </button>
          ))}
        </div>

        {alreadyRated && (
          <div className="bg-green-50 border border-green-200 rounded-kaya-sm p-3 mb-4 text-center">
            <p className="text-sm text-green-700 font-medium">
              ✅ {child?.name}&apos;s {period} routine already rated today
            </p>
          </div>
        )}

        {draftRestored && !alreadyRated && (
          <div className="bg-amber-50 border border-amber-200 rounded-kaya-sm p-2.5 mb-4 text-center">
            <p className="text-xs text-amber-700 font-medium">
              💾 Draft restored · your ticks auto-save — finish + Submit when done
            </p>
          </div>
        )}

        <div className="space-y-3 mb-6">
          {routines.map((routine) => {
            const current = ratings[routine.id];
            return (
              <div key={routine.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xl">{routine.icon}</span>
                  <div>
                    <p className="text-sm font-bold">{routine.label}</p>
                    <p className="text-xs text-kaya-sand">{routine.labelSw}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {RATING_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setRating(routine.id, opt.value)}
                      disabled={alreadyRated}
                      className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-kaya-sm text-xs font-bold transition-all ${
                        current === opt.value ? 'text-white shadow-sm animate-pop' : 'bg-kaya-warm text-kaya-sand'
                      } ${alreadyRated ? 'opacity-60' : ''}`}
                      style={current === opt.value ? { backgroundColor: opt.color } : {}}
                    >
                      <span>{opt.emoji}</span>{opt.label}
                    </button>
                  ))}
                </div>
                {noteInputFor(routine.id)}
              </div>
            );
          })}
        </div>

        {/* Overall comment for this (child, period). Surfaces in the
            Reports Notes panel for family-meeting review. */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Overall note (optional)</label>
          <textarea
            value={overallComment}
            onChange={(e) => setOverallComment(e.target.value)}
            disabled={alreadyRated}
            placeholder="Anything else worth flagging for the family meeting?"
            rows={3}
            className="w-full px-3 py-2 text-sm bg-white border border-kaya-warm-dark rounded-kaya-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 disabled:opacity-60"
          />
        </div>

        <div className="sticky bottom-24 bg-kaya-cream/95 backdrop-blur-sm pt-3 pb-2">
          <div className="flex items-center justify-between bg-white border border-kaya-warm-dark rounded-kaya p-4">
            <div>
              <p className="text-xs text-kaya-sand font-medium">Total Points</p>
              <p className="text-2xl font-display font-black" style={{ color: child?.houseColor }}>{fmt(totalPoints)}</p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={!allRated || saving || alreadyRated || submitBlockedByNotes}
              className="h-11 px-6 bg-kaya-gold text-white rounded-kaya-sm font-bold text-sm disabled:opacity-40 hover:bg-kaya-gold-dark transition-colors"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* DESKTOP (lg+) — split layout                                 */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        {/* Page header */}
        <div className="flex items-end justify-between gap-6 mb-7">
          <div>
            <p className="text-xs text-kaya-sand font-bold uppercase tracking-[0.14em] mb-1">{selectedDateLabel}</p>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Rate routines</h1>
            <p className="text-sm text-kaya-sand mt-1">Pick a child, mark each routine, submit. Done in under a minute.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {dateStepper()}
            {periodToggle('lg')}
          </div>
        </div>
        {!isToday && (
          <div className="mb-6 rounded-kaya bg-kaya-warm/60 border border-kaya-warm-dark px-4 py-2.5 text-[13px] font-semibold text-kaya-chocolate">
            👀 Viewing {selectedDateLabel} — past days are read-only. Step to Today to rate.
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* Kid list (left) */}
          <aside className="col-span-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-kaya-sand px-1 mb-1">Children</p>
            {children.map((c, i) => {
              const isSel = selectedChild === i;
              const done = ratedMap[`${c.id}|${period}`];
              return (
                <button
                  key={c.id}
                  onClick={() => { setSelectedChild(i); setRatings({}); setAlreadyRated(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-kaya border transition-all text-left ${
                    isSel
                      ? 'border-kaya-chocolate bg-white shadow-sm'
                      : 'border-kaya-warm-dark/60 bg-white hover:border-kaya-chocolate'
                  }`}
                >
                  <KidAvatar child={c} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{c.name}</div>
                    <div className="text-[11px] text-kaya-sand truncate">{c.houseName} House</div>
                  </div>
                  {done ? (
                    <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full whitespace-nowrap">✓ Done</span>
                  ) : (
                    <span className="text-[10px] font-bold text-kaya-sand bg-kaya-warm/40 border border-kaya-warm-dark/60 px-2 py-1 rounded-full whitespace-nowrap">Pending</span>
                  )}
                </button>
              );
            })}
            <p className="text-[11px] text-kaya-sand-light px-1 pt-3 leading-relaxed">
              {Object.values(ratedMap).filter(Boolean).length} of {children.length} kids rated for {period} today.
            </p>
          </aside>

          {/* Rating grid (right) */}
          <section className="col-span-9">
            {alreadyRated && (
              <div className="bg-green-50 border border-green-200 rounded-kaya p-3 mb-4 flex items-center gap-3">
                <span className="text-lg">✅</span>
                <p className="text-sm text-green-800 font-semibold">
                  {child?.name}&apos;s {period} routine already rated today.
                </p>
                <span className="text-xs text-green-700 ml-auto">Switch child or period to rate another.</span>
              </div>
            )}

            {draftRestored && !alreadyRated && (
              <div className="bg-amber-50 border border-amber-200 rounded-kaya p-2.5 mb-4 flex items-center gap-2">
                <span className="text-base">💾</span>
                <p className="text-xs text-amber-700 font-semibold">
                  Draft restored · your ticks auto-save — finish + Submit when done.
                </p>
              </div>
            )}

            {routines.length === 0 ? (
              <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-10 text-center">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-kaya-sand text-sm">No {period} routines configured.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {routines.map((routine) => {
                  const current = ratings[routine.id];
                  return (
                    <div
                      key={routine.id}
                      className={`bg-white border rounded-kaya p-4 transition-colors ${
                        current ? 'border-kaya-chocolate/60' : 'border-kaya-warm-dark/70'
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-[12px] bg-kaya-warm/60 flex items-center justify-center text-xl shrink-0">{routine.icon}</div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate">{routine.label}</p>
                          <p className="text-[11px] text-kaya-sand truncate">{routine.labelSw}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {RATING_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setRating(routine.id, opt.value)}
                            disabled={alreadyRated}
                            className={`h-10 rounded-kaya-sm text-[12px] font-bold transition-all flex items-center justify-center gap-1 ${
                              current === opt.value
                                ? 'text-white shadow-sm animate-pop'
                                : 'bg-kaya-warm text-kaya-sand hover:bg-kaya-warm-dark/60'
                            } ${alreadyRated ? 'opacity-60 cursor-not-allowed' : ''}`}
                            style={current === opt.value ? { backgroundColor: opt.color } : {}}
                          >
                            <span>{opt.emoji}</span>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {noteInputFor(routine.id)}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Overall comment — surfaces in the Reports Notes panel
                for the Sunday family meeting. */}
            <div className="mt-4 bg-white border border-kaya-warm-dark/70 rounded-kaya p-4">
              <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-2">Overall note (optional)</label>
              <textarea
                value={overallComment}
                onChange={(e) => setOverallComment(e.target.value)}
                disabled={alreadyRated}
                placeholder="Anything else worth flagging for the family meeting?"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-kaya-cream/60 border border-kaya-warm-dark rounded-kaya-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 disabled:opacity-60"
              />
            </div>

            {/* Sticky footer: total + submit */}
            <div className="mt-6 flex items-center justify-between bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 sticky bottom-4 backdrop-blur">
              <div className="flex items-center gap-4">
                <KidAvatar child={child!} size="lg" shape="square" />
                <div>
                  <p className="text-[11px] text-kaya-sand font-bold uppercase tracking-wider">{child?.name} · {period} total</p>
                  <p className="font-display font-black text-3xl" style={{ color: child?.houseColor }}>{fmt(totalPoints)}<span className="text-xs text-kaya-sand font-semibold ml-1.5">pts</span></p>
                </div>
              </div>
              <button
                onClick={handleSubmit}
                disabled={!allRated || saving || alreadyRated || submitBlockedByNotes}
                className="h-12 px-6 bg-kaya-gold text-white rounded-kaya font-bold text-sm disabled:opacity-40 hover:bg-kaya-gold-dark transition-colors"
              >
                {submitLabel}
              </button>
            </div>
          </section>
          <NextUp from="rate" />
        </div>
      </div>
      <CoachMark
        pageId="rate"
        uid={profile?.uid || ''}
        title="Tap a kid to rate them"
        body="Pick excellent / good / bad for each routine. Five minutes, all three kids. The system handles the rest."
      />
    </>
  );
}
