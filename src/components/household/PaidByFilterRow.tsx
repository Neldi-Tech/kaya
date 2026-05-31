'use client';

// Kaya · "Paid by" filter chip row + per-row tag chip.
//
// Filter chip row sits above every cost list (Subscriptions,
// Contributions, Purchases, Payroll, Pulse Finance). Selecting a chip
// narrows the list to just those rows; counts + totals are caller-
// supplied so the formatting matches each module's currency convention.

import { useEffect, useState } from 'react';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import type { PaidByValue } from './PaidByPicker';

interface FilterRowProps {
  familyId: string;
  selected: PaidByValue | 'all';
  onChange: (next: PaidByValue | 'all') => void;
  /** Optional row -> count map, keyed by uid or 'shared' or 'all'. */
  counts?: Partial<Record<string | 'shared' | 'all', number>>;
}

export default function PaidByFilterRow({ familyId, selected, onChange, counts }: FilterRowProps) {
  const [parents, setParents] = useState<UserProfile[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const members = await getFamilyMembers(familyId);
      if (!alive) return;
      setParents(members.filter((m) => m.role === 'parent'));
    })();
    return () => { alive = false; };
  }, [familyId]);

  // Two parents is the common case; render dynamically for 1 or 3+.
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
      <FilterChip
        label="All"
        active={selected === 'all'}
        count={counts?.all}
        onClick={() => onChange('all')}
        tone="warm"
      />
      {parents.map((p) => (
        <FilterChip
          key={p.uid}
          label={parentLabel(p)}
          active={selected === p.uid}
          count={counts?.[p.uid]}
          onClick={() => onChange(p.uid)}
          tone="parent"
          uid={p.uid}
        />
      ))}
      <FilterChip
        label="👪 Shared"
        active={selected === null}
        count={counts?.shared}
        onClick={() => onChange(null)}
        tone="shared"
      />
    </div>
  );
}

function FilterChip({
  label, active, count, onClick, tone, uid,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  tone: 'warm' | 'parent' | 'shared';
  uid?: string;
}) {
  const palette = tone === 'shared'
    ? { fg: '#6E7A98', bg: '#E5E7EE' }
    : tone === 'parent'
      ? paletteForUid(uid || '')
      : { fg: '#0F1F44', bg: '#F4ECDB' };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold flex items-center gap-1.5 transition border-[1.5px]"
      style={{
        background: palette.bg,
        color: palette.fg,
        borderColor: active ? palette.fg : 'transparent',
        boxShadow: active ? '0 0 0 3px rgba(91, 110, 167, 0.10)' : undefined,
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span className="bg-white rounded-full px-1.5 py-[1px] text-[10px]">{count}</span>
      )}
    </button>
  );
}

/** Compact tag chip for a single row — same colour family as the
 *  picker + filter so attribution reads consistently end-to-end. */
export function PaidByTag({ uid, parents }: { uid: string | null; parents: UserProfile[] }) {
  if (uid === null) {
    return (
      <span
        className="text-[9.5px] font-extrabold rounded-full px-1.5 py-[1px] inline-flex items-center gap-1"
        style={{ background: '#E5E7EE', color: '#6E7A98' }}
      >
        👪 Shared
      </span>
    );
  }
  const parent = parents.find((p) => p.uid === uid);
  if (!parent) return null;
  const palette = paletteForUid(uid);
  return (
    <span
      className="text-[9.5px] font-extrabold rounded-full px-1.5 py-[1px] inline-flex items-center gap-1"
      style={{ background: palette.bg, color: palette.fg }}
    >
      👤 {(parent.displayName || parent.email || 'Parent').split(' ')[0]}
    </span>
  );
}

function parentLabel(p: UserProfile): string {
  const name = (p.displayName || p.email || 'Parent').split(' ')[0];
  return `👤 ${name}`;
}

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
