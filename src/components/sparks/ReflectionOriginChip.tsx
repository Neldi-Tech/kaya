'use client';

// Kaya Sparks · Treasures 2.0 (D35) — where a reflection came from.
//
// One chip, every surface: 📝 Daily · 📚 Book · 🧭 Quest. The tag is
// generic on purpose — Quests adopt it next with a one-line change.

import type { ReflectionOrigin } from '@/lib/sparks/reflection';

const STYLE: Record<ReflectionOrigin['kind'], { emoji: string; label: string; bg: string; fg: string }> = {
  daily: { emoji: '📝', label: 'Daily', bg: '#E2F3EE', fg: '#0E6B5E' },
  book:  { emoji: '📚', label: 'Book',  bg: '#F6ECDF', fg: '#6E4624' },
  quest: { emoji: '🧭', label: 'Quest', bg: '#EFE8FF', fg: '#5A3CB8' },
};

export default function ReflectionOriginChip({ origin, withLabel = false, small = false }: {
  origin?: ReflectionOrigin;
  /** Also show the book/quest name ("📚 Book · Percy Jackson"). */
  withLabel?: boolean;
  small?: boolean;
}) {
  const kind = origin?.kind ?? 'daily';
  const s = STYLE[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 font-extrabold rounded-full ${small ? 'text-[9.5px] px-2 py-0.5' : 'text-[10px] px-2 py-1'}`}
      style={{ background: s.bg, color: s.fg }}
      title={origin?.label ? `${s.label} · ${origin.label}` : s.label}
    >
      <span aria-hidden>{s.emoji}</span>
      <span>{s.label}{withLabel && origin?.label ? ` · ${origin.label}` : ''}</span>
    </span>
  );
}
