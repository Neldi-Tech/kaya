// 🐝 The canonical Hive glossary (HIVE PR3, approved design v2 · D1).
//
// ONE set of kid-voice definitions, reused VERBATIM everywhere a term
// appears — the meaning sheets, the Wealth card, guides. Defined once,
// shown everywhere: change a word here and the whole app agrees.

export interface GlossaryEntry {
  emoji: string;
  name: string;
  def: string;
}

export const HIVE_GLOSSARY: Record<'hive' | 'money' | 'business' | 'wealth' | 'pot', GlossaryEntry> = {
  hive: {
    emoji: '🐝',
    name: 'The Hive',
    def: 'Your whole money world: earn ⭐ House Points → turn them into 🪙 Coins → 🍯 Honey Pot — real money you spend with a parent’s OK.',
  },
  money: {
    emoji: '💵',
    name: 'Money (A)',
    def: 'Everything you hold right now: your HP’s value + Coins + Honey Pot + Cash.',
  },
  business: {
    emoji: '🏪',
    name: 'Business (B)',
    def: 'What your business owns: your stock’s value + the business’s own money. Selling grows it.',
  },
  wealth: {
    emoji: '💎',
    name: 'Wealth',
    def: 'Money + Business. Everything you’ve built.',
  },
  pot: {
    emoji: '🍯',
    name: 'Honey Pot',
    def: 'Your spending money — earnings, sales and Coins land here. Spend straight from it (a parent says yes).',
  },
};
