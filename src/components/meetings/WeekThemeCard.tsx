'use client';

// 📖 Theme of the Week (SM3.1 · H·A) — the verse/quote the leader set at the
// meeting close, carried through the week on Home + My Day. Renders nothing
// unless the theme belongs to the CURRENT meeting-week, so a stale theme
// never lingers. Read-only glue — the presenter writes family.weekTheme.

import { useFamily } from '@/contexts/FamilyContext';

export default function WeekThemeCard({ className = '' }: { className?: string }) {
  const { family } = useFamily();
  const theme = family?.weekTheme;
  if (!theme?.text) return null;

  // Current week's key on the family's meeting day (default Sunday).
  const dow = family?.meetingSetup?.schedule?.dayOfWeek ?? 0;
  const now = new Date();
  const delta = (now.getDay() - dow + 7) % 7;
  const wk = new Date(now); wk.setDate(wk.getDate() - delta);
  const weekKey = `${wk.getFullYear()}-${String(wk.getMonth() + 1).padStart(2, '0')}-${String(wk.getDate()).padStart(2, '0')}`;
  if (theme.weekOf !== weekKey) return null;

  return (
    <div className={`rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-3 ${className}`}>
      <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-amber-700">📖 Theme of the week</p>
      <p className="text-[13.5px] font-nunito font-bold text-[#4a3a18] leading-snug mt-0.5">
        “{theme.text}”{theme.by ? <span className="text-[11px] font-extrabold text-amber-700/70"> — set by {theme.by}</span> : null}
      </p>
    </div>
  );
}
