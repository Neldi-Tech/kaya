'use client';

// Kaya Sparks · 🎤 Coach Ear 2.0 (QF-2 · 2026-07-22).
//
// Sparks AI reads handwriting and scans. Coach Ear extends it to the
// spoken word: the kid talks, and Kaya comes back with three specific,
// kind notes plus a 0-100 clarity read they can record as a marker.
//
// How the listening actually works, stated plainly because it matters:
// Claude's API takes text and images, not audio. So the browser
// transcribes locally with the Web Speech API, and the transcript plus
// the numbers we can compute honestly from it — clip length, words per
// minute, filler-word count — go to Claude, which does the part only it
// can do. Where speech recognition isn't available we SAY so rather than
// pretend to have listened.
//
// 2.0 — why it used to "hear half-way, too fast":
//   · phones end a recognition session at the first pause (they ignore
//     `continuous`), and each restart OVERWROTE the earlier words. Now the
//     engine auto-reconnects on silence while the kid is still "talking"
//     and the transcript ACCUMULATES across sessions (with a de-dup guard
//     for the repeated-last-phrase quirk).
//   · the cap grows 90 s → 3 min (a reading passage needs it), the clock
//     is shown as m:ss, and a live 🐇/🐢/🐌 pace chip replaces guessing.

import { useEffect, useRef, useState } from 'react';
import {
  coachEar, speechRecognitionSupported, addMarkerReading,
  type Quest, type CoachResult,
} from '@/lib/sparks/quests';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

const MAX_SECONDS = 180;

function mmss(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function paceChip(words: number, seconds: number): { emoji: string; label: string } | null {
  if (seconds < 8 || words < 6) return null;
  const wpm = Math.round((words / seconds) * 60);
  if (wpm > 180) return { emoji: '🐇', label: `~${wpm} wpm · slow down a little` };
  if (wpm >= 100) return { emoji: '🐢', label: `~${wpm} wpm · nice pace` };
  return { emoji: '🐌', label: `~${wpm} wpm · take your time, that's okay` };
}

export default function CoachEarCard({ familyId, kidId, kidName, quest }: {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<CoachResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Words from sessions that already ENDED (committed) + the live one.
  const committedRef = useRef('');
  const sessionRef = useRef('');
  const wantRef = useRef(false);       // true while the kid is "talking"
  const secsRef = useRef(0);

  useEffect(() => { setSupported(speechRecognitionSupported()); }, []);
  useEffect(() => () => {
    wantRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (restartRef.current) clearTimeout(restartRef.current);
    try { recRef.current?.abort?.(); recRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const rubricMarker = quest.markers?.find((m) => m.kind === 'rubric');

  const fullText = () => `${committedRef.current} ${sessionRef.current}`.replace(/\s+/g, ' ').trim();

  /** Open ONE recognition session; on end, re-open while still wanted. */
  function openSession() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    sessionRef.current = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += `${e.results[i][0].transcript} `;
      text = text.trim();
      // De-dup the restart quirk: a fresh session sometimes re-emits the
      // last phrase the previous one already committed.
      const tail = committedRef.current.split(' ').slice(-6).join(' ').toLowerCase();
      if (tail && text.toLowerCase().startsWith(tail)) text = text.slice(tail.length).trim();
      sessionRef.current = text;
      setTranscript(fullText());
    };
    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' / 'network' — on most phones these just
      // mean "that session is over"; the restart loop below handles it.
      const code = e?.error || '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        wantRef.current = false;
        setError('Kaya can’t use the microphone — allow it in the browser and try again.');
        stopAll();
      }
    };
    rec.onend = () => {
      // Commit what this session heard, then reconnect while the kid is
      // still talking (phones end sessions at every pause).
      if (sessionRef.current) {
        committedRef.current = fullText();
        sessionRef.current = '';
      }
      recRef.current = null;
      if (wantRef.current && secsRef.current < MAX_SECONDS) {
        restartRef.current = setTimeout(() => { if (wantRef.current) openSession(); }, 250);
      } else {
        setListening(false);
      }
    };
    try { rec.start(); } catch { return false; }
    recRef.current = rec;
    return true;
  }

  function start() {
    setError(''); setResult(null); setSavedTo(null); setShowFull(false);
    committedRef.current = ''; sessionRef.current = ''; setTranscript('');
    secsRef.current = 0; setElapsed(0);
    wantRef.current = true;
    if (!openSession()) { wantRef.current = false; return; }
    setListening(true);
    timerRef.current = setInterval(() => {
      secsRef.current += 1;
      setElapsed(secsRef.current);
      if (secsRef.current >= MAX_SECONDS) stopAll();
    }, 1000);
  }

  function stopAll() {
    wantRef.current = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (restartRef.current) { clearTimeout(restartRef.current); restartRef.current = null; }
    try { recRef.current?.stop(); } catch { /* noop */ }
    // Commit the live session immediately so the button state + text agree.
    if (sessionRef.current) { committedRef.current = fullText(); sessionRef.current = ''; }
    setTranscript(fullText());
    setListening(false);
  }

  async function askCoach() {
    setBusy(true); setError('');
    try {
      const r = await coachEar(quest.id, fullText() || transcript, secsRef.current || elapsed || 30);
      setResult(r);
    } catch (e) {
      const err = e as Error & { hint?: string };
      setError(err.hint || (err.message === 'no-transcript'
        ? 'Kaya couldn’t make out enough words. Try somewhere quieter, closer to the microphone.'
        : 'Coach Kaya couldn’t listen just now. Try again in a moment.'));
    }
    setBusy(false);
  }

  async function saveAsMarker() {
    if (!result || !rubricMarker) return;
    setBusy(true);
    await addMarkerReading(familyId, kidId, {
      questId: quest.id,
      markerId: rubricMarker.id,
      value: result.clarity,
      note: `Coach Ear · ${result.wpm} wpm · ${result.fillers} filler word${result.fillers === 1 ? '' : 's'}`,
    }).catch(() => {});
    setSavedTo(rubricMarker.label);
    setBusy(false);
  }

  if (supported === null) return null;

  const wordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const pace = paceChip(wordCount, elapsed);

  return (
    <div className={`mt-3 rounded-[16px] border bg-white p-3.5 ${listening ? 'border-2 border-[#5A3CB8]' : 'border-[#ECE4D3]'}`}
      style={listening ? { background: '#EFE7FF' } : undefined}>
      <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
        🎤 Coach Ear{listening && <span className="text-[#5A3CB8]"> · listening…</span>}
      </div>
      <p className="text-[11.5px] text-[#5A6488] mt-0.5 mb-2.5 leading-snug">
        Read or say your practice out loud and Kaya gives {kidName === 'you' ? 'you' : kidName} three
        specific notes — what worked, and the two smallest things to change. Pause to breathe — Kaya waits.
      </p>

      {!supported ? (
        <div className="rounded-xl bg-[#FBF7EE] px-3.5 py-3 text-[12px] text-[#5A6488] leading-snug">
          This browser can&apos;t listen. Coach Ear needs speech recognition — try Chrome on a phone or
          computer. On iPhone/iPad, record audio as proof on the step instead and a parent can listen back.
        </div>
      ) : (
        <>
          {listening && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8]">⏱ {mmss(elapsed)} / {mmss(MAX_SECONDS)}</span>
              <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8]">📝 {wordCount} word{wordCount === 1 ? '' : 's'}</span>
              {pace && <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">{pace.emoji} {pace.label}</span>}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={listening ? stopAll : start}
              disabled={busy}
              className={`px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold disabled:opacity-40 ${
                listening ? 'bg-[#5A3CB8] text-white' : 'text-white'
              }`}
              style={listening ? undefined : { background: quest.colour }}
            >
              {listening ? '⏹ I’m finished' : (transcript ? '🎤 Talk again' : '🎤 Start talking')}
            </button>
            {listening && (
              <button type="button" onClick={() => { stopAll(); start(); }}
                className="px-3 py-2 rounded-xl text-[12px] font-extrabold border border-[#cdbdf0] bg-white text-[#5A3CB8]">
                ↻ Start over
              </button>
            )}
            {!listening && transcript && (
              <button
                type="button"
                onClick={askCoach}
                disabled={busy}
                className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #A66CFF 0%, #4ECDC4 100%)' }}
              >
                {busy ? 'Kaya is thinking…' : '✨ What did Kaya hear?'}
              </button>
            )}
          </div>

          {transcript && (
            <div className={`mt-2.5 rounded-xl bg-[#FBF7EE] px-3 py-2.5 text-[12px] text-[#5A6488] leading-relaxed ${showFull ? '' : 'max-h-28'} overflow-y-auto`}>
              {transcript}
              {!listening && transcript.length > 220 && (
                <button type="button" onClick={() => setShowFull((v) => !v)}
                  className="block mt-1 text-[11px] font-extrabold text-[#5A3CB8] underline underline-offset-2">
                  {showFull ? 'Show less' : 'Show everything Kaya heard'}
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mt-2.5 rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-2.5 text-[12px] text-[#8B2130] leading-snug">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-3 rounded-[14px] bg-[#F7F9FF] border border-[#DFE3FB] p-3">
              <div className="text-[10px] font-extrabold tracking-[1px] uppercase text-[#5A6488] mb-1">
                ✨ What Kaya heard · {mmss(secsRef.current || elapsed)} · {result.words} words
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-display font-extrabold text-[15px]" style={{ color: quest.colour }}>
                  {result.clarity}/100
                </span>
                <span className="text-[11px] text-[#5A6488] font-bold">
                  clarity · {result.wpm} wpm · {result.fillers} filler{result.fillers === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="m-0 pl-0 list-none grid gap-1.5">
                {result.notes.map((n, i) => (
                  <li key={i} className="text-[12.5px] text-[#0F1F44] leading-snug flex gap-2">
                    <span aria-hidden>{i === 0 ? '💛' : i === 1 ? '✨' : '🎯'}</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
              {result.cheer && (
                <div className="text-[12px] font-bold text-[#2E7D34] mt-2">👏 {result.cheer}</div>
              )}

              {rubricMarker && !savedTo && (
                <button
                  type="button"
                  onClick={saveAsMarker}
                  disabled={busy}
                  className="mt-2.5 px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border border-[#DFE3FB] bg-white text-[#3B2E86] disabled:opacity-40"
                >
                  ⭐ Save {result.clarity} to &quot;{rubricMarker.label}&quot;
                </button>
              )}
              {savedTo && (
                <div className="text-[11.5px] font-bold text-[#2E7D34] mt-2.5">
                  Saved to &quot;{savedTo}&quot; ✓
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-[#8A8471] italic mt-2 leading-snug m-0">
            Your device turns the sound into words before anything is sent — the recording itself
            stays on your phone. Kaya keeps listening through pauses, up to {mmss(MAX_SECONDS)}.
          </p>
        </>
      )}
    </div>
  );
}
