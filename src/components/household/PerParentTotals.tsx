'use client';

// Kaya · Per-parent spend totals card — stacked bar + per-parent rows.
//
// Answers "who's spending what this month" at a glance: Dad / Mum /
// Shared, with a stacked bar + % of the family pie. Powers the
// cost-cutting view Elia asked for — tap a parent's row to filter the
// feed below to just their attributed costs.
//
// Fed a `byUid` map (uid → cents; the 'shared' key holds null-attributed
// spend) + the parents roster. Pure presentation — the caller computes
// the totals from whatever source collections it has (subscriptions,
// contributions, closed purchases).

import type { UserProfile } from '@/lib/firestore';

export interface PerParentTotalsProps {
  /** uid → cents. The literal key 'shared' holds null-attributed spend. */
  byUid: Record<string, number>;
  parents: UserProfile[];
  /** Format cents in the household currency. */
  format: (cents: number) => string;
  /** Currently-selected filter: 'all' | uid | null(=shared). */
  selected: 'all' | string | null;
  onSelect: (next: 'all' | string | null) => void;
  monthLabel: string;
}

// Stable per-uid palette — matches PaidByPicker / PaidByFilterRow so a
// parent reads the same colour across every surface.
function paletteForUid(uid: string): { fg: string; bg: string } {
  const palettes = [
    { fg: '#2E6FA6', bg: '#DAE6F4' }, // dad-blue
    { fg: '#C0467A', bg: '#F7DDE9' }, // mum-rose
    { fg: '#1E7873', bg: '#D7F4F1' }, // teal
  ];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) & 0xffff;
  return palettes[h % palettes.length];
}

const SHARED = { fg: '#6E7A98', bg: '#E5E7EE' };

export default function PerParentTotals({
  byUid, parents, format, selected, onSelect, monthLabel,
}: PerParentTotalsProps) {
  const rows = [
    ...parents.map((p) => ({
      key: p.uid,
      label: (p.displayName || p.email || 'Parent').split(' ')[0],
      emoji: '👤',
      cents: byUid[p.uid] ?? 0,
      ...paletteForUid(p.uid),
    })),
    {
      key: 'shared' as const,
      label: 'Shared',
      emoji: '👪',
      cents: byUid.shared ?? 0,
      ...SHARED,
    },
  ];
  const total = rows.reduce((acc, r) => acc + r.cents, 0);

  if (total === 0) return null;

  return (
    <div className="rounded-hive border border-pulse-navy/15 bg-white p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-navy/65">
          Spend by parent · {monthLabel}
        </p>
        {selected !== 'all' && (
          <button
            type="button"
            onClick={() => onSelect('all')}
            className="text-[10.5px] font-extrabold text-pulse-navy/55 hover:text-pulse-navy"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Stacked bar */}
      <div className="h-2.5 rounded-full overflow-hidden bg-pulse-navy/8 flex mb-3">
        {rows.filter((r) => r.cents > 0).map((r) => (
          <div
            key={r.key}
            style={{ width: `${(r.cents / total) * 100}%`, background: r.fg }}
            title={`${r.label}: ${format(r.cents)}`}
          />
        ))}
      </div>

      {/* Rows — tappable to filter the feed below. */}
      <div className="space-y-0.5">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.cents / total) * 100) : 0;
          const isSel = selected === r.key || (r.key === 'shared' && selected === null);
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onSelect(r.key === 'shared' ? null : r.key)}
              className={`w-full flex items-center justify-between py-1.5 px-2 rounded-lg transition ${isSel ? 'bg-pulse-navy/5' : 'hover:bg-pulse-navy/[0.03]'}`}
              aria-pressed={isSel}
            >
              <span className="flex items-center gap-2 text-[12.5px] font-bold text-pulse-navy">
                <span className="w-3 h-3 rounded" style={{ background: r.fg }} />
                {r.emoji} {r.label}
              </span>
              <span className="text-[13px] font-extrabold text-pulse-navy tabular-nums">
                {format(r.cents)}
                <span className="text-[10px] text-pulse-navy/50 ml-1.5">· {pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
