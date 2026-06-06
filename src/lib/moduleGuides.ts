// Kaya Module Guides — the data + tiny launcher behind the in-app "how it
// works" guides. A guide plays like a short video (auto-advancing scenes with
// optional voiceover) but is built from the live app, so it never goes stale.
//
// Fully bilingual: scene copy + titles + blurbs are Localized (see lib/i18n);
// the player resolves them with useLocale() and falls back to English. Scene
// VISUAL micro-labels (flow/grid chips) stay English in v1 — the narration +
// captions + chrome carry the language.
//
// Homes (all powered by this one registry):
//   • KayaGuide FAB  → "▶ Show me how this works" for the current screen
//   • Videos module  → the browseable "Guides & Videos" library
//   • A ▶ pill on each module page
// Launch from anywhere with openModuleGuide(moduleId); GuideHost (mounted in
// the app layout) listens and renders the player.

import type { Localized } from './i18n';

export type GuideSceneVisual =
  | { kind: 'hero'; emoji: string }
  | { kind: 'flow'; steps: { emoji: string; label: string }[] }
  | { kind: 'grid'; items: { emoji: string; label: string }[] }
  | { kind: 'pair'; items: { emoji: string; label: string; sub: string }[] }
  | { kind: 'budget'; label: string; pct: number; note: string }
  | { kind: 'screen'; screen: 'purchases'; highlight: 'new' | 'basket' | 'submit' | 'pending' | 'reconcile' };

export interface GuideScene {
  visual: GuideSceneVisual;
  title: Localized;
  body: Localized;
  /** Optional role-aware override shown to helpers instead of `body`. */
  bodyHelper?: Localized;
}

export interface ModuleGuide {
  id: string;
  title: Localized;
  emoji: string;
  blurb: Localized;
  paths: string[];
  ctaLabel?: Localized;
  ctaHref?: string;
  scenes: GuideScene[];
  available: boolean;
  deeperGuideId?: string;
  parentId?: string;
}

// ── Household ──────────────────────────────────────────────────────────────
const HOUSEHOLD_GUIDE: ModuleGuide = {
  id: 'household',
  title: { en: 'Household', sw: 'Household' },
  emoji: '🏡',
  blurb: { en: 'Your family’s money out — log, approve, reconcile.', sw: 'Pesa za nyumbani — andika, idhinisha, linganisha.' },
  paths: ['/household', '/pantry'],
  ctaLabel: { en: 'Open Purchases', sw: 'Fungua Purchases' },
  ctaHref: '/pantry/purchase',
  available: true,
  deeperGuideId: 'purchases',
  scenes: [
    {
      visual: { kind: 'hero', emoji: '🏡' },
      title: { en: 'Welcome to Household', sw: 'Karibu kwenye Household' },
      body: {
        en: 'This is where your family’s money out lives — calm, in one place. Every shilling that leaves the home, tracked.',
        sw: 'Hapa ndipo matumizi yote ya familia yako hukaa — kwa utulivu, sehemu moja. Kila shilingi inayotoka nyumbani, hufuatiliwa.',
      },
    },
    {
      visual: { kind: 'flow', steps: [{ emoji: '✍️', label: 'Log' }, { emoji: '✅', label: 'Approve' }, { emoji: '📊', label: 'Done' }] },
      title: { en: 'One simple loop', sw: 'Mzunguko mmoja rahisi' },
      body: {
        en: 'Someone logs a spend, a parent taps yes, and it’s reconciled against your budget. Log, approve, done.',
        sw: 'Mtu huandika matumizi, mzazi hubonyeza ndiyo, na yanalinganishwa na bajeti yenu. Andika, idhinisha, imekwisha.',
      },
      bodyHelper: {
        en: 'You log a spend within your scope, a parent approves it, and it’s reconciled against the budget. Log, approve, done.',
        sw: 'Wewe huandika matumizi ndani ya mipaka yako, mzazi huidhinisha, na yanalinganishwa na bajeti. Andika, idhinisha, imekwisha.',
      },
    },
    {
      visual: { kind: 'grid', items: [
        { emoji: '🧾', label: 'Purchases' }, { emoji: '⚡', label: 'Utilities' }, { emoji: '🌿', label: 'Outdoor' },
        { emoji: '🚗', label: 'Drivers' }, { emoji: '🍽️', label: 'Dine Out' }, { emoji: '🛋️', label: 'Home' },
      ] },
      title: { en: 'Everyday spending', sw: 'Matumizi ya kila siku' },
      body: {
        en: 'Groceries, power and water, the garden, the car, eating out, the home itself — each has its own tidy place.',
        sw: 'Vyakula, umeme na maji, bustani, gari, kula nje, na nyumba yenyewe — kila kimoja kina sehemu yake nadhifu.',
      },
    },
    {
      visual: { kind: 'pair', items: [
        { emoji: '🤝', label: 'Payroll', sub: 'Helpers request privately' },
        { emoji: '🤲', label: 'Contributions', sub: 'Gifts · tithe · msiba' },
      ] },
      title: { en: 'People & giving', sw: 'Watu na utoaji' },
      body: {
        en: 'Payroll lets each helper request their own advance, privately. Contributions tracks gifts, tithe, msiba and charity.',
        sw: 'Payroll huruhusu kila msaidizi kuomba malipo yake ya awali, kwa faragha. Contributions hufuatilia zawadi, sadaka, misiba na hisani.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🔁' },
      title: { en: 'Recurring, handled', sw: 'Za kujirudia, zimepangwa' },
      body: {
        en: 'Subscriptions remembers every repeating bill — apps, memberships, property dues — so you never miss or overpay one.',
        sw: 'Subscriptions hukumbuka kila bili inayojirudia — programu, uanachama, ada za mali — ili usisahau wala kulipa zaidi.',
      },
    },
    {
      visual: { kind: 'budget', label: 'This month’s budget', pct: 62, note: 'on track ✅' },
      title: { en: 'Stay on budget', sw: 'Baki kwenye bajeti' },
      body: {
        en: 'Finances shows what’s left this month at a glance, so the family always knows if you’re on track.',
        sw: 'Finances huonyesha kilichobaki mwezi huu kwa haraka, ili familia ijue daima kama mko kwenye mstari.',
      },
    },
    {
      visual: { kind: 'hero', emoji: '🎉' },
      title: { en: 'You’re ready!', sw: 'Uko tayari!' },
      body: {
        en: 'Best first step — open Purchases and log one thing you bought today. You’ll feel the loop in ten seconds.',
        sw: 'Hatua bora ya kwanza — fungua Purchases na uandike kitu kimoja ulichonunua leo. Utahisi mzunguko ndani ya sekunde kumi.',
      },
    },
  ],
};

// ── Purchases · "how it flows" (deep walk-through of the request loop) ───────
const PURCHASES_FLOW: ModuleGuide = {
  id: 'purchases',
  title: { en: 'Purchases — how it flows', sw: 'Purchases — jinsi inavyofanya kazi' },
  emoji: '🧾',
  blurb: { en: 'The full request loop, step by step.', sw: 'Mzunguko kamili wa ombi, hatua kwa hatua.' },
  paths: ['/pantry/purchase'],
  parentId: 'household',
  ctaLabel: { en: 'Open Purchases', sw: 'Fungua Purchases' },
  ctaHref: '/pantry/purchase',
  available: true,
  scenes: [
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'new' },
      title: { en: 'Start a shop run', sw: 'Anza ununuzi' },
      body: {
        en: 'Tap ＋ New request. Kaya opens a fresh draft and names it for you, like PAN-1042.',
        sw: 'Bonyeza ＋ New request. Kaya hufungua rasimu mpya na kuipa jina, kama PAN-1042.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'basket' },
      title: { en: 'Add what you’re buying', sw: 'Ongeza unachonunua' },
      body: {
        en: 'List each item and its amount. Re-buy your regulars in one tap with Recycle.',
        sw: 'Orodhesha kila kitu na kiasi chake. Nunua tena vitu vya kawaida kwa mbonyezo mmoja kwa Recycle.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'submit' },
      title: { en: 'Send it for approval', sw: 'Tuma kwa idhini' },
      body: {
        en: 'Done shopping? Submit. The total locks in your currency and it heads off.',
        sw: 'Umemaliza kununua? Tuma. Jumla hufungwa kwa sarafu yako na huondoka.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'pending' },
      title: { en: 'Approval', sw: 'Idhini' },
      body: {
        en: 'It lands in your Approvals as pending — tap approve, or reject with a note.',
        sw: 'Inafika kwenye Approvals zako ikiwa inasubiri — bonyeza idhinisha, au kataa kwa maelezo.',
      },
      bodyHelper: {
        en: 'It goes to a parent’s Approvals — they approve or reject, and you get notified.',
        sw: 'Inakwenda kwenye Approvals za mzazi — yeye huidhinisha au kukataa, nawe hupewa taarifa.',
      },
    },
    {
      visual: { kind: 'screen', screen: 'purchases', highlight: 'reconcile' },
      title: { en: 'Reconcile & close', sw: 'Linganisha na funga' },
      body: {
        en: 'Once approved, reconcile it against the budget before the timer ends. That’s the full loop! 🎉',
        sw: 'Baada ya kuidhinishwa, linganisha na bajeti kabla ya muda kuisha. Huo ndio mzunguko kamili! 🎉',
      },
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────
// `available: false` entries appear in the library as "Coming soon".
export const MODULE_GUIDES: ModuleGuide[] = [
  HOUSEHOLD_GUIDE,
  PURCHASES_FLOW,
  { id: 'hive', title: { en: 'The Hive' }, emoji: '🐝', blurb: { en: 'Points → Honey → real cash.' }, paths: ['/hive'], scenes: [], available: false },
  { id: 'games', title: { en: 'Kaya Games' }, emoji: '🎮', blurb: { en: 'Play, earn House Points, stay safe.' }, paths: ['/games'], scenes: [], available: false },
  { id: 'wealth', title: { en: 'Kaya Wealth' }, emoji: '💎', blurb: { en: 'The family vault & investments.' }, paths: ['/wealth'], scenes: [], available: false },
];

export function getGuide(id: string | null | undefined): ModuleGuide | undefined {
  if (!id) return undefined;
  return MODULE_GUIDES.find((g) => g.id === id);
}

/** The guide whose module owns this route (for the FAB's contextual offer).
 *  Prefers the MOST specific match, so /pantry/purchase offers the Purchases
 *  flow rather than the broader Household overview. */
export function guideForPath(pathname: string | null | undefined): ModuleGuide | undefined {
  if (!pathname) return undefined;
  let best: ModuleGuide | undefined;
  let bestLen = -1;
  for (const g of MODULE_GUIDES) {
    if (!g.available) continue;
    for (const p of g.paths) {
      if ((pathname === p || pathname.startsWith(p + '/')) && p.length > bestLen) { best = g; bestLen = p.length; }
    }
  }
  return best;
}

export const GUIDE_EVENT = 'kaya:open-guide';

/** Open a module guide from anywhere (the GuideHost in the app layout listens). */
export function openModuleGuide(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: { id } }));
}

// ── Watched state (Phase 1: local to the device; Firestore sync is a
//    fast-follow so the ✓ travels across devices) ──────────────────────────
const WATCHED_KEY = 'kaya:guidesWatched';
export function markGuideWatched(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const set = new Set<string>(JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]'));
    set.add(id);
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...set]));
  } catch { /* storage blocked — watched state is non-critical */ }
}
export function isGuideWatched(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]') as string[]).includes(id);
  } catch { return false; }
}
