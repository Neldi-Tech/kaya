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
import { useRouter } from 'next/navigation';
import {
  type KidWorkplanItem, type KidWorkplanCompletion, type KidWorkplanProof,
  subscribeKidWorkplanItems, subscribeKidCompletion, completeKidTask,
  subscribeKidWorkplanProofs, submitKidWorkplanProof,
  kidItemsScheduledOn, partitionKidByTime,
  formatTimeLocal, categoryMeta, todayDateString, todayDayOfWeek,
} from '@/lib/kidWorkplan';
import { uploadWorkplanProofMedia } from '@/lib/workplanProofUpload';
import {
  type Business,
  subscribeToKidBusinesses, subscribeToStockTakes,
  isStockTakeScheduledOn, todayKey,
} from '@/lib/business';
import {
  subscribeToOwnerTasks, subscribeToTrackables, generateTasksNow,
  type PulseTask, type Trackable,
} from '@/lib/pulse';

// A Pulse reading counts as "done" once logged (or moved through review/closed).
const PULSE_DONE: ReadonlyArray<PulseTask['status']> = ['logged', 'review', 'closed'];
const isPulseDone = (t: PulseTask) => PULSE_DONE.includes(t.status);

const JOY = { purple: '#9B5DE5', green: '#6BCB77', coral: '#FF6B6B', yellow: '#FFD93D', ink: '#2D1B5E', border: '#F0E8FF' };

export default function KidWorkplanToday({ familyId, childId, childName, date, readOnly = false }: {
  familyId: string;
  childId: string;
  childName?: string;
  date?: Date;
  readOnly?: boolean;
}) {
  const router = useRouter();
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
  // Businesses the kid owns + whether today's stock-take is already done per
  // business. Drives the synthetic "Stock-take · [Business]" Workplan rows
  // (2026-05-26). Synthetic rows never write to workplanCompletions — the
  // stockTake doc itself is the completion signal.
  const [ownedBusinesses, setOwnedBusinesses] = useState<Business[]>([]);
  const [stockTakeDoneToday, setStockTakeDoneToday] = useState<Record<string, boolean>>({});
  // Kaya Pulse reading tasks assigned to THIS kid for the day — surfaced in
  // the same plan so "what do I do today" is one place. `trackById` resolves
  // each task's name + emoji. Realtime so a log flips the tile to ✓.
  const [pulseTasks, setPulseTasks] = useState<PulseTask[] | null>(null);
  const [trackById, setTrackById] = useState<Record<string, Trackable>>({});

  useEffect(() => {
    const unsubItems = subscribeKidWorkplanItems(familyId, childId, setItems);
    const unsubComp = subscribeKidCompletion(familyId, childId, dateStr, (c) => {
      setCompletion(c);
      setOptimistic({}); // server is now source of truth — drop in-flight guesses
    });
    const unsubProofs = subscribeKidWorkplanProofs(familyId, childId, setProofs);
    const unsubBiz = subscribeToKidBusinesses(familyId, childId, setOwnedBusinesses);
    return () => { unsubItems(); unsubComp(); unsubProofs(); unsubBiz(); };
  }, [familyId, childId, dateStr]);

  // Pulse reading tasks for this kid + day (their pulse ownerId = childId).
  useEffect(() => {
    const unsubTasks = subscribeToOwnerTasks(familyId, childId, dateStr, setPulseTasks);
    const unsubTr = subscribeToTrackables(familyId, (list) => {
      setTrackById(Object.fromEntries(list.map((t) => [t.id, t])));
    });
    return () => { unsubTasks(); unsubTr(); };
  }, [familyId, childId, dateStr]);

  // Ensure today's reading tasks exist the moment the kid opens their plan —
  // an idempotent server materialise, so a freshly-assigned meter appears
  // without waiting for the daily cron. Today only (can't backfill other days).
  useEffect(() => {
    if (!isToday) return;
    generateTasksNow(familyId).catch(() => {});
  }, [familyId, isToday]);

  // One subscription per owned business → did a stockTake doc land for today?
  // The realtime flip is what auto-ticks the synthetic row green when the kid
  // saves the take from /business/[id]/stocktake and bounces back here.
  const ownedBizIds = ownedBusinesses.map((b) => b.id).join(',');
  useEffect(() => {
    if (!isToday) { setStockTakeDoneToday({}); return; }
    if (ownedBusinesses.length === 0) { setStockTakeDoneToday({}); return; }
    const today = todayKey();
    const unsubs: Array<() => void> = [];
    for (const b of ownedBusinesses) {
      const u = subscribeToStockTakes(familyId, b.id, (takes) => {
        const has = takes.some((t) => t.date === today);
        setStockTakeDoneToday((prev) => (prev[b.id] === has ? prev : { ...prev, [b.id]: has }));
      }, 3);
      unsubs.push(u);
    }
    return () => { unsubs.forEach((u) => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, ownedBizIds, isToday]);

  // Build synthetic Workplan rows from the kid's businesses + their schedule.
  // Only injected on the today view; historic days stay clean.
  const syntheticItems = useMemo<KidWorkplanItem[]>(() => {
    if (!isToday) return [];
    const dow = todayDayOfWeek(date);
    return ownedBusinesses
      .filter((b) => isStockTakeScheduledOn(b, dow))
      .map<KidWorkplanItem>((b) => ({
        id: `stocktake:${b.id}`,
        label: `Stock-take · ${b.name}`,
        icon: '📋',
        category: 'business',
        daysOfWeek: (b.stockTakeSchedule?.daysOfWeek ?? ['mon','tue','wed','thu','fri','sat','sun']),
        timeLocal: b.stockTakeSchedule?.timeLocal,
        active: true,
        pointsValue: 1,           // display-only; the real HP grant runs on save
        kind: 'recurring',
        createdAt: b.createdAt,   // not stored, but the type needs a Timestamp
        createdBy: 'system',
      }));
  }, [ownedBusinesses, isToday, date]);

  const isSyntheticStockTake = (id: string) => id.startsWith('stocktake:');
  const businessIdFromSynthetic = (id: string) => id.slice('stocktake:'.length);

  // This day's proof per item (doc id = `${date}_${itemId}`).
  const proofByItem = useMemo(() => {
    const m = new Map<string, KidWorkplanProof>();
    for (const p of proofs) if (p.date === dateStr) m.set(p.itemId, p);
    return m;
  }, [proofs, dateStr]);

  // Merge real items + synthetic stock-take rows BEFORE the day-of-week filter
  // so kidItemsScheduledOn does the usual filter for us. Synthetic rows already
  // carry their `daysOfWeek` from the business schedule.
  const allItems = useMemo(() => (items ? [...items, ...syntheticItems] : null), [items, syntheticItems]);
  const scheduled = useMemo(() => (allItems ? kidItemsScheduledOn(allItems, date) : []), [allItems, date]);
  const { timed, anytime } = useMemo(() => partitionKidByTime(scheduled), [scheduled]);

  if (items === null || pulseTasks === null) {
    return <div className="rounded-2xl bg-white/70 border-2 border-[#F0E8FF] p-6 text-center text-sm font-extrabold text-[#9B5DE5]">Loading your day…</div>;
  }

  const doneSet = new Set(completion?.completedItemIds ?? []);
  const isDone = (id: string) => {
    // Synthetic stock-take rows: a stockTake doc landing for today = done.
    if (isSyntheticStockTake(id)) return !!stockTakeDoneToday[businessIdFromSynthetic(id)];
    return optimistic[id] ?? doneSet.has(id);
  };
  const doneCount = scheduled.filter((i) => isDone(i.id)).length;
  const total = scheduled.length;
  // Pulse readings count toward the day's progress too (equal weight) — same
  // as the helper card — so the hero % reflects the kid's WHOLE day.
  const pulseForDay = pulseTasks;
  const pulseDoneCount = pulseForDay.filter(isPulseDone).length;
  const combinedTotal = total + pulseForDay.length;
  const combinedDone = doneCount + pulseDoneCount;
  const pct = combinedTotal > 0 ? Math.round((combinedDone / combinedTotal) * 100) : 0;
  const pointsToday = scheduled
    .filter((i) => isDone(i.id))
    .reduce((s, i) => s + (i.pointsValue ?? 0), 0);
  const allDone = combinedTotal > 0 && combinedDone === combinedTotal;

  const toggle = async (item: KidWorkplanItem) => {
    if (readOnly || !isToday) return;
    // Synthetic stock-take rows live outside the workplanCompletions doc — the
    // stockTake itself IS the completion. Tap routes into the existing flow;
    // the realtime sub flips this row green when the take saves.
    if (isSyntheticStockTake(item.id)) {
      router.push(`/business/${businessIdFromSynthetic(item.id)}/stocktake`);
      return;
    }
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

  if (total === 0 && pulseForDay.length === 0) {
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
              {combinedDone} of {combinedTotal} done{pointsToday > 0 ? ` · ⭐ ${pointsToday} pts` : ''}
              {pulseForDay.length > 0 && <span className="opacity-90"> · 📊 {pulseDoneCount}/{pulseForDay.length} readings</span>}
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

      {/* 📊 Readings — meter/utility readings assigned to this kid for the day.
          Navy Pulse-brand tint so it reads distinct from the workplan tiles.
          Tap a pending tile to log it (routes to Quick Entry). */}
      {pulseForDay.length > 0 && (
        <div className="rounded-2xl p-3 mb-3 border-2" style={{ background: 'rgba(15,31,68,0.04)', borderColor: 'rgba(15,31,68,0.16)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: '#0F1F44' }}>
            📊 Readings to log
            <span className="text-[9px] font-bold normal-case" style={{ color: '#5C6975' }}>({pulseDoneCount}/{pulseForDay.length} done)</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {pulseForDay.map((t) => {
              const tr = trackById[t.trackableId];
              const emoji = tr?.emoji ?? '📊';
              const name = tr?.name ?? 'Reading';
              const done = isPulseDone(t);
              const missed = t.status === 'missed';
              const canLog = isToday && !readOnly && !done;
              const inner = (
                <>
                  <span className="text-3xl" aria-hidden>{emoji}</span>
                  <span
                    className="text-[11px] font-extrabold text-center leading-tight line-clamp-2 px-1"
                    style={{ color: done ? '#2E7D34' : missed ? '#C0392B' : '#0F1F44' }}
                  >
                    {name}
                  </span>
                  {done ? (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#6BCB77] text-white flex items-center justify-center text-[12px] font-black">✓</span>
                  ) : missed ? (
                    <span className="absolute top-1 right-1 text-[8px] uppercase tracking-wider font-black bg-[#FF6B6B] text-white px-1 rounded">Missed</span>
                  ) : canLog ? (
                    <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: JOY.purple }}>Tap to log</span>
                  ) : null}
                </>
              );
              const base = 'relative aspect-square flex flex-col items-center justify-center gap-1 p-2 rounded-2xl border-2 transition-all';
              const tone = done
                ? 'bg-[#F1FBF2] border-[#6BCB77]'
                : missed
                  ? 'bg-[#FFF1EE] border-[#FF6B6B]'
                  : 'bg-white border-[#0F1F44]/25';
              return canLog ? (
                <button key={t.id} type="button" onClick={() => router.push(`/pulse/log/${t.id}`)} className={`${base} ${tone} hover:shadow-sm active:scale-[0.99]`}>
                  {inner}
                </button>
              ) : (
                <div key={t.id} className={`${base} ${tone} cursor-default`}>{inner}</div>
              );
            })}
          </div>
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
