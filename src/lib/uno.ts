// Kaya Games — UNO engine (pure; no React/Firestore). Cards are compact string
// codes so they serialise cleanly into the multi-device game session.
//   Colour cards: <colour><value>   colour ∈ R Y G B,  value ∈ 0-9 S R D
//     e.g. 'R5' red 5, 'GS' green skip, 'BR' blue reverse, 'YD' yellow draw-two
//   Wilds (no colour): 'W' wild, 'W4' wild draw four
// Kid-simple rules: no +2/+4 stacking, no +4 challenge, single round.

export type UnoColor = 'R' | 'Y' | 'G' | 'B';
export const UNO_COLORS: UnoColor[] = ['R', 'Y', 'G', 'B'];

export function isWild(code: string): boolean { return code === 'W' || code === 'W4'; }
export function cardColor(code: string): UnoColor | 'W' { return (isWild(code) ? 'W' : code[0]) as UnoColor | 'W'; }
export function cardValue(code: string): string { return isWild(code) ? code : code.slice(1); }

export function buildDeck(): string[] {
  const deck: string[] = [];
  for (const c of UNO_COLORS) {
    deck.push(`${c}0`);
    for (let n = 1; n <= 9; n++) deck.push(`${c}${n}`, `${c}${n}`);
    for (const a of ['S', 'R', 'D']) deck.push(`${c}${a}`, `${c}${a}`);
  }
  for (let i = 0; i < 4; i++) deck.push('W', 'W4');
  return deck; // 108 cards
}

export function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Can `code` be played given the active colour + the top card's value? */
export function canPlay(code: string, activeColor: UnoColor, topValue: string): boolean {
  if (isWild(code)) return true;
  if (cardColor(code) === activeColor) return true;
  return cardValue(code) === topValue && topValue !== 'W' && topValue !== 'W4';
}

export interface UnoEffect { reverse: boolean; skip: number; draw: number; wild: boolean }
export function effectOf(code: string): UnoEffect {
  if (code === 'W') return { reverse: false, skip: 0, draw: 0, wild: true };
  if (code === 'W4') return { reverse: false, skip: 1, draw: 4, wild: true };
  const v = cardValue(code);
  if (v === 'S') return { reverse: false, skip: 1, draw: 0, wild: false };
  if (v === 'R') return { reverse: true, skip: 0, draw: 0, wild: false };
  if (v === 'D') return { reverse: false, skip: 1, draw: 2, wild: false };
  return { reverse: false, skip: 0, draw: 0, wild: false };
}

/** Deal n cards each; flip the first plain number card as the starting discard. */
export function dealGame(uids: string[], n = 7): {
  hands: Record<string, string[]>; draw: string[]; discard: string; activeColor: UnoColor;
} {
  const deck = shuffle(buildDeck());
  const hands: Record<string, string[]> = {};
  for (const uid of uids) hands[uid] = deck.splice(0, n);
  let idx = deck.findIndex((c) => !isWild(c) && !['S', 'R', 'D'].includes(cardValue(c)));
  if (idx < 0) idx = 0;
  const discard = deck.splice(idx, 1)[0];
  const activeColor = (cardColor(discard) === 'W' ? 'R' : cardColor(discard)) as UnoColor;
  return { hands, draw: deck, discard, activeColor };
}

/** Pull `count` cards off the draw pile, refilling from a fresh shuffled deck if
 *  it runs dry (casual variant — keeps a long family game from ever stalling). */
export function drawCards(draw: string[], count: number): { cards: string[]; rest: string[] } {
  let pile = draw;
  const cards: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pile.length === 0) pile = shuffle(buildDeck());
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
  const v = cardValue(code);
  if (v === 'S') return '⊘';
  if (v === 'R') return '⇄';
  if (v === 'D') return '+2';
  return v;
}

export const UNO_HEX: Record<string, string> = {
  R: '#FF6B6B', Y: '#FFC93C', G: '#2DD4BF', B: '#4F86F7', W: '#1A1240',
};
/** Yellow needs dark ink for contrast. */
export function cardInk(color: UnoColor | 'W'): string { return color === 'Y' ? '#7a5a00' : '#fff'; }
