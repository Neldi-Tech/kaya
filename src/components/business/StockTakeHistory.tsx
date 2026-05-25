'use client';

// Reusable stock-take history: a tappable list of past takes + a detail modal
// (per-item counts + photos/clips + the kid's note + a parent's note) + a
// full-screen photo zoom. Used on BOTH the Daily stock-take page and the
// business dashboard so the records + view are identical in both places
// (single source — no drift between the two surfaces).

import { useState } from 'react';
import { StockTake, StockMedia, todayKey } from '@/lib/business';
import { toDisplayDate } from '@/lib/dates';

/** Photos + clips of one stock-take, in display order (photos first). */
function takeMedia(t: StockTake): StockMedia[] {
  if (t.media?.length) return t.media;
  return t.photoUrl ? [{ url: t.photoUrl, kind: 'photo' }] : [];
}

export default function StockTakeHistory({
  takes,
  today = todayKey(),
  className = '',
}: {
  takes: StockTake[];
  today?: string;
  className?: string;
}) {
  const [openTake, setOpenTake] = useState<StockTake | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  if (takes.length === 0) return null;

  return (
    <>
      <div className={`bg-hive-paper border border-hive-line rounded-hive p-4 ${className}`}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-nunito font-extrabold text-[14px]">📚 Stock-take history</h3>
          <span className="text-[11px] text-hive-muted">tap a day</span>
        </div>
        <div className="space-y-1">
          {takes.map((t) => {
            const ms = takeMedia(t);
            const cover = ms.find((m) => m.kind === 'photo') || ms[0];
            const photoN = ms.filter((m) => m.kind === 'photo').length;
            const vidN = ms.filter((m) => m.kind === 'video').length;
            return (
              <button key={t.id} type="button" onClick={() => setOpenTake(t)}
                className="w-full flex items-center gap-3 p-2 rounded-hive hover:bg-hive-cream/70 transition text-left">
                <div className="w-12 h-12 rounded-hive overflow-hidden border border-hive-line bg-hive-cream shrink-0 flex items-center justify-center">
                  {cover ? (
                    cover.kind === 'video'
                      ? <video src={cover.url} className="w-full h-full object-cover" muted playsInline />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={cover.url} alt="" className="w-full h-full object-cover" />
                  ) : <span className="text-[18px]">📦</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-extrabold text-[13px] text-hive-navy">{toDisplayDate(t.date)}{t.date === today ? ' · today' : ''}</div>
                  <div className="text-[11px] text-hive-muted flex items-center gap-2 flex-wrap mt-0.5">
                    <span>{t.itemsTouched} updated</span>
                    {photoN > 0 && <span>📸 {photoN}</span>}
                    {vidN > 0 && <span>🎬 {vidN}</span>}
                    {t.note && <span>📝</span>}
                    {t.parentNote && <span className="text-hive-honey-dk font-bold">💬 parent</span>}
                  </div>
                </div>
                <span className="text-hive-muted text-[18px] shrink-0">›</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* History detail — counts + that day's photos/clips + the kid's note + a parent's note. */}
      {openTake && (
        <div onClick={() => setOpenTake(null)}
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4">
          <div onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-hive-paper rounded-t-hive-lg sm:rounded-hive-lg p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-nunito font-black text-[15px]">{toDisplayDate(openTake.date)}{openTake.date === today ? ' · today' : ''}</h3>
              <button type="button" onClick={() => setOpenTake(null)} className="w-8 h-8 rounded-full bg-hive-cream text-hive-muted font-black">✕</button>
            </div>
            <p className="text-[12px] text-hive-muted mb-3">{openTake.itemsTouched} item{openTake.itemsTouched === 1 ? '' : 's'} updated</p>
            {openTake.counts && openTake.counts.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted mb-1">Counts</div>
                <ul className="divide-y divide-hive-line/60 rounded-hive border border-hive-line bg-hive-cream">
                  {openTake.counts.map((c) => (
                    <li key={c.itemId} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                      <span className="text-[13px] text-hive-navy truncate">{c.name}</span>
                      <span className="text-[13px] font-nunito font-extrabold text-hive-navy shrink-0">{c.qty}{c.unitLabel ? ` ${c.unitLabel}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {takeMedia(openTake).length ? (
              <div className={`grid gap-2 mb-3 ${takeMedia(openTake).length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {takeMedia(openTake).map((m, i) => (
                  m.kind === 'video'
                    ? <video key={i} src={m.url} controls playsInline className="w-full aspect-square rounded-hive object-cover bg-black" />
                    : <button key={i} type="button" onClick={() => setZoom(m.url)}
                        className="w-full aspect-square rounded-hive overflow-hidden border border-hive-line hover:brightness-95 transition">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.url} alt="Stock-take" className="w-full h-full object-cover" />
                      </button>
                ))}
              </div>
            ) : <p className="text-[12px] text-hive-muted mb-3">No photos for this day.</p>}
            {openTake.note && (
              <div className="bg-hive-cream rounded-hive p-3 mb-2">
                <div className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted mb-0.5">Note</div>
                <p className="text-[13px] text-hive-navy leading-snug">📝 {openTake.note}</p>
              </div>
            )}
            {openTake.parentNote && (
              <div className="bg-hive-honey-soft border border-hive-honey rounded-hive p-3">
                <div className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-honey-dk mb-0.5">From a parent</div>
                <p className="text-[13px] text-hive-navy leading-snug">💬 {openTake.parentNote}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {zoom && (
        <div onClick={() => setZoom(null)}
          className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Stock-take" className="max-w-full max-h-full rounded-hive-lg" />
        </div>
      )}
    </>
  );
}
