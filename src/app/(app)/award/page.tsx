'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { giveAward } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

const CATEGORIES = [
  { id: 'kindness', icon: '💖', label: 'Kindness' },
  { id: 'helping', icon: '🤝', label: 'Helping Others' },
  { id: 'bravery', icon: '🦁', label: 'Bravery' },
  { id: 'learning', icon: '📚', label: 'Learning' },
  { id: 'creativity', icon: '🎨', label: 'Creativity' },
  { id: 'teamwork', icon: '⭐', label: 'Teamwork' },
  { id: 'responsibility', icon: '🎯', label: 'Responsibility' },
  { id: 'other', icon: '✨', label: 'Other' },
];

const REGULAR_POINTS = [1, 2, 3, 5, 5];
const DIAMOND_POINTS = [3, 4, 5, 6, 7, 8, 9, 10];

export default function AwardPage() {
  const { profile } = useAuth();
  const { children } = useFamily();

  const [selectedChild, setSelectedChild] = useState<string>('');
  const [category, setCategory] = useState('');
  const [isDiamond, setIsDiamond] = useState(false);
  const [regularPts, setRegularPts] = useState(3);
  const [diamondPts, setDiamondPts] = useState(5);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const finalPoints = isDiamond ? diamondPts : regularPts;

  const handleAward = async () => {
    if (!profile?.familyId || !selectedChild || !category || !reason.trim()) return;
    setSaving(true);

    await giveAward(profile.familyId, {
      childId: selectedChild,
      points: finalPoints,
      reason: reason.trim(),
      category: isDiamond ? `diamond-${category}` : category,
      awardedBy: profile.uid,
      awardedByName: profile.displayName,
    } as any);

    setSuccess(true);
    setSaving(false);

    setTimeout(() => {
      setSuccess(false);
      setSelectedChild('');
      setCategory('');
      setIsDiamond(false);
      setRegularPts(3);
      setDiamondPts(5);
      setReason('');
    }, 2500);
  };

  if (success) {
    const child = children.find((c) => c.id === selectedChild);
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center animate-slide-up">
        <div className="text-6xl mb-4">{isDiamond ? '💎' : '🎉'}</div>
        <h2 className="font-display text-2xl font-black mb-2">Points Awarded!</h2>
        <p className="text-kaya-sand text-sm">
          {child?.name} received{' '}
          <span className="text-kaya-gold font-bold">+{finalPoints} {isDiamond ? 'diamond' : ''} points</span>{' '}
          for {reason}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Award Points</h1>
        <p className="text-kaya-sand text-sm">Recognize great behavior with bonus points</p>
      </div>

      {/* Select child */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Who deserves points?</label>
        <div className="flex gap-2 flex-wrap">
          {children.map((child) => (
            <button key={child.id} onClick={() => setSelectedChild(child.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-kaya-sm border-2 transition-all ${selectedChild === child.id ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand'}`}
              style={selectedChild === child.id ? { backgroundColor: child.houseColor } : {}}>
              <span>{child.avatarEmoji}</span>
              <span className="text-sm font-bold">{child.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">What for?</label>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES.map((cat) => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`flex flex-col items-center gap-1 p-3 rounded-kaya-sm border transition-all ${category === cat.id ? 'border-kaya-gold bg-kaya-gold/5 shadow-sm' : 'border-kaya-warm-dark bg-white'}`}>
              <span className="text-xl">{cat.icon}</span>
              <span className="text-[10px] font-semibold text-kaya-sand leading-tight text-center">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Points Type Toggle */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Points type</label>
        <div className="flex gap-2">
          <button onClick={() => setIsDiamond(false)}
            className={`flex-1 h-10 rounded-kaya-sm font-bold text-sm flex items-center justify-center gap-1.5 transition-colors ${!isDiamond ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
            ⭐ Regular
          </button>
          <button onClick={() => setIsDiamond(true)}
            className={`flex-1 h-10 rounded-kaya-sm font-bold text-sm flex items-center justify-center gap-1.5 transition-all ${isDiamond ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'bg-kaya-warm text-kaya-sand'}`}>
            💎 Diamond
          </button>
        </div>
      </div>

      {/* Regular Points: 1, 2, 3, 5, 5 */}
      {!isDiamond && (
        <div className="mb-5">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">How many points?</label>
          <div className="flex gap-2">
            {REGULAR_POINTS.map((p, i) => (
              <button key={`${p}-${i}`} onClick={() => setRegularPts(p)}
                className={`flex-1 h-12 rounded-kaya-sm font-bold transition-all ${regularPts === p ? 'bg-kaya-gold text-white shadow-md shadow-kaya-gold/30' : 'bg-white border border-kaya-warm-dark text-kaya-sand'}`}>
                +{p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Diamond Points: 3–10 */}
      {isDiamond && (
        <div className="mb-5">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Diamond points (3–10)</label>
          <div className="grid grid-cols-4 gap-2">
            {DIAMOND_POINTS.map((p) => (
              <button key={p} onClick={() => setDiamondPts(p)}
                className={`h-11 rounded-kaya-sm font-bold transition-all ${diamondPts === p ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30' : 'bg-white border border-kaya-warm-dark text-kaya-sand'}`}>
                +{p}
              </button>
            ))}
          </div>
          <p className="text-xs text-purple-600 font-semibold mt-2">💎 Diamond points — parents decide the bonus for exceptional behavior</p>
        </div>
      )}

      {/* Reason */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Tell them why (they'll see this!)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-full h-24 px-4 py-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          placeholder="e.g. You helped your sister with homework without being asked!" />
      </div>

      <button onClick={handleAward} disabled={!selectedChild || !category || !reason.trim() || saving}
        className={`w-full h-[52px] rounded-kaya font-bold text-sm disabled:opacity-40 transition-colors ${isDiamond ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-kaya-gold hover:bg-kaya-gold-dark text-white'}`}>
        {saving ? 'Awarding...' : `Award +${finalPoints} Points ${isDiamond ? '💎' : '🎖️'}`}
      </button>
    </div>
  );
}
