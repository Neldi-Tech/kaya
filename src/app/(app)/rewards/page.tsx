'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { redeemReward, Reward } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function RewardsPage() {
  const { profile } = useAuth();
  const { children, rewards, refresh } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const child = children[selectedChild];
  const isParent = profile?.role === 'parent';
  const activeRewards = rewards.filter((r) => r.active);

  const handleRedeem = async (reward: Reward) => {
    if (!profile?.familyId || !child) return;
    if ((child.totalPoints || 0) < reward.pointsCost) {
      setMessage(`${child.name} needs ${fmt(reward.pointsCost - (child.totalPoints || 0))} more points!`);
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
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-5">
          <h1 className="font-display text-2xl font-black">Rewards Store</h1>
          <p className="text-kaya-sand text-sm">Spend points on awesome rewards</p>
        </div>

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
              <p className="text-white text-2xl font-display font-black">{fmt(child.totalPoints || 0)} pts</p>
            </div>
            <div className="text-3xl">{child.avatarEmoji}</div>
          </div>
        )}

        {message && (
          <div className="bg-kaya-gold/10 border border-kaya-gold/30 rounded-kaya-sm p-3 mb-4 text-center text-sm font-medium animate-slide-up">
            {message}
          </div>
        )}

        <div className="space-y-3">
          {activeRewards.map((reward) => {
            const canAfford = (child?.totalPoints || 0) >= reward.pointsCost;
            const remaining = reward.pointsCost - (child?.totalPoints || 0);
            const progress = Math.min(100, ((child?.totalPoints || 0) / reward.pointsCost) * 100);
            return (
              <div key={reward.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-[14px] bg-kaya-warm/60 flex items-center justify-center text-2xl shrink-0">
                    {reward.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm leading-snug break-words">{reward.title}</p>
                    <p className="text-xs text-kaya-sand leading-snug mt-0.5 break-words">{reward.description}</p>
                  </div>
                  <span className="text-xs font-bold text-kaya-gold whitespace-nowrap shrink-0">
                    {fmt(reward.pointsCost)} pts
                  </span>
                </div>

                {/* Progress + action: separate row so the title can breathe and
                    the button never collides with long descriptions. */}
                <div className="mt-3">
                  <div className="h-1.5 bg-kaya-warm rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${progress}%`, backgroundColor: canAfford ? '#D4A017' : (child?.houseColor || '#C4B89A') }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-kaya-sand font-semibold">
                      {canAfford ? 'Ready to redeem' : `${fmt(remaining)} pts to go`}
                    </span>
                    {isParent && (
                      <button
                        onClick={() => handleRedeem(reward)}
                        disabled={!canAfford || redeeming === reward.id}
                        className={`h-9 px-4 rounded-kaya-sm text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                          canAfford ? 'bg-kaya-gold text-white hover:bg-kaya-gold-dark' : 'bg-kaya-warm text-kaya-sand'
                        } disabled:opacity-50`}
                      >
                        {redeeming === reward.id ? '…' : canAfford ? 'Redeem' : 'Not yet'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* DESKTOP (lg+) — balance hero + reward grid                   */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        <div className="flex items-end justify-between gap-6 mb-7">
          <div>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Rewards store</h1>
            <p className="text-sm text-kaya-sand mt-1">Spend earned points on rewards the family agreed on.</p>
          </div>
          <div className="flex gap-2">
            {children.map((c, i) => {
              const sel = selectedChild === i;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedChild(i)}
                  className={`flex items-center gap-2 h-10 px-3 rounded-kaya-sm text-[13px] font-bold border transition-all ${
                    sel ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
                  }`}
                  style={sel ? { backgroundColor: c.houseColor } : {}}
                >
                  <span>{c.avatarEmoji}</span>{c.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Balance hero */}
        {child && (
          <div className="grid grid-cols-12 gap-4 mb-6">
            <div className="col-span-5 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya-lg p-6 text-white relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
              <div className="relative flex items-center gap-5">
                <KidAvatar child={child} size="xl" shape="square" bgOpacity="40" />
                <div>
                  <p className="text-white/60 text-[11px] font-bold uppercase tracking-[0.14em]">Available balance</p>
                  <p className="font-display font-black text-5xl mt-1">{fmt(child.totalPoints || 0)}</p>
                  <p className="text-[12px] text-kaya-sand-light mt-1">{child.name} · {child.houseName} House</p>
                </div>
              </div>
            </div>
            <div className="col-span-3 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Ready to redeem</p>
              <p className="font-display font-extrabold text-3xl mt-2">
                {activeRewards.filter((r) => (child.totalPoints || 0) >= r.pointsCost).length}
                <span className="text-base text-kaya-sand font-semibold ml-1">/ {activeRewards.length}</span>
              </p>
              <p className="text-[11px] text-kaya-sand mt-2">Within {child.name}&apos;s budget</p>
            </div>
            <div className="col-span-4 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">This week</p>
              <p className="font-display font-extrabold text-3xl mt-2">+{fmt(child.weeklyPoints || 0)}</p>
              <p className="text-[11px] text-kaya-sand mt-2">Earned in the last 7 days</p>
            </div>
          </div>
        )}

        {message && (
          <div className="bg-kaya-gold/10 border border-kaya-gold/30 rounded-kaya p-4 mb-4 text-center text-sm font-semibold animate-slide-up">
            {message}
          </div>
        )}

        {/* Rewards grid */}
        {activeRewards.length === 0 ? (
          <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-12 text-center">
            <p className="text-4xl mb-3">🎁</p>
            <p className="text-kaya-sand text-sm">No rewards configured. Add some in Settings.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {activeRewards.map((reward) => {
              const canAfford = (child?.totalPoints || 0) >= reward.pointsCost;
              const remaining = reward.pointsCost - (child?.totalPoints || 0);
              const progress = Math.min(100, ((child?.totalPoints || 0) / reward.pointsCost) * 100);
              return (
                <div
                  key={reward.id}
                  className={`bg-white border rounded-kaya-lg p-5 transition-colors ${
                    canAfford ? 'border-kaya-gold/60' : 'border-kaya-warm-dark/70'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-14 h-14 rounded-[16px] bg-kaya-warm/60 flex items-center justify-center text-3xl shrink-0">
                      {reward.icon}
                    </div>
                    {canAfford && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-kaya-gold">Ready</span>
                    )}
                  </div>
                  <p className="font-display font-bold text-base mb-1">{reward.title}</p>
                  <p className="text-[12px] text-kaya-sand leading-snug mb-4 min-h-[32px]">{reward.description}</p>

                  <div className="mb-3">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="font-display font-extrabold text-xl text-kaya-gold">{fmt(reward.pointsCost)}<span className="text-[11px] text-kaya-sand font-semibold ml-1">pts</span></span>
                      {!canAfford && child && (
                        <span className="text-[11px] text-kaya-sand font-semibold">Need {fmt(remaining)} more</span>
                      )}
                    </div>
                    <div className="h-1.5 bg-kaya-warm rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${progress}%`, backgroundColor: canAfford ? '#D4A017' : (child?.houseColor || '#C4B89A') }}
                      />
                    </div>
                  </div>

                  {isParent && (
                    <button
                      onClick={() => handleRedeem(reward)}
                      disabled={!canAfford || redeeming === reward.id}
                      className={`w-full h-10 rounded-kaya-sm text-[13px] font-bold transition-colors ${
                        canAfford
                          ? 'bg-kaya-gold text-white hover:bg-kaya-gold-dark'
                          : 'bg-kaya-warm text-kaya-sand cursor-not-allowed'
                      } disabled:opacity-50`}
                    >
                      {redeeming === reward.id ? 'Redeeming…' : canAfford ? 'Redeem' : 'Not enough yet'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
