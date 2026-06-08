'use client';

// AutoFileSheet — the "🪄 Kaya filed this for you" confirm card (Scanning
// 3.0 · AI Auto-File). Runs autoFileScan on the captured page, shows the
// suggested Area · Title · Date · Subject (all editable), and on confirm
// uploads the photos + creates the Sparks item in the right area for the
// kid. The parent is always the final say.

import { useEffect, useState } from 'react';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import { autoFileScan } from '@/lib/sparks/ai';
import { SPARKS_AREA_META, type SparksItemArea } from '@/lib/sparks/schema';
import { todayYmd } from '@/lib/sparks/firestore';

const AREAS: SparksItemArea[] = ['achievement', 'school_project', 'home_project', 'sports_subscription', 'revision'];

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
  const [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [area, setArea] = useState<SparksItemArea>('achievement');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(todayYmd());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await autoFileScan(files[0], kidName);
        if (cancelled || !s) return;
        setArea(s.area);
        setTitle(s.title);
        setSubject(s.subject);
        if (s.date) setDate(s.date);
      } finally { if (!cancelled) setReading(false); }
    })();
    return () => { cancelled = true; };
  }, [files, kidName]);

  const showSubject = area === 'school_project' || area === 'revision';

  const fileIt = async () => {
    if (!title.trim()) { setErr('Give it a title first.'); return; }
    setBusy(true); setErr(null);
    try {
      const ref = doc(collection(db, 'families', familyId, 'sparks_items'));
      const urls = await uploadSparksPhotos(familyId, ref.id, files);
      await setDoc(ref, {
        kid_id: kidId,
        area,
        title: title.trim(),
        ...(subject.trim() && showSubject ? { subject: subject.trim() } : {}),
        photo_urls: urls.map((u) => u.feedUrl),
        date,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by: createdBy,
      });
      onFiled?.(ref.id, area);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't file it — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-3xl bg-white p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="font-display font-extrabold text-[16px] text-[#0F1F44]">🪄 Kaya filed this for you</p>
          <button type="button" onClick={onClose} className="text-[#5A6488] text-xs font-bold">Close</button>
        </div>
        <p className="text-[12px] text-[#5A6488] mb-3">
          {reading ? 'Reading the page…' : `For ${kidName.split(' ')[0]} — check it, then file.`}
        </p>

        {/* Area picker */}
        <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1.5">Where it goes</label>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {AREAS.map((a) => {
            const meta = SPARKS_AREA_META[a];
            const on = area === a;
            return (
              <button key={a} type="button" onClick={() => setArea(a)} disabled={busy}
                className={`flex items-center gap-1.5 rounded-xl border-2 px-2.5 py-2 text-left text-[12px] font-extrabold disabled:opacity-50 ${on ? 'border-[#5A3CB8] bg-[#F6F0FF] text-[#5A3CB8]' : 'border-[#ECE4D3] text-[#0F1F44]'}`}>
                <span aria-hidden>{meta.emoji}</span>{meta.label}
              </button>
            );
          })}
        </div>

        <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1">Title</label>
        <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)}
          placeholder={reading ? 'Reading…' : 'e.g. Kipchoge Award · Mile Run'}
          className="w-full h-10 px-3 rounded-xl border-2 border-[#ECE4D3] text-[14px] font-bold text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] mb-3" />

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1">Date</label>
            <input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-2 rounded-xl border-2 border-[#ECE4D3] text-[13px] font-bold focus:outline-none focus:border-[#5A3CB8]" />
          </div>
          {showSubject && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-[#5A6488] mb-1">Subject</label>
              <input type="text" value={subject} maxLength={40} onChange={(e) => setSubject(e.target.value)}
                placeholder="Maths…"
                className="w-full h-10 px-2 rounded-xl border-2 border-[#ECE4D3] text-[13px] font-bold focus:outline-none focus:border-[#5A3CB8]" />
            </div>
          )}
        </div>

        {err && <p className="text-[12px] font-bold text-[#A33A2A] mb-2">⚠ {err}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 h-11 rounded-full text-[13px] font-black text-[#5A6488]">Cancel</button>
          <button type="button" onClick={fileIt} disabled={busy || reading}
            className="px-5 h-11 rounded-full text-[14px] font-black text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7c5cff,#9a86ff)' }}>
            {busy ? 'Filing…' : '✓ File it'}
          </button>
        </div>
      </div>
    </div>
  );
}
