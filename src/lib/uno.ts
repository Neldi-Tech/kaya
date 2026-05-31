// Kaya Games — UNO engine (pure; no React/Firestore). Cards are compact string
// codes so they serialise cleanly into the multi-device game session.
//   Colour cards: <colour><value>   colour ∈ R Y G B
//     value ∈ 0-9 · S skip · R reverse · D draw-two · A skip-everyone (medium+)
//     e.g. 'R5', 'GS', 'BR', 'YD', 'GA'
//   Wilds (no colour): 'W' wild · 'W4' wild draw four · 'WS' wild swap-hands (hard)
//
// Three difficulty levels (chosen by the host) change the deck + rules, and
// pay out more Fun-Points the harder you play:
//   🟢 easy   — classic cards, no stacking
//   🟡 medium — + Skip-Everyone cards, + stack Draw cards (+2/+4) on each other
//   🔴 hard   — all that + Swap-Hands wild cards

export type UnoColor = 'R' | 'Y' | 'G' | 'B';
export type UnoLevel = 'easy' | 'medium' | 'hard';
export const UNO_COLORS: UnoColor[] = ['R', 'Y', 'G', 'B'];

export const UNO_LEVELS: { id: UnoLevel; label: string; emoji: string; blurb: string; funMult: number }[] = [
  { id: 'easy',   label: 'Easy',   emoji: '🟢', blurb: 'Classic cards, relaxed rules', funMult: 1 },
  { id: 'medium', label: 'Medium', emoji: '🟡', blurb: 'Stack Draw cards · Skip-Everyone', funMult: 1.5 },
  { id: 'hard',   label: 'Wild',   emoji: '🔴', blurb: 'All that + Swap-Hands chaos', funMult: 2 },
];

export function isWild(code: string): boolean { return code === 'W' || code === 'W4' || code === 'WS'; }
export function cardColor(code: string): UnoColor | 'W' { return (isWild(code) ? 'W' : code[0]) as UnoColor | 'W'; }
export function cardValue(code: string): string { return isWild(code) ? code : code.slice(1); }

export function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function buildDeck(level: UnoLevel): string[] {
  const deck: string[] = [];
  for (const c of UNO_COLORS) {
    deck.push(`${c}0`);
    for (let n = 1; n <= 9; n++) deck.push(`${c}${n}`, `${c}${n}`);
    for (const a of ['S', 'R', 'D']) deck.push(`${c}${a}`, `${c}${a}`);
    if (level !== 'easy') deck.push(`${c}A`); // Skip-Everyone, one per colour
  }
  for (let i = 0; i < 4; i++) deck.push('W', 'W4');
  if (level === 'hard') deck.push('WS', 'WS', 'WS', 'WS'); // Swap-Hands
  return deck;
}

/** Stacking allowed from medium up (play a Draw card onto a Draw card). */
export const stacks = (level: UnoLevel): boolean => level !== 'easy';

/** The draw-stack kind a card contributes, else null. Same-kind stacking only. */
export function stackKind(code: string): 'd2' | 'd4' | null {
  if (!isWild(code) && cardValue(code) === 'D') return 'd2';
  if (code === 'W4') return 'd4';
  return null;
}

export function canPlay(code: string, activeColor: UnoColor, topValue: string): boolean {
  if (isWild(code)) return true;
  if (cardColor(code) === activeColor) return true;
  return cardValue(code) === topValue && !['W', 'W4', 'WS'].includes(topValue);
}

export interface UnoEffect { reverse: boolean; skip: number; draw: number; wild: boolean; swap: boolean; skipAll: boolean }
export function effectOf(code: string): UnoEffect {
  const base = { reverse: false, skip: 0, draw: 0, wild: false, swap: false, skipAll: false };
  if (code === 'W') return { ...base, wild: true };
  if (code === 'W4') return { ...base, skip: 1, draw: 4, wild: true };
  if (code === 'WS') return { ...base, wild: true, swap: true };
  const v = cardValue(code);
  if (v === 'S') return { ...base, skip: 1 };
  if (v === 'R') return { ...base, reverse: true };
  if (v === 'D') return { ...base, skip: 1, draw: 2 };
  if (v === 'A') return { ...base, skipAll: true };
  return base;
}

/** Deal n cards each; flip the first plain number card as the starting discard. */
export function dealGame(uids: string[], level: UnoLevel, n = 7): {
  hands: Record<string, string[]>; draw: string[]; discard: string; activeColor: UnoColor;
} {
  const deck = shuffle(buildDeck(level));
  const hands: Record<string, string[]> = {};
  for (const uid of uids) hands[uid] = deck.splice(0, n);
  let idx = deck.findIndex((c) => !isWild(c) && !['S', 'R', 'D', 'A'].includes(cardValue(c)));
  if (idx < 0) idx = 0;
  const discard = deck.splice(idx, 1)[0];
  const activeColor = (cardColor(discard) === 'W' ? 'R' : cardColor(discard)) as UnoColor;
  return { hands, draw: deck, discard, activeColor };
}

/** Pull `count` cards off the draw pile, refilling from a fresh shuffled deck if
 *  it runs dry (casual variant — keeps a long family game from ever stalling). */
export function drawCards(draw: string[], count: number, level: UnoLevel): { cards: string[]; rest: string[] } {
  let pile = draw;
  const cards: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pile.length === 0) pile = shuffle(buildDeck(level));
    cards.push(pile[0]);
    pile = pile.slice(1);
  }
  return { cards, rest: pile };
}

export function advance(turn: number, dir: 1 | -1, n: number, steps = 1): number {
  return (((turn + dir * steps) % n) + n) % n;
}

/** Centre glyph for rendering a card. */
export function cardGlyph(code: string): string {
  if (code === 'W') return '🌈';
  if (code === 'W4') return '+4';
  if (code === 'WS') return '🔄';
  const v = cardValue(code);
  if (v === 'S') return '⊘';
  if (v === 'R') return '⇄';
  if (v === 'D') return '+2';
  if (v === 'A') return '🚫';
  return v;
}

export const UNO_HEX: Record<string, string> = {
  R: '#FF6B6B', Y: '#FFC93C', G: '#2DD4BF', B: '#4F86F7', W: '#1A1240',
};
/** Yellow needs dark ink for contrast. */
export function cardInk(color: UnoColor | 'W'): string { return color === 'Y' ? '#7a5a00' : '#fff'; }
