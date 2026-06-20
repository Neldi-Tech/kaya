'use client';

// Kaya · Birthdays — Memory Lane reel (B2).
//
// A look-back at the person's PAST birthdays on Kaya. Reads the accumulated
// per-year celebration state (family.birthdays[{id}_{year}]) — every year the
// kickoff stamps an entry with the age + the wishes that came in — and shows a
// horizontal reel of year cards. Designed to sit ON the themed hero gradient
// (transparent, white text). Renders nothing until there's at least one past
// year to look back on, so the very first birthday stays clean.

import type { BirthdayPerson, BirthdayDayState } from '@/lib/birthdays';

export default function BirthdayMemoryLane({ person, state }: {
  person: BirthdayPerson;
  state: Record<string, BirthdayDayState>;
}) {
  const thisYear = new Date().getFullYear();
  const past = Object.entries(state)
    .map(([key, st]) => {
      const cut = key.lastIndexOf('_');
      if (cut < 0) return null;
      const id = key.slice(0, cut);
      const year = parseInt(key.slice(cut + 1), 10);
      if (id !== person.id || !Number.isFinite(year)) return null;
      return { year, st };
    })
    .filter((x): x is { year: number; st: BirthdayDayState } => !!x && x.year < thisYear)
    .sort((a, b) => b.year - a.year);

  if (past.length === 0) return null;

  const accent = person.theme.accent;
  const badges = past.filter((p) => p.st.dropAt).length;
  return (
    <div className="mt-4">
      <div className="text-[10.5px] font-nunito font-black uppercase tracking-[1.5px] mb-1.5" style={{ color: accent }}>
        ✨ Memory Lane — birthdays past{badges > 0 ? ` · 🏅 ${badges} badge${badges === 1 ? '' : 's'}` : ''}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {past.map(({ year, st }) => {
          const wishes = st.wishes?.length ?? 0;
          return (
            <div key={year} className="shrink-0 bg-white/15 rounded-xl px-3 py-2.5 text-center" style={{ minWidth: 96 }}>
              <div className="text-[18px]">🎂</div>
              <div className="text-[13px] font-nunito font-black text-white">{year}</div>
              {typeof st.age === 'number' && (
                <div className="text-[10.5px] text-white/85">turned {st.age}</div>
              )}
              <div className="text-[10.5px] mt-0.5" style={{ color: accent }}>
                {wishes > 0 ? `${wishes} 💛` : '🎈'}{st.dropAt ? ' · 🏅' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
