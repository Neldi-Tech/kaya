// KidWorkplanToday — a kid's playful "My Workplan" for a day. A
// time-ordered timeline (school schedule first), tap-to-tick with a
// celebratory % bar + points. Ticks route through the server so points
// land (kids can't write awards). Realtime: a parent edit / award shows
// up live. Reused read-only by the profile accomplishment view (Phase 2b).
//
// Proof for points (2026-05-23): a task flagged requiresProof opens a
// "Show your work" modal (note + photo/video) instead of a plain tick —
// the kid earns its points only after submitting proof (instantly or on
// parent approval, per the family's workplanProofMode). Each proof task
// shows its live status: Pending review / Approved +N / Try again.
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type KidWorkplanItem, type KidWorkplanCompletion, type KidWorkplanProof,
  subscribeKidWorkplanItems, subscribeKidCompletion, completeKidTask,
  subscribeKidWorkplanProofs, submitKidWorkplanProof,
  kidItemsScheduledOn, partitionKidByTime, dailyKidPct,
  formatTimeLocal, categoryMeta, todayDateString,
} from '@/lib/kidWorkplan';
import { uploadWorkplanProofMedia } from '@/lib/workplanProofUpload';

const JOY = { purple: '#9B5DE5', green: '#6BCB77', coral: '#FF6B6B', yellow: '#FFD93D', ink: '#2D1B5E', border: '#F0E8FF' };

export default function KidWorkplanToday({ familyId, childId, childName, date, readOnly = false }: {
  familyId: string;
  childId: string;
  childName?: string;
  date?: Date;
  readOnly?: boolean;
}) {
  const dateStr = todayDateString(date);
  const isToday = dateStr === todayDateString();

  const [items, setItems] = useState<KidWorkplanItem[] | null>(null);
  const [completion, setCompletion] = useState<KidWorkplanCompletion | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Proof docs for THIS child (read-only; written server-side). Keyed by
  // itemId for the current day so each proof task shows its status.
  const [proofs, setProofs] = useState<KidWorkplanProof[]>([]);
  // The proof task whose "Show your work" modal is open (null = closed).
  const [proofFor, setProofFor] = useState<KidWorkplanItem | null>(null);

  useEffect(() => {
    const unsubItems = subscribeKidWorkplanItems(familyId, childId, setItems);
    const unsubComp = subscribeKidCompletion(familyId, childId, dateStr, (c) => {
      setCompletion(c);
      setOptimistic({}); // server is now source of truth — drop in-flight guesses
    });
    const unsubProofs = subscribeKidWorkplanProofs(familyId, childId, setProofs);
    return () => { unsubItems(); unsubComp(); unsubProofs(); };
  }, [familyId, childId, dateStr]);

  // This day's proof per item (doc id = `${date}_${itemId}`).
  const proofByItem = useMemo(() => {
    const m = new Map<string, KidWorkplanProof>();
    for (const p of proofs) if (p.date === dateStr) m.set(p.itemId, p);
    return m;
  }, [proofs, dateStr]);

  const scheduled = useMemo(() => (items ? kidItemsScheduledOn(items, date) : []), [items, date]);
  const { timed, anytime } = useMemo(() => partitionKidByTime(scheduled), [scheduled]);

  if (items === null) {
    return <div className="rounded-2xl bg-white/70 border-2 border-[#F0E8FF] p-6 text-center text-sm font-extrabold text-[#9B5DE5]">Loading your day…</div>;
  }

  const doneSet = new Set(completion?.completedItemIds ?? []);
  const isDone = (id: string) => optimistic[id] ?? doneSet.has(id);
  const doneCount = scheduled.filter((i) => isDone(i.id)).length;
  const total = scheduled.length;
  const pct = dailyKidPct(scheduled, completion);
  const pointsToday = scheduled
    .filter((i) => isDone(i.id))
    .reduce((s, i) => s + (i.pointsValue ?? 0), 0);
  const allDone = total > 0 && doneCount === total;

  const toggle = async (item: KidWorkplanItem) => {
    if (readOnly || !isToday) return;
    // Proof-required tasks earn via the "Show your work" modal, not a
    // plain tick. Tapping one opens the capture flow instead of toggling.
    if (item.requiresProof) {
      setProofFor(item);
      return;
    }
    const next = !isDone(item.id);
    setOptimistic((o) => ({ ...o, [item.id]: next }));
    setBusy(item.id);
    try {
      const r = await completeKidTask({ familyId, childId, itemId: item.id, date: dateStr, on: next });
      if (!r.ok) setOptimistic((o) => ({ ...o, [item.id]: !next })); // revert on failure
    } finally {
      setBusy(null);
    }
  };

  if (total === 0) {
    return (
      <div className="rounded-2xl bg-white border-2 border-dashed border-[#F0E8FF] p-8 text-center">
        <div className="text-4xl mb-2">🗓️</div>
        <p className="font-extrabold text-[15px]" style={{ color: JOY.ink }}>Nothing planned {isToday ? 'today' : 'this day'}</p>
        <p className="text-[12px] text-[#5C6975] mt-1">When a grown-up adds tasks, they show up here.</p>
      </div>
    );
  }

  const Tile = ({ item }: { item: KidWorkplanItem }) => {
    const cat = categoryMeta(item.category);
    const proof = item.requiresProof ? proofByItem.get(item.id) : undefined;
    // A proof task counts as "done" once a proof exists (pending or
    // approved). Rejected drops back so the kid can try again.
    const proofDone = !!proof && proof.status !== 'rejected';
    const done = item.requiresProof ? proofDone : isDone(item.id);
    const pts = item.pointsValue ?? 0;
    const approved = proof?.status === 'approved';
    return (
      <button
        type="button"
        disabled={readOnly || !isToday || busy === item.id}
        onClick={() => toggle(item)}
        aria-pressed={done}
        className={`w-full flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all ${
          done ? 'bg-[#F1FBF2] border-[#6BCB77]' : 'bg-white border-[#F0E8FF]'
        } ${readOnly || !isToday ? 'cursor-default' : 'hover:shadow-sm active:scale-[0.99]'} ${busy === item.id ? 'opacity-60' : ''}`}
      >
        {/* check bubble */}
        <span
          className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 text-white text-[14px] font-black"
          style={{ background: done ? JOY.green : '#fff', border: `2px solid ${done ? JOY.green : JOY.purple}`, color: done ? '#fff' : 'transparent' }}
        >
          ✓
        </span>
        <span className="text-2xl flex-shrink-0" aria-hidden>{item.icon || cat.icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block font-extrabold text-[13px] leading-tight ${done ? 'line-through text-[#5C6975]' : ''}`} style={done ? {} : { color: JOY.ink }}>
            {item.label}
          </span>
          <span className="block text-[10px] font-bold mt-0.5" style={{ color: cat.color }}>
            <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: cat.color }} />
            {cat.label}{item.note ? ` · ${item.note}` : ''}
            {item.requiresProof && !proof && <span className="ml-1" style={{ color: JOY.purple }}>· 📸 Show your work</span>}
          </span>
          {/* Proof status line (proof tasks only) */}
          {item.requiresProof && proof && (
            <span className="block text-[10px] font-black mt-1">
              {proof.status === 'pending' && <span style={{ color: JOY.purple }}>⏳ Pending review</span>}
              {proof.status === 'approved' && <span style={{ color: JOY.green }}>✓ Approved{pts > 0 ? ` +${pts}` : ''}</span>}
              {proof.status === 'rejected' && (
                <span style={{ color: JOY.coral }}>
                  🔁 Try again{proof.reviewNote ? ` — “${proof.reviewNote}”` : ''}
                </span>
              )}
            </span>
          )}
        </span>
        {pts > 0 && (
          <span
            className="flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-lg text-white"
            style={{ background: approved || (!item.requiresProof && done) ? JOY.green : `linear-gradient(135deg, ${JOY.purple}, #6A4FCF)` }}
          >
            {approved || (!item.requiresProof && done) ? `+${pts} ✓` : `+${pts}`}
          </span>
        )}
      </button>
    );
  };

  return (
    <div>
      {/* Progress hero */}
      <div className="rounded-2xl p-4 mb-3 text-white" style={{ background: `linear-gradient(135deg, ${JOY.purple}, ${JOY.coral})` }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-[16px] leading-tight">
              {allDone ? '🎉 All done!' : childName ? `Habari, ${childName.split(' ')[0]} 👋` : 'My day'}
            </p>
            <p className="text-[12px] font-bold opacity-90 mt-0.5">
              {doneCount} of {total} done{pointsToday > 0 ? ` · ⭐ ${pointsToday} pts` : ''}
            </p>
          </div>
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 font-black text-[16px] flex-shrink-0 border-2 border-white/40">
            {pct}%
          </div>
        </div>
        <div className="mt-3 h-2.5 w-full rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {allDone && (
        <div className="rounded-2xl p-3 mb-3 text-center font-black text-[13px]" style={{ background: JOY.yellow, color: '#5A3D00' }}>
          🌟 You finished everything {isToday ? 'today' : 'this day'}! Amazing!
        </div>
      )}

      {/* Timeline (timed) */}
      {timed.length > 0 && (
        <div className="space-y-2">
          {timed.map((item) => (
            <div key={item.id} className="flex items-stretch gap-2">
              <div className="flex-shrink-0 w-14 pt-3 text-right">
                <span className="text-[11px] font-black" style={{ color: JOY.purple }}>{formatTimeLocal(item.timeLocal)}</span>
              </div>
              <div className="flex-1 min-w-0"><Tile item={item} /></div>
            </div>
          ))}
        </div>
      )}

      {/* Anytime */}
      {anytime.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: JOY.ink }}>⏰ Anytime</p>
          <div className="space-y-2">
            {anytime.map((item) => <Tile key={item.id} item={item} />)}
          </div>
        </div>
      )}

      {/* "Show your work" capture modal (proof tasks only) */}
      {proofFor && (
        <ProofModal
          familyId={familyId}
          childId={childId}
          date={dateStr}
          item={proofFor}
          onClose={() => setProofFor(null)}
        />
      )}
    </div>
  );
}

// ── "Show your work" capture modal ────────────────
// Note textarea + one media (image/* OR video/*). Submit is disabled
// until BOTH a note and a file are picked. On submit: upload the media
// to Storage, then POST the proof to the server (which awards / queues
// for approval). Keeps the playful joy palette.
function ProofModal({ familyId, childId, date, item, onClose }: {
  familyId: string;
  childId: string;
  date: string;
  item: KidWorkplanItem;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setIsVideo(file.type.startsWith('video/'));
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const canSubmit = note.trim().length > 0 && !!file && !busy;
  const pts = item.pointsValue ?? 0;

  const submit = async () => {
    if (!file || !note.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { url, mediaType } = await uploadWorkplanProofMedia({ familyId, childId, itemId: item.id, date, file });
      const r = await submitKidWorkplanProof({
        familyId, childId, itemId: item.id, date,
        note: note.trim(), mediaUrl: url, mediaType,
      });
      if (!r.ok) { setErr("Couldn't send your proof — please try again."); return; }
      onClose();
    } catch (e) {
      setErr((e as { message?: string })?.message ?? "Couldn't send your proof — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl bg-white border-2 p-4 max-h-[90vh] overflow-y-auto"
        style={{ borderColor: JOY.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl" aria-hidden>{item.icon || categoryMeta(item.category).icon}</span>
          <p className="font-black text-[16px]" style={{ color: JOY.ink }}>Show your work 📸</p>
        </div>
        <p className="text-[12px] font-bold text-[#5C6975] mb-3">
          {item.label}{pts > 0 ? ` · earn +${pts} ⭐` : ''}
        </p>

        <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: JOY.purple }}>Tell us what you did</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="I finished my maths homework and checked my answers!"
          className="w-full rounded-2xl border-2 p-3 text-[13px] font-bold focus:outline-none mb-3"
          style={{ borderColor: JOY.border, color: JOY.ink }}
        />

        <label className="block text-[10px] font-black uppercase tracking-wider mb-1" style={{ color: JOY.purple }}>Add a photo or video</label>
        <input
          type="file"
          accept="image/*,video/*"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }}
          className="w-full text-[12px] font-bold mb-2 file:mr-3 file:rounded-full file:border-0 file:px-3 file:py-1.5 file:text-[12px] file:font-black file:text-white"
          style={{ color: JOY.ink }}
        />

        {previewUrl && (
          <div className="mb-3 rounded-2xl overflow-hidden border-2" style={{ borderColor: JOY.border }}>
            {isVideo
              ? <video src={previewUrl} controls className="w-full max-h-56 object-contain bg-black" />
              : <img src={previewUrl} alt="proof preview" className="w-full max-h-56 object-contain bg-[#FAF7FF]" />}
          </div>
        )}

        {err && (
          <div className="mb-3 rounded-2xl bg-red-50 border-2 border-red-200 text-red-700 text-[12px] font-extrabold px-3 py-2">⚠ {err}</div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 h-10 rounded-full text-[13px] font-black text-[#5C6975]">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit}
            className="px-5 h-10 rounded-full text-[13px] font-black text-white disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${JOY.purple}, ${JOY.coral})` }}>
            {busy ? 'Sending…' : 'Submit proof'}
          </button>
        </div>
      </div>
    </div>
  );
}
