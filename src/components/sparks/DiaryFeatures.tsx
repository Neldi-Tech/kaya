'use client';

// Kaya Sparks · Diary signature features (Slice 8f · 2026-07-21).
// 🎨 Year in Pixels · 📅 On This Day — pure client renders, no AI cost.
// The share flow posts the pixel poster to Moments ON THE KID'S SAY-SO
// via the standard reserve → upload → finalize post pipeline.

import { useMemo, useRef, useState } from 'react';
import { type DiaryEntry, diaryDayKey } from '@/lib/sparks/diary';
import { toDisplayDate } from '@/lib/dates';

// ── 🎨 Year in Pixels ───────────────────────────────────────────────

export function YearInPixelsCard({
  entries, year, ownerName, canShare, onShare, sw,
}: {
  entries: DiaryEntry[];
  year: number;
  ownerName: string;
  /** Only the OWNER may share — the kid's say-so from the design. */
  canShare: boolean;
  onShare?: (pngFile: File) => Promise<void>;
  sw: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  // month → day → feeling (latest entry wins; entries arrive newest-first).
  const byDate = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) if (!m[e.date]) m[e.date] = e.feeling;
    return m;
  }, [entries]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, mo) => {
    const daysIn = new Date(year, mo + 1, 0).getDate();
    return Array.from({ length: daysIn }, (_, d) => {
      const key = `${year}-${String(mo + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
      return byDate[key] ?? null;
    });
  }), [byDate, year]);

  const filled = useMemo(() => months.flat().filter(Boolean).length, [months]);

  /** Render the poster onto a canvas → PNG File. Emoji paint natively
   *  on canvas via fillText — no external assets. */
  const exportPoster = async (): Promise<File | null> => {
    const CELL = 28, PAD = 40, HEAD = 90;
    const w = PAD * 2 + CELL * 12;
    const h = HEAD + PAD + CELL * 31 + 40;
    const cv = document.createElement('canvas');
    cv.width = w * 2; cv.height = h * 2;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.scale(2, 2);
    ctx.fillStyle = '#FDF3F9';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7A2E5C';
    ctx.font = '800 22px -apple-system, sans-serif';
    ctx.fillText(`🎨 ${ownerName}'s ${year} in feelings`, PAD, 44);
    ctx.fillStyle = '#5A6488';
    ctx.font = '700 12px -apple-system, sans-serif';
    ctx.fillText(`${filled} days written · Kaya Diary`, PAD, 66);
    const MO = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    ctx.font = '800 11px -apple-system, sans-serif';
    months.forEach((_, mo) => {
      ctx.fillStyle = '#7A2E5C';
      ctx.fillText(MO[mo], PAD + mo * CELL + 9, HEAD - 6);
    });
    ctx.font = '15px -apple-system, sans-serif';
    months.forEach((days, mo) => {
      days.forEach((feel, d) => {
        const x = PAD + mo * CELL, y = HEAD + d * CELL;
        if (feel) {
          ctx.fillText(feel, x + 3, y + 19);
        } else {
          ctx.fillStyle = '#F0E3EB';
          ctx.fillRect(x + 6, y + 8, 12, 12);
        }
      });
    });
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return null;
    return new File([blob], `year-in-pixels-${year}.png`, { type: 'image/png' });
  };

  const share = async () => {
    if (!onShare || sharing) return;
    setSharing(true);
    try {
      const file = await exportPoster();
      if (file) { await onShare(file); setShared(true); }
    } finally { setSharing(false); }
  };

  return (
    <div className="mt-3 rounded-2xl border border-[#EBC2DC] bg-white p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488]">
          🎨 {sw ? `Mwaka ${year} kwa rangi` : `Year in Pixels · ${year}`}
        </div>
        <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#F9E4F1] text-[#7A2E5C]">
          {filled} {sw ? 'siku' : 'days'}
        </span>
      </div>
      <div ref={gridRef} className="overflow-x-auto">
        <div className="grid gap-[2px] min-w-[330px]" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
          {['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => (
            <span key={`h${i}`} className="text-center text-[8px] font-black text-[#7A2E5C]">{m}</span>
          ))}
          {Array.from({ length: 31 }, (_, d) => (
            months.map((days, mo) => (
              <span key={`${mo}-${d}`} className="grid place-items-center text-[9px] leading-none aspect-square">
                {d < days.length
                  ? (days[d] ?? <span className="w-[7px] h-[7px] rounded-[2px] bg-[#F0E3EB] inline-block" />)
                  : null}
              </span>
            ))
          ))}
        </div>
      </div>
      {canShare && onShare && (
        <button type="button" onClick={share} disabled={sharing || shared}
          className="mt-2.5 w-full rounded-xl py-2 text-[12px] font-extrabold text-white disabled:opacity-60"
          style={{ background: '#7A2E5C' }}>
          {shared ? (sw ? '✓ Imeshirikiwa kwenye Moments' : '✓ Shared to Moments') : sharing ? '…' : (sw ? '📸 Shiriki kwenye Moments' : '📸 Share to Moments')}
        </button>
      )}
      <p className="text-[9.5px] text-[#5A6488] mt-1.5 m-0 leading-snug">
        {sw ? 'Kila kisanduku = hisia ya siku moja. Wewe pekee unaamua kushiriki.' : 'Every cell = one day’s feeling. Only you decide to share it.'}
      </p>
    </div>
  );
}

// ── 📅 On This Day ──────────────────────────────────────────────────

export function OnThisDayCard({ entries, sw }: { entries: DiaryEntry[]; sw: boolean }) {
  const flash = useMemo(() => {
    const today = new Date();
    const targets: Array<{ label: string; labelSw: string; date: string }> = [
      (() => {
        const d = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
        return { label: '1 month ago', labelSw: 'Mwezi 1 uliopita', date: diaryDayKey(d) };
      })(),
      (() => {
        const d = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        return { label: '1 year ago', labelSw: 'Mwaka 1 uliopita', date: diaryDayKey(d) };
      })(),
    ];
    for (const t of targets) {
      const hit = entries.find((e) => e.date === t.date);
      if (hit) return { ...t, entry: hit };
    }
    return null;
  }, [entries]);

  if (!flash) return null;
  const e = flash.entry;
  const isPrivate = e.redacted || e.locked;
  const firstText = e.blocks.find((b) => b.kind === 'text')?.text ?? '';

  return (
    <div className="mt-3 rounded-2xl border border-[#ECE4D3] bg-white px-3.5 py-3">
      <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488]">
        📅 {sw ? flash.labelSw : `On this day · ${flash.label}`}
      </div>
      {isPrivate ? (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[22px]" aria-hidden>{e.feeling}</span>
          <span className="text-[11.5px] text-[#5A6488]">
            {toDisplayDate(e.date)} · 🔒 {sw ? 'ukurasa binafsi' : 'a private page — the feeling says enough'}
          </span>
        </div>
      ) : (
        <>
          <div className="text-[13px] italic text-[#0F1F44] mt-1.5 leading-snug">
            <span className="not-italic mr-1.5" aria-hidden>{e.feeling}</span>
            {firstText ? `“${firstText.slice(0, 140)}${firstText.length > 140 ? '…' : ''}”` : (sw ? '(ukurasa wa picha)' : '(a drawn page)')}
          </div>
          <div className="text-[10px] text-[#5A6488] mt-1">{toDisplayDate(e.date)}</div>
        </>
      )}
    </div>
  );
}
