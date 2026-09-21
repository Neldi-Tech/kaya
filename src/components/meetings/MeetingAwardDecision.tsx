'use client';

// 🏆 Parent decision card — Approve · Adjust · Decline, always with a note
// for the kids (approved design v2, 21-Sep-2026 · S14 · R16).
//
// One card per waiting proposal: the evidence Kaya re-checked on the server,
// the family's set amount on a stepper (adjust if you wish), and the note in
// a RichNote with ✨ Draft with AI. The note is REQUIRED both ways (Elia's
// standing rule) and reaches the kids' 🔔 bell + the shared meeting screen.
// Approval rides the normal award rail, so badges, 🏅 emails and thresholds
// behave exactly as today.

import { useState } from 'react';
import { auth as fbAuth } from '@/lib/firebase';
import RichNote from '@/components/ui/RichNote';
import { awardTitle, meetingAwardErrorText, type MeetingAwardProposal } from '@/lib/meetingAwards.shared';
import { decideMeetingAward, MeetingAwardError } from '@/lib/meetingAwards';

export default function MeetingAwardDecision({
  proposal: p, familyId, me, diamondMinPoints, onDone,
}: {
  proposal: MeetingAwardProposal;
  familyId: string;
  me: { uid: string; displayName?: string | null };
  diamondMinPoints: number;
  onDone: (result: { id: string; status: MeetingAwardProposal['status']; finalPoints: number; note: string }) => void;
}) {
  const [points, setPoints] = useState(p.points);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [err, setErr] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [sugs, setSugs] = useState<string[]>([]);
  const [aiFor, setAiFor] = useState<'approve' | 'decline'>('approve');
  const kid = p.childName.split(' ')[0];

  const draft = async (decision: 'approve' | 'decline') => {
    if (aiBusy) return;
    setAiBusy(true); setErr(''); setAiFor(decision);
    try {
      const token = await fbAuth.currentUser?.getIdToken();
      const res = await fetch('/api/meetings/note-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          mode: 'decision', decision: decision === 'decline' ? 'decline' : points === p.points ? 'approve' : 'adjust',
          awardLabel: `${awardTitle(p)} · ${p.rangeLabel}`, kidName: kid, proposerName: p.proposedByName.split(' ')[0],
          points, proposedPoints: p.points, evidence: p.evidence, text: note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.skipped) { setErr('Kaya’s writing help isn’t switched on here — a few words of your own are perfect.'); return; }
      if (!res.ok || !Array.isArray(data?.suggestions)) { setErr(typeof data?.error === 'string' ? data.error : 'Kaya couldn’t write just now.'); return; }
      setSugs(data.suggestions as string[]);
    } catch { setErr('No connection — a few words of your own are perfect.'); }
    finally { setAiBusy(false); }
  };

  const decide = async (decision: 'approve' | 'decline') => {
    if (busy) return;
    setBusy(decision); setErr('');
    try {
      const r = await decideMeetingAward({ familyId, me, proposal: p, decision, finalPoints: points, note, diamondMinPoints });
      onDone({ id: p.id, status: r.status, finalPoints: r.finalPoints, note });
    } catch (e) {
      setErr(meetingAwardErrorText(e instanceof MeetingAwardError ? e.code : 'failed'));
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-2xl bg-white border border-kaya-warm-dark p-4 text-kaya-chocolate">
      <p className="font-display font-black text-[15px] leading-snug">{awardTitle(p)} → {p.childEmoji} {kid}</p>
      <p className="text-[12px] text-kaya-sand font-bold mt-0.5">Proposed by {p.proposedByName.split(' ')[0]} at the meeting · {p.rangeLabel}</p>
      <p className="mt-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] font-bold text-emerald-800 leading-relaxed">✓ Kaya checked: {p.evidence}</p>

      <div className="flex items-center gap-2 mt-3">
        <button type="button" aria-label="One point less" onClick={() => setPoints((n) => Math.max(1, n - 1))} className="w-9 h-9 rounded-xl border-[1.5px] border-kaya-warm-dark bg-white font-black text-lg">−</button>
        <b className="font-display text-2xl min-w-[52px] text-center">+{points}</b>
        <button type="button" aria-label="One point more" onClick={() => setPoints((n) => Math.min(50, n + 1))} className="w-9 h-9 rounded-xl border-[1.5px] border-kaya-warm-dark bg-white font-black text-lg">+</button>
        <span className="text-[11px] font-bold text-kaya-sand">{points === p.points ? 'family amount · adjust if you wish' : `adjusted from +${p.points}${points >= diamondMinPoints ? ' · Diamond' : ''}`}</span>
      </div>

      <div className="mt-3">
        <RichNote
          value={note} onChange={setNote} tone="light" rows={2} maxLength={600}
          placeholder={`A note for ${kid} and the family — they read it on the meeting screen`}
          aiLabel="✨ Draft with AI" onAi={() => draft('approve')} aiBusy={aiBusy}
          ariaLabel="Note to the kids"
        />
        {sugs.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[10.5px] font-black uppercase tracking-wider text-[#5A3CB8]">✨ Kaya suggests{aiFor === 'decline' ? ' (declining kindly)' : ''} — tap to use, then edit</p>
            {sugs.map((s) => (
              <button key={s} type="button" onClick={() => { setNote(s); setSugs([]); }} className="w-full text-left rounded-xl bg-[#EFE8FF] hover:bg-[#E3D8FF] px-3 py-2 text-[12.5px] font-bold text-[#3B2A8C] leading-snug">{s}</button>
            ))}
          </div>
        )}
      </div>

      {err && <p className="text-[12px] font-bold text-red-600 mt-2">⚠️ {err}</p>}
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={() => decide('approve')} disabled={!!busy} className="h-10 px-4 rounded-full bg-[#2E7D4F] text-white font-black text-[13px] disabled:opacity-50">
          {busy === 'approve' ? 'Saving…' : `✓ Approve +${points}`}
        </button>
        <button type="button" onClick={() => decide('decline')} disabled={!!busy} className="h-10 px-4 rounded-full bg-[#FDE8E8] text-[#D64550] font-black text-[13px] disabled:opacity-50">
          {busy === 'decline' ? 'Saving…' : 'Decline'}
        </button>
        <button type="button" onClick={() => draft('decline')} disabled={aiBusy} className="h-10 px-3 rounded-full text-[11.5px] font-black text-[#5A3CB8] disabled:opacity-50">✨ help me decline kindly</button>
      </div>
    </div>
  );
}
