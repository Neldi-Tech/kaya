// First Week (2026-05-30) — shared data + ordering logic for the
// intent question on onboarding Step 4 and the FirstWeekChecklist card
// pinned to Discover. Auto-detected completion from existing Firestore
// writes (ratings / awards / rewards / meetings / posts / invite-code
// usage) — no new flags, no migration.

import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ── Intent — what's drawing the parent to Kaya ───────────────────────
//
// Captured on onboarding Step 4 and stored on UserProfile.firstWeekIntent.
// Drives the order of FIRST_WEEK_ITEMS so the parent's "why" sits at
// position 1 of the checklist.

export type FirstWeekIntent =
  | 'character'
  | 'routines'
  | 'helpers'
  | 'money'
  | 'memory';

export type FirstWeekIntentOption = {
  id: FirstWeekIntent;
  emoji: string;
  label: string;
  blurb: string;
};

export const FIRST_WEEK_INTENTS: FirstWeekIntentOption[] = [
  {
    id: 'character',
    emoji: '🎖️',
    label: 'Character + Sunday meetings',
    blurb: 'The calm rhythm. Notice the good. Plan the week together.',
  },
  {
    id: 'routines',
    emoji: '🏠',
    label: 'Daily routines + chores',
    blurb: 'Get the week sorted. Less nagging, more rhythm.',
  },
  {
    id: 'helpers',
    emoji: '🤝',
    label: 'Coordinating helpers',
    blurb: 'Nannies, grandparents, the other parent — everyone on the same page.',
  },
  {
    id: 'money',
    emoji: '🍯',
    label: 'Teaching money habits',
    blurb: 'Points → Honey Coins → real money. With your approval.',
  },
  {
    id: 'memory',
    emoji: '📔',
    label: 'Memory + closeness',
    blurb: 'Moments + Sunday meetings — the family record that lasts.',
  },
];

// ── Checklist items ──────────────────────────────────────────────────

export type FirstWeekItemId =
  | 'rate'
  | 'award'
  | 'reward'
  | 'meeting'
  | 'invite'
  | 'moment';

export type FirstWeekItem = {
  id: FirstWeekItemId;
  emoji: string;
  label: string;
  hint: string;
  cta: string;
  href: string;
};

export const FIRST_WEEK_ITEMS: FirstWeekItem[] = [
  {
    id: 'rate',
    emoji: '📋',
    label: "Rate today's routines",
    hint: '5 minutes over coffee — the gentle daily tap that starts everything.',
    cta: 'Start',
    href: '/rate',
  },
  {
    id: 'award',
    emoji: '🎖️',
    label: 'Award a kindness',
    hint: 'Catch something good. The kids notice you noticing.',
    cta: 'Try it',
    href: '/award',
  },
  {
    id: 'reward',
    emoji: '🎁',
    label: 'Set up your first reward',
    hint: 'What can kids earn? One small thing — ice cream, extra story, sleepover.',
    cta: 'Add',
    href: '/parent/rewards?wizard=1',
  },
  {
    id: 'meeting',
    emoji: '👨‍👩‍👧‍👦',
    label: 'Plan your first Sunday meeting',
    hint: '20 minutes · three things noticed, two to shape. The anchor habit.',
    cta: 'Plan',
    href: '/meetings',
  },
  {
    id: 'invite',
    emoji: '🤝',
    label: 'Invite the other parent or a helper',
    hint: 'Send a code. Everyone on the same gentle rhythm.',
    cta: 'Get code',
    href: '/settings',
  },
  {
    id: 'moment',
    emoji: '📸',
    label: 'Add a Moment',
    hint: 'Drop a photo. Only your people see it.',
    cta: 'Add',
    href: '/moments/new',
  },
];

// Which item is "your pick" when the parent picked each intent.
const PRIMARY_FOR_INTENT: Record<FirstWeekIntent, FirstWeekItemId> = {
  character: 'award',
  routines: 'rate',
  helpers: 'invite',
  money: 'reward',
  memory: 'moment',
};

/**
 * Re-order the six items so the intent's primary item sits at position 0;
 * the rest keep their canonical order. With no intent, returns the canonical
 * default.
 */
export function orderItemsByIntent(
  intent: FirstWeekIntent | null | undefined,
): FirstWeekItem[] {
  if (!intent) return FIRST_WEEK_ITEMS;
  const primaryId = PRIMARY_FOR_INTENT[intent];
  const primary = FIRST_WEEK_ITEMS.find((i) => i.id === primaryId);
  if (!primary) return FIRST_WEEK_ITEMS;
  const rest = FIRST_WEEK_ITEMS.filter((i) => i.id !== primaryId);
  return [primary, ...rest];
}

/** Which item is "your pick" for the honey badge in the UI. */
export function primaryItemForIntent(
  intent: FirstWeekIntent | null | undefined,
): FirstWeekItemId | null {
  if (!intent) return null;
  return PRIMARY_FOR_INTENT[intent];
}

// ── Completion detection — auto, from existing Firestore writes ──────

export type FirstWeekProgress = Record<FirstWeekItemId, boolean>;

export const EMPTY_PROGRESS: FirstWeekProgress = {
  rate: false,
  award: false,
  reward: false,
  meeting: false,
  invite: false,
  moment: false,
};

// "Does ANY doc exist in `families/{id}/{sub}`?" — limit(1) so this is
// one read per check; falls through to false on permission denied so
// the row simply shows as pending.
async function hasAny(familyId: string, sub: string): Promise<boolean> {
  try {
    const snap = await getDocs(
      query(collection(db, 'families', familyId, sub), limit(1)),
    );
    return !snap.empty;
  } catch {
    return false;
  }
}

// "Invite the co-adult" is ✓ once at least one of the family's invite
// codes has been used (the joiner accepted it). Driven by the family
// doc we already read on Discover — no extra read.
type InviteCodeShape =
  | string
  | { usedAt?: { toMillis?: () => number } | null }
  | undefined;
type FamilyForInvite = { inviteCodes?: Record<string, InviteCodeShape> };

export function inviteUsed(family: FamilyForInvite | null | undefined): boolean {
  const codes = family?.inviteCodes ?? {};
  for (const value of Object.values(codes)) {
    if (!value || typeof value === 'string') continue;
    if (value.usedAt) return true;
  }
  return false;
}

/**
 * Read each item's completion in parallel. Pass the in-memory family
 * doc so the invite check needs no extra read.
 */
export async function readFirstWeekProgress(
  familyId: string,
  family: FamilyForInvite | null | undefined,
): Promise<FirstWeekProgress> {
  const [rate, award, reward, meeting, moment] = await Promise.all([
    hasAny(familyId, 'ratings'),
    hasAny(familyId, 'awards'),
    hasAny(familyId, 'rewards'),
    hasAny(familyId, 'meetings'),
    hasAny(familyId, 'posts'),
  ]);
  return { rate, award, reward, meeting, moment, invite: inviteUsed(family) };
}

export function countDone(progress: FirstWeekProgress): number {
  return Object.values(progress).filter(Boolean).length;
}

export const FIRST_WEEK_TOTAL = FIRST_WEEK_ITEMS.length;
