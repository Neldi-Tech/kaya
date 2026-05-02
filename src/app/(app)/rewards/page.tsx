'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { redeemReward, Reward } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

export default function RewardsPage() {
  const { profile } = useAuth();
  const { children, rewards, refresh } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const child = children[selectedChild];
  const isParent = profile?.role === 'parent';

  const handleRedeem = async (reward: Reward) => {
    if (!profile?.familyId || !child) return;
    if ((child.totalPoints || 0) < reward.pointsCost) {
      setMessage(`${child.name} needs ${reward.pointsCost - (child.totalPoints || 0)} more points!`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setRedeeming(reward.id);
    try {
      await redeemReward(profile.familyId, child.id, reward);
      setMessage(`🎉 ${child.name} redeemed "${reward.title}"!`);
      await refresh();
    } catch (e: any) {
      setMessage(e.message || 'Failed to redeem');
    }
    setRedeeming(null);
    setTimeout(() => setMessage(''), 4000);
  };

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Rewards Store</h1>
        <p className="text-kaya-sand text-sm">Spend points on awesome rewards</p>
      </div>

      {/* Child selector + balance */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {children.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setSelectedChild(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
              selectedChild === i ? 'text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand'
            }`}
            style={selectedChild === i ? { backgroundColor: c.houseColor } : {}}
          >
            {c.avatarEmoji} {c.name}
          </button>
        ))}
      </div>

      {child && (
        <div className="bg-gradient-to-r from-kaya-chocolate to-kaya-chocolate-light rounded-kaya p-4 mb-5 flex items-center justify-between">
          <div>
            <p className="text-white/70 text-xs font-medium">Available Balance</p>
            <p className="text-white text-2xl font-display font-black">{child.totalPoints || 0} pts</p>
          </div>
          <div className="text-3xl">{child.avatarEmoji}</div>
        </div>
      )}

      {message && (
        <div className="bg-kaya-gold/10 border border-kaya-gold/30 rounded-kaya-sm p-3 mb-4 text-center text-sm font-medium animate-slide-up">
          {message}
        </div>
      )}

      {/* Rewards grid */}
      <div className="space-y-3">
        {rewards.filter((r) => r.active).map((reward) => {
          const canAfford = (child?.totalPoints || 0) >= reward.pointsCost;
          return (
            <div key={reward.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4 flex items-center gap-4">
              <div className="text-3xl flex-shrink-0">{reward.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{reward.title}</p>
                <p className="text-xs text-kaya-sand truncate">{reward.description}</p>
                <p className="text-xs font-bold text-kaya-gold mt-1">{reward.pointsCost} pts</p>
              </div>
              {isParent && (
                <button
                  onClick={() => handleRedeem(reward)}
                  disabled={!canAfford || redeeming === reward.id}
                  className={`h-9 px-4 rounded-kaya-sm text-xs font-bold transition-colors flex-shrink-0 ${
                    canAfford
                      ? 'bg-kaya-gold text-white hover:bg-kaya-gold-dark'
                      : 'bg-kaya-warm text-kaya-sand'
                  } disabled:opacity-50`}
                >
                  {redeeming === reward.id ? '...' : canAfford ? 'Redeem' : 'Need more'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
