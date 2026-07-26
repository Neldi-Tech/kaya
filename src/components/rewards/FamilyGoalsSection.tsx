'use client';

// 👨‍👩‍👧 Family goals (RWD PR5 · R24–R28) — the pool cards on the store:
// team progress, per-kid contribution chips (equal shares or open pool),
// the parent's advice note, team run-rate, chip-in via the family approval
// queue, cheering state for kids under the age gate, and the 🎊 reached →
// parent-fulfil close-out. Approved v2 FINAL 26-Jul-2026.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { isKidInFamilyGoals, updateReward, type Reward } from '@/lib/firestore';
import {
  requestRewardContribution, subscribeToKidRequests,
  type ApprovalRequest,
} from '@/lib/hive';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function FamilyGoalsSection({ myKidId }: { myKidId: string | null }) {
  const { profile } = useAuth();
  const { family, children, rewards, refresh } = useFamily();
  const familyId = profile?.familyId;
  const isKid = profile?.role === 'kid';
  const isParent = profile?.role === 'parent';
  const cfg = family?.rewardsConfig;

  const goals = useMemo(
    () => rewards.filter((r) => r.kind === 'family' && r.active && !r.fulfilled),
    [rewards],
  );

  const included = useMemo(
    () => children.filter((c) => isKidInFamilyGoals(cfg, c)),
    [children, cfg],
  );

  const [myRequests, setMyRequests] = useState<ApprovalRequest[]>([]);
  useEffect(() => {
    if (!isKid || !familyId || !myKidId) return;
    return subscribeToKidRequests(familyId, myKidId, setMyRequests);
  }, [isKid, familyId, myKidId]);
  const pendingGoalIds = useMemo(
    () => new Set(myRequests.filter((r) => r.type === 'reward_contribute' && r.status === 'pending').map((r) => r.rewardId)),
    [myRequests],
  );

  const [chipFor, setChipFor] = useState<Reward | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (goals.length === 0) return null;

  const meIncluded = isKid && myKidId ? included.some((c) => c.id === myKidId) : false;
  const teamWeekly = included.reduce((s, c) => s + Math.max(0, c.weeklyPoints || 0), 0);

  const shareFor = (goal: Reward): number =>
    goal.poolMode === 'equal' && included.length > 0
      ? Math.ceil((goal.targetPoints || 0) / included.length)
      : 0;

  const openChipIn = (goal: Reward) => {
    const share = shareFor(goal);
    const mine = myKidId ? (goal.contributions?.[myKidId] ?? 0) : 0;
    setAmount(String(share > 0 ? Math.max(1, share - mine) : 25));
    setChipFor(goal);
  };

  const sendChipIn = async () => {
    const goal = chipFor;
    const pts = parseInt(amount, 10);
    if (!goal || !familyId || !myKidId || !profile?.uid || busy) return;
    if (!Number.isFinite(pts) || pts <= 0) { setMsg('Pick a positive amount.'); return; }
    setBusy(true);
    try {
      await requestRewardContribution(familyId, myKidId, { id: goal.id, title: goal.title, icon: goal.icon }, pts, profile.uid);
      setMsg(`⏳ Asked! Your ${fmt(pts)}-point chip-in is with a parent.`);
      setChipFor(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send it.');
    } finally { setBusy(false); setTimeout(() => setMsg(''), 4000); }
  };

  const markFulfilled = async (goal: Reward) => {
    if (!familyId || !profile?.uid || busy) return;
    setBusy(true);
    try {
      await updateReward(familyId, goal.id, { fulfilled: true } as Partial<Reward>);
      // Family history row — the goal's close-out (childId 'family').
      await addDoc(collection(db, 'families', familyId, 'redemptions'), {
        childId: 'family',
        rewardId: goal.id,
        rewardTitle: `👨‍👩‍👧 ${goal.title}`,
        pointsSpent: goal.contributedTotal ?? goal.targetPoints ?? 0,
        status: 'approved',
        approvedBy: profile.uid,
        createdAt: serverTimestamp(),
      });
      await refresh?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="mb-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-2">👨‍👩‍👧 Family goals</p>
      {msg && <p className="text-[12px] font-bold rounded-kaya-sm px-3 py-2 mb-2 bg-kaya-gold-light text-kaya-chocolate">{msg}</p>}
      {goals.map((goal) => {
        const target = goal.targetPoints || 0;
        const done = goal.contributedTotal ?? 0;
        const pct = target > 0 ? Math.min(100, (done / target) * 100) : 0;
        const reached = !!goal.goalReachedAt || (target > 0 && done >= target);
        const share = shareFor(goal);
        const remaining = Math.max(0, target - done);
        const weeks = teamWeekly > 0 && remaining > 0 ? Math.ceil(remaining / teamWeekly) : null;
        return (
          <div key={goal.id} className="bg-gradient-to-br from-kaya-gold-light/50 to-white border-2 border-kaya-gold/40 rounded-kaya-lg p-4 mb-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-display font-extrabold text-[15px]">{goal.icon} {goal.title}</p>
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-kaya-gold-dark bg-kaya-gold-light rounded-full px-2 py-0.5 shrink-0">
                {goal.poolMode === 'equal' ? 'equal shares' : 'open pool'} · family goal
              </span>
            </div>
            <p className="text-[12px] text-kaya-sand font-semibold mt-0.5">
              {fmt(done)} / {fmt(target)} pts
              {!reached && weeks !== null && <> · as a team ≈ <b>{weeks} week{weeks > 1 ? 's' : ''}</b> to go</>}
            </p>
            <div className="h-2.5 bg-kaya-warm rounded-full overflow-hidden my-2">
              <div className="h-full rounded-full bg-gradient-to-r from-kaya-gold to-kaya-gold-dark transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {children.map((c) => {
                const inGoal = included.some((i) => i.id === c.id);
                const mine = goal.contributions?.[c.id] ?? 0;
                const full = share > 0 && mine >= share;
                return (
                  <span key={c.id} className={`text-[10.5px] font-extrabold rounded-full px-2 py-0.5 border ${
                    !inGoal ? 'bg-white border-kaya-warm-dark/50 text-kaya-sand'
                      : full ? 'bg-[#E7F5EC] border-[#bfe0cc] text-pantry-leaf-dk'
                        : 'bg-kaya-gold-light border-kaya-gold/50 text-kaya-chocolate'
                  }`}>
                    {c.avatarEmoji || '🧒'} {!inGoal ? 'cheering 📣' : share > 0 ? `${fmt(mine)}/${fmt(share)}${full ? ' ✓' : ''}` : fmt(mine)}
                  </span>
                );
              })}
            </div>
            {goal.parentNote && <p className="text-[11.5px] text-kaya-sand italic mb-1.5">💬 {goal.parentNote}</p>}
            {reached ? (
              <div className="flex items-center justify-between gap-2 rounded-kaya-sm bg-[#E7F5EC] border border-[#bfe0cc] px-3 py-2">
                <p className="text-[12.5px] font-extrabold text-pantry-leaf-dk">🎊 Goal reached — the team did it!</p>
                {isParent && (
                  <button onClick={() => markFulfilled(goal)} disabled={busy}
                    className="px-3 py-1.5 rounded-kaya-sm bg-kaya-gold text-white text-[11.5px] font-bold hover:bg-kaya-gold-dark disabled:opacity-50">
                    Mark fulfilled 🎉
                  </button>
                )}
              </div>
            ) : isKid && meIncluded && (
              pendingGoalIds.has(goal.id) ? (
                <p className="text-[11.5px] font-bold text-kaya-gold-dark">⏳ your chip-in is with a parent</p>
              ) : (
                <button onClick={() => openChipIn(goal)}
                  className="w-full h-10 rounded-kaya-sm bg-kaya-gold text-white text-[13px] font-bold hover:bg-kaya-gold-dark">
                  Chip in my points 🪙
                </button>
              )
            )}
            {isKid && !meIncluded && !reached && (
              <p className="text-[11.5px] font-bold text-kaya-sand">📣 You&rsquo;re on cheering duty for this one — go team!</p>
            )}
          </div>
        );
      })}

      {chipFor && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setChipFor(null)} />
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white rounded-t-3xl shadow-2xl z-50 p-5 pb-8">
            <div className="w-12 h-1 rounded-full bg-kaya-warm-dark/60 mx-auto mb-4" />
            <p className="font-display font-extrabold text-base mb-1">{chipFor.icon} Chip in to {chipFor.title}</p>
            <p className="text-[12px] text-kaya-sand mb-3">
              {shareFor(chipFor) > 0
                ? `Your equal share is ${fmt(shareFor(chipFor))} pts — chip in any amount towards it.`
                : 'Open pool — chip in whatever you like; volunteers can carry more! 🚀'}
            </p>
            <input
              type="number" min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-kaya-sm border border-kaya-warm-dark/70 px-4 py-3 text-lg font-black text-center mb-3"
              aria-label="Points to chip in"
            />
            <div className="flex gap-2">
              <button onClick={sendChipIn} disabled={busy}
                className="flex-1 h-11 rounded-kaya-sm bg-kaya-gold text-white text-[13px] font-bold hover:bg-kaya-gold-dark disabled:opacity-50">
                Ask to chip in 🪙
              </button>
              <button onClick={() => setChipFor(null)} className="h-11 px-4 rounded-kaya-sm border border-kaya-warm-dark text-[13px] font-bold">
                Not now
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
