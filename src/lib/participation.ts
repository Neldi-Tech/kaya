// Kaya · Little Stars — age-gated participation (2026-07-26, Elia-approved).
//
// A newborn (or any young child) is part of the family everywhere it warms
// — birthdays, Moments, Memory Lane, the family headcount — but EXCLUDED
// from surfaces that assign work or count performance (Kaya Sparks tasks &
// routine ratings, Sunday-meeting prompts & attendance) until they reach
// the family's participation ages.
//
//   • Family-wide defaults live at family.participationAges (partial,
//     merged over DEFAULT_PARTICIPATION_AGES — same pattern as
//     gamesConfig / purchaseConfig).
//   • A per-kid override (child.participationOverrides) lets a parent
//     include an eager early joiner (or exclude longer) regardless of age.
//   • NO BIRTHDAY = NO GATING: a kid without a birthday participates in
//     everything (the profile-completion chip nudges the parent instead).

import type { Child } from './firestore';

export interface ParticipationAges {
  /** Kaya Sparks (tasks, routines & ratings) begin at this age. */
  sparksFromAge: number;
  /** Sunday meetings (attendance, gratitude & goals) begin at this age. */
  meetingsFromAge: number;
}

export const DEFAULT_PARTICIPATION_AGES: ParticipationAges = {
  sparksFromAge: 3,
  meetingsFromAge: 2,
};

/** Merge the family's stored partial over the defaults. */
export function readParticipationAges(
  family: { participationAges?: Partial<ParticipationAges> } | null | undefined,
): ParticipationAges {
  const f = family?.participationAges || {};
  const clamp = (v: unknown, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(18, Math.round(v))) : dflt;
  return {
    sparksFromAge: clamp(f.sparksFromAge, DEFAULT_PARTICIPATION_AGES.sparksFromAge),
    meetingsFromAge: clamp(f.meetingsFromAge, DEFAULT_PARTICIPATION_AGES.meetingsFromAge),
  };
}

/** Age in whole years today, or null when no (valid) birthday is set. */
export function ageOf(child: Pick<Child, 'birthday'>): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(child.birthday || '');
  if (!m) return null;
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const md = now.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < b.getDate())) age -= 1;
  return age < 0 ? null : age;
}

type Gated = Pick<Child, 'birthday'> & {
  participationOverrides?: { sparks?: boolean; meetings?: boolean };
};

/** Does this kid take part in Kaya Sparks (tasks/routines/ratings)? */
export function participatesInSparks(
  child: Gated,
  family: { participationAges?: Partial<ParticipationAges> } | null | undefined,
): boolean {
  if (typeof child.participationOverrides?.sparks === 'boolean') return child.participationOverrides.sparks;
  const age = ageOf(child);
  if (age === null) return true; // no birthday → no gating
  return age >= readParticipationAges(family).sparksFromAge;
}

/** Does this kid take part in Sunday meetings (attendance/prompts/stats)? */
export function participatesInMeetings(
  child: Gated,
  family: { participationAges?: Partial<ParticipationAges> } | null | undefined,
): boolean {
  if (typeof child.participationOverrides?.meetings === 'boolean') return child.participationOverrides.meetings;
  const age = ageOf(child);
  if (age === null) return true;
  return age >= readParticipationAges(family).meetingsFromAge;
}

/** A "Little Star" = currently excluded from at least one surface. Drives
 *  the 🌟 chip on kid lists and the wizard's suggestion callout. */
export function isLittleStar(
  child: Gated,
  family: { participationAges?: Partial<ParticipationAges> } | null | undefined,
): boolean {
  return !participatesInSparks(child, family) || !participatesInMeetings(child, family);
}

/** A profile is "unfinished" when the wizard basics are missing — drives
 *  the ✎ Finish-profile chip. */
export function profileUnfinished(child: Pick<Child, 'birthday' | 'gender'>): boolean {
  return !child.birthday || !child.gender || child.gender === 'unspecified';
}
