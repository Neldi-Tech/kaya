'use client';
// 👑 Leader of the Week — parent hub (LW PR-L3/L4):
//   • this week's crown card (appoint / end / guide)
//   • 📒 notes inbox (S4): Approve · Adjust · Decline — claim → giveAward
//     (the existing rail: points, badge counters, 🏅 email, thresholds) →
//     finalize; release on failure so nothing double-awards
//   • decided notes history
//   • 👑 Leadership cards per kid (radar · style · counters · share PNG)
//   • 📖 Leader's Book — the advice chain written by the kids (idea B)
// Helpers may open the page read-only (inbox visible, no decide buttons).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { giveAward, readPointSystemConfig, type AwardKind } from '@/lib/firestore';
import {
  listLeaderNotes, claimLeaderNote, finalizeLeaderNote, releaseLeaderNote, listLeaderTerms, leaderErrorText,
  type LeaderNote, type LeaderTerm,
} from '@/lib/leaderWeek';
import { readLeaderConfig, noteBounds, NOTE_CATEGORIES } from '@/lib/leaderWeek.shared';
import LeaderHomeCard from '@/components/leader/LeaderHomeCard';
import LeadershipCard from '@/components/leader/LeadershipCard';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

const GOLD = '#B8860B';

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
const catLabel = (id: string) => NOTE_CATEGORIES.find((c) => c.id === id)?.label || id;

function NoteCard({ note, canDecide, familyId, onDone }: { note: LeaderNote; canDecide: boolean; familyId: string; onDone: () => void }) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const cfg = readLeaderConfig(family);
  const ps = readPointSystemConfig(family);
  const options = useMemo(() => noteBounds(note.kind, { reducing: ps.reducing, diamondMinPoints: ps.diamondMinPoints }), [note.kind, ps]);
  const [pts, setPts] = useState<number>(options.includes(note.proposedPoints) ? note.proposedPoints : (options[0] ?? 0));
  const [parentNote, setParentNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isSelf = note.targetChildId === note.leaderChildId;
  const leaderFirst = note.leaderName.split(' ')[0];
  const targetFirst = note.targetName.split(' ')[0];

  const decide = async (decision: 'approved' | 'adjusted' | 'declined') => {
    if (!profile || busy) return;
    if (decision === 'declined' && !parentNote.trim()) { setErr('Add a short note for the kids when you decline.'); return; }
    setBusy(decision); setErr(null);
    const finalPoints = decision === 'declined' ? 0 : pts;
    try {
      // 1) claim (pending → resolving; 409 if another parent got there first)
      await claimLeaderNote(familyId, note.id);
      let awardId: string | undefined;
      if (decision !== 'declined') {
        // 2) the award rail — EXACTLY as a parent award would run.
        const kind: AwardKind = finalPoints > 0 ? 'regular' : finalPoints < 0 ? 'reducing' : (note.kind === 'headsup' ? 'improvement_note' : 'kudos');
        const attribution = note.kind === 'shoutout' || cfg.headsUpAttribution === 'name'
          ? `noticed by 👑 ${leaderFirst}`
          : '👑 Leader’s note';
        try {
          const res = await giveAward(familyId, {
            childId: note.targetChildId,
            kind,
            points: finalPoints,
            reason: `${note.reason} — ${attribution}${parentNote.trim() ? ` · ${profile.displayName.split(' ')[0]}: ${parentNote.trim()}` : ''}`,
            category: note.category || 'other',
            awardedBy: profile.uid,
            awardedByName: profile.displayName,
            senderRole: 'parent',
          });
          awardId = res.id;
        } catch (e) {
          await releaseLeaderNote(familyId, note.id).catch(() => {});
          throw e;
        }
      }
      // 3) finalize (retry a couple of times — the award already happened).
      let ok = false; let lastErr: unknown = null;
      for (let i = 0; i < 3 && !ok; i += 1) {
        try {
          await finalizeLeaderNote(familyId, { noteId: note.id, decision, finalPoints, parentNote: parentNote.trim() || undefined, awardId });
          ok = true;
        } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 600)); }
      }
      if (!ok) throw lastErr;
      onDone();
    } catch (e) {
      setErr(leaderErrorText((e as { code?: string }).code));
    } finally { setBusy(null); }
  };

  const adjusted = pts !== note.proposedPoints;
  return (
    <div className="rounded-kaya border border-kaya-warm-dark bg-white p-4">
      <p className="text-[13px] font-black text-kaya-chocolate">
        👑 {leaderFirst} noted <b>{isSelf ? 'themselves' : targetFirst}</b> · {note.kind === 'shoutout' ? '⭐ Shout-out' : '📝 Heads-up'} · proposes{' '}
        <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${note.proposedPoints > 0 ? 'bg-green-100 text-green-800' : note.proposedPoints < 0 ? 'bg-red-100 text-red-700' : 'bg-kaya-warm text-kaya-chocolate'}`}>
          {note.proposedPoints > 0 ? `+${note.proposedPoints}` : note.proposedPoints === 0 ? 'note only' : note.proposedPoints}
        </span> · {catLabel(note.category)}
      </p>
      <p className="text-[12.5px] font-bold text-kaya-chocolate-light mt-1">“{note.reason}”</p>
      <p className="text-[10.5px] font-bold text-kaya-sand mt-0.5">{fmtWhen(note.createdAt)}{note.status === 'resolving' ? ' · 👀 a parent is deciding' : ''}</p>
      {canDecide && (
        <>
          <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mt-3 mb-1">Points</p>
          <div className="flex gap-1.5">
            {options.map((p) => (
              <button key={p} type="button" onClick={() => setPts(p)} className={`flex-1 py-2 rounded-xl text-[13px] font-black border ${pts === p ? (p < 0 ? 'bg-red-50 border-red-400 text-red-700' : p === 0 ? 'bg-kaya-warm border-kaya-sand text-kaya-chocolate' : 'border-green-600 bg-green-50 text-green-800') : 'bg-white border-kaya-warm-dark text-kaya-sand'}`}>
                {p > 0 ? `+${p}` : p === 0 ? 'note only' : p}
              </button>
            ))}
          </div>
          <input
            value={parentNote}
            onChange={(e) => setParentNote(e.target.value.slice(0, 280))}
            placeholder={`Note to ${isSelf ? leaderFirst : `${targetFirst} + ${leaderFirst}`} (required on decline) — “Lovely, thank you 🙌”`}
            className="w-full mt-2 rounded-xl border border-dashed border-kaya-warm-dark px-3 py-2 text-[12.5px] font-bold focus:outline-none focus:border-kaya-gold"
          />
          {err && <p className="text-[12px] font-bold text-red-600 mt-1.5">{err}</p>}
          <div className="flex flex-wrap gap-2 mt-2.5">
            <button type="button" disabled={!!busy} onClick={() => decide(adjusted ? 'adjusted' : 'approved')} className="px-3.5 py-2 rounded-full text-[12px] font-black text-white disabled:opacity-60" style={{ background: '#0E6B5E' }}>
              {busy === 'approved' || busy === 'adjusted' ? '…' : adjusted ? `🔁 Adjust → ${pts > 0 ? `+${pts}` : pts === 0 ? 'note only' : pts}` : `✅ Approve ${pts > 0 ? `+${pts}` : pts === 0 ? '' : pts}`}
            </button>
            <button type="button" disabled={!!busy} onClick={() => decide('declined')} className="px-3.5 py-2 rounded-full text-[12px] font-black bg-red-50 text-red-700 disabled:opacity-60">{busy === 'declined' ? '…' : 'Decline'}</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ParentLeaderPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = profile?.familyId || '';
  const isParent = profile?.role === 'parent';
  const isAdult = isParent || profile?.role === 'helper';
  const [pending, setPending] = useState<LeaderNote[] | null>(null);
  const [history, setHistory] = useState<LeaderNote[] | null>(null);
  const [terms, setTerms] = useState<LeaderTerm[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      const [p, r, all, t] = await Promise.all([
        listLeaderNotes(familyId, { status: 'pending' }),
        listLeaderNotes(familyId, { status: 'resolving' }),
        listLeaderNotes(familyId, {}),
        listLeaderTerms(familyId),
      ]);
      setPending([...p.notes, ...r.notes].sort((a, b) => b.createdAt - a.createdAt));
      setHistory(all.notes.filter((n) => n.status !== 'pending' && n.status !== 'resolving').slice(0, 60));
      setTerms(t.terms);
    } catch (e) {
      setErr(leaderErrorText((e as { code?: string }).code));
    }
  }, [familyId]);
  useEffect(() => { void load(); }, [load]);

  const kids = children || [];
  const adviceBook = useMemo(() => (terms || []).filter((t) => t.advice).slice(0, 30), [terms]);

  if (!profile || !isAdult) {
    return (
      <div className="max-w-lg mx-auto p-6 text-center">
        <p className="text-4xl">👑</p>
        <p className="font-display font-black text-lg mt-2">Leader of the Week</p>
        <p className="text-[13px] font-bold text-kaya-sand mt-1">Kids find their Notebook on <Link href="/kid" className="underline" style={{ color: GOLD }}>Home</Link>.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg lg:max-w-5xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.5px]" style={{ color: GOLD }}>👑 Leader of the Week</p>
          <h1 className="font-display text-2xl lg:text-3xl font-black leading-tight">Leader hub</h1>
          <p className="text-[12.5px] font-bold text-kaya-sand mt-0.5">The Sunday wheel crowns a kid · they take notes · you decide the points · the week seals into a 5-trait radar.</p>
        </div>
        {isParent && <Link href="/settings/meetings#leader" className="shrink-0 px-3 py-1.5 rounded-full text-[11.5px] font-black bg-kaya-warm text-kaya-chocolate">⚙️ Settings</Link>}
      </div>

      {isParent ? <LeaderHomeCard className="mb-4" /> : null}
      {err && <p className="text-[12.5px] font-bold text-red-600 mb-3">{err}</p>}

      <div className="lg:grid lg:grid-cols-5 lg:gap-5">
        <div className="lg:col-span-3">
          {/* Inbox */}
          <div className="mb-4">
            <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-2">📒 Notes waiting {pending ? `(${pending.length})` : ''}</p>
            {pending === null ? (
              <p className="text-[12.5px] font-bold text-kaya-sand">Loading…</p>
            ) : pending.length === 0 ? (
              <div className="rounded-kaya border border-dashed border-kaya-warm-dark bg-white p-4 text-[12.5px] font-bold text-kaya-sand">No notes waiting. {family?.houseLeader ? `${family.houseLeader.name.split(' ')[0]} hasn’t sent anything new.` : 'Nobody wears the crown right now.'}</div>
            ) : (
              <div className="space-y-3">
                {pending.map((n) => <NoteCard key={n.id} note={n} canDecide={isParent} familyId={familyId} onDone={load} />)}
              </div>
            )}
            {!isParent && pending && pending.length > 0 && <p className="text-[11px] font-bold text-kaya-sand mt-2">Parents decide leader notes — you can see them here.</p>}
          </div>

          {/* History */}
          <CollapsibleSection id="leader-history" icon="📜" title="Decided notes" remember summary={history ? `${history.length}` : ''}>
            {!history || history.length === 0 ? (
              <p className="text-[12.5px] font-bold text-kaya-sand">Nothing decided yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((n) => (
                  <li key={n.id} className="text-[12px] font-bold text-kaya-chocolate border-b border-kaya-warm-dark/60 pb-1.5 last:border-0">
                    {n.kind === 'shoutout' ? '⭐' : '📝'} 👑 {n.leaderName.split(' ')[0]} → {n.targetChildId === n.leaderChildId ? 'self' : n.targetName.split(' ')[0]} · {n.status === 'approved' ? `✅ ${n.finalPoints && n.finalPoints > 0 ? `+${n.finalPoints}` : n.finalPoints || 'note'}` : n.status === 'adjusted' ? `🔁 ${n.finalPoints && n.finalPoints > 0 ? `+${n.finalPoints}` : n.finalPoints === 0 ? 'note only' : n.finalPoints}` : n.status === 'declined' ? '❌ declined' : '⌛ expired'}
                    <span className="text-kaya-sand"> · {fmtWhen(n.createdAt)}{n.resolvedByName ? ` · ${n.resolvedByName}` : ''}</span>
                    <span className="block text-kaya-chocolate-light">“{n.reason}”{n.parentNote ? <span className="text-kaya-sand"> — {n.parentNote}</span> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </div>

        <div className="lg:col-span-2 mt-4 lg:mt-0">
          {/* Leadership cards */}
          <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-2">👑 Leadership by kid</p>
          <div className="space-y-3">
            {kids.map((c) => (
              <LeadershipCard key={c.id} familyId={familyId} childId={c.id} childName={c.name} childEmoji={c.avatarEmoji} viewer={isParent ? 'parent' : 'kid'} familyName={family?.name} compact />
            ))}
          </div>

          {/* Leader's Book */}
          <div className="mt-4">
            <CollapsibleSection id="leader-book" icon="📖" title="Leader’s Book" remember summary={adviceBook.length ? `${adviceBook.length} lines` : ''} defaultOpen={adviceBook.length > 0}>
              {adviceBook.length === 0 ? (
                <p className="text-[12.5px] font-bold text-kaya-sand">Each leader leaves one line of advice for the next. The book starts with the first handover.</p>
              ) : (
                <ul className="space-y-2">
                  {adviceBook.map((t) => (
                    <li key={t.id} className="text-[12.5px] font-bold text-kaya-chocolate">
                      <span className="italic">“{t.advice}”</span>
                      <span className="block text-[10.5px] text-kaya-sand">— {t.emoji} {t.name.split(' ')[0]}, week of {new Date(t.startAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}
