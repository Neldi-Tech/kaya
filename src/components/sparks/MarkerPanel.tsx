'use client';

// Kaya Sparks · Quests — the GROWTH track (D9 · F8 · R3) and 📼 Then vs Now.
//
// Steps prove a child showed up. Markers prove they got better. The two
// are shown SEPARATELY and never blended into one score, because a
// blended number can be pushed up by obedience alone — which is exactly
// the metric that would get gamed.
//
// The first reading of any marker becomes the BASELINE. From the second
// reading on, the kid gets 📼 Then vs Now: their starting-line capture
// and their latest one, side by side, each one tap to play. A child who
// can HEAR that they got better never needs to be told they did — it is
// the most persuasive thing in the whole feature, and the reason to keep
// a proof with every reading.
//
// R3 · a dip is never rendered as a naked negative delta. It is named
// honestly and framed against the child's best day.

import { useRef, useState } from 'react';
import {
  addMarkerReading, markerTrend, narrateMarker, formatMarkerValue,
  daysSinceReading, uploadQuestMedia, MARKER_RETAKE_DAYS, PROOF_LIMITS,
  type Quest, type MarkerReading, type QuestMarker, type ProofKind,
} from '@/lib/sparks/quests';
import { uploadSparksPhoto } from '@/lib/sparks/uploadPhoto';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
  readings: MarkerReading[];
  isParent: boolean;
  canAct: boolean;
}

export default function MarkerPanel({
  familyId, kidId, kidName, quest, readings, isParent, canAct,
}: Props) {
  if (!quest.markers?.length) return null;

  return (
    <div className="mt-5">
      <div className="font-display font-extrabold text-[13px] text-[#0F1F44] mb-1">
        📈 Growth
      </div>
      <p className="text-[11.5px] text-[#5A6488] mb-2.5 leading-snug m-0">
        Separate from the streak on purpose. Showing up and getting better are two different
        things, and only one of them can be faked.
      </p>
      <div className="grid gap-3">
        {quest.markers.map((m) => (
          <MarkerCard
            key={m.id}
            familyId={familyId}
            kidId={kidId}
            kidName={kidName}
            quest={quest}
            marker={m}
            readings={readings}
            isParent={isParent}
            canAct={canAct}
          />
        ))}
      </div>
    </div>
  );
}

function MarkerCard({
  familyId, kidId, kidName, quest, marker, readings, isParent, canAct,
}: Props & { marker: QuestMarker }) {
  const { baseline, latest, series } = markerTrend(readings, marker.id);
  const story = narrateMarker(marker, series);
  const since = daysSinceReading(series);
  const dueRetake = since !== null && since >= MARKER_RETAKE_DAYS;

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number>(marker.kind === 'stars' ? 3 : marker.kind === 'rubric' ? 50 : 0);
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<{ url: string; kind: ProofKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // A `stars` marker is a parent's read by definition; the others are a
  // performance the kid can capture themselves.
  const mayRecord = marker.kind === 'stars' ? isParent : canAct;

  async function save() {
    setBusy(true); setError('');
    try {
      await addMarkerReading(familyId, kidId, {
        questId: quest.id,
        markerId: marker.id,
        value,
        note: note.trim() || undefined,
        proofUrl: proof?.url,
        proofKind: proof?.kind,
      });
      setOpen(false); setNote(''); setProof(null);
    } catch {
      setError('Couldn’t save that reading. Try again.');
    }
    setBusy(false);
  }

  async function onPhoto(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const up = await uploadSparksPhoto(familyId, `quest-${quest.id}`, files[0]);
      setProof({ url: up.feedUrl, kind: 'photo' });
    } catch { setError('That photo didn’t upload.'); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="rounded-[16px] border border-[#ECE4D3] bg-white p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-extrabold text-[13px] text-[#0F1F44] leading-snug">
            {marker.label}
          </div>
          <div className="text-[13.5px] font-extrabold mt-1" style={{
            color: story.direction === 'down' ? '#8A6800'
              : story.direction === 'up' ? '#2E7D34' : '#3B2E86',
          }}>
            {story.headline}
          </div>
          <p className="text-[11.5px] text-[#5A6488] mt-0.5 mb-0 leading-snug">{story.sub}</p>
        </div>
        {mayRecord && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`px-3 py-1.5 rounded-full text-[11.5px] font-extrabold whitespace-nowrap shrink-0 ${
              dueRetake || series.length === 0
                ? 'text-white'
                : 'border border-[#ECE4D3] bg-white text-[#5A6488]'
            }`}
            style={dueRetake || series.length === 0 ? { background: quest.colour } : undefined}
          >
            {series.length === 0 ? '🎬 Baseline' : open ? 'Cancel' : '📈 Record'}
          </button>
        )}
      </div>

      {dueRetake && !open && (
        <div className="text-[11px] font-bold text-[#8A6800] mt-2">
          ⏳ {since} days since the last reading — time for a re-take.
        </div>
      )}

      {/* 📼 Then vs Now — the whole reason to attach proof to a reading */}
      {baseline?.proofUrl && latest?.proofUrl && baseline.id !== latest.id && (
        <div className="mt-3 rounded-[14px] bg-[#F7F9FF] border border-[#DFE3FB] p-3">
          <div className="font-display font-extrabold text-[11px] tracking-[1px] text-[#3B2E86] uppercase mb-2">
            📼 Then vs Now
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <ProofSlot
              label="Then"
              sub={toDisplayDate(dayKey(baseline.at))}
              value={formatMarkerValue(marker, baseline.value)}
              url={baseline.proofUrl}
              kind={baseline.proofKind}
            />
            <ProofSlot
              label="Now"
              sub={toDisplayDate(dayKey(latest.at))}
              value={formatMarkerValue(marker, latest.value)}
              url={latest.proofUrl}
              kind={latest.proofKind}
            />
          </div>
          <p className="text-[10.5px] text-[#5A6488] italic mt-2 mb-0 leading-snug">
            Play them both. {kidName} doesn&apos;t have to take anyone&apos;s word for it.
          </p>
        </div>
      )}

      {/* Trend series — the shape, not a single number (R3) */}
      {series.length > 1 && <Sparkline series={series} marker={marker} colour={quest.colour} />}

      {/* Record form */}
      {open && mayRecord && (
        <div className="mt-3 rounded-[14px] bg-[#FDFCF8] border border-[#ECE4D3] p-3">
          {marker.kind === 'rubric' && (
            <>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100} value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="font-display font-extrabold text-[15px] w-14 text-right" style={{ color: quest.colour }}>
                  {value}
                </span>
              </div>
            </>
          )}
          {marker.kind === 'stars' && (
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n} type="button" onClick={() => setValue(n)}
                  className={`text-2xl ${value >= n ? '' : 'opacity-25'}`}
                  aria-label={`${n} stars`}
                >
                  ⭐
                </button>
              ))}
            </div>
          )}
          {marker.kind === 'count' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="w-28 rounded-lg border border-[#ECE4D3] px-3 py-2 text-[14px]"
              />
              {marker.unit && <span className="text-[12.5px] text-[#5A6488] font-bold">{marker.unit}</span>}
            </div>
          )}

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A note about this reading (optional)"
            maxLength={600}
            className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[13px] mt-2.5"
          />

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <input
              ref={fileRef} type="file" accept="image/*" capture="environment"
              className="hidden" onChange={(e) => onPhoto(e.target.files)}
            />
            <SmallBtn onClick={() => fileRef.current?.click()} disabled={busy}>📷 Photo</SmallBtn>
            <RecordBtn
              kind="audio" max={PROOF_LIMITS.audioSeconds} disabled={busy}
              onDone={async (b, s) => {
                setBusy(true);
                try {
                  const up = await uploadQuestMedia(quest.id, 'audio', b, s);
                  setProof({ url: up.url, kind: 'audio' });
                } catch (e) { setError((e as Error).message); }
                setBusy(false);
              }}
            />
            <RecordBtn
              kind="video" max={PROOF_LIMITS.videoSeconds} disabled={busy}
              onDone={async (b, s) => {
                setBusy(true);
                try {
                  const up = await uploadQuestMedia(quest.id, 'video', b, s);
                  setProof({ url: up.url, kind: 'video' });
                } catch (e) { setError((e as Error).message); }
                setBusy(false);
              }}
            />
            {proof && (
              <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-[#E7F5EC] text-[#2E7D34]">
                {proof.kind === 'photo' ? '📷' : proof.kind === 'audio' ? '🎤' : '🎬'} attached
              </span>
            )}
          </div>

          {series.length === 0 && (
            <p className="text-[11px] text-[#8A6800] mt-2 mb-0 leading-snug">
              🎬 This first one is the <strong>baseline</strong> — attach a recording if you can.
              In a few weeks it becomes the thing {kidName} plays back and laughs at.
            </p>
          )}

          {error && <div className="text-[11.5px] text-[#8B2130] mt-2">{error}</div>}

          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="w-full mt-2.5 py-2.5 rounded-xl font-extrabold text-[13px] text-white disabled:opacity-50"
            style={{ background: quest.colour }}
          >
            {busy ? 'Saving…' : series.length === 0 ? 'Save the baseline' : 'Save this reading'}
          </button>
        </div>
      )}

      {/* Parents see the raw numbers; the kid reads the story above. */}
      {isParent && series.length > 0 && (
        <details className="mt-2.5">
          <summary className="text-[11px] font-extrabold text-[#5A6488] cursor-pointer">
            All {series.length} reading{series.length === 1 ? '' : 's'}
          </summary>
          <ul className="m-0 mt-1.5 pl-0 list-none grid gap-1">
            {[...series].reverse().map((r) => (
              <li key={r.id} className="text-[11.5px] text-[#5A6488] flex items-center gap-2">
                <span className="font-extrabold text-[#0F1F44]">{formatMarkerValue(marker, r.value)}</span>
                <span>{toDisplayDate(dayKey(r.at))}</span>
                {r.isBaseline && <span className="text-[10px] font-extrabold text-[#8A6800]">BASELINE</span>}
                <span className="opacity-70">· {r.byName}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ProofSlot({ label, sub, value, url, kind }: {
  label: string; sub: string; value: string; url: string; kind?: ProofKind;
}) {
  return (
    <div className="rounded-[12px] bg-white border border-[#DFE3FB] p-2.5">
      <div className="text-[10px] font-extrabold tracking-[1px] text-[#5A6488] uppercase">{label}</div>
      <div className="font-display font-extrabold text-[15px] text-[#0F1F44] leading-tight">{value}</div>
      <div className="text-[10.5px] text-[#5A6488] mb-1.5">{sub}</div>
      {kind === 'audio' && <audio controls src={url} className="w-full h-8" />}
      {kind === 'video' && <video controls src={url} className="w-full rounded-lg" />}
      {(kind === 'photo' || kind === 'scan' || !kind) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="w-full rounded-lg" />
      )}
    </div>
  );
}

/** The shape of the run — deliberately a shape, not a number (R3). */
function Sparkline({ series, marker, colour }: {
  series: MarkerReading[]; marker: QuestMarker; colour: string;
}) {
  const vals = series.map((r) => r.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 100;
  const h = 28;
  const pts = vals.map((v, i) => {
    const x = vals.length === 1 ? 0 : (i / (vals.length - 1)) * w;
    const norm = (v - min) / span;
    const flip = marker.kind === 'count' && marker.higherIsBetter === false ? norm : 1 - norm;
    return `${x.toFixed(1)},${(flip * h).toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 mt-2.5" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SmallBtn({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded-full border border-[#ECE4D3] bg-white text-[12px] font-extrabold text-[#5A6488] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function RecordBtn({ kind, max, disabled, onDone }: {
  kind: 'audio' | 'video'; max: number; disabled?: boolean;
  onDone: (blob: Blob, seconds: number) => void;
}) {
  const [rec, setRec] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function cleanup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null; recRef.current = null;
    setRec(false); setElapsed(0);
  }

  async function start() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: true } : { audio: true, video: true },
      );
      streamRef.current = stream;
      const r = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      let secs = 0;
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        const blob = new Blob(chunks, { type: r.mimeType || `${kind}/webm` });
        cleanup();
        if (blob.size) onDone(blob, secs);
      };
      r.start();
      recRef.current = r;
      setRec(true);
      timerRef.current = setInterval(() => {
        secs += 1; setElapsed(secs);
        if (secs >= max) { try { r.stop(); } catch { cleanup(); } }
      }, 1000);
    } catch { cleanup(); }
  }

  return (
    <button
      type="button"
      onClick={() => (rec ? (() => { try { recRef.current?.stop(); } catch { cleanup(); } })() : start())}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-full border text-[12px] font-extrabold disabled:opacity-40 ${
        rec ? 'border-[#D64550] bg-[#FDE8E8] text-[#D64550]' : 'border-[#ECE4D3] bg-white text-[#5A6488]'
      }`}
    >
      {rec ? `⏹ ${elapsed}s / ${max}s` : kind === 'audio' ? '🎤 Record' : '🎬 Video'}
    </button>
  );
}

/** ms → local YYYY-MM-DD, so dates render through toDisplayDate. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
