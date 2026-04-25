'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { submitRating, getTodayRatings, todayString, RatingValue, Routine } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

const RATING_OPTIONS: { value: RatingValue; label: string; emoji: string; color: string }[] = [
  { value: 'excellent', label: 'Excellent', emoji: '🌟', color: '#D4A017' },
  { value: 'good', label: 'Good', emoji: '👍', color: '#27AE60' },
  { value: 'bad', label: 'Bad', emoji: '👎', color: '#E74C3C' },
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

  const routines = (family?.routines || []).filter((r) => r.period === period && r.active);
  const child = children[selectedChild];

  // Check if already rated today
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
  };

  if (children.length === 0) {
    return (
      <div className="px-4 pt-8 text-center">
        <p className="text-3xl mb-3">👶</p>
        <p className="text-kaya-sand text-sm">No children added yet. Go to Settings to add children.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <BackButton />
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">
          {todayString()}
        </p>
        <h1 className="font-display text-2xl font-black">Rate Routines</h1>
      </div>

      {/* Period toggle */}
      <div className="flex gap-2 mb-4">
        {(['morning', 'evening'] as const).map((p) => (
          <button
            key={p}
            onClick={() => { setPeriod(p); setRatings({}); setAlreadyRated(false); }}
            className={`flex-1 h-10 rounded-kaya-sm text-sm font-semibold transition-colors ${
              period === p
                ? 'bg-kaya-chocolate text-white'
                : 'bg-kaya-warm text-kaya-sand'
            }`}
          >
            {p === 'morning' ? '☀️ Morning' : '🌙 Evening'}
          </button>
        ))}
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {children.map((c, i) => (
          <button
            key={c.id}
            onClick={() => { setSelectedChild(i); setRatings({}); setAlreadyRated(false); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
              selectedChild === i
                ? 'text-white border-transparent shadow-sm'
                : 'border-kaya-warm-dark bg-white text-kaya-sand'
            }`}
            style={selectedChild === i ? { backgroundColor: c.houseColor } : {}}
          >
            <span>{c.avatarEmoji}</span>
            {c.name}
          </button>
        ))}
      </div>

      {alreadyRated && (
        <div className="bg-green-50 border border-green-200 rounded-kaya-sm p-3 mb-4 text-center">
          <p className="text-sm text-green-700 font-medium">
            ✅ {child?.name}'s {period} routine already rated today
          </p>
        </div>
      )}

      {/* Tasks */}
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
                      current === opt.value
                        ? 'text-white shadow-sm animate-pop'
                        : 'bg-kaya-warm text-kaya-sand'
                    } ${alreadyRated ? 'opacity-60' : ''}`}
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

      {/* Score summary + submit */}
      <div className="sticky bottom-24 bg-kaya-cream/95 backdrop-blur-sm pt-3 pb-2">
        <div className="flex items-center justify-between bg-white border border-kaya-warm-dark rounded-kaya p-4">
          <div>
            <p className="text-xs text-kaya-sand font-medium">Total Points</p>
            <p className="text-2xl font-display font-black" style={{ color: child?.houseColor }}>
              {totalPoints}
            </p>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!allRated || saving || alreadyRated}
            className="h-11 px-6 bg-kaya-gold text-white rounded-kaya-sm font-bold text-sm disabled:opacity-40 hover:bg-kaya-gold-dark transition-colors"
          >
            {saving ? 'Saving...' : saved ? '✅ Saved!' : alreadyRated ? 'Already Rated' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
