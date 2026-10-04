// Kaya Sparks · 🗄 Cupboard — everyone who can be picked for "who was in?"
// (pure; tested by qa/cupboardPeople.test.ts).

import type { CupboardShelf } from './cupboard';

/** A guest (relative / friend) person id. */
export const guestId = (name: string) => `g:${name.trim().slice(0, 40)}`;

export interface Person { id: string; label: string; emoji: string; age?: number; kind: 'grownup' | 'kid' | 'guest' }

const firstName = (n: string) => n.split(' ')[0];

/** Everyone the family picks from by default: parents and children, plus
 *  remembered relatives & friends. Helpers stay OFF the list — they're
 *  offered only when you tap "＋ Add someone" (`helperOptions`) — except the
 *  helper looking at the screen, and any helper already added (`addedIds`). */
export function familyPeople(
  shelf: Pick<CupboardShelf, 'members' | 'kids' | 'settings'>,
  extraGuests: string[] = [],
  addedIds: string[] = [],
): Person[] {
  const list: Person[] = [];
  for (const m of shelf.members ?? []) {
    if (m.role !== 'parent') continue;
    list.push({ id: m.id, label: `${firstName(m.name)}${m.isMe ? ' (you)' : ''}`, emoji: m.emoji, kind: 'grownup' });
  }
  for (const k of shelf.kids) list.push({ id: k.id, label: firstName(k.name), emoji: k.emoji, age: k.age, kind: 'kid' });
  for (const m of shelf.members ?? []) {
    if (m.role === 'helper' && (m.isMe || addedIds.includes(m.id))) {
      list.push({ id: m.id, label: `${firstName(m.name)}${m.isMe ? ' (you)' : ''}`, emoji: m.emoji, kind: 'guest' });
    }
  }
  const seen = new Set<string>();
  for (const g of [...(shelf.settings.guests ?? []), ...extraGuests]) {
    const key = g.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({ id: guestId(g), label: g.trim(), emoji: '👋', kind: 'guest' });
  }
  return list;
}

/** Helpers you can add from "＋ Add someone" (not already on the list). */
export function helperOptions(
  shelf: Pick<CupboardShelf, 'members'>, addedIds: string[] = [],
): Person[] {
  return (shelf.members ?? [])
    .filter((m) => m.role === 'helper' && !m.isMe && !addedIds.includes(m.id))
    .map((m) => ({ id: m.id, label: firstName(m.name), emoji: m.emoji, kind: 'guest' as const }));
}
