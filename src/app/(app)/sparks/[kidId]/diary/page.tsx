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

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useLocale } from '@/lib/useLocale';
import {
  DIARY_FEELINGS, type DiaryFeeling, type DiaryEntry,
  subscribeToDiary, saveDiaryEntry, setDiaryEntryLock,
  computeDiaryStats, diaryDayKey,
} from '@/lib/sparks/diary';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen from '@/components/sparks/AreaScreen';

const PLUM = '#7A2E5C';

export default function DiaryPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const router = useRouter();
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

  // Composer state (owner kid only in this slice)
  const [writing, setWriting] = useState(false);
  const [feeling, setFeeling] = useState<DiaryFeeling | null>(null);
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

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

  const canSave = !saving && feeling !== null && text.trim().length > 0;

  const save = async () => {
    if (!canSave || !familyId || feeling === null) return;
    setSaving(true); setErr('');
    try {
      await saveDiaryEntry(familyId, {
        ownerId: kidId,
        feeling,
        blocks: [{ kind: 'text', text: text.trim() }],
        locked,
      });
      setWriting(false); setFeeling(null); setText(''); setLocked(false);
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
            onToggleLock={isOwnerKid && familyId ? (next) => setDiaryEntryLock(familyId, kidId, e.id, next) : undefined} />)}
        </div>
      )}

      {/* Composer — owner kid only (parents never write here). */}
      {isOwnerKid && !writing && (
        <button type="button" onClick={() => setWriting(true)}
          className="w-full rounded-2xl py-3 text-white font-nunito font-black text-[14px]"
          style={{ background: `linear-gradient(135deg, ${PLUM}, #C05299)` }}>
          ＋ {sw ? 'Andika kwenye shajara yangu' : 'Write in my diary'}
        </button>
      )}
      {isOwnerKid && writing && (
        <div className="rounded-2xl border border-[#EBC2DC] bg-white p-3.5">
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
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={8000}
            placeholder={sw ? 'Leo…' : 'Dear diary…'}
            className="w-full rounded-xl border border-[#EBC2DC] bg-white p-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#C05299]/40 resize-none"
          />
          {err && <p className="text-[12px] font-bold text-[#E36F6F] mt-1">{err}</p>}
          <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
            <button type="button" onClick={() => setLocked((v) => !v)}
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
                      onToggleLock={isOwnerKid && familyId ? (next) => setDiaryEntryLock(familyId, kidId, e.id, next) : undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

// ── Entry card ──────────────────────────────────────────────────────

function EntryCard({
  e, isOwner, kidFirstName, sw, onToggleLock,
}: {
  e: DiaryEntry;
  isOwner: boolean;
  kidFirstName: string;
  sw: boolean;
  onToggleLock?: (locked: boolean) => void;
}) {
  if (e.redacted) {
    return (
      <div className="rounded-2xl border border-dashed border-[#EBC2DC] bg-[#FDF3F9] px-3.5 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[20px]" aria-hidden>{e.feeling}</span>
          <span className="text-[10.5px] font-bold text-[#5A6488]">{e.time}</span>
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#EFEAF9] text-[#4a3d78]">
            🔒 {sw ? `Imefungwa · ya ${kidFirstName} tu` : `Locked · just ${kidFirstName}'s`}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${e.locked ? 'border-dashed border-[#EBC2DC] bg-[#FDF3F9]' : 'border-[#ECE4D3] bg-white'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[20px]" aria-hidden>{e.feeling}</span>
        <span className="text-[10.5px] font-bold text-[#5A6488]">{e.time}</span>
        {e.locked ? (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#EFEAF9] text-[#4a3d78]">🔒 {sw ? 'Imefungwa' : 'Locked · just mine'}</span>
        ) : (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#DDF5DF] text-[#2E7D34]">💛 {sw ? 'Imeshirikiwa na wazazi' : 'Shared with parents'}</span>
        )}
        {isOwner && onToggleLock && (
          <button type="button" onClick={() => onToggleLock(!e.locked)}
            className="ml-auto text-[10.5px] font-extrabold text-[#7A2E5C] underline underline-offset-2">
            {e.locked ? (sw ? 'Fungua' : 'Unlock') : (sw ? 'Funga' : 'Lock')}
          </button>
        )}
      </div>
      <div className="mt-1.5 space-y-2">
        {e.blocks.map((b, i) => {
          if (b.kind === 'text') {
            return <div key={i} className="text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">{b.text}</div>;
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={b.url} alt="" className="w-full max-h-64 object-contain rounded-xl bg-[#FBF7EE] border border-[#ECE4D3]" />
          );
        })}
      </div>
    </div>
  );
}
