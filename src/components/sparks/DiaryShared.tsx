'use client';

// Kaya Sparks · Diary shared components (Slice 8e · 2026-07-21).
// EntryCard · DiaryTimeline · PinCreateModal — used by both the kid
// diary (/sparks/[kidId]/diary) and the parent diary (/sparks/my-diary).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  type DiaryEntry, computeDiaryStats, diaryDayKey,
  DIARY_FEELINGS, DIARY_FEELINGS_MORE,
} from '@/lib/sparks/diary';
import { toDisplayDate } from '@/lib/dates';
import { PolishedText } from './PolishedText';

// ── Entry card ──────────────────────────────────────────────────────

/** 🎨 CSS for a page's paper style (Slice 8i). Applied to the unlocked
 *  entry card so the timeline reads like a real, decorated diary. */
function pageStyleProps(style?: string): { className: string; style?: React.CSSProperties } {
  switch (style) {
    case 'lined':
      return { className: 'border-[#ECE4D3]', style: { background: 'repeating-linear-gradient(#fff, #fff 22px, #e8eef8 23px)' } };
    case 'starry':
      return { className: 'border-[#F3E3B9]', style: { background: '#fffdf4 radial-gradient(circle at 18% 26%, #ffe9a8 0 2px, transparent 3px), #fffdf4 radial-gradient(circle at 74% 62%, #ffd7ef 0 2px, transparent 3px)' } };
    case 'night':
      return { className: 'border-transparent text-white', style: { background: 'linear-gradient(160deg,#1B1547,#3b2b6b)' } };
    case 'rainbow':
      return { className: '', style: { background: '#fff', border: '3px solid transparent', borderImage: 'linear-gradient(90deg,#FF6B6B,#FFB627,#6BCB77,#4ECDC4,#5A3CB8) 1' } };
    default:
      return { className: 'border-[#ECE4D3] bg-white' };
  }
}

export function EntryCard({
  e, isOwner, kidFirstName, sw, onToggleLock, onKnock, onQuietOpen, onNudge, onSetFeeling,
}: {
  e: DiaryEntry;
  isOwner: boolean;
  kidFirstName: string;
  sw: boolean;
  onToggleLock?: (locked: boolean) => void;
  /** Slice 8d · parent doors on a redacted (locked) page. */
  onKnock?: () => void;
  /** Slice 8k · 👋 nudge an unanswered knock (parent, ≥24h, 1/day). */
  onNudge?: () => void;
  onQuietOpen?: () => void;
  /** Slice 8g · owner corrects an AI-guessed feeling. */
  onSetFeeling?: (feeling: string) => void;
}) {
  const [pickFeeling, setPickFeeling] = useState(false);
  // ⏳ Sealed page — hidden from EVERYONE (owner too) until the date.
  if (e.redacted && e.sealed_until) {
    return (
      <div className="rounded-2xl border border-[#F3E3B9] bg-[#FFF8E9] px-3.5 py-3 text-center">
        <div className="text-[22px]" aria-hidden>⏳</div>
        <div className="font-display font-extrabold text-[13px] text-[#8A6800] mt-0.5">
          {sw ? `Imefungwa hadi ${toDisplayDate(e.sealed_until)}` : `Sealed until ${toDisplayDate(e.sealed_until)}`}
        </div>
        <div className="text-[10.5px] text-[#5A6488] mt-0.5">
          {e.feeling} · {e.time} · {sw ? 'hata wewe huwezi kuifungua kabla ya siku hiyo' : 'not even you can open it before then'}
        </div>
      </div>
    );
  }

  if (e.redacted) {
    const knockPending = e.knock?.status === 'pending';
    const knockDenied = e.knock?.status === 'denied';
    // Slice 8k · the loop chips: sent-at, 👀 seen receipt, ⏳ waiting
    // hours, and whether the 👋 nudge is available (≥24h, 1/day).
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const waitingH = knockPending && e.knock?.at ? Math.max(0, Math.floor((now - e.knock.at) / 3600000)) : null;
    const nudgeReady = knockPending && !!e.knock?.at && now - (e.knock.at as number) >= DAY
      && (!e.knock?.nudgedAt || now - (e.knock.nudgedAt as number) >= DAY);
    return (
      <div className="rounded-2xl border border-dashed border-[#EBC2DC] bg-[#FDF3F9] px-3.5 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[20px]" aria-hidden>{e.feeling}</span>
          <span className="text-[10.5px] font-bold text-[#5A6488]">{e.time}</span>
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#EFEAF9] text-[#4a3d78]">
            🔒 {sw ? `Imefungwa · ya ${kidFirstName} tu` : `Locked · just ${kidFirstName}'s`}
          </span>
          {knockPending && (
            <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">
              🚪 {sw ? 'Hodi imetumwa' : 'Knock sent'}
            </span>
          )}
          {knockPending && !isOwner && (
            e.knock?.seenAt ? (
              <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#DDF5DF] text-[#2E7D34]">
                👀 {sw ? 'Imeonekana' : 'Seen'}
              </span>
            ) : (
              <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#EFEAF9] text-[#4a3d78]">
                📪 {sw ? 'Haijaonekana bado' : 'Not seen yet'}
              </span>
            )
          )}
          {knockPending && !isOwner && waitingH !== null && waitingH >= 1 && (
            <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">
              ⏳ {waitingH >= 48 ? `${Math.floor(waitingH / 24)}d` : `${waitingH}h`} {sw ? 'ikisubiri' : 'waiting'}
            </span>
          )}
          {knockDenied && (
            <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFE7E0] text-[#A33A2A]">
              {sw ? 'Bado' : 'Not yet'}
            </span>
          )}
        </div>
        {(onKnock || onQuietOpen) && (
          <div className="flex gap-2 mt-2.5">
            {onKnock && !knockPending && (
              <button type="button" onClick={onKnock}
                className="flex-1 rounded-xl py-2 text-[12px] font-extrabold text-white" style={{ background: '#7A2E5C' }}>
                🚪 {sw ? 'Bisha hodi' : 'Send a knock'}
              </button>
            )}
            {onNudge && nudgeReady && (
              <button type="button" onClick={onNudge}
                className="flex-1 rounded-xl py-2 text-[12px] font-extrabold text-white" style={{ background: '#D4A847' }}>
                👋 {sw ? 'Kumbusha kwa upole' : 'Nudge gently'}
              </button>
            )}
            {onQuietOpen && (
              <button type="button" onClick={onQuietOpen}
                className="flex-1 rounded-xl py-2 text-[12px] font-extrabold bg-white border-2 border-[#7A2E5C] text-[#7A2E5C]">
                🔑 {sw ? 'Fungua kimya' : 'Open quietly'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={`rounded-2xl border px-3.5 py-3 ${e.locked ? 'border-dashed border-[#EBC2DC] bg-[#FDF3F9]' : (e.page_style ? pageStyleProps(e.page_style).className : 'border-[#ECE4D3] bg-white')}`}
      style={!e.locked && e.page_style ? pageStyleProps(e.page_style).style : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[20px]" aria-hidden>{e.feeling}</span>
        {e.feeling_ai_guessed && (
          isOwner && onSetFeeling ? (
            <button type="button" onClick={() => setPickFeeling((v) => !v)}
              className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8]">
              ✨ {sw ? 'Kaya amekisia · badilisha' : 'Kaya guessed · tap to change'}
            </button>
          ) : (
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8]">✨ {sw ? 'Kaya amekisia' : 'Kaya guessed'}</span>
          )
        )}
        <span className="text-[10.5px] font-bold text-[#5A6488]">{e.time}</span>
        {e.locked && !e.knock_open && e.knock_open_until ? (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">⏳ {sw ? 'Wazi leo tu' : 'Open today only'}</span>
        ) : e.locked && e.knock_open ? (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#DDF5DF] text-[#2E7D34]">💛 {sw ? 'Hodi imeruhusiwa' : 'Knock allowed'}</span>
        ) : e.locked ? (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#EFEAF9] text-[#4a3d78]">🔒 {sw ? 'Imefungwa' : 'Locked · just mine'}</span>
        ) : (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#DDF5DF] text-[#2E7D34]">💛 {sw ? 'Imeshirikiwa na wazazi' : 'Shared with parents'}</span>
        )}
        {e.linked_reflection_date && (
          <Link href={`/sparks/${e.ownerId}/reflection`}
            className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#F6EFFF] text-[#5A3CB8] no-underline">
            🪞 {sw ? 'Tafakari' : 'From reflection'}
          </Link>
        )}
        {isOwner && onToggleLock && (
          <button type="button" onClick={() => onToggleLock(!e.locked)}
            className="ml-auto text-[10.5px] font-extrabold text-[#7A2E5C] underline underline-offset-2">
            {e.locked ? (sw ? 'Fungua' : 'Unlock') : (sw ? 'Funga' : 'Lock')}
          </button>
        )}
      </div>
      {pickFeeling && isOwner && onSetFeeling && (
        <div className="mt-1.5 rounded-xl border border-[#EBC2DC] bg-[#FDF3F9] px-2.5 py-2 flex gap-1.5 flex-wrap">
          {[...DIARY_FEELINGS, ...DIARY_FEELINGS_MORE].map((f) => (
            <button key={f} type="button"
              onClick={() => { onSetFeeling(f); setPickFeeling(false); }}
              className="w-8 h-8 rounded-lg grid place-items-center text-[17px] bg-white border border-transparent hover:border-[#C05299]">
              {f}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 space-y-2">
        {(() => {
          const firstText = e.blocks.find((b) => b.kind === 'text')?.text ?? '';
          // ✨ Polished pages render the tidy version with a ↺ flip; the
          // raw text lives in blocks and comes back via the flip.
          if (e.polished && firstText) {
            return <PolishedText polished={e.polished} original={firstText} sw={sw} />;
          }
          return null;
        })()}
        {e.blocks.map((b, i) => {
          if (b.kind === 'text') {
            // When a polished version exists, the first text block is
            // already shown above (with its original flip) — skip it.
            if (e.polished && b.text === e.blocks.find((x) => x.kind === 'text')?.text) return null;
            return <div key={i} className="text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">{b.text}</div>;
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={b.url} alt="" className="w-full max-h-64 object-contain rounded-xl bg-[#FBF7EE] border border-[#ECE4D3]" />
          );
        })}
        {e.kaya_reply && (
          <div className="rounded-xl bg-[#FDF3F9] border border-[#EBC2DC] px-3 py-2 text-[12.5px] leading-snug text-[#0F1F44]">
            <b className="text-[#7A2E5C]">💌 Kaya:</b> {e.kaya_reply}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Slice 8c · Diary timeline — Year → Month → Day ─────────────────
//
// Month view = emoji calendar (the day's latest feeling on each cell,
// tiny 🔒 badge on locked days). Tap the title → year picker: 12 month
// chips each showing the month's two most-picked feelings, ‹ › steps
// the year (bounded: earliest entry year → current). One month rendered
// at a time — the diary honours the same 3-month render cap family.

export function DiaryTimeline({
  entries, sw, onOpenDay,
}: {
  entries: DiaryEntry[];
  sw: boolean;
  onOpenDay: (date: string) => void;
}) {
  const today = new Date();
  const todayKey = diaryDayKey(today);
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());

  const stats = useMemo(() => computeDiaryStats(entries, today), [entries, today]);
  const earliestYear = useMemo(() => {
    let min = today.getFullYear();
    for (const e of entries) {
      const y = Number(e.date.slice(0, 4));
      if (Number.isFinite(y) && y < min) min = y;
    }
    return min;
  }, [entries, today]);

  const monthLabel = new Date(cursor.y, cursor.m, 1)
    .toLocaleDateString(sw ? 'sw' : 'en', { month: 'long', year: 'numeric' });

  // Monday-padded day keys for the cursor month.
  const days = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const last = new Date(cursor.y, cursor.m + 1, 0);
    const out: string[] = [];
    const lead = (first.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) out.push('');
    for (let d = 1; d <= last.getDate(); d++) out.push(diaryDayKey(new Date(cursor.y, cursor.m, d)));
    return out;
  }, [cursor]);

  // Month-scoped chips: days filled · best run · locked count.
  const monthStats = useMemo(() => {
    let filled = 0, locked = 0, run = 0, best = 0;
    for (const k of days) {
      if (!k) continue;
      if (stats.feelingByDate[k]) {
        filled++; run++;
        if (run > best) best = run;
        if (stats.lockedByDate[k]) locked++;
      } else if (k <= todayKey) {
        run = 0;
      }
    }
    return { filled, locked, best };
  }, [days, stats, todayKey]);

  // Year-picker chips: the month's two most-picked feelings.
  const yearMonths = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const prefix = `${pickerYear}-${String(m + 1).padStart(2, '0')}`;
      const future = new Date(pickerYear, m, 1) > today;
      const counts = new Map<string, number>();
      for (const e of entries) {
        if (!e.date.startsWith(prefix)) continue;
        counts.set(e.feeling, (counts.get(e.feeling) ?? 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f]) => f);
      return { m, future, top };
    });
  }, [pickerYear, entries, today]);

  const dow = sw ? ['J2', 'J3', 'J4', 'J5', 'I', 'J', 'JP'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const back = () => setCursor(({ y, m }) => (y <= earliestYear && m === 0 ? { y, m } : m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const fwd = () => setCursor(({ y, m }) => {
    if (y === today.getFullYear() && m === today.getMonth()) return { y, m };
    return m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
  });
  const atNow = cursor.y === today.getFullYear() && cursor.m === today.getMonth();

  return (
    <div className="mt-3 rounded-2xl border border-[#EBC2DC] bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={back} disabled={cursor.y <= earliestYear && cursor.m === 0}
          className="text-[16px] font-black text-[#5A6488] px-2 disabled:opacity-30" aria-label={sw ? 'Mwezi uliopita' : 'Previous month'}>‹</button>
        <button type="button" onClick={() => { setPickerYear(cursor.y); setPickerOpen((o) => !o); }}
          className="font-nunito font-black text-[13px] text-[#0F1F44] capitalize px-2 py-0.5 rounded-lg hover:bg-[#FDF3F9]"
          aria-expanded={pickerOpen} title={sw ? 'Chagua mwezi wowote' : 'Jump to any month'}>
          {monthLabel} <span className="text-[#7A2E5C]">▾</span>
        </button>
        <button type="button" onClick={fwd} disabled={atNow}
          className="text-[16px] font-black text-[#5A6488] px-2 disabled:opacity-30" aria-label={sw ? 'Mwezi ujao' : 'Next month'}>›</button>
      </div>

      {pickerOpen && (
        <div className="mb-2 rounded-xl border border-[#EBC2DC] bg-[#FDF3F9] px-3 py-2.5">
          <div className="flex items-center justify-center gap-4 mb-2">
            <button type="button" onClick={() => setPickerYear((y) => Math.max(earliestYear, y - 1))}
              disabled={pickerYear <= earliestYear}
              className="text-[15px] font-black text-[#5A6488] px-2 disabled:opacity-30" aria-label="Previous year">‹</button>
            <span className="font-nunito font-black text-[14px] text-[#0F1F44]">{pickerYear}</span>
            <button type="button" onClick={() => setPickerYear((y) => Math.min(today.getFullYear(), y + 1))}
              disabled={pickerYear >= today.getFullYear()}
              className="text-[15px] font-black text-[#5A6488] px-2 disabled:opacity-30" aria-label="Next year">›</button>
          </div>
          <div className="grid grid-cols-6 max-[420px]:grid-cols-4 gap-1.5">
            {yearMonths.map(({ m, future, top }) => {
              const sel = pickerYear === cursor.y && m === cursor.m;
              return (
                <button key={m} type="button" disabled={future}
                  onClick={() => { setCursor({ y: pickerYear, m }); setPickerOpen(false); }}
                  className={`rounded-lg px-1 pt-1.5 pb-1 text-center border-[1.5px] text-[11px] font-extrabold transition-colors ${
                    sel ? 'border-[#7A2E5C] bg-[#F9E4F1] text-[#7A2E5C]'
                      : future ? 'border-transparent bg-white text-[#cfc7b5]'
                      : 'border-transparent bg-white text-[#5A6488] hover:border-[#C05299]/40'
                  }`}>
                  {new Date(pickerYear, m, 1).toLocaleDateString(sw ? 'sw' : 'en', { month: 'short' })}
                  <span className="block text-[12px] mt-0.5 tracking-[1px]" aria-hidden>
                    {future ? '' : top.length ? top.join('') : '·'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 mb-1">
        {dow.map((d, i) => <span key={i} className="text-center text-[8.5px] font-black text-[#5A6488]">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((k, i) => {
          if (!k) return <span key={`p${i}`} className="invisible aspect-square" />;
          const feeling = stats.feelingByDate[k];
          const isToday = k === todayKey;
          const future = k > todayKey;
          const dayNum = Number(k.slice(8, 10));
          return (
            <button key={k} type="button" disabled={!feeling}
              onClick={() => onOpenDay(k)}
              title={toDisplayDate(k)}
              className={`relative aspect-square rounded-lg grid place-items-center border ${
                feeling ? 'bg-[#FDF3F9] border-transparent text-[15px] cursor-pointer'
                : future ? 'bg-white border-dashed border-[#ECE4D3] text-[#cfc7b5] text-[10px] font-extrabold'
                : 'bg-[#FBF7EE] border-transparent text-[#b9ad95] text-[10px] font-extrabold'
              } ${isToday ? 'ring-2 ring-[#7A2E5C]' : ''}`}>
              {feeling ?? dayNum}
              {feeling && stats.lockedByDate[k] && (
                <span className="absolute bottom-0 right-0 text-[8px]" aria-hidden>🔒</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mt-2.5 flex-wrap">
        <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full bg-[#F9E4F1] text-[#7A2E5C]">
          {monthStats.filled} {sw ? 'siku zimejazwa' : 'days filled'}
        </span>
        <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full bg-[#FFF1C9] text-[#8A6800]">
          🔥 {sw ? 'mfululizo bora' : 'best run'} · {monthStats.best}
        </span>
        {monthStats.locked > 0 && (
          <span className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full bg-[#EFEAF9] text-[#4a3d78]">
            🔒 {monthStats.locked} {sw ? 'zimefungwa' : 'locked'}
          </span>
        )}
      </div>
      <div className="text-[9.5px] text-[#5A6488] mt-2 leading-snug">
        {sw
          ? 'Kila kisanduku kinaonyesha hisia ya mwisho ya siku hiyo. Bonyeza siku kuona kurasa zake.'
          : 'Each cell shows that day’s latest feeling. Tap a filled day to read its pages.'}
      </div>
    </div>
  );
}


// ── Slice 8d · Kid PIN-create modal ────────────────────────────────
// The capability disclosure lives HERE, once: "your parents can always
// see your PIN." Locking anything routes through this until a PIN exists.

export function PinCreateModal({
  kidFirstName, sw, onCancel, onSet, adult = false,
}: {
  kidFirstName: string;
  sw: boolean;
  onCancel: () => void;
  onSet: (pin: string) => Promise<void>;
  /** Adult mode (parent's own diary): the disclosure flips to the
   *  yours-alone + NO-RECOVERY warning. */
  adult?: boolean;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const press = (d: string) => {
    if (busy) return;
    if (d === '⌫') { setPin((p) => p.slice(0, -1)); return; }
    setPin((p) => (p.length >= 4 ? p : p + d));
  };
  const submit = async () => {
    if (pin.length !== 4 || busy) return;
    setBusy(true); setErr('');
    try { await onSet(pin); }
    catch (e) { setErr((e as Error).message || 'Failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Close" onClick={onCancel} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 text-white" style={{ background: 'linear-gradient(135deg, #7A2E5C, #C05299)' }}>
          <div className="font-display font-extrabold text-[16px]">🔒 {sw ? 'Weka PIN ya shajara' : 'Set your Diary PIN'}</div>
        </div>
        <div className="p-4">
          <div className="flex gap-2.5 justify-center my-2" aria-label={`${pin.length} of 4 digits`}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < pin.length ? 'bg-[#7A2E5C] border-[#7A2E5C]' : 'bg-[#F9E4F1] border-[#EBC2DC]'}`} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 justify-items-stretch my-3 max-w-[220px] mx-auto">
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => d === ''
              ? <span key={i} />
              : (
                <button key={i} type="button" onClick={() => press(d)}
                  className="h-11 rounded-xl bg-[#FBF7EE] font-black text-[15px] text-[#0F1F44] active:bg-[#F9E4F1]">
                  {d}
                </button>
              ))}
          </div>
          {adult ? (
            <div className="rounded-xl bg-[#FFE7E0] px-3 py-2.5 text-[11.5px] text-[#A33A2A] leading-relaxed">
              ⚠️ {sw
                ? 'PIN hii ni yako peke yako — haionekani kwa mzazi mwenzako, haiwezi kuwekwa upya. Ukiisahau, kurasa zilizofungwa hubaki zimefungwa milele.'
                : 'This PIN is yours alone — invisible to your co-parent, no knock, no reset. Forget it and those pages stay locked forever.'}
            </div>
          ) : (
            <div className="rounded-xl bg-[#FFF1C9] px-3 py-2.5 text-[11.5px] text-[#8A6800] leading-relaxed">
              💛 {sw
                ? `PIN yako inazuia kaka na dada kufungua kurasa zako. Wazazi wako wanaweza kuiona PIN yako kila wakati — ni walezi wako salama.`
                : `Your PIN keeps your locked pages away from brothers & sisters. Your parents can always see your PIN — they're your safe grown-ups. Locked pages just say "knock first, please."`}
            </div>
          )}
          {err && <p className="text-[12px] font-bold text-[#E36F6F] mt-2">{err}</p>}
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={onCancel} className="flex-1 rounded-xl py-2.5 text-[13px] font-bold text-[#5A6488] bg-[#FBF7EE]">
              {sw ? 'Ghairi' : 'Cancel'}
            </button>
            <button type="button" onClick={submit} disabled={pin.length !== 4 || busy}
              className="flex-1 rounded-xl py-2.5 text-[13px] font-extrabold text-white disabled:opacity-40" style={{ background: '#7A2E5C' }}>
              {busy ? '…' : (sw ? 'Weka PIN' : 'Set PIN')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

