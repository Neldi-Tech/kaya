// Traditional wedding anniversary milestones — each year has a symbolic
// material (and a few emoji we surface in the UI). Used by the Family Tree
// and parent profile to make the countdown feel meaningful:
//
//   "120 days to celebrating 🥫 Tin (10th year) Anniversary"
//
// Years that don't have a traditional name fall back to a plain
// "120 days to your 17th anniversary".

export interface AnniversaryMilestone {
  year: number;
  name: string;
  emoji: string;
}

// Catalog combines the most widely recognised traditional symbols (UK + US).
// Where regions disagree we picked the entry families are most likely to
// recognise — e.g. 7th = Copper (UK) which the user mentioned.
export const ANNIVERSARY_MILESTONES: AnniversaryMilestone[] = [
  { year: 1,  name: 'Paper',         emoji: '📜' },
  { year: 2,  name: 'Cotton',        emoji: '🧵' },
  { year: 3,  name: 'Leather',       emoji: '👞' },
  { year: 4,  name: 'Fruit & Flowers', emoji: '🌸' },
  { year: 5,  name: 'Wood',          emoji: '🌳' },
  { year: 6,  name: 'Iron',          emoji: '⚙️' },
  { year: 7,  name: 'Copper',        emoji: '🟫' },
  { year: 8,  name: 'Bronze',        emoji: '🥉' },
  { year: 9,  name: 'Pottery',       emoji: '🏺' },
  { year: 10, name: 'Tin',           emoji: '🥫' },
  { year: 11, name: 'Steel',         emoji: '⚒️' },
  { year: 12, name: 'Silk',          emoji: '🧣' },
  { year: 13, name: 'Lace',          emoji: '🪢' },
  { year: 14, name: 'Ivory',         emoji: '🪈' },
  { year: 15, name: 'Crystal',       emoji: '🔮' },
  { year: 20, name: 'China',         emoji: '🍵' },
  { year: 25, name: 'Silver',        emoji: '🥈' },
  { year: 30, name: 'Pearl',         emoji: '🦪' },
  { year: 35, name: 'Coral',         emoji: '🪸' },
  { year: 40, name: 'Ruby',          emoji: '❤️' },
  { year: 45, name: 'Sapphire',      emoji: '💎' },
  { year: 50, name: 'Gold',          emoji: '🥇' },
  { year: 55, name: 'Emerald',       emoji: '💚' },
  { year: 60, name: 'Diamond',       emoji: '💎' },
  { year: 65, name: 'Blue Sapphire', emoji: '🔷' },
  { year: 70, name: 'Platinum',      emoji: '⚪' },
  { year: 75, name: 'Diamond & Gold', emoji: '🏆' },
];

// Returns the named milestone for an exact year — or null if that year isn't
// in the catalog (e.g. the 17th, 18th anniversary aren't traditionally
// named in this list).
export function milestoneForYear(year: number): AnniversaryMilestone | null {
  return ANNIVERSARY_MILESTONES.find((m) => m.year === year) || null;
}

// Returns the next NAMED milestone strictly after the given year — useful
// for "next big one is Silver in 5 years" style messaging.
export function nextNamedMilestone(currentYears: number): AnniversaryMilestone | null {
  return ANNIVERSARY_MILESTONES.find((m) => m.year > currentYears) || null;
}

// English ordinal suffix — "1st", "2nd", "3rd", "10th", "21st"…
export function ordinal(n: number): string {
  const v = n % 100;
  // Special-case 11/12/13 → "th"
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
