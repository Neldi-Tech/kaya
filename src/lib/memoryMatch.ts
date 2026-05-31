// Kaya Games — Memory Match deck (pure; shared by the solo/duo game AND the
// multi-device game, so both phones see the SAME shuffled board).

export interface MemoryCard { key: number; emoji: string }

export const MEMORY_DECK = ['🦁', '🐼', '🦊', '🐸', '🐙', '🦄'];

export function shuffledDeck(): MemoryCard[] {
  const cards = MEMORY_DECK.flatMap((e, i) => [
    { key: i * 2, emoji: e },
    { key: i * 2 + 1, emoji: e },
  ]);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
