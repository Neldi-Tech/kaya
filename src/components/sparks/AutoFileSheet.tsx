'use client';

// AutoFileSheet — the "🪄 Kaya filed this for you" confirm card (Scanning
// 3.0 · AI Auto-File + Rapid Batch Scan). Runs autoFileScan on each captured
// page, shows the suggested Area · Title · Date · Subject (all editable), and
// on confirm uploads the photos + creates the Sparks item(s) in the right
// area for the kid. One page → the single confirm card. Many pages → a batch
// list with a 🟢/🟡/🔴 quality dot per page and "File all N". The parent is
// always the final say.

import { useEffect, useState } from 'react';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import { autoFileScan } from '@/lib/sparks/ai';
import { scanQuality, type ScanQuality } from '@/lib/photoEnhance';
import { SPARKS_AREA_META, type SparksItemArea } from '@/lib/sparks/schema';
import { todayYmd } from '@/lib/sparks/firestore';

const AREAS: SparksItemArea[] = ['achievement', 'school_project', 'home_project', 'sports_subscription', 'revision'];

type RowStatus = 'pending' | 'filing' | 'filed' | 'error';
interface Row {
  file: File;
  previewUrl: string;
  reading: boolean;            // AI classify still in flight
  quality: ScanQuality | null; // null = still measuring
  area: SparksItemArea;
  title: string;
  subject: string;
  date: string;
  status: RowStatus;
  error?: string;
}

const QDOT: Record<ScanQuality, { c: string; label: string }> = {
  good: { c: '#16A34A', label: 'Sharp' },
  ok: { c: '#D9A406', label: 'Readable' },
  low: { c: '#DC2626', label: 'Blurry — reshoot?' },
};

function showSubjectFor(a: SparksItemArea) { return a === 'school_project' || a === 'revision'; }

export default function AutoFileSheet({
  familyId, kidId, kidName, files, createdBy, onClose, onFiled,
}: {
  familyId: string;
  kidId: string;
  kidName: string;
  files: File[];
  createdBy: string;
  onClose: () => void;
  onFiled?: (itemId: string, area: SparksItemArea) => void;
}) {
  const batch = files.length > 1;
  const firstName = kidName.split(' ')[0];

  const [rows, setRows] = useState<Row[]>(() => files.map((f) => ({
    file: f, previewUrl: '', reading: true, quality: null,
    area: 'achievement' as SparksItemArea, title: '', subject: '', date: todayYmd(), status: 'pending' as RowStatus,
  })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  // Object-URL previews (revoked on unmount)
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setRows((rs) => rs.map((r, i) => ({ ...r, previewUrl: urls[i] })));
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // AI classifies each page
  useEffect(() => {
    let cancelled = false;
    files.forEach((f, i) => {
      autoFileScan(f, kidName)
        .then((s) => {
          if (cancelled) return;
          if (s) patch(i, { area: s.area, title: s.title, subject: s.subject, date: s.date || todayYmd(), reading: false });
          else patch(i, { reading: false });
        })
        .catch(() => { if (!cancelled) patch(i, { reading: false }); });
    });
    return () => { cancelled = true; };
  }, [files, kidName]);

  // Quality dot per page
  useEffect(() => {
    let cancelled = false;
    files.forEach((f, i) => {
      scanQuality(f).then((q) => { if (!cancelled) patch(i, { quality: q }); }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [files]);

  const fileEntry = async (i: number, r: Row): Promise<boolean> => {
    if (!r.title.trim()) { patch(i, { status: 'error', error: 'Needs a title' }); return false; }
    patch(i, { status: 'filing', error: undefined });
    try {
      const ref = doc(collection(db, 'families', familyId, 'sparks_items'));
      const urls = await uploadSparksPhotos(familyId, ref.id, [r.file]);
      await setDoc(ref, {
        kid_id: kidId,
        area: r.area,
        title: r.title.trim(),
        ...(r.subject.trim() && showSubjectFor(r.area) ? { subject: r.subject.trim() } : {}),
        photo_urls: urls.map((u) => u.feedUrl),
        date: r.date,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by: createdBy,
      });
      patch(i, { status: 'filed' });
      onFiled?.(ref.id, r.area);
      return true;
    } catch (e) {
      patch(i, { status: 'error', error: e instanceof Error ? e.message : "Couldn't file it" });
      return false;
    }
  };

  const fileOne = async () => {
    setBusy(true); setErr(null);
    const ok = await fileEntry(0, rows[0]);
    if (ok) onClose(); else setBusy(false);
  };

  const fileAll = async () => {
    setBusy(true); setErr(null);
    const snap = rows;
    let filed = 0;
    for (let i = 0; i < snap.length; i++) {
      if (snap[i].status === 'filed') { filed++; continue; }
      // eslint-disable-next-line no-await-in-loop
      const ok = await fileEntry(i, snap[i]);
      if (ok) filed++;
    }
    if (filed === snap.length) onClose();
    else { setBusy(false); setErr(`Filed ${filed}/${snap.length}. Fix the flagged page${snap.length - filed > 1 ? 's' : ''} and try again.`); }
  };

  const anyReading = rows.some((r) => r.reading);
  const QualityDot = ({ q }: { q: ScanQuality | null }) =>
    q ? <span title={QDOT[q].label} className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: QDOT[q].c }} /> : null;

  // ── Single page: the approved AI Auto-File confirm card ───────────────────
  if (!batch) {
    const r = rows[0];
    const showSubject = showSubjectFor(r.area);
    return (
      <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={onClose}>
        <div className="w-full sm:max-w-md rounded-3xl bg-white p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <p className="font-display font-extrabold text-[16px] text-[#0F1F44]">🪄 Kaya filed this for you</p>
            <button type="button" onClick={onClose} className="text-[#5A6488] text-xs font-bold">Close</button>
          </div>
          <p className="text-[12px] text-[#5A6488] mb-3 flex items-center gap-1.5">
            {r.reading ? 'Reading the page…' : `For ${firstName} — check it, then file.`}
            {!r.reading && <QualityDot q={r.quality} />}
          </p>

          {/* Area picker */}
          <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1.5">Where it goes</label>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {AREAS.map((a) => {
              const meta = SPARKS_AREA_META[a];
              const on = r.area === a;
              return (
                <button key={a} type="button" onClick={() => patch(0, { area: a })} disabled={busy}
                  className={`flex items-center gap-1.5 rounded-xl border-2 px-2.5 py-2 text-left text-[12px] font-extrabold disabled:opacity-50 ${on ? 'border-[#5A3CB8] bg-[#F6F0FF] text-[#5A3CB8]' : 'border-[#ECE4D3] text-[#0F1F44]'}`}>
                  <span aria-hidden>{meta.emoji}</span>{meta.label}
                </button>
              );
            })}
          </div>

          <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1">Title</label>
          <input type="text" value={r.title} maxLength={120} onChange={(e) => patch(0, { title: e.target.value })}
            placeholder={r.reading ? 'Reading…' : 'e.g. Kipchoge Award · Mile Run'}
            className="w-full h-10 px-3 rounded-xl border-2 border-[#ECE4D3] text-[14px] font-bold text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] mb-3" />

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1">Date</label>
              <input type="date" value={r.date} max={todayYmd()} onChange={(e) => patch(0, { date: e.target.value })}
                className="w-full h-10 px-2 rounded-xl border-2 border-[#ECE4D3] text-[13px] font-bold focus:outline-none focus:border-[#5A3CB8]" />
            </div>
            {showSubject && (
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1">Subject</label>
                <input type="text" value={r.subject} maxLength={40} onChange={(e) => patch(0, { subject: e.target.value })}
                  placeholder="Maths…"
                  className="w-full h-10 px-2 rounded-xl border-2 border-[#ECE4D3] text-[13px] font-bold focus:outline-none focus:border-[#5A3CB8]" />
              </div>
            )}
          </div>

          {err && <p className="text-[12px] font-bold text-[#A33A2A] mb-2">⚠ {err}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="px-4 h-11 rounded-full text-[13px] font-black text-[#5A6488]">Cancel</button>
            <button type="button" onClick={fileOne} disabled={busy || r.reading}
              className="px-5 h-11 rounded-full text-[14px] font-black text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#7c5cff,#9a86ff)' }}>
              {busy ? 'Filing…' : '✓ File it'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Many pages: Rapid Batch Scan list ─────────────────────────────────────
  const filedCount = rows.filter((r) => r.status === 'filed').length;
  return (
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="w-full sm:max-w-lg rounded-3xl bg-white p-4 max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-0.5">
          <p className="font-display font-extrabold text-[16px] text-[#0F1F44]">🪄 Kaya filed {rows.length} pages</p>
          <button type="button" onClick={onClose} className="text-[#5A6488] text-xs font-bold">Close</button>
        </div>
        <p className="text-[12px] text-[#5A6488] mb-2">
          {anyReading ? 'Reading the pages…' : `For ${firstName} — check each, then file them all.`}
        </p>
        <div className="flex items-center gap-3 mb-2 text-[10px] font-bold text-[#5A6488]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: QDOT.good.c }} /> Sharp</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: QDOT.ok.c }} /> Readable</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: QDOT.low.c }} /> Reshoot?</span>
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
          {rows.map((r, i) => {
            const meta = SPARKS_AREA_META[r.area];
            const showSubject = showSubjectFor(r.area);
            const done = r.status === 'filed';
            const lock = busy || done;
            return (
              <div key={i} className={`rounded-2xl border-2 p-2.5 flex gap-2.5 ${done ? 'border-[#BBE7C9] bg-[#F2FBF5]' : r.status === 'error' ? 'border-[#F0C0B8] bg-[#FDF4F2]' : 'border-[#ECE4D3]'}`}>
                {/* thumbnail + quality dot */}
                <div className="relative shrink-0">
                  {r.previewUrl
                    ? <img src={r.previewUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-[#ECE4D3]" />
                    : <div className="w-16 h-16 rounded-xl bg-[#F4EFE3]" />}
                  {r.quality && (
                    <span title={QDOT[r.quality].label}
                      className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full border-2 border-white"
                      style={{ background: QDOT[r.quality].c }} />
                  )}
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-black text-[#5A6488] bg-white px-1 rounded-full border border-[#ECE4D3]">{i + 1}</span>
                </div>

                {/* fields */}
                <div className="flex-1 min-w-0">
                  {done ? (
                    <p className="text-[13px] font-extrabold text-[#16823F] flex items-center gap-1">✓ Filed · <span aria-hidden>{meta.emoji}</span>{meta.label}</p>
                  ) : (
                    <select value={r.area} onChange={(e) => patch(i, { area: e.target.value as SparksItemArea })} disabled={lock}
                      className="w-full h-8 px-2 rounded-lg border-2 border-[#ECE4D3] text-[12px] font-extrabold text-[#0F1F44] bg-white mb-1.5 disabled:opacity-60">
                      {AREAS.map((a) => <option key={a} value={a}>{SPARKS_AREA_META[a].emoji} {SPARKS_AREA_META[a].label}</option>)}
                    </select>
                  )}
                  <input type="text" value={r.title} maxLength={120} disabled={lock}
                    onChange={(e) => patch(i, { title: e.target.value })}
                    placeholder={r.reading ? 'Reading…' : 'Title'}
                    className="w-full h-9 px-2.5 rounded-lg border-2 border-[#ECE4D3] text-[13px] font-bold text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] disabled:opacity-60" />
                  {!done && (
                    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                      <input type="date" value={r.date} max={todayYmd()} disabled={lock}
                        onChange={(e) => patch(i, { date: e.target.value })}
                        className="w-full h-8 px-1.5 rounded-lg border-2 border-[#ECE4D3] text-[12px] font-bold focus:outline-none focus:border-[#5A3CB8] disabled:opacity-60" />
                      {showSubject && (
                        <input type="text" value={r.subject} maxLength={40} disabled={lock}
                          onChange={(e) => patch(i, { subject: e.target.value })} placeholder="Subject"
                          className="w-full h-8 px-2 rounded-lg border-2 border-[#ECE4D3] text-[12px] font-bold focus:outline-none focus:border-[#5A3CB8] disabled:opacity-60" />
                      )}
                    </div>
                  )}
                  {r.status === 'error' && <p className="text-[11px] font-bold text-[#A33A2A] mt-1">⚠ {r.error}</p>}
                  {r.status === 'filing' && <p className="text-[11px] font-bold text-[#5A6488] mt-1">Filing…</p>}
                </div>
              </div>
            );
          })}
        </div>

        {err && <p className="text-[12px] font-bold text-[#A33A2A] mt-2">⚠ {err}</p>}

        <div className="flex justify-end items-center gap-2 pt-2 mt-1 border-t border-[#F0EAD9]">
          {filedCount > 0 && <span className="text-[11px] font-bold text-[#16823F] mr-auto">✓ {filedCount}/{rows.length} filed</span>}
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 h-11 rounded-full text-[13px] font-black text-[#5A6488]">{filedCount === rows.length ? 'Done' : 'Cancel'}</button>
          <button type="button" onClick={fileAll} disabled={busy || anyReading}
            className="px-5 h-11 rounded-full text-[14px] font-black text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7c5cff,#9a86ff)' }}>
            {busy ? 'Filing…' : `✓ File all ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
