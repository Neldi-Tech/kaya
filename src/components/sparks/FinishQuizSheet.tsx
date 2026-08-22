'use client';

// Kaya Sparks · Treasures 2.0 — 🏁 the Finish Quiz (C4 · D36 · N5).
//
// Design screen 9. When a kid finishes a book, Kaya asks 3–5 warm,
// age-aware questions written from the book + the kid's own notes. The
// kid answers (typed or 🎙 said); Kaya rates UNDERSTANDING 0–100 —
// display-only, never points — and a parent rates as usual (stars + a
// line). Points only through the real award rail, and only when the
// parent switched it on in Cupboard settings (default off). Skippable —
// it waits on the book's page.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { giveAward } from '@/lib/firestore';
import { startQuiz, answerQuiz, skipQuiz, rateQuiz } from '@/lib/sparks/cupboard';
import type { Reading } from '@/lib/sparks/treasures';
import { inputCls, Pill, JADE, WOOD_DK } from './CupboardShell';

interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
}

const QUIZ_POINTS_DEFAULT = 10;

export default function FinishQuizSheet({ familyId, treasureId, bookName, reading, kidName, isParent, canAnswer, pointsOn, onClose, onChanged }: {
  familyId: string;
  treasureId: string;
  bookName: string;
  reading: Reading;
  kidName: string;
  isParent: boolean;
  /** The reader, a parent, or an allow-listed helper. */
  canAnswer: boolean;
  /** Cupboard settings → quiz.points (parent toggle, default off). */
  pointsOn: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const quiz = reading.quiz;
  const [questions, setQuestions] = useState<string[]>(quiz?.questions || []);
  const [generated, setGenerated] = useState<boolean | null>(quiz?.questions?.length ? true : null);
  const [answers, setAnswers] = useState<string[]>(quiz?.answers || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ understanding?: number; rationale?: string } | null>(
    quiz?.answeredAt ? { understanding: quiz.understanding, rationale: quiz.rationale } : null,
  );
  const [stars, setStars] = useState(quiz?.parentRating?.stars || 0);
  const [note, setNote] = useState(quiz?.parentRating?.note || '');
  const [rated, setRated] = useState(!!quiz?.parentRating);
  const [listening, setListening] = useState<number | null>(null);
  const [speechOk, setSpeechOk] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSpeechOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (questions.length) return;
    let dead = false;
    setBusy(true);
    startQuiz(familyId, treasureId, reading.id)
      .then((r) => { if (!dead) { setQuestions(r.questions); setGenerated(r.generated); } })
      .catch(() => { if (!dead) setErr('Kaya couldn’t write the questions right now — try again later.'); })
      .finally(() => { if (!dead) setBusy(false); });
    return () => { dead = true; };
  }, [familyId, treasureId, reading.id, questions.length]);

  function say(i: number) {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening !== null) { try { recRef.current?.stop(); } catch { /* noop */ } setListening(null); return; }
    const base = answers[i] ? `${answers[i].trim()} ` : '';
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-GB'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let full = '';
      for (let k = 0; k < e.results.length; k++) full += `${e.results[k][0].transcript} `;
      setAnswers((a) => { const n = a.slice(); n[i] = (base + full).trim(); return n; });
    };
    rec.onerror = () => { setListening(null); };
    rec.onend = () => setListening(null);
    try { rec.start(); recRef.current = rec; setListening(i); } catch { /* noop */ }
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await answerQuiz(familyId, treasureId, reading.id, answers);
      setResult(r);
      onChanged();
    } catch { setErr('Could not send the answers — try again.'); }
    finally { setBusy(false); }
  }

  async function skip() {
    setBusy(true);
    try { await skipQuiz(familyId, treasureId, reading.id); onChanged(); onClose(); }
    finally { setBusy(false); }
  }

  async function rate() {
    if (busy || !stars) return;
    setBusy(true); setErr('');
    try {
      let pointsAwarded = 0;
      if (pointsOn && reading.readerKidId && profile?.uid) {
        // The REAL award rail — same as any parent award.
        await giveAward(familyId, {
          childId: reading.readerKidId,
          kind: 'regular',
          points: QUIZ_POINTS_DEFAULT,
          reason: `🏁 Finish Quiz — ${bookName}`,
          category: 'Reading',
          awardedBy: profile.uid,
          awardedByName: profile.displayName || 'Parent',
          senderRole: 'parent',
        } as Parameters<typeof giveAward>[1]);
        pointsAwarded = QUIZ_POINTS_DEFAULT;
      }
      await rateQuiz(familyId, treasureId, reading.id, { stars, note: note.trim() || undefined, pointsAwarded: pointsAwarded || undefined });
      setRated(true);
      onChanged();
    } catch { setErr('Could not save the rating.'); }
    finally { setBusy(false); }
  }

  const answered = !!result;
  const u = result?.understanding;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-md lg:max-w-lg bg-[#FFFBF5] rounded-t-[22px] sm:rounded-[22px] max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 text-white rounded-t-[22px]" style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}>
          <div className="text-[10.5px] font-extrabold opacity-85">📚 {bookName}</div>
          <div className="font-display text-[18px] font-extrabold mt-0.5">🏁 {kidName === 'You' ? 'You finished it!' : `${kidName} finished it!`}</div>
          <div className="text-[11px] opacity-90 mt-0.5">{questions.length || '3–5'} quick questions from Kaya · always skippable</div>
        </div>

        <div className="p-4">
          {!questions.length && busy && <p className="text-[12px] font-bold text-[#5A6488] text-center py-4">🧠 Kaya is writing the questions…</p>}
          {generated === false && questions.length > 0 && (
            <p className="text-[10.5px] font-bold text-[#8A6800] bg-[#FFF9EF] border border-[#F3D3A6] rounded-[10px] px-3 py-2 mb-2">Kaya’s reader is resting — these are the everyday questions instead.</p>
          )}

          {questions.map((q, i) => (
            <div key={i} className="rounded-[12px] border border-[#ECE4D3] bg-white p-3 mb-2">
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">{i + 1} · {q}</div>
              {answered ? (
                <p className="text-[11.5px] italic text-[#394458] mt-1 m-0 leading-snug">{answers[i] ? `“${answers[i]}”` : '— skipped —'}</p>
              ) : canAnswer ? (
                <div className="mt-1.5">
                  <textarea className={`${inputCls} min-h-[56px]`} value={answers[i] || ''} onChange={(e) => setAnswers((a) => { const n = a.slice(); n[i] = e.target.value; return n; })} placeholder="type, or say it" maxLength={800} />
                  {speechOk && (
                    <button type="button" onClick={() => say(i)} className="mt-1 text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#BFE3D8] bg-white" style={{ color: listening === i ? '#C0392B' : JADE }}>
                      {listening === i ? '⏹ Stop' : '🎙 Say it'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-[#8A8471] mt-1 m-0">Waiting for {kidName} to answer.</p>
              )}
            </div>
          ))}

          {answered && (
            <div className="rounded-[12px] border border-[#D9CCFA] bg-[#EFE8FF] p-3 mb-2 text-[11.5px] text-[#3B2A73] leading-snug">
              <b className="text-[#5A3CB8]">Kaya</b> · {typeof u === 'number' ? <>Understanding <b>{u}%</b> — {result?.rationale || 'you followed the story.'}</> : (result?.rationale || 'Answers saved. Kaya’s reader was resting, so no score this time.')}
              {typeof u === 'number' && <div className="h-2 rounded-full bg-white overflow-hidden mt-1.5"><div className="h-full" style={{ width: `${u}%`, background: 'linear-gradient(90deg,#E9746D,#F0B23C,#3FA38F)' }} /></div>}
              <div className="text-[10px] mt-1.5 opacity-80">Display-only — never points. Parents rate as usual below.</div>
            </div>
          )}

          {answered && isParent && (
            <div className="rounded-[12px] border border-[#BFE3D8] bg-[#F1FAF7] p-3 mb-2">
              <div className="font-display font-extrabold text-[12px] text-[#0E6B5E]">👩 Your rating{rated ? ' · saved' : ''}</div>
              {!rated ? (
                <>
                  <div className="flex gap-1 text-[22px] mt-1" style={{ color: '#D4A847' }}>
                    {[1, 2, 3, 4, 5].map((s) => <button key={s} type="button" onClick={() => setStars(s)} aria-label={`${s} stars`}>{s <= stars ? '★' : '☆'}</button>)}
                  </div>
                  <input className={`${inputCls} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="a line they’ll see (“Loved your Luke answer.”)" maxLength={400} />
                  <p className="text-[10px] text-[#2C4A44] mt-1.5 mb-0">Points: <b>{pointsOn ? `on — +${QUIZ_POINTS_DEFAULT} through the award rail when you save` : 'off (Cupboard settings → Finish Quiz)'}</b></p>
                  <div className="mt-2"><Pill bg={JADE} fg="#fff" disabled={busy || !stars} onClick={rate}>⭐ Save rating</Pill></div>
                </>
              ) : (
                <p className="text-[11px] font-bold text-[#2C4A44] mt-1 m-0">
                  <span style={{ color: '#D4A847' }}>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>{note ? ` “${note}”` : ''}{quiz?.parentRating?.pointsAwarded ? ` · +${quiz.parentRating.pointsAwarded} points` : ''}
                </p>
              )}
            </div>
          )}

          {err && <p className="text-[11.5px] text-[#C0392B] font-bold mb-2">{err}</p>}

          <div className="flex flex-wrap gap-2">
            {!answered && canAnswer && questions.length > 0 && (
              <Pill bg={JADE} fg="#fff" disabled={busy || !answers.some((a) => a && a.trim())} onClick={submit}>{busy ? 'Kaya is reading…' : '✓ Send my answers'}</Pill>
            )}
            {!answered && canAnswer && <Pill bg="#EEF0F4" fg="#5B6B8C" disabled={busy} onClick={skip}>Skip · later</Pill>}
            <Pill bg="#fff" fg={WOOD_DK} onClick={onClose}>{answered ? 'Done' : 'Close'}</Pill>
          </div>
        </div>
      </div>
    </div>
  );
}
