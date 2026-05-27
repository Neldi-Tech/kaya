'use client';

// Pill-shaped status badge. Used in EntryRow + Detail page. Visibility
// pills (parents-only / family / private) read as small chip-like
// tokens on the cards in Premium navy/gold colourway.

import { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'gold' | 'green' | 'coral' | 'muted';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-pulse-navy/8  text-pulse-navy/80  border-pulse-navy/15',
  gold:    'bg-pulse-gold/15 text-pulse-gold     border-pulse-gold/40',
  green:   'bg-pulse-green/10 text-pulse-green   border-pulse-green/35',
  coral:   'bg-pulse-coral/12 text-pulse-coral   border-pulse-coral/40',
  muted:   'bg-pulse-cream    text-pulse-navy/60 border-pulse-navy/10',
};

export function StatusBadge({
  tone = 'neutral',
  children,
}: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
