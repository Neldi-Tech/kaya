// Shared "Who Kaya is for + how you'd use it" copy, rendered on both the
// marketing landing (Audience.tsx, .kaya-mk styles) and the public
// /universe landing (UniverseLanding.tsx, CSS-module styles). Keep the
// arrays as the single source of truth so the two surfaces can't drift.

export type AudienceCard = {
  em: string;
  title: string;
  body: string;
};

export type AudienceUse = {
  em: string;
  strong: string;
  body: string;
};

export const AUDIENCE_CARDS: AudienceCard[] = [
  {
    em: '❤️',
    title: 'Busy two-parent households',
    body: 'Both working. Kids growing. You want to parent on purpose — meetings, character, calm — even when the week is full.',
  },
  {
    em: '💛',
    title: 'Solo parents, holding it together',
    body: 'One adult, all the love. You’re running this household on your own — Kaya gives the gentle structure (without piling on more work).',
  },
  {
    em: '🪺',
    title: 'Guardians + chosen families',
    body: 'Aunties, uncles, grandparents, foster + adoptive families — whoever’s raising the kids. Kaya treats every household the same: same rhythm, same Sunday.',
  },
  {
    em: '🤝',
    title: 'Families with helpers in the loop',
    body: 'Nannies, grandparents, tutors, house staff — everyone who helps raise your kids, on the same shared standards and the same Sunday meeting.',
  },
  {
    em: '🌱',
    title: 'Parents teaching character first, money second',
    body: 'You want kids who say thanks, do hard things, and know what $1 means. Kaya holds points first, money later — same gentle arc.',
  },
  {
    em: '📔',
    title: 'Families who want to remember it',
    body: 'Photos, milestones, the three things noticed on Sunday — saved forever, only seen by your people. The opposite of a public feed.',
  },
];

export const AUDIENCE_USES: AudienceUse[] = [
  { em: '☀️', strong: 'Morning', body: '5 min over coffee: rate today’s wake-up routines.' },
  { em: '🎖️', strong: 'During the day', body: 'a tap or two: catch a kindness, award a point.' },
  { em: '🌙', strong: 'Bedtime', body: '5 min: rate the wind-down, gentle redirect for tomorrow.' },
  { em: '👨‍👩‍👧‍👦', strong: 'Sunday', body: '20 min: three things noticed, two to shape next week.' },
  { em: '📸', strong: 'All week', body: 'drop photos and small wins into Moments; the family circle sees them.' },
  { em: '🤝', strong: 'When helpers are around', body: 'same Kaya rhythm; everyone’s on the same page.' },
];

export const AUDIENCE_EYEBROW = 'Who Kaya is for';
export const AUDIENCE_TITLE = 'Built for the families who want to do this on purpose.';
export const AUDIENCE_LEDE =
  'Kaya is for busy parents who feel the pull to slow down — and for a home where everyone (you, your partner, grandparents, helpers) shares the same gentle rhythm.';
export const AUDIENCE_USES_TITLE = 'A typical week, in five small moments';
