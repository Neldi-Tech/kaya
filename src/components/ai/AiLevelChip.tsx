'use client';

// 🤖 Kaya AI Levels · the level chip (approved 2026-09-07, rule 6).
//
// A small pill — "🌤 Balanced marking" — shown wherever an AI score or
// piece of AI feedback is rendered, carrying the level that evaluation
// was ACTUALLY made at (stamped on the record, never re-computed). Kids
// tap it for a one-line explanation, so a strict week reads as "stricter
// marking started", not "something went wrong". Renders nothing for a
// missing / invalid level (legacy rows before AI Levels).

import { useState } from 'react';
import { aiLevelExplainer, aiLevelMeta, parseAiLevel } from '@/lib/ai/level.shared';

const TONE: Record<1 | 2 | 3 | 4, { bg: string; fg: string; border: string }> = {
  1: { bg: '#DDF5DF', fg: '#2E7D34', border: '#B7E4BC' },
  2: { bg: '#E2F1FF', fg: '#2B5FA8', border: '#BBD8F5' },
  3: { bg: '#FFF1C9', fg: '#8A6800', border: '#F3D3A6' },
  4: { bg: '#E5D6FF', fg: '#5A3CB8', border: '#D9CCFA' },
};

export default function AiLevelChip({
  level,
  what = 'marking',
  size = 'sm',
  className = '',
}: {
  /** The stamped level (1-4). Anything else renders nothing. */
  level: unknown;
  /** The noun after the level name: "marking" · "scoring" · "feedback" · "quiz" · "coaching". */
  what?: string;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const lv = parseAiLevel(level);
  if (!lv) return null;
  const m = aiLevelMeta(lv);
  const tone = TONE[lv];
  return (
    <span className={`inline-flex flex-col items-start ${className}`} data-ai-level={lv}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-expanded={open}
        title={`${m.name} ${what} — tap to see what it means`}
        className={`inline-flex items-center gap-1 rounded-full border font-extrabold whitespace-nowrap ${
          size === 'xs' ? 'text-[9.5px] px-1.5 py-[1px]' : 'text-[10.5px] px-2 py-0.5'
        }`}
        style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}
      >
        {m.emoji} {m.name} {what}
      </button>
      {open && (
        <span className="mt-1 text-[10.5px] leading-snug text-[#5A6488] max-w-[280px] text-left">
          {aiLevelExplainer(lv)} <span className="opacity-70">Set by your parent in Settings.</span>
        </span>
      )}
    </span>
  );
}
