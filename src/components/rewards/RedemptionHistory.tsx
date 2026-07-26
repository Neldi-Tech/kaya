'use client';

// 📜 Redemption history (RWD PR2 · R11/R12/R15) — the store's History tab.
// Kids see ONLY their own rows and get the 💬 feedback prompt on enjoyed
// redemptions; parents see the whole family with kid + reward filters.
// Status chips: ✓ approved / ⏳ pending (live requests) / ✕ declined.
// Legacy rows (pre-status) read as approved instant redemptions.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRedemptions, type Redemption } from '@/lib/firestore';
import { subscribeToPendingApprovals, subscribeToKidRequests, type ApprovalRequest } from '@/lib/hive';
import { toDisplayDate } from '@/lib/dates';

const fmt = (n: number) => n.toLocaleString('en-US');
const REACTION_META = [
  { key: 'loved' as const, emoji: '😍', label: 'Loved it' },
  { key: 'ok' as const, emoji: '🙂', label: 'It was OK' },
  { key: 'meh' as const, emoji: '😕', label: 'Could be better' },
];

function dateOf(r: { createdAt?: { toMillis?: () => number } }): string {
  const ms = r.createdAt?.toMillis?.();
  if (typeof ms !== 'number') return '';
  const d = new Date(ms);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return toDisplayDate(key) || key;
}

export default function RedemptionHistory({ myKidId }: { myKidId: string | null }) {
  const { profile, user } = useAuth();
  const { children } = useFamily();
  const familyId = profile?.familyId;
  const isKid = profile?.role === 'kid';

  const [rows, setRows] = useState<Redemption[]>([]);
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [kidFilter, setKidFilter] = useState<string | null>(null);
  const [rewardFilter, setRewardFilter] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [fbText, setFbText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!familyId) return;
    getRedemptions(familyId, 100).then(setRows).catch(() => setRows([]));
  }, [familyId, refreshTick]);

  // Live ⏳ rows — the kid's own, or the whole family's for parents.
  useEffect(() => {
    if (!familyId) return;
    if (isKid && myKidId) return subscribeToKidRequests(familyId, myKidId, setPending);
    if (!isKid) return subscribeToPendingApprovals(familyId, setPending);
  }, [familyId, isKid, myKidId]);
  const pendingRewards = useMemo(
    () => pending.filter((r) => r.type === 'reward_redeem' && r.status === 'pending'),
    [pending],
  );

  const visible = useMemo(() => {
    let out = rows;
    if (isKid && myKidId) out = out.filter((r) => r.childId === myKidId);
    if (!isKid && kidFilter) out = out.filter((r) => r.childId === kidFilter);
    if (rewardFilter) out = out.filter((r) => r.rewardId === rewardFilter);
    return out;
  }, [rows, isKid, myKidId, kidFilter, rewardFilter]);

  const rewardOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.rewardId && !seen.has(r.rewardId)) seen.set(r.rewardId, r.rewardTitle);
    return Array.from(seen.entries());
  }, [rows]);

  const kidName = (id: string) => children.find((c) => c.id === id)?.name?.split(' ')[0] || 'Kid';
  const kidEmoji = (id: string) => children.find((c) => c.id === id)?.avatarEmoji || '🧒';

  const sendFeedback = async (redemptionId: string, reaction: 'loved' | 'ok' | 'meh') => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      await fetch('/api/rewards/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ redemptionId, reaction, text: fbText }),
      });
      setFeedbackFor(null); setFbText('');
      setRefreshTick((t) => t + 1);
    } finally { setBusy(false); }
  };

  const chip = (status?: string) =>
    status === 'rejected'
      ? <span className="text-[10px] font-bold text-hive-rose bg-[#FCEAEA] rounded-full px-2 py-0.5 shrink-0">✕ declined</span>
      : <span className="text-[10px] font-bold text-pantry-leaf-dk bg-[#E7F5EC] rounded-full px-2 py-0.5 shrink-0">✓ approved</span>;

  return (
    <div className="space-y-3">
      {/* Parent filters */}
      {!isKid && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setKidFilter(null)} className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border ${!kidFilter ? 'bg-kaya-gold text-white border-kaya-gold-dark' : 'bg-white border-kaya-warm-dark/60'}`}>All kids</button>
          {children.map((c) => (
            <button key={c.id} onClick={() => setKidFilter(kidFilter === c.id ? null : c.id)} className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border ${kidFilter === c.id ? 'bg-kaya-gold text-white border-kaya-gold-dark' : 'bg-white border-kaya-warm-dark/60'}`}>{c.avatarEmoji || '🧒'} {c.name.split(' ')[0]}</button>
          ))}
          {rewardOptions.length > 0 && (
            <select
              value={rewardFilter ?? ''}
              onChange={(e) => setRewardFilter(e.target.value || null)}
              className="px-2 py-1 rounded-full text-[11px] font-extrabold border border-kaya-warm-dark/60 bg-white"
              aria-label="Filter by reward"
            >
              <option value="">All rewards</option>
              {rewardOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          )}
        </div>
      )}

      {/* ⏳ live pending rows */}
      {pendingRewards.map((r) => (
        <div key={r.id} className="bg-white border border-dashed border-kaya-gold/60 rounded-kaya p-3 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-kaya-gold-light flex items-center justify-center text-[15px] shrink-0">{kidEmoji(r.kidId)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold truncate">{r.rewardIcon || '🎁'} {r.rewardTitle}</p>
            <p className="text-[11px] text-kaya-sand">{isKid ? 'you asked' : kidName(r.kidId)} · {fmt(r.rewardPointsCost || 0)} pts</p>
          </div>
          <span className="text-[10px] font-bold text-kaya-gold-dark bg-kaya-gold-light rounded-full px-2 py-0.5 shrink-0">⏳ pending</span>
        </div>
      ))}

      {/* History rows */}
      {visible.length === 0 && pendingRewards.length === 0 && (
        <p className="text-[12px] text-kaya-sand font-semibold text-center py-6">No redemptions yet — the story starts with the first one! 🎁</p>
      )}
      {visible.map((r) => (
        <div key={r.id} className="bg-white border border-kaya-warm-dark/70 rounded-kaya p-3">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">{kidEmoji(r.childId)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate">{r.rewardTitle}</p>
              <p className="text-[11px] text-kaya-sand truncate">
                {!isKid && <>{kidName(r.childId)} · </>}{dateOf(r)} · −{fmt(r.pointsSpent)} pts
                {r.approvedBy === 'auto' && ' · ⚡ auto'}
              </p>
              {r.note && <p className="text-[11px] text-kaya-sand italic truncate">💬 &ldquo;{r.note}&rdquo;</p>}
            </div>
            {chip(r.status)}
          </div>

          {/* 💬 the kid's reaction — shown to everyone once given; kids can set/change theirs. */}
          {r.feedback ? (
            <p className="text-[11.5px] font-semibold mt-1.5 pl-10">
              {REACTION_META.find((m) => m.key === r.feedback!.reaction)?.emoji} {REACTION_META.find((m) => m.key === r.feedback!.reaction)?.label}
              {r.feedback.text && <span className="text-kaya-sand italic"> — &ldquo;{r.feedback.text}&rdquo;</span>}
              {isKid && r.status !== 'rejected' && (
                <button onClick={() => setFeedbackFor(feedbackFor === r.id ? null : r.id)} className="ml-2 text-[10.5px] text-kaya-gold-dark font-bold hover:underline">change</button>
              )}
            </p>
          ) : (isKid && r.status !== 'rejected' && (
            <div className="mt-1.5 pl-10">
              <button onClick={() => setFeedbackFor(feedbackFor === r.id ? null : r.id)} className="text-[11.5px] font-bold text-kaya-gold-dark hover:underline">
                💬 How was it?
              </button>
            </div>
          ))}
          {feedbackFor === r.id && (
            <div className="mt-2 pl-10 space-y-1.5">
              <input
                value={fbText}
                onChange={(e) => setFbText(e.target.value)}
                placeholder="Say more… (optional)"
                maxLength={200}
                className="w-full rounded-kaya-sm border border-kaya-warm-dark/60 px-3 py-1.5 text-[12px]"
              />
              <div className="flex gap-1.5">
                {REACTION_META.map((m) => (
                  <button key={m.key} disabled={busy} onClick={() => sendFeedback(r.id, m.key)} className="px-2.5 py-1.5 rounded-full text-[11.5px] font-extrabold border border-kaya-warm-dark/60 bg-white hover:border-kaya-gold disabled:opacity-50">
                    {m.emoji} {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
