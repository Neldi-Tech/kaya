// Kaya Sparks · 🗄 Cupboard — everyone who can be picked for "who was in?"
// (pure; tested by qa/cupboardPeople.test.ts).

import type { CupboardShelf } from './cupboard';

/** A guest (relative / friend) person id. */
export const guestId = (name: string) => `g:${name.trim().slice(0, 40)}`;

export interface Person { id: string; label: string; emoji: string; age?: number; kind: 'grownup' | 'kid' | 'guest' }

/** Everyone the family can pick, grown-ups first. */
export function familyPeople(shelf: Pick<CupboardShelf, 'members' | 'kids' | 'settings'>, extraGuests: string[] = []): Person[] {
  const list: Person[] = [];
  for (const m of shelf.members ?? []) {
    list.push({ id: m.id, label: `${m.name.split(' ')[0]}${m.isMe ? ' (you)' : ''}`, emoji: m.emoji, kind: 'grownup' });
  }
  for (const k of shelf.kids) list.push({ id: k.id, label: k.name.split(' ')[0], emoji: k.emoji, age: k.age, kind: 'kid' });
  const seen = new Set<string>();
  for (const g of [...(shelf.settings.guests ?? []), ...extraGuests]) {
    const key = g.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({ id: guestId(g), label: g.trim(), emoji: '👋', kind: 'guest' });
  }
  return list;
}

