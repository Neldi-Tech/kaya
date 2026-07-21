'use client';

// Kaya Sparks · My Diary — the PARENT's own diary (Slice 8e).
//
// Same engine as the kid diary (feelings, trio composer, timeline,
// lock), with the adult boundary from LOCKED LOGIC v1 rule 9:
//   · per-surface visibility toggle: Personal (only me) / Visible
//     (kids + co-parent read my non-locked pages)
//   · my page PIN is MINE ALONE — not visible to my co-parent, no
//     knock, no override, and NO RECOVERY if forgotten
//   · no points, no ratings, no AI score — a light streak only.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/lib/useLocale';
import {
  DIARY_FEELINGS, DIARY_FEELINGS_MORE, type DiaryFeeling, type DiaryEntry, type DiaryBlock,
  subscribeToDiary, saveDiaryEntry, setDiaryEntryLock,
  computeDiaryStats,
  kidHasDiaryPin, setDiaryPin,
  getMyDiaryMeta, setDiaryVisibility, setEntryFeeling,
} from '@/lib/sparks/diary';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import { toDisplayDate } from '@/lib/dates';
import { EntryCard, DiaryTimeline, PinCreateModal } from '@/components/sparks/DiaryShared';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
import DiaryInkCanvas, { type DiaryInkHandle } from '@/components/sparks/DiaryInkCanvas';

const PLUM = '#7A2E5C';

export default function MyDiaryPage() {
  const { profile: authProfile } = useAuth();
  const familyId = authProfile?.familyId;
  const uid = authProfile?.uid ?? '';
  const isParent = authProfile?.role === 'parent';
  const firstName = (authProfile?.displayName || 'Me').split(' ')[0];
  const sw = useLocale() === 'sw';

  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [meta, setMeta] = useState<{ hasPin: boolean; visibility: 'personal' | 'visible' } | null>(null);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Composer
  const [writing, setWriting] = useState(false);
  const [feeling, setFeeling] = useState<DiaryFeeling | null>(null);
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [moreFeelings, setMoreFeelings] = useState(false);
  const [inkOpen, setInkOpen] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const inkRef = useRef<DiaryInkHandle>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFiles, setScanFiles] = useState<File[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [pinModalFor, setPinModalFor] = useState<null | { then: () => void }>(null);

  useEffect(() => {
    if (!familyId || !uid || !isParent) return;
    return subscribeToDiary(familyId, uid, setEntries);
  }, [familyId, uid, isParent]);
  useEffect(() => {
    if (!uid || !isParent) return;
    getMyDiaryMeta(uid).then(setMeta).catch(() => setMeta(null));
  }, [uid, isParent]);

  const stats = useMemo(() => computeDiaryStats(entries ?? []), [entries]);
  const todays = useMemo(() => (entries ?? []).filter((e) => e.date === today), [entries, today]);

  const withPin = (then: () => void) => {
    if (meta?.hasPin) { then(); return; }
    setPinModalFor({ then });
  };

  const toggleVisibility = async () => {
    if (!meta) return;
    const next = meta.visibility === 'visible' ? 'personal' : 'visible';
    setMeta({ ...meta, visibility: next });
    try { await setDiaryVisibility(uid, next); } catch { getMyDiaryMeta(uid).then(setMeta).catch(() => {}); }
  };

  const canSave = !saving && (text.trim().length > 0 || hasInk || scanFiles.length > 0);
  const save = async () => {
    if (!canSave || !familyId) return;
    setSaving(true); setErr('');
    try {
      const blocks: DiaryBlock[] = [];
      if (text.trim()) blocks.push({ kind: 'text', text: text.trim() });
      const draftId = `diary-${Date.now().toString(36)}`;
      const ink = await inkRef.current?.exportFile();
      if (ink) {
        const [up] = await uploadSparksPhotos(familyId, draftId, [ink]);
        blocks.push({ kind: 'ink', url: up.feedUrl });
      }
      if (scanFiles.length > 0) {
        const ups = await uploadSparksPhotos(familyId, draftId, scanFiles);
        for (const up of ups) blocks.push({ kind: 'scan', url: up.feedUrl });
      }
      await saveDiaryEntry(familyId, { ownerId: uid, ...(feeling ? { feeling } : {}), blocks, locked });
      setWriting(false); setFeeling(null); setText(''); setLocked(false);
      setInkOpen(false); setHasInk(false); inkRef.current?.clear(); setScanFiles([]);
    } catch (e) {
      setErr((e as Error).message || 'Could not save');
    } finally { setSaving(false); }
  };

  if (!isParent) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">
        {sw ? 'Ukurasa huu ni wa wazazi.' : 'This page is for parents.'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF5]">
      <div className="mx-auto max-w-md sm:max-w-3xl lg:max-w-5xl">
        <div className="px-4 pt-4 lg:px-6">
          <Link href="/sparks" className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline hover:border-[#D4A847]">
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>Sparks</span>
          </Link>
        </div>
        <div className="px-4 pt-3 pb-8 lg:px-6">
          <div className="bg-white rounded-[24px] shadow-[0_8px_24px_rgba(15,31,68,0.08)] overflow-hidden">
            {/* Darker plum hero — the adult identity from the design. */}
            <div className="px-5 py-5 text-white" style={{ background: 'linear-gradient(135deg, #2a1f3d 0%, #7A2E5C 100%)' }}>
              <div className="text-[11px] opacity-85">Kaya › Sparks › {sw ? 'Shajara yangu' : 'My Diary'}</div>
              <h1 className="font-display font-extrabold text-[20px] m-0 mt-0.5">📔 {firstName}&apos;s Diary</h1>
              <div className="text-[12px] opacity-90 mt-0.5">
                {meta?.visibility === 'visible' ? (sw ? 'Inaonekana kwa familia' : 'Visible to family') : (sw ? 'Binafsi' : 'Personal')}
                {' · '}{stats.daysFilledThisYear} {sw ? 'kurasa mwaka huu' : 'pages this year'}
                {stats.streak > 1 ? ` · 🔥 ${stats.streak}` : ''}
              </div>
            </div>

            <div className="p-4 lg:p-6">
              {/* Visibility + PIN row */}
              <div className="rounded-2xl border border-[#ECE4D3] bg-[#FBF7EE] px-3.5 py-3 mb-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-nunito font-extrabold text-[13px] text-[#0F1F44]">{sw ? 'Mwonekano' : 'Visibility'}</div>
                    <div className="text-[11px] text-[#5A6488] leading-snug">
                      {sw ? 'Binafsi = wewe tu. Inaonekana = watoto + mzazi mwenzako wanasoma kurasa zisizofungwa.' : 'Personal = only you. Visible = kids + your co-parent read your unlocked pages — great modelling when you share.'}
                    </div>
                  </div>
                  <button type="button" onClick={toggleVisibility}
                    className="shrink-0 text-[11px] font-extrabold px-3 py-1.5 rounded-full bg-[#F9E4F1] text-[#7A2E5C]">
                    {meta === null ? '…' : meta.visibility === 'visible' ? (sw ? 'Inaonekana ▾' : 'Visible ▾') : (sw ? 'Binafsi ▾' : 'Personal ▾')}
                  </button>
                </div>
                <div className="rounded-xl bg-[#FFE7E0] px-3 py-2 text-[10.5px] text-[#A33A2A] leading-snug">
                  ⚠️ <b>{sw ? 'Hakuna urejeshaji.' : 'No recovery.'}</b> {sw
                    ? 'PIN ya kurasa zako ni yako peke yako — hakuna anayeweza kuifungua au kuiweka upya. Ukiisahau, kurasa hizo hubaki zimefungwa milele.'
                    : 'Your page PIN is yours alone — no knock, no override, no reset. Not Kaya, not your co-parent. Forget it and those pages stay locked forever.'}
                </div>
              </div>

              {/* Today's pages */}
              <div className="font-nunito font-black text-[15px] text-[#0F1F44] mb-2">{toDisplayDate(today)}</div>
              {entries === null ? (
                <div className="text-[12.5px] text-[#5A6488] py-6 text-center animate-pulse">{sw ? 'Inapakia…' : 'Loading…'}</div>
              ) : todays.length === 0 && !writing ? (
                <div className="rounded-2xl border-2 border-dashed border-[#EBC2DC] bg-[#FDF3F9] px-4 py-5 text-center mb-3">
                  <div className="text-2xl" aria-hidden>📔</div>
                  <div className="font-display font-extrabold text-[13.5px] text-[#7A2E5C] mt-1">{sw ? 'Hakuna ukurasa leo bado' : 'No page for today yet'}</div>
                </div>
              ) : (
                <div className="space-y-2.5 mb-3">
                  {todays.slice().reverse().map((e) => (
                    <EntryCard key={e.id} e={e} isOwner kidFirstName={firstName} sw={sw}
                      onSetFeeling={familyId ? (f) => setEntryFeeling(familyId, uid, e.id, f) : undefined}
                      onToggleLock={familyId ? (next) => (next ? withPin(() => setDiaryEntryLock(familyId, uid, e.id, true)) : setDiaryEntryLock(familyId, uid, e.id, false)) : undefined} />
                  ))}
                </div>
              )}

              {!writing && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setWriting(true)}
                    className="flex-1 rounded-2xl py-3 text-white font-nunito font-black text-[14px]"
                    style={{ background: `linear-gradient(135deg, #2a1f3d, ${PLUM})` }}>
                    ＋ {sw ? 'Andika' : 'Write'}
                  </button>
                  <button type="button" onClick={() => setTimelineOpen((v) => !v)}
                    className="rounded-2xl py-3 px-4 font-nunito font-black text-[14px] bg-[#F9E4F1] text-[#7A2E5C]">
                    📖 {sw ? 'Ratiba' : 'Timeline'}
                  </button>
                </div>
              )}

              {writing && (
                <div className="rounded-2xl border border-[#EBC2DC] bg-white p-3.5">
                  <div className="text-[11px] font-nunito font-black uppercase tracking-[1.2px] text-[#7A2E5C] mb-1.5">
                    {sw ? 'Unajisikiaje?' : 'How do you feel?'}
                  </div>
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {DIARY_FEELINGS.map((f) => (
                      <button key={f} type="button" onClick={() => setFeeling(f)} aria-label={`Feeling ${f}`}
                        className={`w-10 h-10 rounded-xl grid place-items-center text-[21px] border-2 transition ${feeling === f ? 'border-[#7A2E5C] bg-[#F9E4F1]' : 'border-transparent bg-[#FBF7EE]'}`}>
                        {f}
                      </button>
                    ))}
                    <button type="button" onClick={() => setMoreFeelings((v) => !v)}
                      className="w-10 h-10 rounded-xl grid place-items-center text-[16px] font-black text-[#7A2E5C] border-2 border-dashed border-[#EBC2DC] bg-[#FDF3F9]">
                      ＋
                    </button>
                  </div>
                  {moreFeelings && (
                    <div className="rounded-xl border border-[#EBC2DC] bg-[#FDF3F9] px-2.5 py-2 mb-2 flex gap-1.5 flex-wrap">
                      {DIARY_FEELINGS_MORE.map((f) => (
                        <button key={f} type="button" onClick={() => { setFeeling(f); setMoreFeelings(false); }}
                          className="w-8 h-8 rounded-lg grid place-items-center text-[17px] bg-white border border-transparent hover:border-[#C05299]">
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-[#5A6488] mt-0 mb-2">✨ {sw ? 'Ukiruka, Kaya atakisia.' : 'Skip it and Kaya guesses from your words.'}</p>
                  <div className="grid grid-cols-3 gap-2 mb-2.5">
                    <div className="rounded-2xl border-2 border-[#7A2E5C] bg-[#F9E4F1] py-2 px-2 text-center">
                      <div className="text-[18px] leading-none" aria-hidden>✍️</div>
                      <div className="text-[10.5px] font-extrabold text-[#7A2E5C] mt-0.5">{sw ? 'Andika' : 'Type'}</div>
                    </div>
                    <button type="button" onClick={() => setInkOpen((v) => !v)}
                      className={`rounded-2xl border-2 py-2 px-2 text-center ${inkOpen || hasInk ? 'border-[#7A2E5C] bg-[#F9E4F1]' : 'border-dashed border-[#EBC2DC] bg-[#FDF3F9]'}`}>
                      <div className="text-[18px] leading-none" aria-hidden>🖊</div>
                      <div className="text-[10.5px] font-extrabold text-[#7A2E5C] mt-0.5">{sw ? 'Kalamu' : 'Pencil'}{hasInk ? ' ✓' : ''}</div>
                    </button>
                    <button type="button" onClick={() => setScanOpen(true)}
                      className={`rounded-2xl border-2 py-2 px-2 text-center ${scanFiles.length ? 'border-[#7A2E5C] bg-[#F9E4F1]' : 'border-dashed border-[#EBC2DC] bg-[#FDF3F9]'}`}>
                      <div className="text-[18px] leading-none" aria-hidden>📷</div>
                      <div className="text-[10.5px] font-extrabold text-[#7A2E5C] mt-0.5">{sw ? 'Changanua' : 'Scan'}{scanFiles.length ? ` · ${scanFiles.length}` : ''}</div>
                    </button>
                  </div>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={8000}
                    placeholder={sw ? 'Leo…' : 'Dear diary…'}
                    className="w-full rounded-xl border border-[#EBC2DC] bg-white p-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#C05299]/40 resize-none" />
                  {inkOpen && <div className="mt-2.5"><DiaryInkCanvas ref={inkRef} height={240} onDirtyChange={setHasInk} /></div>}
                  {err && <p className="text-[12px] font-bold text-[#E36F6F] mt-1">{err}</p>}
                  <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                    <button type="button" onClick={() => (locked ? setLocked(false) : withPin(() => setLocked(true)))}
                      className="flex items-center gap-2 text-[12.5px] font-extrabold text-[#7A2E5C]" aria-pressed={locked}>
                      🔒 {sw ? 'Funga ukurasa' : 'Lock this page'}
                      <span className={`w-[42px] h-[24px] rounded-full relative transition-colors ${locked ? 'bg-[#7A2E5C]' : 'bg-[#cfd3e0]'}`}>
                        <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all ${locked ? 'right-[3px]' : 'left-[3px]'}`} />
                      </span>
                    </button>
                    <div className="flex gap-2 ml-auto">
                      <button type="button" onClick={() => { setWriting(false); setErr(''); }}
                        className="px-3.5 py-2 rounded-xl text-[12.5px] font-bold text-[#5A6488]">{sw ? 'Ghairi' : 'Cancel'}</button>
                      <button type="button" onClick={save} disabled={!canSave}
                        className="px-4 py-2 rounded-xl text-white font-nunito font-black text-[13px] disabled:opacity-50" style={{ background: PLUM }}>
                        {saving ? '…' : (sw ? 'Hifadhi' : 'Save page')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {timelineOpen && (
                <DiaryTimeline entries={entries ?? []} sw={sw} onOpenDay={(d) => setDayOpen(d)} />
              )}

              {dayOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
                  <button type="button" aria-label="Close" onClick={() => setDayOpen(null)} className="absolute inset-0 bg-black/40" />
                  <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
                    <div className="px-5 pt-4 pb-3 text-white sticky top-0" style={{ background: `linear-gradient(135deg, #2a1f3d, ${PLUM})` }}>
                      <div className="font-display font-extrabold text-[16px]">📔 {toDisplayDate(dayOpen)}</div>
                    </div>
                    <div className="p-4 space-y-2.5">
                      {(entries ?? []).filter((e) => e.date === dayOpen).slice().reverse().map((e) => (
                        <EntryCard key={e.id} e={e} isOwner kidFirstName={firstName} sw={sw}
                          onToggleLock={familyId ? (next) => (next ? withPin(() => setDiaryEntryLock(familyId, uid, e.id, true)) : setDiaryEntryLock(familyId, uid, e.id, false)) : undefined} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {pinModalFor && (
                <PinCreateModal
                  kidFirstName={firstName}
                  sw={sw}
                  adult
                  onCancel={() => setPinModalFor(null)}
                  onSet={async (pin) => {
                    await setDiaryPin(uid, pin);
                    setMeta((m) => (m ? { ...m, hasPin: true } : m));
                    const go = pinModalFor.then;
                    setPinModalFor(null);
                    go();
                  }}
                />
              )}

              <CameraCaptureSheet
                open={scanOpen}
                mode="scan"
                onClose={() => setScanOpen(false)}
                onConfirm={(files) => { if (files.length) setScanFiles((prev) => [...prev, ...files]); setScanOpen(false); }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
