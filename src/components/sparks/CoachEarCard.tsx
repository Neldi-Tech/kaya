'use client';

// Kaya Sparks · 🎤 Coach Ear (innovation 2).
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
// Speech, reading fluency, languages, music, times tables, memorised
// verses — one surface serves them all, and audio is the lightest thing
// we can ask a kid for on a mobile data bundle.

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
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
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

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textRef = useRef('');
  const secsRef = useRef(0);

  useEffect(() => { setSupported(speechRecognitionSupported()); }, []);
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try { recRef.current?.stop(); } catch { /* noop */ }
  }, []);

  // A rubric marker is the natural home for a clarity score.
  const rubricMarker = quest.markers?.find((m) => m.kind === 'rubric');

  function start() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    setError(''); setResult(null); setTranscript(''); setSavedTo(null);
    textRef.current = ''; secsRef.current = 0; setElapsed(0);

    const rec = new Ctor();
    rec.lang = navigator.language || 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += `${e.results[i][0].transcript} `;
      textRef.current = full.trim();
      setTranscript(textRef.current);
    };
    rec.onerror = () => { setError('The microphone didn’t catch that. Try again.'); stop(); };
    rec.onend = () => { setListening(false); };
    try { rec.start(); } catch { return; }
    recRef.current = rec;
    setListening(true);
    timerRef.current = setInterval(() => {
      secsRef.current += 1;
      setElapsed(secsRef.current);
      if (secsRef.current >= 90) stop();
    }, 1000);
  }

  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }

  async function askCoach() {
    setBusy(true); setError('');
    try {
      const r = await coachEar(quest.id, textRef.current || transcript, secsRef.current || elapsed || 30);
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

  return (
    <div className="mt-3 rounded-[16px] border border-[#ECE4D3] bg-white p-3.5">
      <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
        🎤 Coach Ear
      </div>
      <p className="text-[11.5px] text-[#5A6488] mt-0.5 mb-2.5 leading-snug">
        Say your practice out loud and Kaya gives {kidName === 'you' ? 'you' : kidName} three
        specific notes — what worked, and the two smallest things to change.
      </p>

      {!supported ? (
        <div className="rounded-xl bg-[#FBF7EE] px-3.5 py-3 text-[12px] text-[#5A6488] leading-snug">
          This browser can&apos;t listen. Coach Ear needs speech recognition — try Chrome or Safari,
          or record audio as proof on the step instead and a parent can listen back.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={listening ? stop : start}
              disabled={busy}
              className={`px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold disabled:opacity-40 ${
                listening ? 'bg-[#FDE8E8] text-[#D64550] border border-[#F5C6C6]' : 'text-white'
              }`}
              style={listening ? undefined : { background: quest.colour }}
            >
              {listening ? `⏹ Stop · ${elapsed}s` : '🎤 Start talking'}
            </button>
            {!listening && transcript && (
              <button
                type="button"
                onClick={askCoach}
                disabled={busy}
                className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #A66CFF 0%, #4ECDC4 100%)' }}
              >
                {busy ? 'Listening…' : '✨ What did Kaya hear?'}
              </button>
            )}
          </div>

          {transcript && (
            <div className="mt-2.5 rounded-xl bg-[#FBF7EE] px-3 py-2.5 text-[12px] text-[#5A6488] leading-relaxed max-h-28 overflow-y-auto">
              {transcript}
            </div>
          )}

          {error && (
            <div className="mt-2.5 rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-2.5 text-[12px] text-[#8B2130] leading-snug">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-3 rounded-[14px] bg-[#F7F9FF] border border-[#DFE3FB] p-3">
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
                    <span aria-hidden>{i === 0 ? '🌟' : '💡'}</span>
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
                  📈 Save {result.clarity} to &quot;{rubricMarker.label}&quot;
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
            stays on your phone.
          </p>
        </>
      )}
    </div>
  );
}
