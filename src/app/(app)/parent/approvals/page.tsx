'use client';

// /parent/approvals — pending request inbox. Reads pending money requests
// from HiveContext (real-time across all kids) and renders each as an
// ApprovalRequestCard. Kaya Games wins worth House Points also surface here
// (in their own section) so a parent has one place to clear everything — the
// dedicated /games/approvals queue shows the same items.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { useAuth } from '@/contexts/AuthContext';
import ApprovalRequestCard from '@/components/hive/ApprovalRequestCard';
import GameApprovalCard from '@/components/games/GameApprovalCard';
import BackButton from '@/components/ui/BackButton';
import RequestsHistory from '@/components/parent/RequestsHistory';
import { subscribeToPendingGameApprovals } from '@/lib/gamesApprovals';
import type { GamePlay } from '@/lib/games';
import { listLeaderNotes, type LeaderNote } from '@/lib/leaderWeek';
import { listMeetingAwards, type MeetingAwardProposal } from '@/lib/meetingAwards';
import { awardTitle } from '@/lib/meetingAwards.shared';
import { Page } from '@/components/layout/Page';

export default function ParentApprovalsPage() {
  const { pendingApprovals: allPending } = useHive();
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  // 💡 RWI PR-A — reward IDEAS resolve in Manage Rewards (approve = create
  // the reward there, pre-filled). Keep them out of this money inbox and
  // point across instead.
  const pendingApprovals = allPending.filter((r) => r.type !== 'reward_proposal');
  const ideaCount = allPending.length - pendingApprovals.length;

  const [tab, setTab] = useState<'waiting' | 'history'>('waiting');
  const [gamePlays, setGamePlays] = useState<GamePlay[]>([]);
  useEffect(() => {
    if (!familyId || !isParent) return;
    const unsub = subscribeToPendingGameApprovals(familyId, setGamePlays);
    return () => unsub();
  }, [familyId, isParent]);

  // 🏆 Meeting awards + 👑 Leader notes the kids proposed at the Sunday
  // meeting. These live in their own gateway-backed collections (not Hive
  // approvalRequests), so without this they never appeared on THIS page —
  // only on the Home banner. Same gateway idiom + poll the banner uses.
  const [meetingAwards, setMeetingAwards] = useState<MeetingAwardProposal[]>([]);
  const [leaderNotes, setLeaderNotes] = useState<LeaderNote[]>([]);
  useEffect(() => {
    if (!familyId || !isParent) return;
    let alive = true;
    const tick = () => {
      listMeetingAwards(familyId, { pending: true })
        .then((r) => { if (alive) setMeetingAwards(r.proposals.filter((x) => !x.direct && x.status === 'pending')); })
        .catch(() => {});
      listLeaderNotes(familyId, { status: 'pending' })
        .then((r) => { if (alive) setLeaderNotes(r.notes); })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, [familyId, isParent]);

  const waitingCount = pendingApprovals.length + gamePlays.length + meetingAwards.length + leaderNotes.length;
  const nothing = waitingCount === 0;

  // Web-Fit (2026-08-23): content tier. Header keeps its inline "Rates →"
  // action; pending cards lay out 2-up at lg (each card keeps its
  // designed width). Mobile markup unchanged.
  return (
    <Page width="content">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · The Hive</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1">Approvals</h1>
        </div>
        <Link href="/parent/rates" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          Rates →
        </Link>
      </div>

      {/* Waiting / History tabs */}
      <div className="flex gap-1 bg-[#FFF3D9] rounded-full p-1 mb-5">
        <button
          type="button"
          onClick={() => setTab('waiting')}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-nunito font-extrabold transition-colors ${
            tab === 'waiting' ? 'bg-hive-paper text-hive-navy shadow-sm' : 'text-hive-honey-dk'
          }`}
        >
          Waiting{waitingCount > 0 ? ` · ${waitingCount}` : ''}
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-nunito font-extrabold transition-colors ${
            tab === 'history' ? 'bg-hive-paper text-hive-navy shadow-sm' : 'text-hive-honey-dk'
          }`}
        >
          History
        </button>
      </div>

      {ideaCount > 0 && tab === 'waiting' && (
        <Link href="/parent/rewards" className="flex items-center justify-between gap-2 bg-hive-paper border border-hive-line rounded-hive-lg px-4 py-3 mb-4 hover:shadow-sm transition-shadow">
          <p className="font-nunito font-extrabold text-[13px]">💡 {ideaCount} reward idea{ideaCount === 1 ? '' : 's'} from the kids</p>
          <span className="text-[12px] font-nunito font-extrabold text-hive-honey-dk">Review in Manage Rewards →</span>
        </Link>
      )}
      {tab === 'history' ? (
        <RequestsHistory />
      ) : nothing ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-10 text-center">
          <div className="text-5xl mb-3">📭</div>
          <p className="font-nunito font-extrabold text-[15px]">Inbox zero</p>
          <p className="text-hive-muted text-sm mt-1">
            Nothing waiting on your approval. New requests show up here in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingApprovals.length > 0 && (
            <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
              {pendingApprovals.map((r) => (
                <ApprovalRequestCard key={r.id} req={r} />
              ))}
            </div>
          )}

          {gamePlays.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
                  🎮 Games · House Points
                </p>
                <Link href="/games/approvals" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                  Open queue →
                </Link>
              </div>
              <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
                {gamePlays.map((p) => (
                  <GameApprovalCard key={p.id} play={p} />
                ))}
              </div>
            </div>
          )}

          {meetingAwards.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
                  🏆 Meeting awards · House Points
                </p>
                <Link href="/meetings/awards" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                  Review &amp; approve →
                </Link>
              </div>
              <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
                {meetingAwards.map((m) => (
                  <Link key={m.id} href="/meetings/awards" className="block bg-hive-paper border border-hive-line rounded-hive-lg p-3 hover:shadow-sm transition-shadow">
                    <p className="font-nunito font-extrabold text-[13px] text-hive-ink">
                      {awardTitle(m)} → {(m.childName || '').split(' ')[0]} · +{m.points}
                    </p>
                    <p className="text-[11px] text-hive-muted mt-0.5">
                      Proposed by {(m.proposedByName || 'the leader').split(' ')[0]} · {m.rangeLabel} · tap to review →
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {leaderNotes.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
                  👑 Leader notes
                </p>
                <Link href="/parent/leader" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                  Review &amp; approve →
                </Link>
              </div>
              <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
                {leaderNotes.map((n) => {
                  const who = n.targetChildId === n.leaderChildId ? 'themselves' : (n.targetName || 'a sibling').split(' ')[0];
                  const pts = n.proposedPoints > 0 ? `+${n.proposedPoints}` : n.proposedPoints === 0 ? 'note only' : `${n.proposedPoints}`;
                  return (
                    <Link key={n.id} href="/parent/leader" className="block bg-hive-paper border border-hive-line rounded-hive-lg p-3 hover:shadow-sm transition-shadow">
                      <p className="font-nunito font-extrabold text-[13px] text-hive-ink">
                        {n.kind === 'shoutout' ? '⭐' : '📝'} {(n.leaderName || 'Leader').split(' ')[0]} noted {who} · {pts}
                      </p>
                      <p className="text-[11px] text-hive-muted mt-0.5 truncate">
                        {n.reason} · tap to review →
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
