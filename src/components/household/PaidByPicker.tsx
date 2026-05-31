'use client';

// Kaya · "Paid by" picker — used on every cost entry / edit sheet
// (Subscriptions, Contributions, Purchases, Payroll, Pulse Finance).
//
// One field on the doc: `paidByUid: string | null`.
//   null         → 👪 Shared (default; renders as the unattributed bucket)
//   <parent uid> → that parent's attributed cost
//
// Visibility unchanged: every family member still SEES the row. The
// field is for analysis + filtering only. The 3-button render is
// dynamic from the family roster — works for 1 / 2 / 3+ parents.

import { useEffect, useMemo, useState } from 'react';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';

export type PaidByValue = string | null; // null = shared

interface Props {
  familyId: string;
  value: PaidByValue;
  onChange: (next: PaidByValue) => void;
  /** Optional label override — defaults to "💳 Paid by". */
  label?: string;
}

export default function PaidByPicker({ familyId, value, onChange, label }: Props) {
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

  return (
    <div className="space-y-1.5">
      <label className="block text-[10.5px] font-bold uppercase tracking-wide text-pulse-navy/65">
        {label ?? '💳 Paid by'}
      </label>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${Math.min(parents.length + 1, 4)}, 1fr)` }}
      >
        {parents.map((p) => (
          <PaidByOption
            key={p.uid}
            label={parentLabel(p)}
            tone="dad-or-mom"
            uid={p.uid}
            selected={value === p.uid}
            onClick={() => onChange(p.uid)}
          />
        ))}
        <PaidByOption
          label="👪 Shared"
          tone="shared"
          uid={null}
          selected={value === null}
          onClick={() => onChange(null)}
        />
      </div>
      <p className="text-[10px] text-pulse-navy/50 leading-snug">
        Default = Shared. Tap to attribute the cost; use the filter chips on the list to slice by parent later.
      </p>
    </div>
  );
}

function PaidByOption({
  label, tone, uid, selected, onClick,
}: {
  label: string;
  tone: 'dad-or-mom' | 'shared';
  uid: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  // For Dad/Mum, the colour comes from the parent index — stable hash
  // so the first parent gets dad-blue and the second gets mum-rose
  // without us guessing which is which. The Shared option always uses
  // the muted slate tone.
  const palette = tone === 'shared'
    ? { fg: '#6E7A98', bg: '#E5E7EE', border: '#6E7A98' }
    : paletteForUid(uid || '');
  const style = selected
    ? {
        background: palette.bg,
        color: palette.fg,
        borderColor: palette.border,
        boxShadow: '0 0 0 3px rgba(91, 110, 167, 0.12)',
      }
    : {
        background: 'white',
        color: '#5A6488',
        borderColor: 'rgba(15, 31, 68, 0.12)',
      };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="rounded-xl px-2 py-2 text-[11.5px] font-extrabold text-center border-[1.5px] transition"
      style={style}
    >
      {label}
    </button>
  );
}

// Display name + role-emoji for a parent. Falls back gracefully if
// displayName is empty (rare).
function parentLabel(p: UserProfile): string {
  const name = (p.displayName || p.email || 'Parent').split(' ')[0];
  return `👤 ${name}`;
}

// Stable parent-uid → palette assignment. Same uid → same colour every
// render, even if the parents reorder in the picker.
function paletteForUid(uid: string): { fg: string; bg: string; border: string } {
  // Two palettes, alternated by hash. Extends naturally to a list if
  // we ever support >2 parents.
  const palettes = [
    { fg: '#2E6FA6', bg: '#DAE6F4', border: '#2E6FA6' }, // dad-blue
    { fg: '#C0467A', bg: '#F7DDE9', border: '#C0467A' }, // mum-rose
    { fg: '#1E7873', bg: '#D7F4F1', border: '#1E7873' }, // teal — third parent
  ];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) & 0xffff;
  return palettes[h % palettes.length];
}

// ── Display helpers — exported so list rows + chips can share palette ──

/** The same palette lookup used by the picker — exported for the
 *  filter row + per-row tag chip so colours match end-to-end. */
export function paidByPalette(uid: string | null): { fg: string; bg: string; label: string; emoji: string } {
  if (uid === null) {
    return { fg: '#6E7A98', bg: '#E5E7EE', label: 'Shared', emoji: '👪' };
  }
  const p = paletteForUid(uid);
  return { fg: p.fg, bg: p.bg, label: 'You', emoji: '👤' };
}
