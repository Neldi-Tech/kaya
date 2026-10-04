'use client';

// Kaya Sparks · 🗄 Cupboard — "who was in?" for the Game Shelf.
//
// Everyone can be picked: the family's grown-ups (every parent + active
// helpers), the children, and remembered guests — relatives and friends.
// "＋ Add someone" adds a new guest by name; the gateway remembers it for
// next time (cupboardSettings.guests).

import { useState } from 'react';

import { JADE, inputCls } from './CupboardShell';

export { familyPeople, type Person } from '@/lib/sparks/cupboardPeople';
import type { Person } from '@/lib/sparks/cupboardPeople';

export default function CupboardPeoplePicker({ people, value, onToggle, onAddGuest }: {
  people: Person[];
  value: Set<string>;
  onToggle: (id: string) => void;
  /** Adds (and selects) a relative/friend by name. */
  onAddGuest: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onAddGuest(n.slice(0, 40));
    setName(''); setAdding(false);
  };
  const chip = (p: Person) => (
    <button key={p.id} type="button" onClick={() => onToggle(p.id)}
      className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44]"
      style={value.has(p.id) ? { background: JADE, color: '#fff', borderColor: JADE } : undefined}>
      {p.emoji} {p.label}
    </button>
  );
  const groups: Array<[string, Person[]]> = [
    ['Grown-ups', people.filter((p) => p.kind === 'grownup')],
    ['Children', people.filter((p) => p.kind === 'kid')],
    ['Relatives & friends', people.filter((p) => p.kind === 'guest')],
  ];
  return (
    <div>
      {groups.filter(([, g]) => g.length > 0).map(([label, g]) => (
        <div key={label} className="mb-1.5">
          <div className="text-[9.5px] font-extrabold tracking-[.5px] uppercase text-[#8A8471] mb-1">{label}</div>
          <div className="flex flex-wrap gap-1.5">{g.map(chip)}</div>
        </div>
      ))}
      {adding ? (
        <div className="flex gap-1.5 mt-1">
          <input className={inputCls} autoFocus value={name} maxLength={40} placeholder="e.g. Grandma Rose, cousin Amani"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" onClick={add} disabled={!name.trim()} className="px-3 rounded-full text-[11px] font-extrabold text-white disabled:opacity-50" style={{ background: JADE }}>Add</button>
          <button type="button" onClick={() => { setAdding(false); setName(''); }} className="px-2 text-[11px] font-extrabold text-[#5B6B8C]">✕</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-1 text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-dashed border-[#BFE3D8] bg-white" style={{ color: JADE }}>
          ＋ Add someone (relative or friend)
        </button>
      )}
    </div>
  );
}
