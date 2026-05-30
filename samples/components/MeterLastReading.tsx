'use client';

// Last-reading hero card for ANY metered module — Luku electricity,
// Maji water, car odometer, gas refill, anything metered.
//
// Drops in at the TOP of the trackable-detail screen, above the
// existing "Daily Consumption" block. Empty state handles modules
// that have never been logged.
//
// Usage:
//   <MeterLastReading
//     reading={{
//       value: 247, unit: 'units',
//       at: '2026-05-28T18:32:00Z', by: 'Elia',
//     }}
//     accentEmoji="⚡"           // 💧 water, 🚗 odometer, 🔥 gas…
//     onLogNew={() => openLogSheet()}
//   />
//
// Self-contained — no external imports beyond React. Inline hex
// colour values so it drops into any Tailwind setup.

import React from 'react';

export interface MeterReading {
  /** The numeric meter value (units, litres, km, etc.). */
  value: number;
  /** Human label for the unit; defaults to 'units'. */
  unit?: string;
  /** ISO timestamp the reading was taken. */
  at: string;
  /** Who logged it. */
  by?: string;
}

export interface MeterLastReadingProps {
  /** The last logged reading, or null when none has ever been logged. */
  reading: MeterReading | null;
  /** Hero accent emoji (⚡ for Luku, 💧 for Maji, 🚗 for car odo…). */
  accentEmoji?: string;
  /** Tap-to-log handler. Hidden when omitted. */
  onLogNew?: () => void;
}

function fmtAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0)   return 'today';
  if (days === 1)  return 'yesterday';
  if (days < 30)   return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function MeterLastReading({
  reading, accentEmoji = '⚡', onLogNew,
}: MeterLastReadingProps) {
  if (!reading) {
    return (
      <div className="bg-white rounded-[20px] p-4 border border-dashed border-[#EDE3CC]">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#6B7280]">
          {accentEmoji} Last reading
        </p>
        <p className="text-[14px] font-extrabold text-[#0E2240] mt-2">
          No reading logged yet.
        </p>
        {onLogNew && (
          <button
            type="button"
            onClick={onLogNew}
            className="mt-3 w-full h-10 rounded-full bg-[#0E2240] text-[#FBF5E5] font-black text-[12px]"
          >
            ＋ Log first reading
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#0E2240] text-[#FBF5E5] rounded-[20px] p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#E8A300]">
          {accentEmoji} Last reading
        </p>
        {onLogNew && (
          <button
            type="button"
            onClick={onLogNew}
            className="text-[11px] font-extrabold text-[#E8A300]"
          >
            ＋ Log new →
          </button>
        )}
      </div>
      <p className="text-[30px] font-black leading-none mt-2">
        {reading.value.toLocaleString()}
        <span className="text-[14px] font-extrabold opacity-70 ml-1">
          {reading.unit ?? 'units'}
        </span>
      </p>
      <p className="text-[12px] text-[#FBF5E5]/80 mt-1">
        {fmtTs(reading.at)}
        {reading.by ? ` · by ${reading.by}` : ''}
        <span className="opacity-70"> · {fmtAgo(reading.at)}</span>
      </p>
    </div>
  );
}
