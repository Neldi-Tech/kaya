'use client';

// Kaya Sparks · Treasures 2.0 — ✍️ "Write about it" (C4 · D34 · D35).
//
// Design screen 7. The kid writes two lines about the book — typed, 🎙
// said out loud, or 📷 a scan of their notebook — and it goes through
// the SAME reflection engine the daily reflection uses: Kaya's warm read
// (/api/sparks/ai/reflection-read), the thoughtfulness score
// (/api/sparks/ai/reflection-score) and the structured feedback
// (/api/sparks/ai/reflect). The entry is a real reflection with
// origin { kind: 'book' } — it counts for the streak and wears the 📚
// chip everywhere (D35). Book typing is ALWAYS allowed (D34).

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
import {
  saveReadingNote, attachReadingNoteAI, rateReadingNote, listReadingNotes,
  type BookNoteEntry,
} from '@/lib/sparks/cupboard';
import type { Reading } from '@/lib/sparks/treasures';
import { toDisplayDate } from '@/lib/dates';
import ReflectionOriginChip from './ReflectionOriginChip';
import { inputCls, Pill, JADE } from './CupboardShell';

interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export default function ReadingNoteComposer({ familyId, treasureId, bookName, reading, kidFirstName, kidAge, canWrite, isParent, onChanged }: {
  familyId: string;
  treasureId: string;
  bookName: string;
  reading: Reading;
  kidFirstName: string;
  kidAge?: number;
  /** The reader themselves, a parent, or an allow-listed helper. */
  canWrite: boolean;
  isParent: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [page, setPage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState<{ kaya?: string; score?: number; fb?: BookNoteEntry['feedback'] } | null>(null);
  const [notes, setNotes] = useState<BookNoteEntry[] | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef('');

  const readerKidId = reading.readerKidId;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSpeechOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (!readerKidId) return;
    let dead = false;
    listReadingNotes(treasureId, readerKidId).then((n) => { if (!dead) setNotes(n); }).catch(() => { if (!dead) setNotes([]); });
    return () => { dead = true; };
  }, [treasureId, readerKidId, reply]);

  if (!readerKidId) return null;

  function startListening() {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    baseRef.current = text ? `${text.trim()} ` : '';
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-GB';
    rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += `${e.results[i][0].transcript} `;
      setText((baseRef.current + full).trim());
    };
    rec.onerror = () => { setErr('The microphone didn’t catch that — try again or type it.'); stopListening(); };
    rec.onend = () => setListening(false);
    try { rec.start(); recRef.current = rec; setListening(true); setErr(''); } catch { /* noop */ }
  }
  function stopListening() { try { recRef.current?.stop(); } catch { /* noop */ } setListening(false); }

  async function onScan(files: File[]) {
    setScanOpen(false);
    const f = files[0];
    if (!f) return;
    setBusy(true); setErr('');
    try {
      const imageBase64 = await fileToBase64(f);
      const res = await fetch('/api/sparks/ai/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mediaType: f.type || 'image/jpeg', kind: 'reflection' }),
      });
      const data = await res.json().catch(() => ({}));
      const t = typeof data?.text === 'string' ? data.text : typeof data?.content === 'string' ? data.content : '';
      if (t.trim()) setText((prev) => (prev ? `${prev.trim()}\n${t.trim()}` : t.trim()));
      else setErr('Kaya couldn’t read that page — try a flatter, brighter photo, or type it.');
    } catch { setErr('Could not read the scan.'); }
    finally { setBusy(false); }
  }

  async function save() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr(''); setReply(null);
    try {
      const r = await saveReadingNote(familyId, treasureId, reading.id, {
        text: t, source: 'typed', page: page ? Number(page) : undefined,
      });
      setText(''); setPage('');
      // The engine, in parallel — all best-effort, like the daily reflection.
      const out: { kaya?: string; score?: number; fb?: BookNoteEntry['feedback'] } = {};
      await Promise.all([
        (async () => {
          try {
            const res = await fetch('/api/sparks/ai/reflection-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: r.text, firstName: kidFirstName }) });
            const d = await res.json().catch(() => ({}));
            if (d && !d.skipped && d.mood_emoji) { out.kaya = d.kaya_response; await attachReadingNoteAI(treasureId, r.entryId, { ai_read: d }); }
          } catch { /* best-effort */ }
        })(),
        (async () => {
          try {
            const res = await fetch('/api/sparks/ai/reflection-score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: r.text }) });
            const d = await res.json().catch(() => ({}));
            if (d && !d.skipped && typeof d.soundness === 'number') { out.score = d.soundness; await attachReadingNoteAI(treasureId, r.entryId, { ai_score: d }); }
          } catch { /* best-effort */ }
        })(),
        (async () => {
          try {
            const res = await fetch('/api/sparks/ai/reflect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: r.text, firstName: kidFirstName, ...(kidAge ? { ageYears: kidAge } : {}), context: `This is about the book "${bookName}" the child is reading.` }) });
            const d = await res.json().catch(() => ({}));
            if (d && !d.skipped && d.wentWell) { out.fb = d; await attachReadingNoteAI(treasureId, r.entryId, { feedback: d }); }
          } catch { /* best-effort */ }
        })(),
      ]);
      setReply(out);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error && e.message === 'kids-only' ? 'Book notes are for the kid readers.' : 'Could not save that — try again.');
    } finally { setBusy(false); }
  }

  const latest = (notes ?? []).slice(0, 3);

  return (
    <div className="mt-2.5 rounded-[12px] border border-[#BFE3D8] bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-display font-extrabold text-[12px] text-[#0E6B5E]">✍️ {canWrite ? 'Write about it' : 'Notes about it'} <ReflectionOriginChip origin={{ kind: 'book' }} small /></div>
        {canWrite && <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-extrabold" style={{ color: JADE }}>{open ? 'Close' : (latest.length ? '+ Tonight’s note' : 'Write')}</button>}
      </div>

      {open && canWrite && (
        <div className="mt-2">
          <textarea className={`${inputCls} min-h-[72px]`} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened? What did you think?" maxLength={2000} />
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {speechOk && (
              <button type="button" onClick={listening ? stopListening : startListening} className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#BFE3D8] bg-white" style={{ color: listening ? '#C0392B' : JADE }}>
                {listening ? '⏹ Stop' : '🎙 Say it'}
              </button>
            )}
            <button type="button" onClick={() => setScanOpen(true)} className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#BFE3D8] bg-white" style={{ color: JADE }}>📷 Scan my notebook</button>
            <label className="ml-auto text-[10.5px] font-extrabold text-[#8A8471] flex items-center gap-1">
              page <input className="w-[64px] rounded-[8px] border border-[#E8E0CF] px-2 py-1 text-[11px]" inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ''))} placeholder={String(reading.currentPage)} />
            </label>
          </div>
          <div className="flex gap-2 mt-2">
            <Pill bg={JADE} fg="#fff" disabled={busy || !text.trim()} onClick={save}>{busy ? 'Kaya is reading…' : '✓ Save & hear from Kaya'}</Pill>
          </div>
          {err && <p className="text-[11px] text-[#C0392B] font-bold mt-1.5 m-0">{err}</p>}
          <p className="text-[10px] text-[#8A8471] italic mt-1.5 m-0">Saved to your Reflections with a 📚 Book chip — counts for your streak. Typing is always allowed for books.</p>
        </div>
      )}

      {reply && (
        <div className="mt-2 rounded-[10px] border border-[#D9CCFA] bg-[#EFE8FF] p-2.5 text-[11.5px] leading-snug text-[#3B2A73]">
          <b className="text-[#5A3CB8]">Kaya</b> · {reply.kaya || reply.fb?.wentWell || 'Saved. Nice work writing it down.'}
          {reply.fb?.tip && <div className="mt-1">💡 {reply.fb.tip}</div>}
          {typeof reply.score === 'number' && (
            <div className="mt-1.5">
              <span className="text-[10.5px] font-extrabold">Thoughtfulness {reply.score}%</span>
              <div className="h-1.5 rounded-full bg-white overflow-hidden mt-1"><div className="h-full" style={{ width: `${reply.score}%`, background: 'linear-gradient(90deg,#E9746D,#F0B23C,#3FA38F)' }} /></div>
            </div>
          )}
          <div className="mt-1.5 text-[10.5px]"><ReflectionOriginChip origin={{ kind: 'book', label: bookName }} small withLabel /> · saved to <Link href={`/sparks/${readerKidId}/reflection`} className="font-extrabold text-[#5A3CB8]">Reflections →</Link></div>
        </div>
      )}

      {latest.length > 0 && (
        <div className="mt-2">
          {latest.map((n) => (
            <NoteRow key={n.id} n={n} treasureId={treasureId} familyId={familyId} isParent={isParent} onRated={() => setReply((r) => ({ ...(r || {}) }))} />
          ))}
          {(notes?.length || 0) > 3 && <p className="text-[10px] text-[#8A8471] m-0 mt-1">+{(notes?.length || 0) - 3} more on the Reflections page</p>}
        </div>
      )}

      {scanOpen && (
        <CameraCaptureSheet open={scanOpen} mode="scan" onClose={() => setScanOpen(false)} onConfirm={onScan} />
      )}
    </div>
  );
}

function NoteRow({ n, treasureId, familyId, isParent, onRated }: { n: BookNoteEntry; treasureId: string; familyId: string; isParent: boolean; onRated: () => void }) {
  const [rating, setRating] = useState(false);
  const [stars, setStars] = useState(n.parent_rating?.stars || 0);
  const [note, setNote] = useState(n.parent_rating?.notes || '');
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[10px] border border-[#E8E0CF] bg-[#FBF7EE] p-2 mt-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-[#8A8471]">
        {toDisplayDate(n.date)} <ReflectionOriginChip origin={n.origin} small />
        {n.origin?.page ? <span>· p.{n.origin.page}</span> : null}
        {typeof n.ai_score?.soundness === 'number' && <span className="ml-auto text-[#0E6B5E]">AI {n.ai_score.soundness}%</span>}
      </div>
      <p className="text-[11.5px] italic text-[#394458] mt-1 m-0 leading-snug line-clamp-4">&ldquo;{n.text}&rdquo;</p>
      {n.ai_read?.kaya_response && <p className="text-[10.5px] text-[#5A3CB8] font-bold mt-1 m-0">Kaya: {n.ai_read.kaya_response}</p>}
      {n.parent_rating && (
        <p className="text-[10.5px] font-bold text-[#2C4A44] mt-1 m-0">
          {n.parent_rating.stars ? <span style={{ color: '#D4A847' }}>{'★'.repeat(n.parent_rating.stars)}{'☆'.repeat(5 - n.parent_rating.stars)}</span> : null}
          {n.parent_rating.notes ? ` ${n.parent_rating.ratedByName}: “${n.parent_rating.notes}”` : ` rated by ${n.parent_rating.ratedByName}`}
        </p>
      )}
      {isParent && (
        <div className="mt-1.5">
          {!rating ? (
            <button type="button" onClick={() => setRating(true)} className="text-[10.5px] font-extrabold" style={{ color: JADE }}>{n.parent_rating ? '✏️ Re-rate' : '⭐ Rate as usual'}</button>
          ) : (
            <div>
              <div className="flex gap-1 text-[18px]" style={{ color: '#D4A847' }}>
                {[1, 2, 3, 4, 5].map((s) => <button key={s} type="button" onClick={() => setStars(s)} aria-label={`${s} stars`}>{s <= stars ? '★' : '☆'}</button>)}
              </div>
              <input className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="a line for them (they’ll see it)" maxLength={600} />
              <div className="flex gap-2 mt-1.5">
                <Pill bg={JADE} fg="#fff" disabled={busy || !stars} onClick={async () => { setBusy(true); try { await rateReadingNote(familyId, treasureId, n.id, { stars, notes: note.trim() || undefined }); setRating(false); onRated(); } finally { setBusy(false); } }}>Save rating</Pill>
                <Pill bg="#EEF0F4" fg="#5B6B8C" onClick={() => setRating(false)}>Cancel</Pill>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
