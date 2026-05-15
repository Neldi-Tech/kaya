'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { submitRating, getTodayRatings, getFamilyMembers, getFamily, todayString, RatingValue } from '@/lib/firestore';
import { notifyRating } from '@/lib/notify';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const RATING_OPTIONS: { value: RatingValue; label: string; emoji: string; color: string }[] = [
  { value: 'excellent', label: 'Excellent', emoji: '🌟', color: '#27AE60' },
  { value: 'good',      label: 'Good',      emoji: '👍', color: '#D4A017' },
  { value: 'bad',       label: 'Bad',       emoji: '👎', color: '#E74C3C' },
];

export default function RatePage() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const { family, children } = useFamily();

  const [selectedChild, setSelectedChild] = useState(0);
  const [period, setPeriod] = useState<'morning' | 'evening'>(
    (searchParams.get('period') as 'morning' | 'evening') || 'morning'
  );
  const [ratings, setRatings] = useState<Record<string, RatingValue>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);
  // Map of `${childId}|${period}` → boolean, used by the desktop kid list to
  // show a "Done" badge next to kids already rated for the chosen period.
  const [ratedMap, setRatedMap] = useState<Record<string, boolean>>({});

  const routines = (family?.routines || []).filter((r) => r.period === period && r.active);
  const child = children[selectedChild];

  // Load the currently selected child's rating + repopulate the form.
  useEffect(() => {
    if (!profile?.familyId || !child) return;
    (async () => {
      const existing = await getTodayRatings(profile.familyId, child.id, period);
      if (existing) {
        setRatings(existing.ratings);
        setAlreadyRated(true);
      } else {
        setRatings({});
        setAlreadyRated(false);
      }
    })();
  }, [profile?.familyId, child?.id, period]);

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
    if (alreadyRated) return;
    setRatings((prev) => ({ ...prev, [routineId]: value }));
  };

  const totalPoints = routines.reduce((sum, r) => {
    const val = ratings[r.id];
    if (val === 'excellent') return sum + r.pointsExcellent;
    if (val === 'good') return sum + r.pointsGood;
    return sum + r.pointsBad;
  }, 0);

  const allRated = routines.every((r) => ratings[r.id]);

  const handleSubmit = async () => {
    if (!profile?.familyId || !child || !allRated || alreadyRated) return;
    setSaving(true);
    await submitRating(profile.familyId, {
      childId: child.id,
      date: todayString(),
      period,
      ratings,
      totalPoints,
      ratedBy: profile.uid,
      ratedByName: profile.displayName,
    } as any);
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

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const submitLabel = saving ? 'Saving…' : saved ? '✅ Saved' : alreadyRated ? 'Already rated' : 'Submit';

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

  return (
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">{todayString()}</p>
          <h1 className="font-display text-2xl font-black">Rate Routines</h1>
        </div>

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
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-24 bg-kaya-cream/95 backdrop-blur-sm pt-3 pb-2">
          <div className="flex items-center justify-between bg-white border border-kaya-warm-dark rounded-kaya p-4">
            <div>
              <p className="text-xs text-kaya-sand font-medium">Total Points</p>
              <p className="text-2xl font-display font-black" style={{ color: child?.houseColor }}>{totalPoints}</p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={!allRated || saving || alreadyRated}
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
            <p className="text-xs text-kaya-sand font-bold uppercase tracking-[0.14em] mb-1">{today}</p>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Rate routines</h1>
            <p className="text-sm text-kaya-sand mt-1">Pick a child, mark each routine, submit. Done in under a minute.</p>
          </div>
          {periodToggle('lg')}
        </div>

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
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sticky footer: total + submit */}
            <div className="mt-6 flex items-center justify-between bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 sticky bottom-4 backdrop-blur">
              <div className="flex items-center gap-4">
                <KidAvatar child={child!} size="lg" shape="square" />
                <div>
                  <p className="text-[11px] text-kaya-sand font-bold uppercase tracking-wider">{child?.name} · {period} total</p>
                  <p className="font-display font-black text-3xl" style={{ color: child?.houseColor }}>{totalPoints}<span className="text-xs text-kaya-sand font-semibold ml-1.5">pts</span></p>
                </div>
              </div>
              <button
                onClick={handleSubmit}
                disabled={!allRated || saving || alreadyRated}
                className="h-12 px-6 bg-kaya-gold text-white rounded-kaya font-bold text-sm disabled:opacity-40 hover:bg-kaya-gold-dark transition-colors"
              >
                {submitLabel}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
