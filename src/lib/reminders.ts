// Kaya Reminders — the calendar/reminders space that lives under the Kaya
// nav group (approved v3 FINAL, 2026-06-13). Every user (parent · kid ·
// helper) gets it. Events can be 🔒 private or 👨‍👩‍👧 shared; they repeat
// on fixed days OR by a loose "N times a week/month" frequency; they remind
// at a lead time via 🔔 in-app + 📧 email (with a per-event recipient
// picker — family members + add-your-own external addresses); and they
// surface inline in My Day / Today + a Home chip.
//
// ARCHITECTURE NOTE — why this is all driven through /api/reminders/* Admin
// routes rather than the client SDK: a brand-new `families/{id}/reminders`
// subcollection is default-deny until firestore.rules is deployed, and the
// Firebase CLI auth is currently expired (can't deploy from here). So, like
// the Birthdays engine, every read/write goes through an Admin-SDK route
// that verifies the caller's Firebase ID token → no rules deploy needed,
// ships fully working today. The `reminders` rules block IS added to
// firestore.rules as documented defense-in-depth for when a deploy lands.
//
// This module is PURE (types + date/recurrence math + theming) plus a thin
// set of client fetch wrappers at the bottom. The recurrence helpers are
// reused server-side by the firing cron, so keep them dependency-free.

import { toDisplayDate } from './dates';

// ── Types ────────────────────────────────────────────────────────────────

export type ReminderType =
  | 'birthday'
  | 'anniversary'
  | 'appointment'
  | 'event'
  | 'reminder';

export type ReminderVisibility = 'private' | 'shared';

export type RepeatFreq =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom';

export type RepeatEndMode = 'never' | 'on' | 'after';

/** A day-of-month token: 1..31 or the literal 'last' (month-end). */
export type MonthDay = number | 'last';

export interface RepeatRule {
  freq: RepeatFreq;
  /** weekly — 0=Sun … 6=Sat. */
  weekdays?: number[];
  /** monthly — which dates of the month (incl 'last'). */
  monthDays?: MonthDay[];
  /** custom — "N times per week|month" (Kaya spreads them, no fixed day). */
  customCount?: number;
  customPer?: 'week' | 'month';
  end?: { mode: RepeatEndMode; onDate?: string; afterCount?: number };
}

/** One email target — a family member (uid + their Kaya email) OR a
 *  free-typed external address (grandparent, co-parent's work email…). */
export interface ReminderRecipient {
  kind: 'member' | 'external';
  email: string;
  uid?: string;   // members only
  name?: string;  // display label
}

export interface ReminderChannels {
  inApp: boolean;
  email: boolean;
  /** Designed-in now, switches on with the messaging integration. */
  whatsapp?: boolean;
}

/** Kid-created shared events need a parent nod before they go family-wide.
 *  Private kid events (and anything an adult creates) are 'active'. */
export type ReminderStatus = 'active' | 'pending_parent';

export interface ReminderEvent {
  id: string;
  familyId: string;
  ownerUid: string;
  ownerName?: string;
  ownerRole?: 'parent' | 'helper' | 'kid';
  type: ReminderType;
  title: string;
  /** First/anchor occurrence — canonical YYYY-MM-DD. */
  date: string;
  /** v4 — the ACTUAL event date (date of birth / wedding day), used only to
   *  count "Nth Birthday / Nth Anniversary". Optional; absent = plain copy.
   *  Only meaningful for type birthday|anniversary. Auto-imported mirrors
   *  stamp it from the profile DOB / family anniversary. */
  originDate?: string;
  /** "HH:MM" 24h, optional (absent = all-day). */
  time?: string;
  withWho?: string;
  location?: string;
  note?: string;
  visibility: ReminderVisibility;
  repeat: RepeatRule;
  /** Reminder lead times in days before the occurrence — e.g. [0] on the
   *  day, [1] a day before, [7] a week before. */
  leadDays: number[];
  channels: ReminderChannels;
  emailRecipients: ReminderRecipient[];
  status?: ReminderStatus;
  createdAt?: number;
  updatedAt?: number;
  /** Idempotency log for the firing cron — `${occurrenceDate}:${lead}`. */
  firedKeys?: string[];
}

/** A computed instance of an event on a specific calendar day — what the
 *  My Day / Coming-up surfaces and the email actually render. */
export interface ReminderOccurrence {
  event: ReminderEvent;
  /** YYYY-MM-DD the event happens on. */
  dateKey: string;
  /** Days from today (0 = today, 3 = in 3 days). */
  daysAway: number;
}

// ── Type theming (icon · label · email hero gradient) ─────────────────────

export interface ReminderTypeMeta {
  id: ReminderType;
  icon: string;
  label: string;
  /** Email hero gradient stops (matches the v3 mock — appointment/reminder
   *  get the navy→indigo→gold; birthday confetti; anniversary elegant). */
  heroFrom: string;
  heroMid: string;
  heroTo: string;
}

export const REMINDER_TYPES: ReminderTypeMeta[] = [
  { id: 'birthday',    icon: '🎂', label: 'Birthday',    heroFrom: '#1F2D3D', heroMid: '#C2588F', heroTo: '#F39C2F' },
  { id: 'anniversary', icon: '💍', label: 'Anniversary', heroFrom: '#1F2D3D', heroMid: '#6B4FC0', heroTo: '#D4A847' },
  { id: 'appointment', icon: '🩺', label: 'Appointment', heroFrom: '#1F2D3D', heroMid: '#3E4DA0', heroTo: '#D4A847' },
  { id: 'event',       icon: '🎉', label: 'Event',       heroFrom: '#1F2D3D', heroMid: '#3FAF9E', heroTo: '#D4A847' },
  { id: 'reminder',    icon: '📌', label: 'Reminder',    heroFrom: '#1F2D3D', heroMid: '#3E4DA0', heroTo: '#D4A847' },
];

export function typeMeta(type: ReminderType): ReminderTypeMeta {
  return REMINDER_TYPES.find((t) => t.id === type) || REMINDER_TYPES[4];
}

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Date-key helpers (local calendar, YYYY-MM-DD) ─────────────────────────

/** Local "today" as YYYY-MM-DD. Day boundaries are LOCAL, never UTC — Kaya
 *  users (and helpers) are worldwide. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

export function addDaysKey(key: string, days: number): string {
  const d = parseKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

/** Integer day difference toKey - fromKey. */
export function diffDaysKey(fromKey: string, toKey: string): number {
  const a = parseKey(fromKey);
  const b = parseKey(toKey);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function weekdayOfKey(key: string): number {
  const d = parseKey(key);
  return d ? d.getDay() : 0;
}

function dayOfMonth(key: string): number {
  return parseInt(key.slice(8, 10), 10);
}

function monthDayStr(key: string): string {
  return key.slice(5); // "MM-DD"
}

function lastDayOfMonth(key: string): number {
  const d = parseKey(key);
  if (!d) return 28;
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// ── Custom-frequency spread ───────────────────────────────────────────────
// "N times a week/month, no fixed day — Kaya spreads them." We DERIVE a fixed
// set of evenly-spaced days so firing is deterministic (and idempotent).

export function spreadWeekdays(count: number): number[] {
  const n = Math.max(1, Math.min(7, Math.round(count)));
  if (n >= 7) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (let i = 0; i < n; i++) {
    out.add(Math.min(6, Math.max(0, Math.round(((i + 0.5) * 7) / n))));
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function spreadMonthDays(count: number): number[] {
  const n = Math.max(1, Math.min(28, Math.round(count)));
  const out = new Set<number>();
  for (let i = 0; i < n; i++) {
    out.add(Math.min(28, Math.max(1, Math.round(((i + 0.5) * 28) / n))));
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** Effective weekday/monthDay sets after resolving 'custom'. */
function effectiveWeekdays(rule: RepeatRule): number[] {
  if (rule.freq === 'weekly') return rule.weekdays?.length ? rule.weekdays : [];
  if (rule.freq === 'custom' && rule.customPer === 'week') return spreadWeekdays(rule.customCount || 1);
  return [];
}
function effectiveMonthDays(rule: RepeatRule): MonthDay[] {
  if (rule.freq === 'monthly') return rule.monthDays?.length ? rule.monthDays : [];
  if (rule.freq === 'custom' && rule.customPer === 'month') return spreadMonthDays(rule.customCount || 1);
  return [];
}

// ── Recurrence ─────────────────────────────────────────────────────────────

/** Does the event fall on `key` (ignoring the end rule)? */
function isDayMatch(ev: ReminderEvent, key: string): boolean {
  const anchor = ev.date;
  if (!parseKey(key) || !parseKey(anchor)) return false;
  const freq = ev.repeat?.freq || 'none';

  switch (freq) {
    case 'none':
      return key === anchor;
    case 'daily':
      return key >= anchor;
    case 'yearly':
      // Match month+day every year (birthdays/anniversaries anchor in the
      // past, so don't gate on key >= anchor here).
      return monthDayStr(key) === monthDayStr(anchor);
    case 'weekly':
    case 'custom': {
      if (ev.repeat?.customPer === 'month' && freq === 'custom') {
        const days = effectiveMonthDays(ev.repeat);
        return key >= anchor && monthDayMatches(key, days);
      }
      const wds = effectiveWeekdays(ev.repeat);
      return key >= anchor && wds.includes(weekdayOfKey(key));
    }
    case 'monthly': {
      const days = effectiveMonthDays(ev.repeat);
      return key >= anchor && monthDayMatches(key, days);
    }
    default:
      return key === anchor;
  }
}

function monthDayMatches(key: string, days: MonthDay[]): boolean {
  if (!days.length) return false;
  const dom = dayOfMonth(key);
  for (const d of days) {
    if (d === 'last') {
      if (dom === lastDayOfMonth(key)) return true;
    } else if (dom === d) {
      return true;
    }
  }
  return false;
}

/** Resolve the effective end date (inclusive) — null = no end. For 'after N'
 *  we walk occurrences from the anchor and take the Nth (capped). */
export function effectiveEndDate(ev: ReminderEvent): string | null {
  const end = ev.repeat?.end;
  if (!end || end.mode === 'never') return null;
  if (end.mode === 'on') return end.onDate || null;
  if (end.mode === 'after') {
    const n = Math.max(1, end.afterCount || 1);
    let count = 0;
    let key = ev.date;
    for (let i = 0; i < 2000; i++) {
      if (isDayMatch(ev, key)) {
        count++;
        if (count >= n) return key;
      }
      key = addDaysKey(key, 1);
    }
    return key;
  }
  return null;
}

/** Does the event occur on `key`, honouring the end rule? */
export function occursOn(ev: ReminderEvent, key: string): boolean {
  if (!isDayMatch(ev, key)) return false;
  const endKey = effectiveEndDate(ev);
  if (endKey && key > endKey) return false;
  return true;
}

/** The next date on/after `fromKey` the event occurs — null if none within
 *  `horizonDays`. */
export function nextOccurrenceOnOrAfter(ev: ReminderEvent, fromKey: string, horizonDays = 800): string | null {
  let key = fromKey > ev.date ? fromKey : ev.date;
  for (let i = 0; i <= horizonDays; i++) {
    if (occursOn(ev, key)) return key;
    key = addDaysKey(key, 1);
  }
  return null;
}

/** Lead-time firings that land TODAY: for each configured lead L, the event
 *  occurs on (today + L), so the "L days before" reminder fires now. Returns
 *  the occurrence date + lead so the cron can stamp an idempotency key. */
export function leadFiringsForToday(
  ev: ReminderEvent,
  today: string = todayKey(),
): Array<{ occurrenceKey: string; lead: number }> {
  const leads = ev.leadDays?.length ? ev.leadDays : [0];
  const out: Array<{ occurrenceKey: string; lead: number }> = [];
  for (const lead of leads) {
    const occKey = addDaysKey(today, Math.max(0, lead));
    if (occursOn(ev, occKey)) out.push({ occurrenceKey: occKey, lead });
  }
  return out;
}

export function firedKeyFor(occurrenceKey: string, lead: number): string {
  return `${occurrenceKey}:${lead}`;
}

// ── Visibility ─────────────────────────────────────────────────────────────

/** Can `viewer` see this event? Owner always; shared+active to the whole
 *  family; pending-parent kid events only to the kid + parents. */
export function visibleTo(ev: ReminderEvent, viewerUid: string, viewerRole: string | undefined): boolean {
  if (ev.ownerUid === viewerUid) return true;
  if (ev.visibility !== 'shared') return false;
  if (ev.status === 'pending_parent') return viewerRole === 'parent';
  return true;
}

// ── Occurrence assembly (for My Day / Coming up) ──────────────────────────

/** Build occurrences for a set of events between today and today+horizon,
 *  visibility-filtered for the viewer. Used by the surfacing hook + page. */
export function occurrencesInRange(
  events: ReminderEvent[],
  viewerUid: string,
  viewerRole: string | undefined,
  opts: { from?: string; horizonDays?: number } = {},
): ReminderOccurrence[] {
  const from = opts.from || todayKey();
  const horizon = opts.horizonDays ?? 45;
  const out: ReminderOccurrence[] = [];
  for (const ev of events) {
    if (!visibleTo(ev, viewerUid, viewerRole)) continue;
    let key = from;
    for (let i = 0; i <= horizon; i++) {
      if (occursOn(ev, key)) {
        out.push({ event: ev, dateKey: key, daysAway: i });
        // For a date-anchored event we only need its next instance in the
        // window for surfacing; recurring ones we still list each hit.
        if (ev.repeat?.freq === 'none') break;
      }
      key = addDaysKey(key, 1);
    }
  }
  return out.sort((a, b) => (a.dateKey === b.dateKey
    ? timeRank(a.event.time) - timeRank(b.event.time)
    : a.dateKey < b.dateKey ? -1 : 1));
}

function timeRank(t?: string): number {
  if (!t) return 24 * 60 + 1; // all-day sorts after timed
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return 24 * 60 + 1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ── Auto-import: family birthdays + anniversary → synthetic events ────────
// Family birthdays/anniversaries flow in from Kaya profiles (no double
// entry). These are READ-ONLY mirrors (id prefixed `auto:`) — they surface
// and remind, but aren't stored or editable in the reminders collection,
// and the Birthdays engine owns the day-of celebration so the cron skips
// them (it only fires stored events).

export interface BirthdayLikeSource {
  id: string;
  name: string;
  birthday?: string;     // YYYY-MM-DD
  kind: 'kid' | 'adult';
}

export function autoImportedEvents(
  familyId: string,
  people: BirthdayLikeSource[],
  family: { anniversary?: string; anniversaryName?: string } | undefined,
): ReminderEvent[] {
  const out: ReminderEvent[] = [];
  for (const p of people) {
    if (!p.birthday || !/^\d{4}-\d{2}-\d{2}$/.test(p.birthday)) continue;
    out.push(synthEvent(familyId, `auto:bday:${p.id}`, 'birthday', `${p.name}'s birthday`, p.birthday));
  }
  if (family?.anniversary && /^\d{4}-\d{2}-\d{2}$/.test(family.anniversary)) {
    out.push(synthEvent(familyId, 'auto:anniversary', 'anniversary',
      family.anniversaryName?.trim() || 'Anniversary', family.anniversary));
  }
  return out;
}

function synthEvent(familyId: string, id: string, type: ReminderType, title: string, date: string): ReminderEvent {
  return {
    id, familyId, ownerUid: 'system', ownerName: 'Kaya', type, title, date,
    // The profile DOB / family anniversary IS the true origin, so mirrors
    // get "Nth Birthday" counting for free.
    originDate: date,
    visibility: 'shared',
    repeat: { freq: 'yearly' },
    leadDays: [7, 1, 0],
    channels: { inApp: true, email: false },
    emailRecipients: [],
    status: 'active',
  };
}

export function isAutoImported(ev: ReminderEvent): boolean {
  return ev.id.startsWith('auto:');
}

// ── Descriptions / formatting ─────────────────────────────────────────────

export function describeRepeat(rule: RepeatRule | undefined): string {
  if (!rule || rule.freq === 'none') return 'Does not repeat';
  switch (rule.freq) {
    case 'daily': return withEnd('Every day', rule);
    case 'yearly': return withEnd('Every year', rule);
    case 'weekly': {
      const wds = (rule.weekdays || []).slice().sort((a, b) => a - b);
      if (!wds.length) return withEnd('Weekly', rule);
      return withEnd(`Every ${wds.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(' · ')}`, rule);
    }
    case 'monthly': {
      const ds = (rule.monthDays || []);
      if (!ds.length) return withEnd('Monthly', rule);
      return withEnd(`Monthly on ${ds.map((d) => d === 'last' ? 'last day' : ordinal(d)).join(' & ')}`, rule);
    }
    case 'custom': {
      const per = rule.customPer === 'month' ? 'month' : 'week';
      const n = rule.customCount || 1;
      return withEnd(`${n}× a ${per} — Kaya spreads them`, rule);
    }
    default: return 'Does not repeat';
  }
}

function withEnd(base: string, rule: RepeatRule): string {
  const end = rule.end;
  if (!end || end.mode === 'never') return base;
  if (end.mode === 'on' && end.onDate) return `${base}, until ${toDisplayDate(end.onDate)}`;
  if (end.mode === 'after' && end.afterCount) return `${base}, ${end.afterCount}×`;
  return base;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Nth Birthday / Anniversary (v4) ────────────────────────────────────────
// Counting anchors ONLY on the explicit originDate — never inferred from the
// anchor date on stored events, so a reminder created "for next June" can
// never mislabel itself a 1st birthday. Auto-imported mirrors stamp
// originDate from the real DOB/anniversary, so they light up for free.

/** N = occurrence year − origin year, for birthday/anniversary events with a
 *  known origin. Null (= render plain, exactly as v3) when the origin is
 *  missing, malformed, in the future, or the same year. */
export function nthFor(ev: ReminderEvent, occurrenceKey: string): number | null {
  if (ev.type !== 'birthday' && ev.type !== 'anniversary') return null;
  if (!ev.originDate || !/^\d{4}-\d{2}-\d{2}$/.test(ev.originDate)) return null;
  const originYear = parseInt(ev.originDate.slice(0, 4), 10);
  const occYear = parseInt(occurrenceKey.slice(0, 4), 10);
  if (!Number.isFinite(originYear) || !Number.isFinite(occYear)) return null;
  const n = occYear - originYear;
  return n > 0 ? n : null;
}

/** The spoken title for an occurrence — "Daniella's 8th Birthday" — used by
 *  the list, My Day, Home chip, notification and email. Falls back to the
 *  stored title whenever there's no N. */
export function displayTitle(ev: ReminderEvent, occurrenceKey: string): string {
  const n = nthFor(ev, occurrenceKey);
  if (!n) return ev.title;
  const word = ev.type === 'birthday' ? 'Birthday' : 'Anniversary';
  const re = new RegExp(`${word}\\s*$`, 'i');
  if (re.test(ev.title)) return ev.title.replace(re, `${ordinal(n)} ${word}`);
  return `${ev.title} · ${ordinal(n)} ${word}`;
}

/** Sub-line flourish for an Nth occurrence — "turning 8 🎈" / "12 years ·
 *  since 2015 💕". Null when there's no N (sub-line renders as before). */
export function nthSubLabel(ev: ReminderEvent, occurrenceKey: string): string | null {
  const n = nthFor(ev, occurrenceKey);
  if (!n) return null;
  if (ev.type === 'birthday') return `turning ${n} 🎈`;
  return `${n} years · since ${ev.originDate!.slice(0, 4)} 💕`;
}

/** "3:00 PM" from "15:00". */
export function formatTime(time?: string): string {
  if (!time) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return time;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/** "Today" / "Tomorrow" / "in 3 days" / DD-Mmm-YYYY. */
export function relativeDays(daysAway: number, dateKey: string): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway > 1 && daysAway <= 30) return `in ${daysAway} days`;
  return toDisplayDate(dateKey);
}

/** Default lead-day presets offered in the editor. */
export const LEAD_PRESETS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'On the day' },
  { days: 1, label: '1 day before' },
  { days: 3, label: '3 days before' },
  { days: 7, label: '1 week before' },
];

// ── Client fetch wrappers (call the Admin-SDK routes) ─────────────────────
// All take a Firebase ID token (await user.getIdToken()).

async function authedPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `request-failed-${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchReminders(token: string): Promise<ReminderEvent[]> {
  const out = await authedPost<{ events?: ReminderEvent[] }>('/api/reminders/list', token, {});
  return out.events || [];
}

/** Create (no id) or update (with id). Returns the saved event. */
export async function saveReminder(
  token: string,
  payload: Partial<ReminderEvent> & { id?: string },
): Promise<{ event: ReminderEvent; pending?: boolean }> {
  return authedPost('/api/reminders/save', token, { action: 'save', event: payload });
}

export async function deleteReminder(token: string, id: string): Promise<{ ok: boolean }> {
  return authedPost('/api/reminders/save', token, { action: 'delete', id });
}

/** Parent flips a kid's pending shared event to active (approve) or removes
 *  the share request (decline → reverts to private). */
export async function decideReminder(
  token: string,
  id: string,
  decision: 'approve' | 'decline',
): Promise<{ ok: boolean }> {
  return authedPost('/api/reminders/save', token, { action: decision, id });
}

// ── 🎁 Gift Brain (R2) ─────────────────────────────────────────────────────
// A year-round, per-person gift-idea stash, surfaced ~2 weeks before someone's
// birthday/anniversary — tied to a kid's interests/aspirations. PARENTS-ONLY:
// gift ideas must never spoil the surprise for the kid, so the gifts route and
// the UI section are gated to parents. Ideas link to a family kid (childId) or
// carry a free-typed name (a friend, grandparent).

export interface GiftIdea {
  id: string;
  familyId: string;
  personName: string;
  /** Set when the idea is for a family kid — lets prompts match precisely. */
  linkedChildId?: string;
  text: string;
  done?: boolean;
  createdByUid?: string;
  createdByName?: string;
  createdAt?: number;
}

/** How many days ahead Gift Brain starts nudging. */
export const GIFT_LEAD_DAYS = 14;

function normName(s: string): string {
  return (s || '').trim().toLowerCase();
}

/** Strip "'s birthday"/"'s anniversary" etc. to recover the person's name. */
export function personFromTitle(title: string): string {
  return (title || '').replace(/['’]s\s+(birthday|anniversary|big day).*$/i, '').trim() || title;
}

export interface GiftPrompt {
  occurrence: ReminderOccurrence;
  personName: string;
  linkedChildId?: string;
  ideas: GiftIdea[];
  interests: string[];
}

/** Build the ~2-weeks-before gift nudges: upcoming birthdays/anniversaries
 *  within GIFT_LEAD_DAYS, each with its saved ideas + the kid's interests. */
export function giftPromptsFor(
  occurrences: ReminderOccurrence[],
  ideas: GiftIdea[],
  interestsByChildId: Record<string, string[]>,
): GiftPrompt[] {
  const out: GiftPrompt[] = [];
  const seen = new Set<string>();
  for (const o of occurrences) {
    if (o.daysAway < 0 || o.daysAway > GIFT_LEAD_DAYS) continue;
    if (o.event.type !== 'birthday' && o.event.type !== 'anniversary') continue;
    const childId = o.event.id.startsWith('auto:bday:') ? o.event.id.slice('auto:bday:'.length) : undefined;
    const personName = childId ? o.event.title.replace(/['’]s\s+birthday$/i, '') : personFromTitle(o.event.title);
    const key = childId ? `c:${childId}` : `n:${normName(personName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matched = ideas.filter((g) => (childId && g.linkedChildId === childId)
      || (!g.done && normName(g.personName) === normName(personName)));
    out.push({
      occurrence: o,
      personName,
      linkedChildId: childId,
      ideas: matched.filter((g) => !g.done),
      interests: childId ? (interestsByChildId[childId] || []) : [],
    });
  }
  return out.sort((a, b) => a.occurrence.daysAway - b.occurrence.daysAway);
}

export async function fetchGiftIdeas(token: string): Promise<GiftIdea[]> {
  const out = await authedPost<{ ideas?: GiftIdea[] }>('/api/reminders/gifts', token, { action: 'list' });
  return out.ideas || [];
}

export async function saveGiftIdea(
  token: string,
  payload: { id?: string; personName: string; linkedChildId?: string; text: string; done?: boolean },
): Promise<{ idea: GiftIdea }> {
  return authedPost('/api/reminders/gifts', token, { action: 'save', idea: payload });
}

export async function deleteGiftIdea(token: string, id: string): Promise<{ ok: boolean }> {
  return authedPost('/api/reminders/gifts', token, { action: 'delete', id });
}

// ── 📮 Time Capsule (R3) ────────────────────────────────────────────────────
// Schedule a message (+ photo; voice is a seam) to auto-deliver on a future
// date — a birthday wish, "open on your 18th", a note that resurfaces next
// anniversary. Delivered by the daily reminders cron: 'family' capsules post
// to the family chat; 'self'/'member' capsules deliver privately (in-app +
// email). Anyone can create one.

export type CapsuleAudience = 'self' | 'member' | 'family';

export interface TimeCapsule {
  id: string;
  familyId: string;
  createdByUid: string;
  createdByName?: string;
  audience: CapsuleAudience;
  toUid?: string;     // 'self' (creator) or 'member'
  toName?: string;
  deliverOn: string;  // YYYY-MM-DD
  message: string;
  photoUrl?: string;
  voiceUrl?: string;  // reserved for the voice fast-follow
  delivered?: boolean;
  deliveredAt?: number;
  createdAt?: number;
}

/** "Delivered" / "Opens today" / "Opens tomorrow" / "Opens in N days" / date. */
export function capsuleStatus(c: TimeCapsule, today: string = todayKey()): string {
  if (c.delivered) return 'Delivered ✓';
  const days = diffDaysKey(today, c.deliverOn);
  if (days <= 0) return 'Opening…';
  if (days === 1) return 'Opens tomorrow';
  if (days <= 30) return `Opens in ${days} days`;
  return `Opens ${toDisplayDate(c.deliverOn)}`;
}

export async function fetchTimeCapsules(token: string): Promise<TimeCapsule[]> {
  const out = await authedPost<{ capsules?: TimeCapsule[] }>('/api/reminders/capsules', token, { action: 'list' });
  return out.capsules || [];
}

export async function saveTimeCapsule(
  token: string,
  payload: {
    id?: string; audience: CapsuleAudience; toUid?: string; toName?: string;
    deliverOn: string; message: string; photoUrl?: string;
  },
): Promise<{ capsule: TimeCapsule }> {
  return authedPost('/api/reminders/capsules', token, { action: 'save', capsule: payload });
}

export async function deleteTimeCapsule(token: string, id: string): Promise<{ ok: boolean }> {
  return authedPost('/api/reminders/capsules', token, { action: 'delete', id });
}
