'use client';

import { useState } from 'react';
import { StatusPill } from './StatusPill';
import { SparkAvatar } from './Avatar';
import {
  categoryLabel,
  type Spark, type SparkStatus, type SparkTargetWindow,
} from '@/lib/sparks';
import { toggleUpvote, transitionSpark } from '@/lib/sparksClient';
import { toDisplayDate } from '@/lib/dates';

const WINDOWS: { value: SparkTargetWindow; label: string }[] = [
  { value: 'Q3 2026',     label: 'Q3 2026' },
  { value: 'Q4 2026',     label: 'Q4 2026' },
  { value: 'Q1 2027',     label: 'Q1 2027' },
  { value: 'No date yet', label: 'No date yet' },
];

export function IdeaCard({
  spark,
  isOperator,
  onChange,
}: { spark: Spark; isOperator: boolean; onChange: () => void }) {
  const [voting, setVoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState({ voted: spark.iVoted, count: spark.upvoteCount });

  async function onVote() {
    if (voting) return;
    setVoting(true);
    setOptimistic((o) => ({ voted: !o.voted, count: o.count + (o.voted ? -1 : 1) }));
    try {
      const res = await toggleUpvote(spark.id);
      setOptimistic({ voted: res.voted, count: res.upvoteCount });
    } catch {
      setOptimistic({ voted: spark.iVoted, count: spark.upvoteCount });
    } finally {
      setVoting(false);
    }
  }

  async function setStatus(status: SparkStatus, window?: SparkTargetWindow) {
    setBusy(true);
    try {
      const isShipping = (status === 'live' || status === 'reward')
        && spark.status !== 'live' && spark.status !== 'reward';
      let confirmReward = false;
      if (isShipping) {
        confirmReward = window === undefined
          ? confirm(`Mark "${spark.title.slice(0, 40)}" as Live and credit the Spark reward to the contributing family's kids?`)
          : true;
        if (!confirmReward) { setBusy(false); return; }
      }
      await transitionSpark(spark.id, { status, comingSoonTargetWindow: window ?? null, confirmReward });
      onChange();
    } catch (e) {
      alert(`Transition failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-[20px] p-[18px] border border-[rgba(15,31,68,0.08)] flex flex-col gap-3 transition-transform hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,31,68,0.08)]">
      <div className="flex items-center justify-between">
        <StatusPill status={spark.status} />
        <span className="text-[11px] text-[#6E7791] font-semibold uppercase tracking-wider">{categoryLabel(spark.category)}</span>
      </div>
      <h4 className="font-display font-bold text-[17px] text-[#0F1F44] leading-[1.25] m-0">{spark.title}</h4>
      <p className="text-[#6E7791] text-[13px] leading-[1.5] m-0 line-clamp-3">{spark.body}</p>

      {isOperator && (
        <div className="bg-[#FFF9EC] border border-dashed border-[#D4A847] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2.5 flex-wrap">
          <div className="text-[11px] text-[#A07900] font-bold uppercase tracking-wider flex items-center gap-1.5">👑 Admin · pipeline</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {spark.postedAnonymously && spark.authorRealName && (
              <span className="text-[10px] text-[#6E7791] font-semibold mr-1.5" title="Real name visible to operators only">
                🕶 {spark.authorRealName}
              </span>
            )}
            <select
              value={spark.status}
              onChange={(e) => setStatus(e.target.value as SparkStatus, spark.comingSoonTargetWindow ?? undefined)}
              disabled={busy}
              className="text-[11px] bg-white border border-[rgba(15,31,68,0.08)] rounded-md px-1.5 py-1 font-semibold text-[#0F1F44]"
            >
              <option value="new">⚡ New</option>
              <option value="review">👀 Review</option>
              <option value="soon">🔮 Coming Soon</option>
              <option value="building">🛠 Building</option>
              <option value="live">✅ Live</option>
              <option value="reward">🌟 Reward</option>
            </select>
            {spark.status === 'soon' && (
              <select
                value={spark.comingSoonTargetWindow ?? 'No date yet'}
                onChange={(e) => setStatus('soon', e.target.value as SparkTargetWindow)}
                disabled={busy}
                className="text-[11px] bg-white border border-[rgba(15,31,68,0.08)] rounded-md px-1.5 py-1 font-semibold text-[#0F1F44]"
              >
                {WINDOWS.map((w) => <option key={String(w.value)} value={w.value ?? ''}>{w.label}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2.5 border-t border-dashed border-[rgba(15,31,68,0.08)]">
        <div className="flex items-center gap-2">
          <SparkAvatar avatarKey={spark.authorAvatarKey} displayName={spark.authorDisplayName} />
          <div>
            <div className="text-[12px] text-[#0F1F44] font-semibold">
              {spark.authorDisplayName}
              {spark.postedAnonymously && <span className="text-[#6E7791] font-medium text-[11px]"> · anonymous</span>}
            </div>
            <div className="text-[11px] text-[#6E7791]">
              {fmtDate(spark.createdAt)} · {spark.commentCount} {spark.commentCount === 1 ? 'comment' : 'comments'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onVote}
          disabled={voting}
          className={`px-3 py-1.5 rounded-full font-bold text-[13px] flex items-center gap-1.5 ${
            optimistic.voted
              ? 'bg-[#D4A847] text-white'
              : 'bg-[#FFF4D6] text-[#A07900]'
          } disabled:opacity-60`}
          aria-pressed={optimistic.voted}
        >
          ▲ {optimistic.count}
        </button>
      </div>
    </div>
  );
}

function fmtDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return toDisplayDate(iso);
}
