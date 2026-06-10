// Kaya · Birthdays — pure helpers (no firebase imports, usable client + server).
//
// Kaya already stores birthday + gender + interests (+ aspirations) per child,
// and birthday + birthdayPrivacy per adult. These helpers answer "whose
// birthday is it today?", pick a celebration THEME from who the person is, and
// shape the per-day celebration state kept on the FAMILY DOC at
// `family.birthdays[{personId}_{year}]` (written only by the Admin-SDK
// /api/birthdays/* routes — no Firestore-rules change needed; every family
// member already reads the family doc live via useFamily).

export type BirthdayKind = 'kid' | 'adult';

export interface BirthdayPersonSource {
  id: string;                 // childId (kids) | uid (adults)
  kind: BirthdayKind;
  name: string;
  birthday?: string;          // YYYY-MM-DD
  gender?: string;
  interests?: string[];
  aspirations?: string[];
  email?: string;             // kids: login email (loginEnabled)
  privacy?: 'public' | 'partial' | 'private';  // adults only
}

export interface BirthdayPerson extends BirthdayPersonSource {
  /** Age turning today — undefined for adults with partial/unknown privacy. */
  age?: number;
  theme: BirthdayTheme;
  stateKey: string;           // `${id}_${year}`
}

export interface BirthdayWishEntry {
  uid: string;
  name: string;
  text: string;
  at: number;                 // epoch ms (admin route stamps Date.now())
}

/** Per-person per-day celebration state on the family doc. */
export interface BirthdayDayState {
  name: string;
  age?: number;
  themeId: string;
  kickoffAt?: number;         // chat post + emails fired (epoch ms)
  wishes?: BirthdayWishEntry[];
  dropAt?: number;            // B3: birthday gift dropped
  noChores?: boolean;         // B3: parent toggle
  blownOutAt?: number;        // B2: candles blown out
}

// ── Date math (LOCAL time — Kaya families are worldwide) ─────────────

/** Local YYYY-MM-DD of `now`. */
export function localDayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** True when `birthday` (YYYY-MM-DD) has the same month+day as `now` (local). */
export function isBirthdayToday(birthday: string | undefined, now: Date = new Date()): boolean {
  if (!birthday) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return false;
  return Number(m[2]) === now.getMonth() + 1 && Number(m[3]) === now.getDate();
}

/** Age turning on today's birthday (local years). */
export function ageTurningToday(birthday: string, now: Date = new Date()): number {
  const y = Number(birthday.slice(0, 4));
  return y > 1900 ? now.getFullYear() - y : 0;
}

// ── Themes — picked from gender + interests/aspirations ──────────────

export interface BirthdayTheme {
  id: 'champion' | 'artist' | 'explorer' | 'gold' | 'elegant';
  label: string;
  emoji: string;
  /** CSS gradient stops for banners/takeover. */
  from: string;
  to: string;
  accent: string;             // chip/CTA color on the gradient
  /** One-tap wish chips, personalised to the theme. */
  quickWishes: string[];
}

const THEMES: Record<BirthdayTheme['id'], BirthdayTheme> = {
  champion: {
    id: 'champion', label: 'Champion', emoji: '⚽',
    from: '#0F1F44', to: '#1E7A46', accent: '#FBE38E',
    quickWishes: ['Happy birthday champ! ⚽🎂', 'Have a winning day! 🏆', 'Score big today! 🥳'],
  },
  artist: {
    id: 'artist', label: 'Artist', emoji: '🎨',
    from: '#C2588F', to: '#F7A8C4', accent: '#FFF3D9',
    quickWishes: ['Happy birthday, superstar! 🎨🎂', 'Paint the day happy! 🌈', 'You make life colourful! 🥳'],
  },
  explorer: {
    id: 'explorer', label: 'Explorer', emoji: '🚀',
    from: '#10142E', to: '#3F2E7E', accent: '#9AD0EC',
    quickWishes: ['Happy birthday, explorer! 🚀🎂', 'To the stars today! ✨', 'Adventure awaits! 🥳'],
  },
  gold: {
    id: 'gold', label: 'Kaya Gold', emoji: '🌟',
    from: '#B8860B', to: '#F39C2F', accent: '#FFF8EC',
    quickWishes: ['Happy birthday! 🌟🎂', 'Shine bright today! ✨', 'Best day ever! 🥳'],
  },
  elegant: {
    id: 'elegant', label: 'Elegant', emoji: '🥂',
    from: '#1F2D3D', to: '#54420F', accent: '#FCD9A0',
    quickWishes: ['Happy birthday! 🥂', 'Wishing you a wonderful year ahead 🎉', 'Celebrating you today! 🎂'],
  },
};

const THEME_KEYWORDS: Array<{ id: BirthdayTheme['id']; words: RegExp }> = [
  { id: 'champion', words: /football|soccer|sport|basketball|tennis|swim|run|athlet|rugby|cricket/i },
  { id: 'artist',   words: /art|draw|paint|craft|music|sing|dance|design|fashion/i },
  { id: 'explorer', words: /space|rocket|science|robot|dino|animal|nature|adventure|pilot|astronaut|engineer/i },
];

/** Pick the celebration theme. Adults always get Elegant; kids match their
 *  interests/aspirations, falling back to warm Kaya Gold. */
export function themeFor(p: Pick<BirthdayPersonSource, 'kind' | 'interests' | 'aspirations'>): BirthdayTheme {
  if (p.kind === 'adult') return THEMES.elegant;
  const hay = [...(p.interests || []), ...(p.aspirations || [])].join(' ');
  for (const { id, words } of THEME_KEYWORDS) if (words.test(hay)) return THEMES[id];
  return THEMES.gold;
}

export function themeById(id: string | undefined): BirthdayTheme {
  return (id && (THEMES as Record<string, BirthdayTheme>)[id]) || THEMES.gold;
}

// ── Who's celebrating today ──────────────────────────────────────────

export function birthdayStateKey(personId: string, now: Date = new Date()): string {
  return `${personId}_${now.getFullYear()}`;
}

/** Today's birthday people from raw sources. Adults with privacy 'private'
 *  are skipped; 'partial' celebrates without the age. */
export function todaysBirthdays(sources: BirthdayPersonSource[], now: Date = new Date()): BirthdayPerson[] {
  const out: BirthdayPerson[] = [];
  for (const s of sources) {
    if (!isBirthdayToday(s.birthday, now)) continue;
    if (s.kind === 'adult' && s.privacy === 'private') continue;
    const showAge = s.kind === 'kid' || s.privacy === 'public';
    out.push({
      ...s,
      age: showAge && s.birthday ? ageTurningToday(s.birthday, now) || undefined : undefined,
      theme: themeFor(s),
      stateKey: birthdayStateKey(s.id, now),
    });
  }
  return out;
}

/** Ordinal: 11 → "11th". */
export function ordinalAge(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
