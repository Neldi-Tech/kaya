'use client';
// 🏆 Meeting awards — the parents' inbox (approved design v2, 21-Sep-2026 ·
// S13/S14 · R16, R19). Where the bundled push + the Home approvals line land.
//
// Every award a kid proposed at the Sunday meeting waits here until a parent
// decides — it never expires. One card each: the evidence Kaya re-checked,
// the family's set amount on a stepper, a RichNote with ✨ Draft with AI,
// Approve / Decline — plus "Approve all N waiting" with one shared note.
// Kids who open the page see what is waiting (read-only).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { readPointSystemConfig } from '@/lib/firestore';
import { Page, PageHeader } from '@/components/layout/Page';
import RichNote, { RichNoteText } from '@/components/ui/RichNote';
import MeetingAwardDecision from '@/components/meetings/MeetingAwardDecision';
import { listMeetingAwards, decideMeetingAward, MeetingAwardError, type MeetingAwardProposal } from '@/lib/meetingAwards';
import { awardTitle, meetingAwardErrorText } from '@/lib/meetingAwards.shared';

export default function MeetingAwardsInboxPage() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const isParent = profile?.role === 'parent';
  const diamondMin = readPointSystemConfig(family).diamondMinPoints;
  const [waiting, setWaiting] = useState<MeetingAwardProposal[] | null>(null);
  const [done, setDone] = useState<Array<{ p: MeetingAwardProposal; status: string; finalPoints: number; note: string }>>([]);
  const [allNote, setAllNote] = useState('');
  const [allBusy, setAllBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!profile?.familyId) return;
    try {
      const r = await listMeetingAwards(profile.familyId, { pending: true });
      setWaiting(r.proposals.filter((x) => !x.direct));
    } catch (e) {
      setWaiting([]);
      setErr(meetingAwardErrorText(e instanceof MeetingAwardError ? e.code : 'failed'));
    }
  }, [profile?.familyId]);
  useEffect(() => { void load(); }, [load]);

  const approveAll = async () => {
    if (!profile?.familyId || !waiting || allBusy) return;
    if (allNote.trim().split(/\s+/).filter(Boolean).length < 2) { setErr(meetingAwardErrorText('note-required')); return; }
    setAllBusy(true); setErr('');
    for (const p of waiting.filter((x) => x.status === 'pending')) {
      try {
        const r = await decideMeetingAward({ familyId: profile.familyId, me: profile, proposal: p, decision: 'approve', finalPoints: p.points, note: allNote, diamondMinPoints: diamondMin });
        setDone((d) => [...d, { p, status: r.status, finalPoints: r.finalPoints, note: allNote }]);
        setWaiting((w) => (w || []).filter((x) => x.id !== p.id));
      } catch (e) {
        setErr(meetingAwardErrorText(e instanceof MeetingAwardError ? e.code : 'failed'));
        break;
      }
    }
    setAllBusy(false);
  };

  const pendingCount = (waiting || []).filter((x) => x.status === 'pending').length;

  return (
    <Page width="narrow" className="pb-24">
      <PageHeader>
        <Link href="/meetings" className="text-[12px] font-bold text-kaya-sand">‹ Family Meetings</Link>
        <h1 className="font-display text-2xl lg:text-3xl font-black text-kaya-chocolate mt-1">🏆 Meeting awards</h1>
        <p className="text-[13px] text-kaya-sand mt-0.5">
          {isParent ? 'Proposed by the kids at the Sunday meeting — you decide. Nothing here expires.' : 'Waiting for a parent to decide. Nothing here expires.'}
        </p>
      </PageHeader>

      {err && <p className="text-[12.5px] font-bold text-red-600 mb-3">⚠️ {err}</p>}
      {waiting === null && <p className="text-[13px] text-kaya-sand py-6">Loading…</p>}

      {waiting !== null && waiting.length === 0 && done.length === 0 && (
        <div className="rounded-2xl border border-kaya-warm-dark bg-white p-6 text-center">
          <p className="text-3xl mb-1" aria-hidden>🧹</p>
          <p className="font-display font-black text-kaya-chocolate">All decided</p>
          <p className="text-[13px] text-kaya-sand mt-1">When a kid proposes a Star, Belt or Ladder bonus at the meeting, it lands here.</p>
        </div>
      )}

      {isParent && pendingCount > 1 && (
        <div className="rounded-2xl border border-[#EFD9A0] bg-[#FFF7E5] p-4 mb-4">
          <p className="font-display font-black text-[14px] text-kaya-chocolate">Approve all {pendingCount} waiting</p>
          <p className="text-[12px] text-kaya-sand font-bold mb-2">One note goes to everyone — at the family&apos;s set amounts.</p>
          <RichNote value={allNote} onChange={setAllNote} tone="light" rows={2} maxLength={600} placeholder="A note for the kids — they read it on the meeting screen" ariaLabel="Note for all the awards" />
          <button type="button" onClick={approveAll} disabled={allBusy} className="mt-2.5 h-10 px-4 rounded-full bg-[#1F2A44] text-white font-black text-[13px] disabled:opacity-50">
            {allBusy ? 'Approving…' : `✓ Approve all ${pendingCount} waiting`}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {(waiting || []).map((p) => (isParent && p.status === 'pending' && profile?.familyId ? (
          <MeetingAwardDecision
            key={p.id} proposal={p} familyId={profile.familyId} me={profile} diamondMinPoints={diamondMin}
            onDone={(r) => { setDone((d) => [...d, { p, status: r.status, finalPoints: r.finalPoints, note: r.note }]); setWaiting((w) => (w || []).filter((x) => x.id !== p.id)); }}
          />
        ) : (
          <div key={p.id} className="rounded-2xl bg-white border border-kaya-warm-dark p-4">
            <p className="font-display font-black text-[14px] text-kaya-chocolate">{awardTitle(p)} → {p.childEmoji} {p.childName.split(' ')[0]} · +{p.points}</p>
            <p className="text-[12px] text-kaya-sand font-bold mt-0.5">
              {p.status === 'resolving' ? 'A parent is deciding this one right now…' : `⏳ Proposed by ${p.proposedByName.split(' ')[0]} · ${p.rangeLabel} · waiting for a parent`}
            </p>
          </div>
        )))}
        {done.map(({ p, status, finalPoints, note }) => (
          <div key={`d-${p.id}`} className={`rounded-2xl border p-4 ${status === 'declined' ? 'bg-[#FDE8E8] border-[#F3B9BD]' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="font-display font-black text-[14px] text-kaya-chocolate">
              {status === 'declined' ? '✕' : '✓'} {awardTitle(p)} → {p.childEmoji} {p.childName.split(' ')[0]}{status === 'declined' ? ' · declined' : ` · +${finalPoints}${status === 'adjusted' ? ' (adjusted)' : ''}`}
            </p>
            <p className="text-[12px] text-kaya-chocolate/75 italic mt-0.5">“<RichNoteText text={note} />”</p>
          </div>
        ))}
      </div>
    </Page>
  );
}
