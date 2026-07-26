'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Reward, Redemption, getRedemptions, isRewardLocked, ageFromBirthday,
  DEFAULT_REWARD_CATEGORIES, DEFAULT_REWARD_CATEGORY,
} from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';
import RedemptionHistory from '@/components/rewards/RedemptionHistory';
import FamilyGoalsSection from '@/components/rewards/FamilyGoalsSection';
import {
  requestRewardRedeem, parentRedeemReward, cancelOwnRequest,
  subscribeToKidRequests, rewardsFloorFor,
  type ApprovalRequest, type FamilyRewardsSlice,
} from '@/lib/hive';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

const iconForCategory = (name: string) =>
  DEFAULT_REWARD_CATEGORIES.find((c) => c.name === name)?.icon || '🏷️';

export default function RewardsPage() {
  const { profile, user } = useAuth();
  const { family, children: allChildren, rewards, refresh } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const isParent = profile?.role === 'parent';
  const isKid = profile?.role === 'kid';

  // RWD PR1 (R1) — a kid's store is THEIR OWN: resolve their child record
  // (childId, with an email-match fallback like /stats/me) and hide sibling
  // tabs entirely. Parents/helpers keep the full picker.
  const myKidId = useMemo(() => {
    if (!isKid) return null;
    if (profile?.childId && profile.childId.trim()) return profile.childId;
    const email = (profile?.email || '').trim().toLowerCase();
    const match = email ? allChildren.find((c) => (c.emailLower || c.email?.toLowerCase() || '') === email) : undefined;
    return match?.id ?? null;
  }, [isKid, profile?.childId, profile?.email, allChildren]);
  const children = useMemo(
    () => (isKid ? allChildren.filter((c) => c.id === myKidId) : allChildren),
    [isKid, allChildren, myKidId],
  );

  const child = children[selectedChild] ?? children[0];
  // Family goals render in their own 👨‍👩‍👧 section — keep them out of the grid.
  const activeRewards = rewards.filter((r) => r.active && r.kind !== 'family');

  // RWD PR1 (R3) — the kid's own pending reward requests (⏳ + cancel).
  const [myRequests, setMyRequests] = useState<ApprovalRequest[]>([]);
  useEffect(() => {
    if (!isKid || !profile?.familyId || !myKidId) return;
    return subscribeToKidRequests(profile.familyId, myKidId, setMyRequests);
  }, [isKid, profile?.familyId, myKidId]);
  const pendingByReward = useMemo(() => {
    const map = new Map<string, ApprovalRequest>();
    for (const r of myRequests) {
      if (r.type === 'reward_redeem' && r.status === 'pending' && r.rewardId) map.set(r.rewardId, r);
    }
    return map;
  }, [myRequests]);

  // RWD PR1 (R9/R10) — 🛡 spendable = balance − floor; every affordability
  // check below runs on spendable, and the transaction re-enforces it.
  const floor = rewardsFloorFor(family as FamilyRewardsSlice | undefined, child?.id || '');
  const spendable = Math.max(0, (child?.totalPoints || 0) - floor);

  // RWD PR2 (R11) — Store / 📜 History tabs.
  const [view, setView] = useState<'store' | 'history'>('store');

  // RWD PR3 (R18/R20) — run-rate advisory: how long to a reward at the kid's
  // real weekly pace, and the "🎯 So close!" strip for the nearest stretch
  // reward within ~2 weeks of reach.
  const weekly = Math.max(0, child?.weeklyPoints || 0);
  const paceLabel = (remaining: number): string | null => {
    if (weekly <= 0) return null;
    const weeks = remaining / weekly;
    if (weeks <= 0.5) return 'a few days at your pace';
    if (weeks <= 1.2) return 'about a week at your pace';
    return `about ${Math.ceil(weeks)} week${Math.ceil(weeks) > 1 ? 's' : ''} at your pace`;
  };
  const soClose = useMemo(() => {
    if (weekly <= 0) return null;
    const stretch = activeRewards
      .filter((r) => !isRewardLocked(r) && r.pointsCost > spendable && (r.pointsCost - spendable) / weekly <= 2)
      .sort((a, b) => a.pointsCost - b.pointsCost)[0];
    if (!stretch) return null;
    return { reward: stretch, missing: stretch.pointsCost - spendable };
  }, [activeRewards, spendable, weekly]);
  const soCloseStrip = soClose && view === 'store' ? (
    <div className="rounded-kaya border border-kaya-gold/50 bg-gradient-to-r from-kaya-gold-light/70 to-kaya-warm/40 px-3.5 py-2.5 mb-4">
      <p className="text-[12.5px] font-bold">
        🎯 So close! {fmt(soClose.missing)} more and {soClose.reward.icon} <b>{soClose.reward.title}</b> is yours
        {paceLabel(soClose.missing) ? ` — ${paceLabel(soClose.missing)}.` : '.'}
      </p>
    </div>
  ) : null;

  // R19 — what's still affordable after a candidate redemption.
  const stillAffordableAfter = (cost: number): Reward[] =>
    activeRewards.filter((r) => !isRewardLocked(r) && r.pointsCost <= spendable - cost).sort((a, b) => a.pointsCost - b.pointsCost).slice(0, 2);

  // 🔒 RWD PR4 (R22) — locked cards stay visible but greyed with a countdown;
  // redeem stays off until they open (date locks auto-open on the day).
  const daysUntil = (key: string): number => {
    const target = new Date(`${key}T00:00:00`);
    return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86400000));
  };
  // 🎂 RWD PR6 — per-reward min age gates against the SELECTED kid's age
  // (no birthday = no gating; it opens by itself as they grow).
  const childAgeNow = ageFromBirthday(child?.birthday);
  const isAgeGated = (r: Reward): boolean =>
    !!r.minAge && r.minAge > 0 && childAgeNow !== null && childAgeNow < r.minAge;
  const lockChip = (r: Reward) => {
    if (isAgeGated(r)) {
      return (
        <span className="text-[10px] font-bold text-kaya-sand bg-kaya-warm rounded-full px-2 py-0.5 shrink-0">
          🔒 from age {r.minAge}
        </span>
      );
    }
    if (!isRewardLocked(r)) return null;
    const days = r.lockedUntil ? daysUntil(r.lockedUntil) : null;
    return (
      <span className="text-[10px] font-bold text-kaya-sand bg-kaya-warm rounded-full px-2 py-0.5 shrink-0">
        🔒 Coming soon{days !== null ? ` · ${days}d` : ''}
      </span>
    );
  };
  const lockLine = (r: Reward): string =>
    isAgeGated(r)
      ? `🔒 opens from age ${r.minAge} — something to grow into!`
      : r.lockedUntil ? `🔒 unlocks in ${daysUntil(r.lockedUntil)} days — keep saving!` : '🔒 coming soon — keep saving!';

  // RWD PR2 (R13/R14) — per-reward counts, tappable → dates.
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    getRedemptions(profile.familyId, 200).then(setRedemptions).catch(() => setRedemptions([]));
  }, [profile?.familyId, view]);
  const redeemedByReward = useMemo(() => {
    const map = new Map<string, Redemption[]>();
    for (const r of redemptions) {
      if (r.status === 'rejected') continue;
      const list = map.get(r.rewardId) || [];
      list.push(r);
      map.set(r.rewardId, list);
    }
    return map;
  }, [redemptions]);
  const [datesFor, setDatesFor] = useState<string | null>(null);
  const kidNameOf = (id: string) => allChildren.find((c) => c.id === id)?.name?.split(' ')[0] || 'Kid';
  const redemptionDate = (r: Redemption) => {
    const ms = (r.createdAt as { toMillis?: () => number })?.toMillis?.();
    if (typeof ms !== 'number') return '—';
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return toDisplayDate(key) || key;
  };
  const countLine = (rewardId: string) => {
    const list = redeemedByReward.get(rewardId) || [];
    if (list.length === 0) return null;
    const mine = isKid && myKidId ? list.filter((r) => r.childId === myKidId).length : 0;
    return (
      <div className="mt-1">
        <button
          onClick={(e) => { e.stopPropagation(); setDatesFor(datesFor === rewardId ? null : rewardId); }}
          className="text-[10.5px] font-bold text-kaya-gold-dark hover:underline"
        >
          redeemed {list.length}×{mine > 0 ? ` · you've had this ${mine}×` : ''} {datesFor === rewardId ? '▴' : '▾'}
        </button>
        {datesFor === rewardId && (
          <div className="mt-1 rounded-kaya-sm border border-dashed border-kaya-warm-dark/60 bg-kaya-cream/60 px-2.5 py-1.5 space-y-0.5">
            {list.slice(0, 6).map((r) => (
              <p key={r.id} className="text-[10.5px] font-semibold text-kaya-sand">
                {redemptionDate(r)} · {kidNameOf(r.childId)} ✓
              </p>
            ))}
            {list.length > 6 && <p className="text-[10px] text-kaya-sand">…and {list.length - 6} more in 📜 History</p>}
          </div>
        )}
      </div>
    );
  };

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

  // RWD PR1 (R2/R5/R6/R8) — parent taps = instant TRANSACTIONAL redeem (they
  // are the approver); kid taps = confirm sheet → request in the family
  // approval queue (or instant via the server when under the family's
  // auto-approve threshold). Both paths respect the 🛡 floor.
  const [confirmFor, setConfirmFor] = useState<Reward | null>(null);
  const autoBelow = (family as FamilyRewardsSlice | undefined)?.rewardsConfig?.autoApproveBelowPoints ?? 0;

  const handleRedeem = async (reward: Reward) => {
    if (!profile?.familyId || !child) return;
    if (isRewardLocked(reward) || isAgeGated(reward)) {
      setMessage(lockLine(reward));
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    if (spendable < reward.pointsCost) {
      const missing = reward.pointsCost - spendable;
      setMessage(floor > 0
        ? `${fmt(missing)} more spendable points needed (🛡 ${fmt(floor)} stays protected).`
        : `${child.name} needs ${fmt(missing)} more points!`);
      setTimeout(() => setMessage(''), 3500);
      return;
    }
    if (isKid) { setConfirmFor(reward); return; }
    setRedeeming(reward.id);
    try {
      await parentRedeemReward(profile.familyId, child.id, reward, profile.uid);
      setMessage(`🎉 ${child.name} redeemed "${reward.title}"!`);
      await refresh();
    } catch (e: any) {
      setMessage(e.message || 'Failed to redeem');
    }
    setRedeeming(null);
    setTimeout(() => setMessage(''), 4000);
  };

  const kidConfirmRedeem = async () => {
    const reward = confirmFor;
    if (!reward || !profile?.familyId || !myKidId) return;
    setConfirmFor(null);
    setRedeeming(reward.id);
    try {
      if (autoBelow > 0 && reward.pointsCost <= autoBelow && user) {
        // Under the family threshold → instant via the server (kids can't
        // write points themselves; the route re-checks floor + threshold).
        const token = await user.getIdToken();
        const res = await fetch('/api/rewards/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rewardId: reward.id }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!data.ok) throw new Error(data.error || 'Could not redeem.');
        setMessage(`🎉 "${reward.title}" is yours — enjoy!`);
        await refresh();
      } else {
        await requestRewardRedeem(profile.familyId, myKidId, reward, profile.uid);
        setMessage(`⏳ Asked! A parent will look at "${reward.title}" soon.`);
      }
    } catch (e: any) {
      setMessage(e.message || 'Could not send the request.');
    }
    setRedeeming(null);
    setTimeout(() => setMessage(''), 4000);
  };

  const kidCancelRequest = async (req: ApprovalRequest) => {
    if (!profile?.familyId || !profile.uid) return;
    try { await cancelOwnRequest(profile.familyId, req.id, profile.uid); setMessage('Request cancelled.'); }
    catch { setMessage('Could not cancel.'); }
    setTimeout(() => setMessage(''), 3000);
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
              <p className="text-white/70 text-xs font-medium">Available to spend</p>
              <p className="text-white text-2xl font-display font-black">{fmt(spendable)} pts</p>
              {/* R17 — spendable hero: total · 🛡 protected · to spend. */}
              {floor > 0 && (
                <p className="text-white/60 text-[11px] font-semibold mt-0.5">of {fmt(child.totalPoints || 0)} total · 🛡 {fmt(floor)} protected</p>
              )}
            </div>
            <div className="text-3xl">{child.avatarEmoji}</div>
          </div>
        )}

        {message && (
          <div className="bg-kaya-gold/10 border border-kaya-gold/30 rounded-kaya-sm p-3 mb-4 text-center text-sm font-medium animate-slide-up">
            {message}
          </div>
        )}

        {/* RWD PR2 (R11) — Store / 📜 History tabs */}
        <div className="flex gap-1.5 mb-4">
          {(['store', 'history'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`flex-1 h-9 rounded-kaya-sm text-[12.5px] font-bold border transition-colors ${view === v ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
              {v === 'store' ? '🎁 Store' : '📜 History'}
            </button>
          ))}
        </div>
        {view === 'history' && <RedemptionHistory myKidId={myKidId} />}

        {view === 'store' && <>
        {soCloseStrip}
        <FamilyGoalsSection myKidId={myKidId} />
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
                const canAfford = spendable >= reward.pointsCost;
                const remaining = reward.pointsCost - spendable;
                const progress = Math.min(100, (spendable / reward.pointsCost) * 100);
                const pendingReq = isKid ? pendingByReward.get(reward.id) : undefined;
                const lockedNow = isRewardLocked(reward) || isAgeGated(reward);
                return (
                  <div key={reward.id} className={`bg-white border border-kaya-warm-dark rounded-kaya p-4 ${lockedNow ? 'opacity-70 grayscale-[35%]' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-[14px] bg-kaya-warm/60 flex items-center justify-center text-2xl shrink-0">
                        {reward.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm leading-snug break-words">{reward.title}</p>
                        <p className="text-xs text-kaya-sand leading-snug mt-0.5 break-words">{reward.description}</p>
                        {countLine(reward.id)}
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
                          {lockedNow
                            ? lockLine(reward)
                            : canAfford
                              ? 'Ready to redeem'
                              : `${fmt(remaining)} pts to go${paceLabel(remaining) ? ` · ${paceLabel(remaining)} 💪` : ''}`}
                        </span>
                        {lockedNow ? lockChip(reward) : pendingReq ? (
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-bold text-kaya-gold-dark bg-kaya-gold-light rounded-full px-2 py-1">⏳ waiting for a parent</span>
                            <button onClick={() => kidCancelRequest(pendingReq)} className="text-[10px] font-bold text-kaya-sand hover:underline">cancel</button>
                          </span>
                        ) : (isParent || isKid) && (
                          <button
                            onClick={() => handleRedeem(reward)}
                            disabled={!canAfford || redeeming === reward.id}
                            className={`h-9 px-4 rounded-kaya-sm text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                              canAfford ? 'bg-kaya-gold text-white hover:bg-kaya-gold-dark' : 'bg-kaya-warm text-kaya-sand'
                            } disabled:opacity-50`}
                          >
                            {redeeming === reward.id ? '…' : !canAfford ? 'Not yet' : isKid ? 'Ask to redeem 🎁' : 'Redeem'}
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
        </>}
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
                  <p className="text-white/60 text-[11px] font-bold uppercase tracking-[0.14em]">Available to spend</p>
                  <p className="font-display font-black text-5xl mt-1">{fmt(spendable)}</p>
                  <p className="text-[12px] text-kaya-sand-light mt-1">
                    {floor > 0
                      ? <>of {fmt(child.totalPoints || 0)} total · 🛡 {fmt(floor)} protected · {child.name}</>
                      : <>{child.name} · {child.houseName} House</>}
                  </p>
                </div>
              </div>
            </div>
            <div className="col-span-3 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Ready to redeem</p>
              <p className="font-display font-extrabold text-3xl mt-2">
                {activeRewards.filter((r) => !isRewardLocked(r) && spendable >= r.pointsCost).length}
                <span className="text-base text-kaya-sand font-semibold ml-1">/ {activeRewards.length}</span>
              </p>
              <p className="text-[11px] text-kaya-sand mt-2">Within {child.name}&apos;s spendable points</p>
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

        {/* RWD PR2 (R11) — Store / 📜 History tabs (desktop) */}
        <div className="flex gap-2 mb-5">
          {(['store', 'history'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`h-10 px-6 rounded-kaya-sm text-[13px] font-bold border transition-colors ${view === v ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
              {v === 'store' ? '🎁 Store' : '📜 History'}
            </button>
          ))}
        </div>
        {view === 'history' && <div className="max-w-3xl"><RedemptionHistory myKidId={myKidId} /></div>}

        {view === 'store' && <>
        {soCloseStrip}
        <FamilyGoalsSection myKidId={myKidId} />
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
              const canAfford = spendable >= reward.pointsCost;
              const remaining = reward.pointsCost - spendable;
              const progress = Math.min(100, (spendable / reward.pointsCost) * 100);
              const pendingReq = isKid ? pendingByReward.get(reward.id) : undefined;
              const lockedNow = isRewardLocked(reward) || isAgeGated(reward);
              return (
                <div
                  key={reward.id}
                  className={`bg-white border rounded-kaya-lg p-5 transition-colors ${
                    lockedNow ? 'border-kaya-warm-dark/50 opacity-70 grayscale-[35%]' : canAfford ? 'border-kaya-gold/60' : 'border-kaya-warm-dark/70'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-14 h-14 rounded-[16px] bg-kaya-warm/60 flex items-center justify-center text-3xl shrink-0">
                      {reward.icon}
                    </div>
                    {lockedNow ? lockChip(reward) : canAfford && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-kaya-gold">Ready</span>
                    )}
                  </div>
                  <p className="font-display font-bold text-base mb-1">{reward.title}</p>
                  <p className="text-[12px] text-kaya-sand leading-snug mb-2 min-h-[32px]">{reward.description}</p>
                  <div className="mb-2">{countLine(reward.id)}</div>

                  <div className="mb-3">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="font-display font-extrabold text-xl text-kaya-gold">{fmt(reward.pointsCost)}<span className="text-[11px] text-kaya-sand font-semibold ml-1">pts</span></span>
                      {!canAfford && child && (
                        <span className="text-[11px] text-kaya-sand font-semibold">
                          Need {fmt(remaining)} more{paceLabel(remaining) ? ` · ${paceLabel(remaining)} 💪` : ''}
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 bg-kaya-warm rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${progress}%`, backgroundColor: canAfford ? '#D4A017' : (child?.houseColor || '#C4B89A') }}
                      />
                    </div>
                  </div>

                  {lockedNow ? (
                    <div className="w-full h-10 flex items-center justify-center rounded-kaya-sm bg-kaya-warm text-[12px] font-bold text-kaya-sand">
                      {lockLine(reward)}
                    </div>
                  ) : pendingReq ? (
                    <div className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-kaya-sm bg-kaya-gold-light">
                      <span className="text-[11px] font-bold text-kaya-gold-dark">⏳ waiting for a parent</span>
                      <button onClick={() => kidCancelRequest(pendingReq)} className="text-[11px] font-bold text-kaya-sand hover:underline">cancel</button>
                    </div>
                  ) : (isParent || isKid) && (
                    <button
                      onClick={() => handleRedeem(reward)}
                      disabled={!canAfford || redeeming === reward.id}
                      className={`w-full h-10 rounded-kaya-sm text-[13px] font-bold transition-colors ${
                        canAfford
                          ? 'bg-kaya-gold text-white hover:bg-kaya-gold-dark'
                          : 'bg-kaya-warm text-kaya-sand cursor-not-allowed'
                      } disabled:opacity-50`}
                    >
                      {redeeming === reward.id ? 'Redeeming…' : !canAfford ? 'Not enough yet' : isKid ? 'Ask to redeem 🎁' : 'Redeem'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>}
      </div>

      {/* RWD PR1 (R2) — kid confirm sheet: what it costs, what's left to
          spend, the 🛡 floor staying safe, then ask (or instant when the
          family's auto-approve threshold covers it). */}
      {confirmFor && child && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setConfirmFor(null)} />
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white rounded-t-3xl shadow-2xl z-50 p-5 pb-8">
            <div className="w-12 h-1 rounded-full bg-kaya-warm-dark/60 mx-auto mb-4" />
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-[14px] bg-kaya-warm/60 flex items-center justify-center text-2xl">{confirmFor.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-display font-extrabold text-base">{confirmFor.title}</p>
                <p className="text-[12px] text-kaya-sand">{fmt(confirmFor.pointsCost)} pts</p>
              </div>
            </div>
            <p className="text-[12.5px] font-semibold mb-1">
              After this you&rsquo;ll have <b>{fmt(spendable - confirmFor.pointsCost)}</b> to spend
              {floor > 0 && <> — and your 🛡 {fmt(floor)} stays safe</>}.
            </p>
            {/* R19 — keep saving visible at spend time. */}
            {stillAffordableAfter(confirmFor.pointsCost).length > 0 && (
              <p className="text-[11.5px] text-kaya-sand font-semibold mb-1">
                Still enough for {stillAffordableAfter(confirmFor.pointsCost).map((r) => `${r.icon} ${r.title}`).join(' and ')}.
              </p>
            )}
            <p className="text-[11.5px] text-kaya-sand mb-4">
              {autoBelow > 0 && confirmFor.pointsCost <= autoBelow
                ? 'This one is small enough to redeem right away. 🎉'
                : 'A parent will get your request and reply with a note.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={kidConfirmRedeem}
                className="flex-1 h-11 rounded-kaya-sm bg-kaya-gold text-white text-[13px] font-bold hover:bg-kaya-gold-dark"
              >
                {autoBelow > 0 && confirmFor.pointsCost <= autoBelow ? 'Redeem now 🎁' : 'Ask to redeem 🎁'}
              </button>
              <button onClick={() => setConfirmFor(null)} className="h-11 px-4 rounded-kaya-sm border border-kaya-warm-dark text-[13px] font-bold">
                Not now
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
