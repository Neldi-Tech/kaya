// Kaya Games — Word Sprint racks + checker (pure; shared by the solo game AND
// the multi-device race, so every phone in a race gets the same rack of letters).

export interface WordRack { letters: string; words: string[] }

export const WORD_SPRINT_SECONDS = 60;

export const WORD_RACKS: WordRack[] = [
  { letters: 'TEACHRS', words: ['teach', 'reach', 'chase', 'share', 'cheat', 'trace', 'crate', 'chart', 'char', 'cash', 'rash', 'star', 'arts', 'rats', 'cats', 'cars', 'scar', 'care', 'race', 'rate', 'tear', 'heat', 'hear', 'ear', 'eat', 'tea', 'ate', 'sea', 'set', 'the', 'hat', 'cat', 'car', 'art', 'ash', 'has', 'sat', 'rat', 'tar'] },
  { letters: 'PRINTED', words: ['print', 'tried', 'tired', 'pride', 'diner', 'rind', 'ride', 'ripe', 'pine', 'dine', 'dirt', 'drip', 'trip', 'pint', 'rent', 'nerd', 'tend', 'tin', 'ten', 'pen', 'pet', 'net', 'red', 'rip', 'tip', 'pit', 'dip', 'din', 'end', 'pie', 'tie', 'die', 'pin', 'rid'] },
  { letters: 'STORMED', words: ['stored', 'sorted', 'modest', 'store', 'storm', 'term', 'torn', 'tore', 'rote', 'most', 'dorm', 'rest', 'rode', 'more', 'mode', 'dome', 'dose', 'rose', 'sore', 'rod', 'rot', 'ore', 'toe', 'doe', 'met', 'set', 'red', 'sod', 'dot', 'mod'] },
  { letters: 'BLANKET', words: ['blanket', 'ankle', 'blank', 'table', 'bean', 'lean', 'lent', 'tale', 'late', 'bake', 'lake', 'take', 'bank', 'tank', 'bent', 'teal', 'ten', 'net', 'ant', 'eat', 'ate', 'tea', 'ban', 'bat', 'bet', 'let', 'lab', 'tab', 'ale', 'elk'] },
];

export function canMake(word: string, letters: string): boolean {
  const avail: Record<string, number> = {};
  for (const ch of letters.toUpperCase()) avail[ch] = (avail[ch] || 0) + 1;
  for (const ch of word.toUpperCase()) {
    if (!avail[ch]) return false;
    avail[ch] -= 1;
  }
  return true;
}

export function pickRack(): WordRack {
  return WORD_RACKS[Math.floor(Math.random() * WORD_RACKS.length)];
}

/** Legal lowercase words for a rack (guards against any mis-listed word). */
export function validWords(rack: WordRack): string[] {
  return rack.words.filter((w) => canMake(w, rack.letters)).map((w) => w.toLowerCase());
}
