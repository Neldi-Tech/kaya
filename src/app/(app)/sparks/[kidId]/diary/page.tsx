'use client';

// Kaya Sparks · Diary — day page (Slice 8a · 2026-07-21).
//
// The kid's personal book. This slice ships the core loop: feeling-first
// typed entries, multiple per day, per-page lock, day list + recent days.
// Slice 8b upgrades the composer with the pencil canvas + scan; 8c adds
// the emoji timeline; 8d the knock/quiet-open doors; 8e parent surfaces.
//
// Privacy (enforced by /api/sparks/diary — the client never reads the
// collection directly):
//   · siblings get 403 → "this diary is private" state
//   · parents see entries; locked pages arrive REDACTED (meta only)
//   · only the owner kid writes here

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useLocale } from '@/lib/useLocale';
import {
  DIARY_FEELINGS, type DiaryFeeling, type DiaryEntry, type DiaryBlock,
  subscribeToDiary, saveDiaryEntry, setDiaryEntryLock,
  computeDiaryStats, diaryDayKey,
  kidHasDiaryPin, setDiaryPin, answerKnock, knockOnPage, quietOpenPage, getDiaryPrivacy,
} from '@/lib/sparks/diary';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen from '@/components/sparks/AreaScreen';
import { EntryCard, DiaryTimeline, PinCreateModal } from '@/components/sparks/DiaryShared';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
import DiaryInkCanvas, { type DiaryInkHandle } from '@/components/sparks/DiaryInkCanvas';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';

const PLUM = '#7A2E5C';

export default function DiaryPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const router = useRouter();
  const search = useSearchParams();
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);
  const kidName = kid?.name || 'Kid';
  const sw = useLocale() === 'sw';

  const isParent = authProfile?.role === 'parent';
  // Client-side guard for the obvious sibling case — the API is the
  // real gate (403 → private state below).
  const knownOtherKid = authProfile?.role === 'kid'
    && !!authProfile?.childId && authProfile.childId !== kidId;
  const isOwnerKid = authProfile?.role === 'kid' && !knownOtherKid;

  const today = diaryDayKey();
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [denied, setDenied] = useState(false);

  // Composer state (owner kid only). Slice 8b: full trio editor —
  // ✍️ type · 🖊 pencil canvas · 📷 scan, blocks mix on one page.
  const [writing, setWriting] = useState(false);
  const [feeling, setFeeling] = useState<DiaryFeeling | null>(null);
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [inkOpen, setInkOpen] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const inkRef = useRef<DiaryInkHandle>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFiles, setScanFiles] = useState<File[]>([]);
  // Slice 8c · timeline visibility + tapped-day sheet.
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  // Slice 8d · privacy: kid PIN gate + parent quiet-open flow.
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pinModalFor, setPinModalFor] = useState<null | { then: () => void }>(null);
  const [quietFor, setQuietFor] = useState<DiaryEntry | null>(null);
  const [peek, setPeek] = useState<DiaryEntry | null>(null);
  const scanUrls = useMemo(() => scanFiles.map((f) => URL.createObjectURL(f)), [scanFiles]);
  useEffect(() => () => scanUrls.forEach((u) => URL.revokeObjectURL(u)), [scanUrls]);

  useEffect(() => {
    if (knownOtherKid) { router.replace('/sparks'); return; }
    if (!familyId || !kidId) return;
    setDenied(false);
    return subscribeToDiary(familyId, kidId, (rows) => {
      // subscribeToDiary maps API failures to [] — probe once for the
      // sibling-403 case so we can show the honest private state.
      setEntries(rows);
    });
  }, [familyId, kidId, knownOtherKid, router]);

  // Distinguish "empty diary" from "access denied" with one probe.
  useEffect(() => {
    if (!familyId || !kidId || knownOtherKid) return;
    import('@/lib/sparks/diary').then(({ diaryApi }) => {
      diaryApi('list', { ownerId: kidId, max: 1 }).catch((e) => {
        if (String(e?.message).includes('forbidden')) setDenied(true);
      });
    });
  }, [familyId, kidId, knownOtherKid]);

  useEffect(() => {
    if (!isOwnerKid || !kidId) return;
    kidHasDiaryPin(kidId).then(setHasPin).catch(() => setHasPin(null));
  }, [isOwnerKid, kidId]);

  // Slice 8e · Reflection → Diary connector: arriving with
  // ?from=reflection opens the composer pre-linked to today's
  // reflection ("tell the full story").
  const linkedRefDate = search?.get('from') === 'reflection'
    ? (search?.get('d') || today) : null;
  useEffect(() => {
    if (linkedRefDate && isOwnerKid) setWriting(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRefDate, isOwnerKid]);

  /** Gate a lock action behind PIN existence — first lock sets the PIN
   *  (with the parents-can-see-it disclosure). */
  const withPin = (then: () => void) => {
    if (hasPin) { then(); return; }
    setPinModalFor({ then });
  };

  const stats = useMemo(() => computeDiaryStats(entries ?? []), [entries]);
  const todays = useMemo(() => (entries ?? []).filter((e) => e.date === today), [entries, today]);
  const recent = useMemo(() => {
    const byDay = new Map<string, DiaryEntry[]>();
    for (const e of entries ?? []) {
      if (e.date === today) continue;
      byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    }
    return Array.from(byDay.entries()).slice(0, 7);
  }, [entries, today]);

  const canSave = !saving && feeling !== null
    && (text.trim().length > 0 || hasInk || scanFiles.length > 0);

  const save = async () => {
    if (!canSave || !familyId || feeling === null) return;
    setSaving(true); setErr('');
    try {
      const blocks: DiaryBlock[] = [];
      if (text.trim()) blocks.push({ kind: 'text', text: text.trim() });

      // Uploads share one pseudo-item id so the Storage layout mirrors
      // the sparks path convention (families/{f}/sparks/{itemId}/…).
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

      await saveDiaryEntry(familyId, {
        ownerId: kidId,
        feeling,
        blocks,
        locked,
        ...(linkedRefDate ? { linked_reflection_date: linkedRefDate } : {}),
      });
      setWriting(false); setFeeling(null); setText(''); setLocked(false);
      setInkOpen(false); setHasInk(false); inkRef.current?.clear();
      setScanFiles([]);
    } catch (e) {
      setErr((e as Error).message || (sw ? 'Imeshindikana kuhifadhi' : 'Could not save'));
    } finally { setSaving(false); }
  };

  const heroSub = stats.streak > 0
    ? (sw ? `🔥 Mfululizo wa siku ${stats.streak} · kurasa ${stats.daysFilledThisYear} mwaka huu` : `🔥 ${stats.streak}-day streak · ${stats.daysFilledThisYear} pages this year`)
    : (sw ? 'Kitabu chako binafsi' : 'Your personal book');

  if (denied) {
    return (
      <AreaScreen kidId={kidId} kidName={kidName} area="diary" subtitle="">
        <div className="text-center py-12">
          <div className="text-4xl mb-2" aria-hidden>🔒</div>
          <div className="font-display font-extrabold text-[16px] text-[#0F1F44]">
            {sw ? 'Hii ni shajara binafsi' : 'This diary is private'}
          </div>
          <p className="text-[12.5px] text-[#5A6488] mt-1">
            {sw ? `Kurasa za ${kidName} ni zake tu.` : `${kidName}'s pages are theirs alone.`}
          </p>
        </div>
      </AreaScreen>
    );
  }

  return (
    <AreaScreen kidId={kidId} kidName={kidName} area="diary" subtitle={heroSub}>
      {/* Pinned guide note — the Diary side of the boundary. */}
      <div className="rounded-xl bg-[#FDF3F9] border-l-[3px] border-[#C05299] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[#5c2547] mb-4">
        <b className="text-[#7A2E5C]">📔 {sw ? 'Shajara yako' : 'Your Diary'}</b>{' — '}
        {sw
          ? 'kitabu chako binafsi: hisia, hadithi, ndoto, wasiwasi. Urefu wowote unaotaka. Ni chako — kinashirikiwa na wazazi wako, funga ukurasa unapohitaji.'
          : "your personal book: feelings, stories, dreams, worries. As long or as short as you want. It's yours — shared with your parents, locked when you need it."}
      </div>

      {/* Slice 8e · "Why share?" guidance — the kid-side card from the
          locked logic (rule 8). One warm line, never preachy. */}
      {isOwnerKid && (
        <div className="rounded-xl bg-[#FFF8E9] border border-[#F3E3B9] px-3.5 py-2 text-[11px] leading-relaxed text-[#8A6800] mb-3">
          💛 {sw
            ? 'Kushiriki kunasaidia wazazi wako kukuelewa — funga kurasa zinazohitaji kuwa zako kwa muda.'
            : 'Sharing helps your grown-ups understand you — lock the pages that need to be just yours for a while.'}
        </div>
      )}

      {/* Slice 8d · pending knocks — the kid answers here. */}
      {isOwnerKid && (entries ?? []).some((e) => e.knock?.status === 'pending') && (
        <div className="space-y-2 mb-3">
          {(entries ?? []).filter((e) => e.knock?.status === 'pending').map((e) => (
            <div key={`k-${e.id}`} className="rounded-2xl border-2 border-[#5A3CB8] bg-[#F6EFFF] px-4 py-3">
              <div className="font-display font-extrabold text-[13.5px] text-[#1B1547]">
                🚪 {sw ? 'Hodi hodi…' : 'Knock knock…'}
              </div>
              <p className="text-[12px] text-[#2c2056] mt-0.5 mb-2 leading-snug">
                {sw
                  ? `${e.knock?.byName} anaomba kusoma ukurasa wako wa ${toDisplayDate(e.date)}. Kushiriki husaidia wazazi kukuelewa.`
                  : `${e.knock?.byName} would like to read your ${toDisplayDate(e.date)} page. Sharing helps your grown-ups understand you.`}
              </p>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => familyId && answerKnock(familyId, kidId, e.id, true)}
                  className="flex-1 rounded-xl py-2 text-[12.5px] font-extrabold text-[#3D2E08]" style={{ background: '#D4A847' }}>
                  💛 {sw ? 'Ruhusu' : 'Allow'}
                </button>
                <button type="button"
                  onClick={() => familyId && answerKnock(familyId, kidId, e.id, false)}
                  className="flex-1 rounded-xl py-2 text-[12.5px] font-extrabold bg-white border-2 border-[#5A3CB8] text-[#5A3CB8]">
                  {sw ? 'Bado' : 'Not yet'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Today */}
      <div className="flex items-center justify-between mb-2">
        <div className="font-nunito font-black text-[15px] text-[#0F1F44]">{toDisplayDate(today)}</div>
        {stats.streak > 0 && (
          <span className="text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full bg-[#F9E4F1] text-[#7A2E5C]">
            🔥 {stats.streak}
          </span>
        )}
      </div>

      {entries === null ? (
        <div className="text-[12.5px] text-[#5A6488] py-6 text-center animate-pulse">{sw ? 'Inapakia…' : 'Loading…'}</div>
      ) : todays.length === 0 && !writing ? (
        <div className="rounded-2xl border-2 border-dashed border-[#EBC2DC] bg-[#FDF3F9] px-4 py-6 text-center mb-3">
          <div className="text-3xl mb-1" aria-hidden>📔</div>
          <div className="font-display font-extrabold text-[14px] text-[#7A2E5C]">
            {sw ? 'Hakuna ukurasa leo bado' : 'No page for today yet'}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 mb-3">
          {todays.slice().reverse().map((e) => <EntryCard key={e.id} e={e} isOwner={isOwnerKid} kidFirstName={kidName.split(' ')[0]} sw={sw}
            onKnock={isParent && familyId ? () => knockOnPage(familyId, kidId, e.id) : undefined}
            onQuietOpen={isParent ? () => setQuietFor(e) : undefined}
            onToggleLock={isOwnerKid && familyId ? (next) => (next ? withPin(() => setDiaryEntryLock(familyId, kidId, e.id, true)) : setDiaryEntryLock(familyId, kidId, e.id, false)) : undefined} />)}
        </div>
      )}

      {/* Composer — owner kid only (parents never write here). */}
      {isOwnerKid && !writing && (
        <div className="flex gap-2">
          <button type="button" onClick={() => setWriting(true)}
            className="flex-1 rounded-2xl py-3 text-white font-nunito font-black text-[14px]"
            style={{ background: `linear-gradient(135deg, ${PLUM}, #C05299)` }}>
            ＋ {sw ? 'Andika kwenye shajara yangu' : 'Write in my diary'}
          </button>
          <button type="button" onClick={() => setTimelineOpen((v) => !v)}
            className="rounded-2xl py-3 px-4 font-nunito font-black text-[14px] bg-[#F9E4F1] text-[#7A2E5C]">
            📖 {sw ? 'Ratiba' : 'My timeline'}
          </button>
        </div>
      )}
      {!isOwnerKid && (
        <button type="button" onClick={() => setTimelineOpen((v) => !v)}
          className="w-full rounded-2xl py-3 font-nunito font-black text-[14px] bg-[#F9E4F1] text-[#7A2E5C]">
          📖 {sw ? 'Ratiba ya shajara' : 'Diary timeline'}
        </button>
      )}

      {/* Slice 8c · emoji timeline — Year → Month → Day. */}
      {timelineOpen && (
        <DiaryTimeline
          entries={entries ?? []}
          sw={sw}
          onOpenDay={(d) => setDayOpen(d)}
        />
      )}
      {isOwnerKid && writing && (
        <div className="rounded-2xl border border-[#EBC2DC] bg-white p-3.5">
          {linkedRefDate && (
            <div className="rounded-xl bg-[#F6EFFF] px-3 py-2 mb-2 text-[11.5px] font-bold text-[#5A3CB8]">
              🪞 {sw ? `Inaunganishwa na tafakari ya ${toDisplayDate(linkedRefDate)}` : `Linking to your ${toDisplayDate(linkedRefDate)} reflection — tell the full story.`}
            </div>
          )}
          <div className="text-[11px] font-nunito font-black uppercase tracking-[1.2px] text-[#7A2E5C] mb-1.5">
            {sw ? 'Unajisikiaje sasa hivi?' : 'How do you feel right now?'}
          </div>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {DIARY_FEELINGS.map((f) => (
              <button key={f} type="button" onClick={() => setFeeling(f)}
                aria-label={`Feeling ${f}`}
                className={`w-10 h-10 rounded-xl grid place-items-center text-[21px] border-2 transition ${feeling === f ? 'border-[#7A2E5C] bg-[#F9E4F1]' : 'border-transparent bg-[#FBF7EE]'}`}>
                {f}
              </button>
            ))}
          </div>
          {/* Trio — mix any of the three on one page (Slice 8b). */}
          <div className="grid grid-cols-3 gap-2 mb-2.5">
            <div className="rounded-2xl border-2 border-[#7A2E5C] bg-[#F9E4F1] py-2.5 px-2 text-center">
              <div className="text-[20px] leading-none" aria-hidden>✍️</div>
              <div className="text-[11px] font-extrabold text-[#7A2E5C] mt-0.5">{sw ? 'Andika' : 'Type'}</div>
            </div>
            <button type="button" onClick={() => setInkOpen((v) => !v)}
              className={`rounded-2xl border-2 py-2.5 px-2 text-center transition-colors ${inkOpen || hasInk ? 'border-[#7A2E5C] bg-[#F9E4F1]' : 'border-dashed border-[#EBC2DC] bg-[#FDF3F9] hover:border-[#C05299]'}`}>
              <div className="text-[20px] leading-none" aria-hidden>🖊</div>
              <div className="text-[11px] font-extrabold text-[#7A2E5C] mt-0.5">{sw ? 'Kalamu' : 'Pencil'}{hasInk ? ' ✓' : ''}</div>
            </button>
            <button type="button" onClick={() => setScanOpen(true)}
              className={`rounded-2xl border-2 py-2.5 px-2 text-center transition-colors ${scanFiles.length > 0 ? 'border-[#7A2E5C] bg-[#F9E4F1]' : 'border-dashed border-[#EBC2DC] bg-[#FDF3F9] hover:border-[#C05299]'}`}>
              <div className="text-[20px] leading-none" aria-hidden>📷</div>
              <div className="text-[11px] font-extrabold text-[#7A2E5C] mt-0.5">{sw ? 'Changanua' : 'Scan'}{scanFiles.length > 0 ? ` · ${scanFiles.length}` : ''}</div>
            </button>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder={sw ? 'Leo…' : 'Dear diary…'}
            className="w-full rounded-xl border border-[#EBC2DC] bg-white p-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#C05299]/40 resize-none"
          />

          {/* Pencil canvas — toggled by the 🖊 tile. */}
          {inkOpen && (
            <div className="mt-2.5">
              <DiaryInkCanvas ref={inkRef} height={260} onDirtyChange={setHasInk} />
              <p className="text-[10px] text-[#5A6488] mt-1 leading-snug">
                {sw
                  ? '🖊 Kalamu ya iPad inachora yenyewe · "Finger scrolls" huzuia kiganja kuchora.'
                  : '🖊 Apple Pencil draws with pressure · "Finger scrolls" keeps your palm from marking the page.'}
              </p>
            </div>
          )}

          {/* Scan previews. */}
          {scanFiles.length > 0 && (
            <div className="mt-2.5 flex items-center gap-2 overflow-x-auto">
              {scanUrls.map((url, idx) => (
                <div key={url} className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-[#EBC2DC]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Scan ${idx + 1}`} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setScanFiles((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label={`Remove scan ${idx + 1}`}
                    className="absolute top-0.5 right-0.5 w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-white text-[#E85C5C] font-bold text-[11px] grid place-items-center shadow">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {err && <p className="text-[12px] font-bold text-[#E36F6F] mt-1">{err}</p>}
          <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
            <button type="button" onClick={() => (locked ? setLocked(false) : withPin(() => setLocked(true)))}
              className="flex items-center gap-2 text-[12.5px] font-extrabold text-[#7A2E5C]" aria-pressed={locked}>
              🔒 {sw ? 'Funga ukurasa huu' : 'Lock this page'}
              <span className={`w-[42px] h-[24px] rounded-full relative transition-colors ${locked ? 'bg-[#7A2E5C]' : 'bg-[#cfd3e0]'}`}>
                <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all ${locked ? 'right-[3px]' : 'left-[3px]'}`} />
              </span>
            </button>
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={() => { setWriting(false); setErr(''); }}
                className="px-3.5 py-2 rounded-xl text-[12.5px] font-bold text-[#5A6488]">
                {sw ? 'Ghairi' : 'Cancel'}
              </button>
              <button type="button" onClick={save} disabled={!canSave}
                className="px-4 py-2 rounded-xl text-white font-nunito font-black text-[13px] disabled:opacity-50"
                style={{ background: PLUM }}>
                {saving ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi ukurasa' : 'Save page')}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-[#5A6488] mt-2 leading-snug">
            {sw
              ? '💛 Inashirikiwa na wazazi wako isipokuwa ukiifunga. Unaweza kuongeza kurasa zaidi leo.'
              : '💛 Shared with your parents unless you lock it. Add as many pages today as you like — morning and night both count.'}
          </p>
        </div>
      )}

      {/* Recent days */}
      {recent.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488] mb-2">
            {sw ? 'Siku za karibuni' : 'Recent days'}
          </div>
          <div className="space-y-2.5">
            {recent.map(([date, dayEntries]) => (
              <div key={date}>
                <div className="text-[11.5px] font-nunito font-black text-[#0F1F44] mb-1">{toDisplayDate(date)}</div>
                <div className="space-y-2">
                  {dayEntries.slice().reverse().map((e) => (
                    <EntryCard key={e.id} e={e} isOwner={isOwnerKid} kidFirstName={kidName.split(' ')[0]} sw={sw}
                    onKnock={isParent && familyId ? () => knockOnPage(familyId, kidId, e.id) : undefined}
                    onQuietOpen={isParent ? () => setQuietFor(e) : undefined}
                      onToggleLock={isOwnerKid && familyId ? (next) => (next ? withPin(() => setDiaryEntryLock(familyId, kidId, e.id, true)) : setDiaryEntryLock(familyId, kidId, e.id, false)) : undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slice 8c · tapped-day sheet — that day's entries, same cards. */}
      {dayOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" aria-label="Close" onClick={() => setDayOpen(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
            <div className="px-5 pt-4 pb-3 text-white sticky top-0" style={{ background: `linear-gradient(135deg, ${PLUM}, #C05299)` }}>
              <div className="font-display font-extrabold text-[16px]">📔 {toDisplayDate(dayOpen)}</div>
            </div>
            <div className="p-4 space-y-2.5">
              {(entries ?? []).filter((e) => e.date === dayOpen).slice().reverse().map((e) => (
                <EntryCard key={e.id} e={e} isOwner={isOwnerKid} kidFirstName={kidName.split(' ')[0]} sw={sw}
                  onKnock={isParent && familyId ? () => knockOnPage(familyId, kidId, e.id) : undefined}
                  onQuietOpen={isParent ? () => setQuietFor(e) : undefined}
                  onToggleLock={isOwnerKid && familyId ? (next) => (next ? withPin(() => setDiaryEntryLock(familyId, kidId, e.id, true)) : setDiaryEntryLock(familyId, kidId, e.id, false)) : undefined} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Slice 8d · kid PIN-create modal (first lock). */}
      {pinModalFor && (
        <PinCreateModal
          kidFirstName={kidName.split(' ')[0]}
          sw={sw}
          onCancel={() => setPinModalFor(null)}
          onSet={async (pin) => {
            await setDiaryPin(kidId, pin);
            setHasPin(true);
            const go = pinModalFor.then;
            setPinModalFor(null);
            go();
          }}
        />
      )}

      {/* Slice 8d · parent quiet-open flow (pause → PIN → maybe reason). */}
      {quietFor && (
        <QuietOpenModal
          entry={quietFor}
          kidId={kidId}
          kidFirstName={kidName.split(' ')[0]}
          onClose={() => setQuietFor(null)}
          onKnockInstead={() => { if (familyId) knockOnPage(familyId, kidId, quietFor.id); setQuietFor(null); }}
          onOpened={(full) => { setQuietFor(null); setPeek(full); }}
        />
      )}

      {/* One-time read of a quietly-opened page. */}
      {peek && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" aria-label="Close" onClick={() => setPeek(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
            <div className="px-5 pt-4 pb-3 text-white" style={{ background: 'linear-gradient(135deg, #7A2E5C, #C05299)' }}>
              <div className="font-display font-extrabold text-[15px]">🔑 {toDisplayDate(peek.date)} · {peek.feeling}</div>
              <div className="text-[10.5px] opacity-85">One-time read · nothing is saved, {kidName.split(' ')[0]} is not notified</div>
            </div>
            <div className="p-4 space-y-2">
              {peek.blocks.map((b, i) => b.kind === 'text'
                ? <div key={i} className="text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">{b.text}</div>
                // eslint-disable-next-line @next/next/no-img-element
                : <img key={i} src={b.url} alt="" className="w-full max-h-64 object-contain rounded-xl bg-[#FBF7EE] border border-[#ECE4D3]" />)}
              <button type="button" onClick={() => setPeek(null)}
                className="w-full rounded-xl py-2.5 mt-2 text-[13px] font-extrabold bg-[#FBF7EE] text-[#5A6488]">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan camera — same sheet the Reflection + Revisions use. */}
      <CameraCaptureSheet
        open={scanOpen}
        mode="scan"
        onClose={() => setScanOpen(false)}
        onConfirm={(files) => { if (files.length) setScanFiles((prev) => [...prev, ...files]); setScanOpen(false); }}
      />

      {isParent && (
        <p className="text-[10.5px] text-[#5A6488] mt-5 leading-snug">
          {sw
            ? '🔒 Kurasa zilizofungwa zinaonyesha hisia + tarehe tu. Milango ya "bisha hodi" inakuja hivi karibuni.'
            : '🔒 Locked pages show only the feeling + date. The knock-first doors arrive in the next update.'}
        </p>
      )}
    </AreaScreen>
  );
}

// ── Slice 8d · Parent quiet-open modal ─────────────────────────────
// Pause screen first (knock is the celebrated path), then the kid's
// PIN, then — over quota in a multi-parent family — a typed reason.
// The opened page returns ONCE; nothing persists; the kid is never
// notified (capability disclosed at PIN setup).

function QuietOpenModal({
  entry, kidId, kidFirstName, onClose, onKnockInstead, onOpened,
}: {
  entry: DiaryEntry;
  kidId: string;
  kidFirstName: string;
  onClose: () => void;
  onKnockInstead: () => void;
  onOpened: (full: DiaryEntry) => void;
}) {
  const [meta, setMeta] = useState<{ quota: number; used: number; parents: number } | null>(null);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    getDiaryPrivacy(kidId)
      .then((v) => setMeta({ quota: v.quota, used: v.usedThisMonth, parents: v.parentCount }))
      .catch(() => setMeta(null));
  }, [kidId]);

  const overQuota = meta !== null && meta.used >= meta.quota;
  const left = meta === null ? null : Math.max(0, meta.quota - meta.used);

  const open = async () => {
    if (busy || pin.length !== 4) return;
    setBusy(true); setErr('');
    try {
      const { entry: full } = await quietOpenPage(kidId, entry.id, pin, reason.trim() || undefined);
      onOpened(full);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('reason-required')) { setNeedReason(true); setErr('Over your monthly limit — a short reason is required and your co-parent is pinged.'); }
      else if (msg.includes('wrong-pin')) setErr(`That's not ${kidFirstName}'s PIN — check /sparks/setup.`);
      else setErr(msg || 'Could not open');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 text-white" style={{ background: 'linear-gradient(135deg, #7A2E5C, #C05299)' }}>
          <div className="font-display font-extrabold text-[16px]">🚪 Knock first?</div>
          <div className="text-[11px] opacity-90">{toDisplayDate(entry.date)} · {entry.feeling}</div>
        </div>
        <div className="p-4">
          <p className="text-[12.5px] text-[#0F1F44] leading-relaxed m-0 mb-3">
            Every knock {kidFirstName} allows is a trust rep — that&apos;s the learning.
            Quiet opens are for genuine worry, not curiosity.
          </p>
          <button type="button" onClick={onKnockInstead}
            className="w-full rounded-xl py-2.5 text-[13px] font-extrabold text-white mb-2" style={{ background: '#7A2E5C' }}>
            🚪 Send a knock instead
          </button>

          <div className="rounded-xl border border-[#ECE4D3] bg-[#FBF7EE] px-3 py-2.5 mt-2">
            <div className="text-[11px] font-extrabold text-[#5A6488] mb-1.5">
              🔑 Open quietly {left === null ? '' : `· ${left} of ${meta?.quota} left this month`}
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder={`${kidFirstName}'s 4-digit PIN`}
              className="w-full bg-white border border-[#ECE4D3] rounded-lg px-3 py-2 text-[14px] font-black tracking-[6px] text-[#0F1F44] focus:outline-none focus:border-[#7A2E5C]"
            />
            {(needReason || (overQuota && (meta?.parents ?? 1) > 1)) && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="One line on the genuine worry…"
                className="mt-2 w-full bg-white border border-[#ECE4D3] rounded-lg px-3 py-2 text-[12.5px] text-[#0F1F44] focus:outline-none focus:border-[#7A2E5C] resize-none"
              />
            )}
            {err && <p className="text-[11.5px] font-bold text-[#A33A2A] mt-1.5">{err}</p>}
            <button type="button" onClick={open} disabled={pin.length !== 4 || busy}
              className="w-full mt-2 rounded-xl py-2 text-[12.5px] font-extrabold bg-white border-2 border-[#7A2E5C] text-[#7A2E5C] disabled:opacity-40">
              {busy ? '…' : overQuota ? '🔑 Open with reason' : '🔑 Open quietly'}
            </button>
            <p className="text-[10px] text-[#5A6488] mt-1.5 leading-snug m-0">
              Quiet opens don&apos;t notify {kidFirstName}. Every one is logged for parents.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
