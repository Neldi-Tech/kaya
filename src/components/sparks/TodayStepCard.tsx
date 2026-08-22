'use client';

// Kaya Sparks · Today's Step — the card a kid actually opens.
//
// One step. A note. Proof. A tick. That's the whole daily loop, and it
// is deliberately the shortest surface in Sparks: a kid who has a
// reflection, a revision, a workplan AND a quest will not do a fifth
// long form (R2).
//
// D8 · the two reflection choices are SEPARATE and honestly labelled:
//      "Add this to my reflection" attaches freely; "This IS my
//      reflection today" is a second, deliberate tap that needs real
//      words behind it — the server is the authority and will decline a
//      four-word claim.
// D13 · points are minted server-side. Nothing here decides them.
// D15 · audio ≤ 60s, video ≤ 45s, and the size ceiling comes back as a
//      readable sentence instead of a dead spinner.

import { useEffect, useRef, useState } from 'react';
import {
  completeStep, undoStep, uploadQuestMedia, PROOF_LIMITS,
  REFLECTION_CLAIM_MIN_CHARS,
  type Quest, type QuestStep, type ProofKind,
} from '@/lib/sparks/quests';
import { uploadSparksPhoto } from '@/lib/sparks/uploadPhoto';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
  step: QuestStep;
  /** True when the viewer may tick it: parent, the kid themselves, or a
   *  helper with the Sparks act-grant. */
  canAct: boolean;
  /** Rendered inside the card as the "you're all caught up" line. */
  isToday: boolean;
}

type Pending = { kind: ProofKind; url: string; seconds?: number };

export default function TodayStepCard({
  familyId, kidId, kidName, quest, step, canAct, isToday,
}: Props) {
  const [note, setNote] = useState('');
  const [proofs, setProofs] = useState<Pending[]>([]);
  const [attach, setAttach] = useState(false);
  const [claim, setClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // QF-1 · keep the last failed recording so "Try again" re-uploads it.
  const [failedMedia, setFailedMedia] = useState<{ kind: 'audio' | 'video'; blob: Blob; seconds: number } | null>(null);
  const [celebrate, setCelebrate] = useState<null | { points: number; streak: number; late: boolean }>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const canClaim = note.trim().length >= REFLECTION_CLAIM_MIN_CHARS;

  useEffect(() => { if (!canClaim) setClaim(false); }, [canClaim]);

  async function onPhoto(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError('');
    try {
      const up = await uploadSparksPhoto(familyId, `quest-${quest.id}`, files[0]);
      setProofs((p) => [...p, { kind: 'photo', url: up.feedUrl }]);
    } catch {
      setError('That photo didn’t upload. Try again, or a smaller picture.');
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onMedia(kind: 'audio' | 'video', blob: Blob, seconds: number) {
    setBusy(true); setError('');
    try {
      const up = await uploadQuestMedia(quest.id, kind, blob, seconds);
      setProofs((p) => [...p, { kind: up.kind, url: up.url, seconds: up.seconds }]);
      setFailedMedia(null);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg === 'video-too-large') {
        setError('That clip is too big. Keep videos under 45 seconds — or record audio instead, which is lighter and usually better proof anyway.');
      } else if (msg === 'audio-too-large') {
        setError('That recording is too long. Keep it under 60 seconds.');
      } else if (msg === 'not-signed-in' || msg === 'unauthenticated' || msg === 'invalid-token') {
        setError('You got signed out — sign in again and your words will still be here.');
      } else if (msg === 'no-such-quest' || msg === 'forbidden') {
        setError('This quest isn’t yours to add proof to. Nothing was lost.');
      } else {
        // storage-write-failed (server hint) · upload-failed · network
        setError(msg.includes('storage') || msg.includes('Kaya')
          ? msg
          : 'Your recording didn’t reach Kaya. Your words and photos are still here — try again, or tick it off without the recording.');
        setFailedMedia({ kind, blob, seconds });
      }
    }
    setBusy(false);
  }

  async function tick() {
    setBusy(true); setError('');
    try {
      const res = await completeStep(familyId, kidId, {
        questId: quest.id,
        stepId: step.id,
        note: note.trim() || undefined,
        proofs: proofs.map((p) => ({ kind: p.kind, url: p.url, seconds: p.seconds })),
        attachReflection: attach || claim,
        claimReflection: claim,
      });
      setCelebrate({
        points: res.pointsAwarded,
        streak: res.streak?.current ?? 0,
        late: res.doneLate,
      });
    } catch (e) {
      // QF-1 · name the cause. "Check your connection" hid every real one.
      const msg = (e as Error).message || '';
      if (msg === 'forbidden') {
        setError(`This quest is shared with you, but only ${kidName} (or a parent) can tick it. Nothing was lost.`);
      } else if (msg === 'no-such-step' || msg === 'step-mismatch' || msg === 'not-found') {
        setError('This step was changed or removed by a parent — pull down to refresh and try again.');
      } else if (msg === 'not-signed-in' || msg === 'unauthenticated' || msg === 'invalid-token') {
        setError('You got signed out — sign in again and your words will still be here.');
      } else if (msg === 'bad-step' || msg === 'bad-quest') {
        setError('Kaya couldn’t find this step. Refresh the page and try again.');
      } else if (!navigator.onLine) {
        setError('You’re offline — your words are still here. Try again when you’re back online.');
      } else {
        setError(`Couldn’t save that (${msg || 'unknown'}). Your words are still here — try again in a moment.`);
      }
    }
    setBusy(false);
  }

  // ── Already done ──────────────────────────────────────────────────
  if (step.done || celebrate) {
    const streak = celebrate?.streak ?? quest.streak?.current ?? 0;
    return (
      <div
        className="rounded-[18px] p-4 text-white"
        style={{ background: `linear-gradient(135deg, ${quest.colour} 0%, #2E7D34 150%)` }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-2xl" aria-hidden>✅</span>
          <div className="flex-1 min-w-0">
            <div className="font-display font-extrabold text-[15px] leading-tight">
              {isToday ? 'Today’s step is done' : 'Step done'}
            </div>
            <div className="text-[12px] opacity-90 mt-0.5">
              {step.title}
              {celebrate?.points ? ` · +${celebrate.points} points` : ''}
              {streak > 0 ? ` · 🔥${streak}` : ''}
            </div>
          </div>
        </div>
        {celebrate?.late && (
          <p className="text-[11.5px] opacity-90 mt-2 mb-0 leading-snug">
            It landed after the cut-off — that&apos;s fine, and your parents will be told you did it.
          </p>
        )}
        {canAct && (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              await undoStep(familyId, kidId, quest.id, step.id).catch(() => {});
              setCelebrate(null);
              setBusy(false);
            }}
            disabled={busy}
            className="mt-3 text-[11.5px] font-extrabold underline opacity-80"
          >
            Undo
          </button>
        )}
      </div>
    );
  }

  // ── Open step ─────────────────────────────────────────────────────
  return (
    <div className="rounded-[18px] border-2 border-[#DFE3FB] bg-white overflow-hidden">
      <div
        className="px-4 py-3 text-white"
        style={{ background: `linear-gradient(135deg, ${quest.colour} 0%, #5AB7D6 150%)` }}
      >
        <div className="text-[10px] font-extrabold tracking-[1.5px] opacity-85">
          {isToday ? '🚀 TODAY’S STEP' : '🚀 NEXT STEP'} · {step.phase.toUpperCase()}
        </div>
        <div className="font-display font-extrabold text-[16px] leading-tight mt-0.5">
          {step.tone === 'fun' ? '🎈 ' : ''}{step.title}
        </div>
        <div className="text-[11.5px] opacity-90 mt-0.5">
          {step.minutes} minutes · by {quest.cutoffHHmm}
        </div>
      </div>

      <div className="px-4 py-4">
        {step.how && (
          <p className="text-[13px] text-[#0F1F44] leading-relaxed m-0 mb-3">{step.how}</p>
        )}

        {!canAct ? (
          <p className="text-[12px] text-[#5A6488] m-0">
            {kidName} ticks this one off themselves.
          </p>
        ) : (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="How did it go? (optional)"
              className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[13.5px] resize-none"
            />

            {/* Proof row */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onPhoto(e.target.files)}
              />
              <ProofButton onClick={() => fileRef.current?.click()} disabled={busy}>📷 Photo</ProofButton>
              <MediaRecorderButton
                kind="audio"
                maxSeconds={PROOF_LIMITS.audioSeconds}
                disabled={busy}
                onDone={(b, s) => onMedia('audio', b, s)}
              />
              <MediaRecorderButton
                kind="video"
                maxSeconds={PROOF_LIMITS.videoSeconds}
                disabled={busy}
                onDone={(b, s) => onMedia('video', b, s)}
              />
            </div>

            {proofs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {proofs.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-[#E7F5EC] text-[#2E7D34]"
                  >
                    {p.kind === 'photo' ? '📷' : p.kind === 'audio' ? '🎤' : '🎬'} attached
                    {p.seconds ? ` · ${p.seconds}s` : ''}
                    <button
                      type="button"
                      onClick={() => setProofs((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label="Remove"
                      className="opacity-60"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* D8 · the two reflection choices, honestly separated */}
            <div className="mt-3 rounded-xl bg-[#F7F9FF] border border-[#DFE3FB] px-3.5 py-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attach || claim}
                  onChange={(e) => { setAttach(e.target.checked); if (!e.target.checked) setClaim(false); }}
                  className="mt-0.5"
                />
                <span className="text-[12.5px] text-[#0F1F44] leading-snug">
                  <strong>Add this to my reflection</strong>
                  <span className="block text-[11px] text-[#5A6488]">
                    It gets attached under today&apos;s reflection. Nothing you already wrote changes.
                  </span>
                </span>
              </label>

              {(attach || claim) && (
                <label className={`flex items-start gap-2.5 mt-2.5 ${canClaim ? 'cursor-pointer' : 'opacity-55'}`}>
                  <input
                    type="checkbox"
                    checked={claim}
                    disabled={!canClaim}
                    onChange={(e) => setClaim(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-[12.5px] text-[#0F1F44] leading-snug">
                    <strong>This IS my reflection today</strong>
                    <span className="block text-[11px] text-[#5A6488]">
                      {canClaim
                        ? 'Counts for your reflection streak — so you don’t write the same day twice.'
                        : `Write a bit more first (${note.trim().length}/${REFLECTION_CLAIM_MIN_CHARS} characters).`}
                    </span>
                  </span>
                </label>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-2.5 text-[12px] text-[#8B2130] leading-snug">
                <div className="text-[10px] font-extrabold tracking-[1px] uppercase text-[#D64550] mb-0.5">Couldn’t save</div>
                {error}
                {failedMedia && (
                  <div className="flex gap-2 mt-2">
                    <button type="button" disabled={busy}
                      onClick={() => { const m = failedMedia; setFailedMedia(null); setError(''); void onMedia(m.kind, m.blob, m.seconds); }}
                      className="px-3 py-1.5 rounded-full border border-[#F5C6C6] bg-white text-[11.5px] font-extrabold text-[#8B2130]">
                      ↻ Try again
                    </button>
                    <button type="button" disabled={busy}
                      onClick={() => { setFailedMedia(null); setError(''); }}
                      className="px-3 py-1.5 rounded-full border border-[#ECE4D3] bg-white text-[11.5px] font-extrabold text-[#5A6488]">
                      Tick without it
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={tick}
              disabled={busy}
              className="w-full mt-3 py-3 rounded-xl font-extrabold text-[14px] text-white disabled:opacity-50"
              style={{ background: quest.colour }}
            >
              {busy ? 'Saving…' : '✅ Done — I did it'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProofButton({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-full border border-[#ECE4D3] bg-white text-[12px] font-extrabold text-[#5A6488] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Record straight in the browser, hard-stopped at the cap so a kid can
 *  never produce a clip the upload will refuse (D15). */
function MediaRecorderButton({ kind, maxSeconds, disabled, onDone }: {
  kind: 'audio' | 'video';
  maxSeconds: number;
  disabled?: boolean;
  onDone: (blob: Blob, seconds: number) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function cleanup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    setRecording(false);
    setElapsed(0);
  }

  useEffect(() => cleanup, []);

  async function start() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: true } : { audio: true, video: true },
      );
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      let seconds = 0;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || `${kind}/webm` });
        cleanup();
        if (blob.size) onDone(blob, seconds);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      timerRef.current = setInterval(() => {
        seconds += 1;
        setElapsed(seconds);
        if (seconds >= maxSeconds) { try { rec.stop(); } catch { cleanup(); } }
      }, 1000);
    } catch {
      cleanup();
    }
  }

  function stop() { try { recRef.current?.stop(); } catch { cleanup(); } }

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-full border text-[12px] font-extrabold disabled:opacity-40 ${
        recording
          ? 'border-[#D64550] bg-[#FDE8E8] text-[#D64550]'
          : 'border-[#ECE4D3] bg-white text-[#5A6488]'
      }`}
    >
      {recording
        ? `⏹ Stop · ${elapsed}s / ${maxSeconds}s`
        : kind === 'audio' ? '🎤 Record' : '🎬 Video'}
    </button>
  );
}
