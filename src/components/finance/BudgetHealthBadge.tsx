'use client';

// Budget Health Score gauge (2026-06-15) — surprise #1. A compact 0-100
// ring + letter grade for the Finances Overview hero.

import { type BudgetHealth } from '@/lib/budgetHealth';

const RING = 2 * Math.PI * 30; // r = 30

export default function BudgetHealthBadge({ health }: { health: BudgetHealth }) {
  if (!health.hasCaps) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-hive-muted font-bold">
        <span className="text-base">🩺</span> {health.reason}
      </div>
    );
  }
  const color = health.score >= 78 ? '#3E6B4F' : health.score >= 62 ? '#4A7C59'
    : health.score >= 45 ? '#C99A3A' : '#C2562E';
  const offset = RING * (1 - health.score / 100);
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-[72px] h-[72px] flex-shrink-0">
        <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="36" cy="36" r="30" fill="none" stroke="#ffffff" strokeWidth="8" />
          <circle cx="36" cy="36" r="30" fill="none" stroke={color} strokeWidth="8"
            strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={offset} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-nunito font-black text-[20px] leading-none text-hive-ink">{health.score}</span>
        </div>
      </div>
      <div className="min-w-0">
        <span className="inline-block bg-white/70 border border-pantry-leaf rounded-full px-2.5 py-0.5 font-nunito font-black text-[12px] text-pantry-leaf-dk">
          Grade {health.grade} · {health.label}
        </span>
        <p className="text-[11px] text-hive-muted font-bold mt-1 leading-snug">{health.reason}</p>
      </div>
    </div>
  );
}
