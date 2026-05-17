'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  redeemReward, Reward,
  DEFAULT_REWARD_CATEGORIES, DEFAULT_REWARD_CATEGORY,
} from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

const iconForCategory = (name: string) =>
  DEFAULT_REWARD_CATEGORIES.find((c) => c.name === name)?.icon || '🏷️';

export default function RewardsPage() {
  const { profile } = useAuth();
  const { children, rewards, refresh } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const child = children[selectedChild];
  const isParent = profile?.role === 'parent';
  const activeRewards = rewards.filter((r) => r.active);

  // Distinct categories present in the active reward set, in alpha order.
  const categories = useMemo(() => {
    const set = new Set(activeRewards.map((r) => r.category || DEFAULT_REWARD_CATEGORY));
    return Array.from(set).sort();
  }, [activeRewards]);

  // Rewards filtered by the active category pill (null = show all).
  const visibleRewards = useMemo(() => {
    if (!activeCategory) return activeRewards;
    return activeRewards.filter((r) => (r.category || DEFAULT_REWARD_CATEGORY) === activeCategory);
  }, [activeRewards, activeCategory]);

  // Grouped buckets for the "All" view — rendered as category sections
  // so kids can scan by type instead of one giant scroll.
  const groupedRewards = useMemo(() => {
    const map = new Map<string, Reward[]>();
    for (const r of visibleRewards) {
      const key = r.category || DEFAULT_REWARD_CATEGORY;
      const bucket = map.get(key) || [];
      bucket.push(r);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleRewards]);

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

        {/* Category filter pills (mobile) */}
        {categories.length > 1 && (
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCategory(null)}
              className={`h-8 px-3 rounded-full text-[11px] font-bold whitespace-nowrap border transition-colors ${
                activeCategory === null
                  ? 'bg-kaya-chocolate text-white border-transparent'
                  : 'bg-white text-kaya-sand border-kaya-warm-dark'
              }`}
            >
              All
            </button>
            {categories.map((cat) => {
              const sel = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(sel ? null : cat)}
                  className={`h-8 px-3 rounded-full text-[11px] font-bold whitespace-nowrap border transition-colors flex items-center gap-1 ${
                    sel
                      ? 'bg-kaya-chocolate text-white border-transparent'
                      : 'bg-white text-kaya-sand border-kaya-warm-dark'
                  }`}
                >
                  <span>{iconForCategory(cat)}</span>{cat}
                </button>
              );
            })}
          </div>
        )}

        {groupedRewards.length === 0 && (
          <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya p-8 text-center">
            <p className="text-3xl mb-2">🎁</p>
            <p className="text-kaya-sand text-sm">
              No rewards yet.{' '}
              {isParent && (
                <Link href="/parent/rewards" className="text-kaya-gold font-bold underline">
                  Add some here
                </Link>
              )}
            </p>
          </div>
        )}

        {groupedRewards.map(([cat, items]) => (
          <div key={cat} className="mb-5">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-base">{iconForCategory(cat)}</span>
              <h2 className="font-display font-extrabold text-sm">{cat}</h2>
              <span className="text-[10px] text-kaya-sand font-semibold">· {items.length}</span>
            </div>
            <div className="space-y-3">
              {items.map((reward) => {
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
        ))}
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
          <div className="flex gap-2 items-center">
            {isParent && (
              <Link
                href="/parent/rewards"
                className="h-10 px-4 rounded-kaya-sm text-[13px] font-bold border border-kaya-warm-dark bg-white text-kaya-chocolate hover:border-kaya-gold transition-colors flex items-center gap-1.5"
              >
                <span>⚙️</span> Manage rewards
              </Link>
            )}
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

        {/* Category filter pills (desktop) */}
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-5">
            <button
              onClick={() => setActiveCategory(null)}
              className={`h-9 px-4 rounded-full text-xs font-bold border transition-colors ${
                activeCategory === null
                  ? 'bg-kaya-chocolate text-white border-transparent'
                  : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-sand'
              }`}
            >
              All ({activeRewards.length})
            </button>
            {categories.map((cat) => {
              const count = activeRewards.filter((r) => (r.category || DEFAULT_REWARD_CATEGORY) === cat).length;
              const sel = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(sel ? null : cat)}
                  className={`h-9 px-4 rounded-full text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                    sel
                      ? 'bg-kaya-chocolate text-white border-transparent'
                      : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-sand'
                  }`}
                >
                  <span>{iconForCategory(cat)}</span>
                  <span>{cat}</span>
                  <span className={sel ? 'text-white/70' : 'text-kaya-sand-light'}>({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Rewards grid */}
        {activeRewards.length === 0 ? (
          <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-12 text-center">
            <p className="text-4xl mb-3">🎁</p>
            <p className="text-kaya-sand text-sm">
              No rewards configured.{' '}
              {isParent && (
                <Link href="/parent/rewards" className="text-kaya-gold font-bold underline">
                  Add some now
                </Link>
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {visibleRewards.map((reward) => {
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
