// Curated overlay for "Major events on this day" — universally inspiring
// innovations, discoveries, firsts and peace milestones.
//
// Wikipedia is the primary source (free, no key) but its full events feed
// also surfaces wars and disasters. This curated layer guarantees a
// kid-friendly inspiring entry on the most famous dates, regardless of
// what the live API returns.
//
// Keys: "MM-DD" zero-padded, e.g. "07-20".
// Source columns:
//   year       — year of the milestone
//   text       — single sentence, kid-friendly framing
//   category   — drives the icon: science/tech/peace/arts/sports/exploration
//   pageUrl    — optional Wikipedia link if a reader wants more

export type InnovationCategory =
  | 'science'
  | 'tech'
  | 'peace'
  | 'arts'
  | 'sports'
  | 'exploration'
  | 'medicine';

export interface CuratedInnovation {
  year: number;
  text: string;
  category: InnovationCategory;
  pageUrl?: string;
}

// Each date can have multiple entries; we surface the strongest one(s) first.
// Curation favours "firsts", peaceful milestones, and breakthroughs that a
// 7-year-old can grasp in one breath.
export const CURATED_INNOVATIONS: Record<string, CuratedInnovation[]> = {
  '01-04': [
    { year: 1643, text: 'Isaac Newton was born — he later figured out gravity and the laws of motion.', category: 'science', pageUrl: 'https://en.wikipedia.org/wiki/Isaac_Newton' },
  ],
  '02-11': [
    { year: 1847, text: 'Thomas Edison was born — he gave the world the practical light bulb and recorded sound.', category: 'tech', pageUrl: 'https://en.wikipedia.org/wiki/Thomas_Edison' },
  ],
  '03-10': [
    { year: 1876, text: 'Alexander Graham Bell made the first ever phone call.', category: 'tech', pageUrl: 'https://en.wikipedia.org/wiki/History_of_the_telephone' },
  ],
  '03-14': [
    { year: 1879, text: 'Albert Einstein was born — Pi Day shares his birthday.', category: 'science', pageUrl: 'https://en.wikipedia.org/wiki/Albert_Einstein' },
  ],
  '04-12': [
    { year: 1961, text: 'Yuri Gagarin became the first human to orbit Earth.', category: 'exploration', pageUrl: 'https://en.wikipedia.org/wiki/Yuri_Gagarin' },
  ],
  '04-15': [
    { year: 1452, text: 'Leonardo da Vinci was born — painter, inventor, scientist all in one.', category: 'arts', pageUrl: 'https://en.wikipedia.org/wiki/Leonardo_da_Vinci' },
  ],
  '05-25': [
    { year: 1961, text: 'President Kennedy committed America to landing a person on the Moon by the end of the decade.', category: 'exploration' },
  ],
  '06-15': [
    { year: 1752, text: 'Benjamin Franklin flew his kite in a storm and proved that lightning is electricity.', category: 'science' },
  ],
  '07-04': [
    { year: 1997, text: 'NASA\'s Pathfinder rover landed on Mars — the first rover on another planet.', category: 'exploration', pageUrl: 'https://en.wikipedia.org/wiki/Mars_Pathfinder' },
  ],
  '07-16': [
    { year: 1969, text: 'Apollo 11 launched — three astronauts heading to the Moon.', category: 'exploration' },
  ],
  '07-20': [
    { year: 1969, text: 'Neil Armstrong and Buzz Aldrin became the first humans to walk on the Moon.', category: 'exploration', pageUrl: 'https://en.wikipedia.org/wiki/Apollo_11' },
  ],
  '07-21': [
    { year: 1969, text: 'After their Moonwalk, Apollo 11 lifted off the lunar surface to head home.', category: 'exploration' },
  ],
  '08-06': [
    { year: 1991, text: 'Tim Berners-Lee published the first ever website — the World Wide Web went public.', category: 'tech', pageUrl: 'https://en.wikipedia.org/wiki/History_of_the_World_Wide_Web' },
  ],
  '08-15': [
    { year: 1947, text: 'India became independent — a peaceful transition led largely by non-violence.', category: 'peace' },
  ],
  '09-09': [
    { year: 1947, text: 'The first computer "bug" — a real moth — was found in the Harvard Mark II computer.', category: 'tech' },
  ],
  '09-17': [
    { year: 1976, text: 'The first space shuttle, Enterprise, was unveiled at NASA.', category: 'exploration' },
  ],
  '10-04': [
    { year: 1957, text: 'The Soviet Union launched Sputnik 1, the first artificial satellite.', category: 'exploration', pageUrl: 'https://en.wikipedia.org/wiki/Sputnik_1' },
  ],
  '10-29': [
    { year: 1969, text: 'The first message ever sent over the internet (then called ARPANET) was transmitted.', category: 'tech' },
  ],
  '11-08': [
    { year: 1895, text: 'Wilhelm Röntgen discovered X-rays — letting doctors see inside us without a single cut.', category: 'medicine' },
  ],
  '12-03': [
    { year: 1967, text: 'The first successful human heart transplant was performed by Dr. Christiaan Barnard.', category: 'medicine' },
  ],
  '12-17': [
    { year: 1903, text: 'The Wright Brothers made the first powered flight at Kitty Hawk.', category: 'tech', pageUrl: 'https://en.wikipedia.org/wiki/Wright_brothers' },
  ],
  '12-25': [
    { year: 1642, text: 'Isaac Newton was born (old calendar) — the apple-and-gravity story belongs to this guy.', category: 'science' },
  ],
};

export const CATEGORY_ICON: Record<InnovationCategory, string> = {
  science: '🔬',
  tech: '💡',
  peace: '🕊️',
  arts: '🎨',
  sports: '🏅',
  exploration: '🚀',
  medicine: '⚕️',
};

export function curatedFor(monthMM: string, dayDD: string): CuratedInnovation[] {
  return CURATED_INNOVATIONS[`${monthMM}-${dayDD}`] || [];
}
