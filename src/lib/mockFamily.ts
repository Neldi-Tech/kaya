// Seeded demo data for guest mode. All fields shaped to match real Firestore types.
// Nothing here ever writes to Firestore.

import { Timestamp } from 'firebase/firestore';
import type {
  Family, Child, Reward, DailyRating, Award, Routine, UserProfile,
} from './firestore';

const ts = (daysAgo = 0): Timestamp =>
  Timestamp.fromDate(new Date(Date.now() - daysAgo * 86400000));

const today = (offsetDays = 0): string => {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
};

export const GUEST_FAMILY_ID = '__guest_family__';
export const GUEST_UID = '__guest_user__';

const ROUTINES: Routine[] = [
  { id: 'r-wake', label: 'Wake on time', labelSw: 'Amka mapema', icon: '🌅', period: 'morning', pointsExcellent: 10, pointsGood: 5, pointsBad: 0, active: true },
  { id: 'r-bed',  label: 'Make the bed',  labelSw: 'Tandika kitanda', icon: '🛏️', period: 'morning', pointsExcellent: 10, pointsGood: 5, pointsBad: 0, active: true },
  { id: 'r-brush',label: 'Brush teeth',   labelSw: 'Piga mswaki',     icon: '🪥', period: 'morning', pointsExcellent: 10, pointsGood: 5, pointsBad: 0, active: true },
  { id: 'r-read', label: 'Read 20 min',   labelSw: 'Soma dakika 20',  icon: '📚', period: 'evening', pointsExcellent: 15, pointsGood: 8, pointsBad: 0, active: true },
  { id: 'r-tidy', label: 'Tidy up',       labelSw: 'Safisha',         icon: '🧹', period: 'evening', pointsExcellent: 10, pointsGood: 5, pointsBad: 0, active: true },
];

export const MOCK_FAMILY: Family = {
  id: GUEST_FAMILY_ID,
  name: 'The Demo Family',
  createdBy: GUEST_UID,
  inviteCode: 'DEMO-1234',
  inviteCodes: {
    kid:    { code: 'KID-DEMO',   active: false },
    helper: { code: 'HELP-DEMO',  active: true  },
    guest:  { code: 'GUEST-DEMO', active: false },
  },
  referralCode: 'DEMO-2026-XYZ',
  referredBy: null,
  referralCount: 1,
  compoundCredit: 0,
  isFoundingFamily: true,
  spotlightOptIn: false,
  pointsMode: 'full',
  routines: ROUTINES,
  createdAt: ts(30),
};

export const MOCK_CHILDREN: Child[] = [
  { id: 'c-amani',  name: 'Amani',  houseName: 'Golden', houseColor: '#D4A017', avatarEmoji: '🦁', totalPoints: 482, weeklyPoints: 95, streak: 5, badges: ['first-star','steady-streak','meeting-mvp'] },
  { id: 'c-zuri',   name: 'Zuri',   houseName: 'White',  houseColor: '#7B9DB7', avatarEmoji: '🦋', totalPoints: 421, weeklyPoints: 80, streak: 3, badges: ['first-star','book-worm'] },
  { id: 'c-kito',   name: 'Kito',   houseName: 'Silver', houseColor: '#9B8EC4', avatarEmoji: '🐉', totalPoints: 356, weeklyPoints: 60, streak: 2, badges: ['first-star'] },
];

export const MOCK_REWARDS: Reward[] = [
  { id: 'rw-icecream', title: 'Ice cream outing',   description: 'Family trip to the ice cream parlour', pointsCost: 100, icon: '🍦', active: true },
  { id: 'rw-movie',    title: 'Movie night pick',   description: 'Choose the family movie this weekend', pointsCost: 75,  icon: '🎬', active: true },
  { id: 'rw-screen',   title: '+30 min screen time',description: 'Bonus screen time on Saturday',        pointsCost: 50,  icon: '📱', active: true },
  { id: 'rw-friend',   title: 'Sleepover with friend', description: 'Invite a friend for a sleepover',  pointsCost: 200, icon: '🛌', active: true },
];

export const MOCK_RATINGS: DailyRating[] = [
  { id: 'rt-1', childId: 'c-amani', date: today(0), period: 'morning', ratings: { 'r-wake':'excellent','r-bed':'good','r-brush':'excellent' }, totalPoints: 25, ratedBy: GUEST_UID, ratedByName: 'Mum (demo)', createdAt: ts(0) },
  { id: 'rt-2', childId: 'c-zuri',  date: today(0), period: 'morning', ratings: { 'r-wake':'good','r-bed':'excellent','r-brush':'good' }, totalPoints: 20, ratedBy: GUEST_UID, ratedByName: 'Mum (demo)', createdAt: ts(0) },
  { id: 'rt-3', childId: 'c-kito',  date: today(1), period: 'evening', ratings: { 'r-read':'excellent','r-tidy':'good' }, totalPoints: 20, ratedBy: GUEST_UID, ratedByName: 'Dad (demo)', createdAt: ts(1), comment: 'Read a whole chapter without prompting — really proud.' },
  { id: 'rt-4', childId: 'c-amani', date: today(1), period: 'evening', ratings: { 'r-read':'good','r-tidy':'excellent' }, totalPoints: 18, ratedBy: GUEST_UID, ratedByName: 'Dad (demo)', createdAt: ts(1), comment: 'Tidied without being asked. Big win.' },
  { id: 'rt-5', childId: 'c-zuri',  date: today(2), period: 'evening', ratings: { 'r-read':'bad','r-tidy':'bad' }, totalPoints: 0, ratedBy: GUEST_UID, ratedByName: 'Helper (demo)', createdAt: ts(2), comment: 'Tough evening — overtired from the long day.' },
];

export const MOCK_AWARDS: Award[] = [
  { id: 'aw-1', childId: 'c-amani', kind: 'diamond', points: 20, reason: 'Helped sister with homework', category: 'kindness', awardedBy: GUEST_UID, awardedByName: 'Mum (demo)', createdAt: ts(0) },
  { id: 'aw-2', childId: 'c-zuri',  kind: 'diamond', points: 15, reason: 'Cleared the table without being asked', category: 'initiative', awardedBy: GUEST_UID, awardedByName: 'Dad (demo)', createdAt: ts(1) },
  { id: 'aw-3', childId: 'c-kito',  kind: 'diamond', points: 10, reason: 'Said sorry properly', category: 'character', awardedBy: GUEST_UID, awardedByName: 'Mum (demo)', createdAt: ts(2) },
];

export const MOCK_PROFILE: UserProfile = {
  uid: GUEST_UID,
  email: 'guest@ourkaya.com',
  displayName: 'Guest Visitor',
  role: 'parent',
  familyId: GUEST_FAMILY_ID,
  createdAt: ts(0),
};

// Module-level guest flag — read by firestore.ts to short-circuit writes.
let _guestActive = false;
export const isGuestActive = () => _guestActive;
export const setGuestActive = (v: boolean) => { _guestActive = v; };
