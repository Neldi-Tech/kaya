'use client';
// 📒 Leader's Notebook (S3 in the approved design, LW PR-L2) — the kid
// leader's surface: ⭐ Shout-out / 📝 Heads-up about a sibling (or self),
// proposed points within the family's point system, a category, a reason
// (≥3 words) → "Send to parents". Pending notes are invisible to the target
// kid; outcomes come back here with the parent's note. Also hosts the 🎯
// mission, 👀 whisper, and the 🔑 advice line for the next leader.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  loadNotebook, createLeaderNote, markLeaderNotesSeen, setLeaderAdvice, leaderErrorText, draftLeaderReport,
  type NotebookBundle, type LeaderNoteKind,
} from '@/lib/leaderWeek';
import { termDayNumber, termWeekNumber } from '@/lib/leaderWeek.shared';
import LeaderGuideSheet from '@/components/leader/LeaderGuideSheet';

const GOLD = '#B8860B';

function statusLine(n: NotebookBundle['notes'][number]): { text: string; tone: string } {
  switch (n.status) {
    case 'approved': return { text: `✅ approved ${n.finalPoints && n.finalPoints !== 0 ? (n.finalPoints > 0 ? `+${n.finalPoints}` : n.finalPoints) : ''}${n.resolvedByName ? ` · ${n.resolvedByName}` : ''}${n.parentNote ? `: ${n.parentNote}` : ''}`, tone: 'text-green-700' };
    case 'adjusted': return { text: `🔁 adjusted to ${n.finalPoints && n.finalPoints !== 0 ? (n.finalPoints > 0 ? `+${n.finalPoints}` : n.finalPoints) : 'note only'}${n.resolvedByName ? ` · ${n.resolvedByName}` : ''}${n.parentNote ? `: ${n.parentNote}` : ''}`, tone: 'text-amber-700' };
    case 'declined': return { text: `❌ not this time${n.resolvedByName ? ` · ${n.resolvedByName}` : ''}${n.parentNote ? `: ${n.parentNote}` : ''}`, tone: 'text-red-700' };
    case 'expired': return { text: '⌛ the week ended before a parent decided', tone: 'text-kaya-sand' };
    case 'resolving': return { text: '👀 a parent is looking at it now', tone: 'text-kaya-sand' };
    default: return { text: '⏳ waiting for Mum or Dad', tone: 'text-kaya-sand' };
  }
}

export default function LeaderNotebookPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const [bundle, setBundle] = useState<NotebookBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [kind, setKind] = useState<LeaderNoteKind>('shoutout');
  const [target, setTarget] = useState<string>('');
  const [points, setPoints] = useState<number | null>(null);
  const [category, setCategory] = useState<string>('helping');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const [advice, setAdvice] = useState('');
  const [adviceSaved, setAdviceSaved] = useState(false);
  const [adviceBusy, setAdviceBusy] = useState(false);

  const familyId = profile?.familyId || '';
  const hl = family?.houseLeader || null;
  const isLeader = !!(hl && profile?.role === 'kid' && profile.childId === hl.childId);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoading(true); setLoadErr(null);
    try {
      const b = await loadNotebook(familyId);
      setBundle(b);
      if (b.term?.advice) setAdvice(b.term.advice);
      // Default target: first sibling; default points: the smallest option.
      setTarget((t) => t || b.targets.find((x) => !x.self)?.id || b.targets[0]?.id || '');
      setPoints((p) => (p === null ? (b.caps?.shoutoutPoints[0] ?? 1) : p));
      const unseen = b.notes.filter((n) => (n.status === 'approved' || n.status === 'adjusted' || n.status === 'declined') && !n.seenByLeader).map((n) => n.id);
      if (unseen.length) void markLeaderNotesSeen(familyId, unseen).catch(() => {});
    } catch (e) {
      setLoadErr(leaderErrorText((e as { code?: string }).code));
    } finally { setLoading(false); }
  }, [familyId]);

  useEffect(() => { void load(); }, [load]);

  // Points options follow the kind.
  const pointOptions = useMemo(() => {
    if (!bundle?.caps) return kind === 'shoutout' ? [1, 2, 3] : [0];
    return kind === 'shoutout' ? bundle.caps.shoutoutPoints : bundle.caps.headsupPoints;
  }, [bundle, kind]);
  useEffect(() => {
    if (points === null || !pointOptions.includes(points)) setPoints(pointOptions[0] ?? 0);
  }, [pointOptions, points]);

  const wordCount = reason.trim().split(/\s+/).filter(Boolean).length;
  const capsLeft = bundle?.caps ? Math.max(0, bundle.caps.dailyCap - bundle.caps.usedToday) : null;
  const selfLeft = bundle?.caps ? (bundle.caps.selfAllowed ? Math.max(0, 1 - bundle.caps.selfUsedToday) : 0) : 0;
  const targetIsSelf = bundle?.targets.find((t) => t.id === target)?.self || false;
  const canSend = !!bundle && isLeader && bundle.notebookAllowed && !sending && wordCount >= 3 && !!target && points !== null
    && (capsLeft === null || capsLeft > 0) && !(targetIsSelf && kind === 'shoutout' && selfLeft === 0) && !(targetIsSelf && !(bundle.caps?.selfAllowed ?? true));

  const send = async () => {
    if (!canSend || !bundle || points === null) return;
    setSending(true); setSendErr(null);
    try {
      await createLeaderNote(familyId, { targetChildId: target, kind, proposedPoints: points, category, reason: reason.trim() });
      const who = bundle.targets.find((t) => t.id === target);
      setSentFlash(`Sent to your parents ✉️ — ${kind === 'shoutout' ? '⭐' : '📝'} about ${who?.self ? 'you' : who?.name.split(' ')[0]}`);
      setReason('');
      await load();
      setTimeout(() => setSentFlash(null), 4000);
    } catch (e) {
      setSendErr(leaderErrorText((e as { code?: string }).code));
    } finally { setSending(false); }
  };

  const saveAdvice = async () => {
    if (!bundle?.term) return;
    setAdviceBusy(true);
    try {
      const names: Record<string, string> = {};
      (children || []).forEach((c) => { names[c.id] = c.name.split(' ')[0]; });
      await setLeaderAdvice(familyId, bundle.term.id, { advice: advice.trim(), report: draftLeaderReport(bundle.term, bundle.notes, names) });
      setAdviceSaved(true); setTimeout(() => setAdviceSaved(false), 2500);
    } catch { /* quiet */ } finally { setAdviceBusy(false); }
  };

  // ── Gates ─────────────────────────────────────────────────────────
  if (!profile || profile.role !== 'kid') {
    return (
      <div className="max-w-lg mx-auto p-6 text-center">
        <p className="text-4xl">📒</p>
        <p className="font-display font-black text-lg mt-2">Leader&apos;s Notebook</p>
        <p className="text-[13px] font-bold text-kaya-sand mt-1">This is the kid leader&apos;s surface. Parents review notes at <Link href="/parent/leader" className="underline" style={{ color: GOLD }}>Leader of the Week</Link>.</p>
      </div>
    );
  }
  if (!hl || !isLeader) {
    return (
      <div className="max-w-lg mx-auto p-6 text-center">
        <p className="text-4xl">👑</p>
        <p className="font-display font-black text-lg mt-2">{hl ? `${hl.name.split(' ')[0]} is Leader of the Week` : 'No leader this week yet'}</p>
        <p className="text-[13px] font-bold text-kaya-sand mt-1">{hl ? 'Only the leader can take notes. Your turn comes — the wheel spins every Sunday!' : 'The Sunday wheel (or a parent) picks the leader. Keep showing your best!'}</p>
        <Link href="/kid" className="inline-block mt-4 px-4 py-2 rounded-full text-[12.5px] font-black text-white" style={{ background: GOLD }}>← Home</Link>
      </div>
    );
  }

  const day = termDayNumber(hl.startAt);
  const week = termWeekNumber(hl.startAt);
  const first = hl.name.split(' ')[0];

  return (
    <div className="max-w-lg lg:max-w-4xl mx-auto pb-24">
      {/* Hero */}
      <div className="rounded-kaya-lg p-5 text-white mb-4" style={{ background: 'linear-gradient(135deg,#B8860B,#E9B949)' }}>
        <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.5px] opacity-90">👑 {first} · Leader of the Week · day {Math.min(day, 7)}{week > 1 ? ` · week ${week}` : ''}</p>
        <h1 className="font-display text-2xl font-black mt-0.5">📒 Take a note</h1>
        <p className="text-[12.5px] font-bold opacity-95 mt-1">Notes go to Mum &amp; Dad first. They decide the points.</p>
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => setGuide(true)} className="px-3 py-1.5 rounded-full text-[11.5px] font-black bg-white/20 border border-white/50">📖 What does being leader mean?</button>
          <Link href="/kid" className="px-3 py-1.5 rounded-full text-[11.5px] font-black bg-white/20 border border-white/50">← Home</Link>
        </div>
      </div>

      {loading && !bundle && <p className="text-[13px] font-bold text-kaya-sand px-1">Opening your Notebook…</p>}
      {loadErr && <p className="text-[13px] font-bold text-red-600 px-1">{loadErr}</p>}

      {bundle && (
        <div className="lg:grid lg:grid-cols-2 lg:gap-5">
          <div>
            {/* Mission + whisper */}
            {bundle.mission && (
              <div className="rounded-kaya border border-kaya-warm-dark bg-white p-3.5 mb-3">
                <p className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand">🎯 Your mission this week</p>
                <p className="text-[13.5px] font-black text-kaya-chocolate mt-0.5">{bundle.mission.label}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="flex-1 h-2.5 rounded-full bg-kaya-warm overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (bundle.mission.progress / Math.max(1, bundle.mission.target)) * 100)}%`, background: bundle.mission.done ? '#2E9E5B' : GOLD }} /></span>
                  <span className="text-[11.5px] font-black text-kaya-sand">{bundle.mission.done ? 'done ✓' : `${bundle.mission.progress} of ${bundle.mission.target}`}</span>
                </div>
              </div>
            )}
            {bundle.whisper && (
              <p className="text-[12px] font-bold text-kaya-chocolate-light rounded-xl px-3 py-2 mb-3" style={{ background: '#FFF7E5' }}>👀 Kaya whisper: {bundle.whisper}</p>
            )}

            {!bundle.notebookAllowed ? (
              <div className="rounded-kaya border border-kaya-warm-dark bg-white p-4 mb-3">
                <p className="font-display font-black text-[15px]">👑 You wear the crown this week!</p>
                <p className="text-[12.5px] font-bold text-kaya-sand mt-1">The Notebook opens when you&apos;re a little older. Lead by example — help, share, and shine on Sunday.</p>
              </div>
            ) : (
              <div className="rounded-kaya border border-kaya-warm-dark bg-white p-4 mb-3">
                {/* Kind */}
                <div className="grid grid-cols-2 gap-1 bg-kaya-warm rounded-xl p-1 mb-3">
                  {(['shoutout', 'headsup'] as LeaderNoteKind[]).map((k) => (
                    <button key={k} type="button" onClick={() => setKind(k)} className={`py-2 rounded-lg text-[12px] font-black ${kind === k ? 'bg-white text-kaya-chocolate shadow-sm' : 'text-kaya-sand'}`}>
                      {k === 'shoutout' ? '⭐ Shout-out' : '📝 Heads-up'}
                    </button>
                  ))}
                </div>
                {/* Who */}
                <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-1.5">Who?</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {bundle.targets.filter((t) => !t.self || bundle.caps?.selfAllowed).map((t) => (
                    <button key={t.id} type="button" onClick={() => setTarget(t.id)} className={`px-3 py-1.5 rounded-full text-[12px] font-black border ${target === t.id ? 'text-white' : 'bg-white text-kaya-chocolate border-kaya-warm-dark'}`} style={target === t.id ? { background: GOLD, borderColor: GOLD } : undefined}>
                      {t.emoji} {t.self ? 'Me' : t.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
                {/* Points */}
                <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-1.5">
                  {kind === 'shoutout' ? 'How many points do you propose?' : pointOptions.length > 1 ? 'How many points should come off?' : 'A heads-up is a note only in your family'}
                </p>
                <div className="flex gap-1.5 mb-3">
                  {pointOptions.map((p) => (
                    <button key={p} type="button" onClick={() => setPoints(p)} className={`flex-1 py-2 rounded-xl text-[13px] font-black border ${points === p ? (p < 0 ? 'bg-red-50 border-red-400 text-red-700' : p === 0 ? 'bg-kaya-warm border-kaya-sand text-kaya-chocolate' : 'border-green-600 bg-green-50 text-green-800') : 'bg-white border-kaya-warm-dark text-kaya-sand'}`}>
                      {p > 0 ? `+${p}` : p === 0 ? 'note only' : p}
                    </button>
                  ))}
                </div>
                {/* Category */}
                <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-1.5">For what?</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {bundle.categories.map((c) => (
                    <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={`px-2.5 py-1 rounded-full text-[11.5px] font-black border ${category === c.id ? 'bg-kaya-chocolate text-white border-kaya-chocolate' : 'bg-white text-kaya-chocolate border-kaya-warm-dark'}`}>
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>
                {/* Reason */}
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 280))}
                  placeholder={kind === 'shoutout' ? 'What did they do? e.g. cleared the table without being asked 🍽️' : 'What happened, and what would help? e.g. teasing at lunch — let\'s be kind'}
                  className="w-full rounded-xl border border-dashed border-kaya-warm-dark px-3 py-2.5 text-[13px] font-bold min-h-[72px] focus:outline-none focus:border-kaya-gold"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10.5px] font-black text-kaya-sand">{wordCount < 3 ? `${3 - wordCount} more word${3 - wordCount === 1 ? '' : 's'}` : `${reason.length}/280`}</span>
                  {bundle.caps && <span className="text-[10.5px] font-black text-kaya-sand">{capsLeft} of {bundle.caps.dailyCap} notes left today{bundle.caps.selfAllowed ? ` · ${selfLeft} self shout-out left` : ''}</span>}
                </div>
                {sendErr && <p className="text-[12px] font-bold text-red-600 mt-1.5">{sendErr}</p>}
                {sentFlash && <p className="text-[12px] font-black text-green-700 mt-1.5">{sentFlash}</p>}
                <button type="button" disabled={!canSend} onClick={send} className="w-full mt-3 py-3 rounded-full font-display font-black text-[14px] text-[#3D2E08] disabled:opacity-50" style={{ background: '#E9B949' }}>
                  {sending ? 'Sending…' : 'Send to parents ✉️'}
                </button>
              </div>
            )}

            {/* 🔑 Advice for the next leader (idea B) */}
            <div className="rounded-kaya border border-kaya-warm-dark bg-white p-4 mb-3">
              <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand">🔑 My advice to the next leader</p>
              <p className="text-[11.5px] font-bold text-kaya-sand mt-0.5">One line. Kaya reads it out on Sunday and shows it to whoever leads next.</p>
              <input value={advice} onChange={(e) => setAdvice(e.target.value.slice(0, 200))} placeholder="e.g. notice the quiet one" className="w-full mt-2 rounded-xl border border-kaya-warm-dark px-3 py-2 text-[13px] font-bold focus:outline-none focus:border-kaya-gold" />
              <button type="button" disabled={adviceBusy || !advice.trim()} onClick={saveAdvice} className="mt-2 px-3.5 py-1.5 rounded-full text-[12px] font-black text-white disabled:opacity-50" style={{ background: GOLD }}>{adviceSaved ? 'Saved ✓' : adviceBusy ? '…' : 'Save'}</button>
            </div>
          </div>

          {/* My notes */}
          <div className="rounded-kaya border border-kaya-warm-dark bg-white p-4">
            <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-2">📜 My notes this week</p>
            {bundle.notes.length === 0 ? (
              <p className="text-[12.5px] font-bold text-kaya-sand">Nothing yet. Keep your eyes open for good things 👀</p>
            ) : (
              <ul className="space-y-2">
                {bundle.notes.map((n) => {
                  const s = statusLine(n);
                  const d = new Date(n.createdAt);
                  return (
                    <li key={n.id} className="rounded-xl border border-kaya-warm-dark/70 px-3 py-2">
                      <p className="text-[12.5px] font-black text-kaya-chocolate">
                        {n.kind === 'shoutout' ? '⭐' : '📝'} {n.targetChildId === hl.childId ? 'Me' : n.targetName.split(' ')[0]} · {n.proposedPoints > 0 ? `+${n.proposedPoints}` : n.proposedPoints === 0 ? 'note only' : n.proposedPoints} · {n.category}
                        <span className="ml-1.5 text-[10.5px] font-bold text-kaya-sand">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                      </p>
                      <p className="text-[12px] font-bold text-kaya-chocolate-light mt-0.5">“{n.reason}”</p>
                      <p className={`text-[11.5px] font-black mt-0.5 ${s.tone}`}>{s.text}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <LeaderGuideSheet open={guide} onClose={() => setGuide(false)} isLeader leaderName={hl.name} />
    </div>
  );
}
