// Kaya Sparks · Diary (Slice 8 · 2026-07-21).
//
// The kid's personal book — 7th Sparks area, per the approved
// Kaya-Sparks-Diary-v1 design + LOCKED LOGIC v1:
//   · any-time writing, MULTIPLE entries per day, feeling emoji required
//   · never AI-scored, never parent-rated
//   · siblings NEVER see diary content; parents see by default; a kid
//     can lock individual pages (content hides, date + feeling stay)
//   · all reads/writes go through the Admin-API gateway
//     (/api/sparks/diary, verified ID token) — the client NEVER touches
//     the `sparks_diary` collection directly, so locks are enforced
//     server-side and firestore.rules stays untouched.
//
// This module mirrors the reflection.ts gateway + ping-bus pattern so
// pages get live-ish refresh without onSnapshot.

'use client';

import { auth } from '../firebase';
import { isGuestActive } from '../mockFamily';

// ── Types ───────────────────────────────────────────────────────────

/** The 8 feelings — same scale the Reflection AI-read uses, but here
 *  the KID picks (required on every entry). */
export const DIARY_FEELINGS = ['😊', '😄', '😐', '🙁', '😢', '😠', '😴', '🤔'] as const;
export type DiaryFeeling = typeof DIARY_FEELINGS[number];

/** One content block on a page. Blocks mix freely on one entry:
 *  a typed paragraph + an ink drawing + a scanned page. */
export interface DiaryBlock {
  kind: 'text' | 'ink' | 'scan';
  /** kind 'text' → the typed content. */
  text?: string;
  /** kind 'ink' | 'scan' → Storage download URL (compressed image). */
  url?: string;
}

export interface DiaryEntry {
  id: string;
  /** kidId for kid diaries; parent uid for parent diaries (Slice 8e). */
  ownerId: string;
  ownerRole: 'kid' | 'parent';
  date: string;   // YYYY-MM-DD local day
  time: string;   // HH:mm local — orders multiple entries in a day
  feeling: DiaryFeeling;
  blocks: DiaryBlock[];
  /** Kid-locked page — content hidden from parents until knock/PIN.
   *  For parents' own diaries this is their independent page PIN. */
  locked: boolean;
  /** Server-redacted flag: when the API strips a locked page's content
   *  for a parent viewer, blocks=[] and this is true. Date + feeling
   *  always survive redaction (the meta is never hidden). */
  redacted?: boolean;
  /** Slice 8d · pending/answered knock on a locked page. */
  knock?: { byUid: string; byName: string; status: 'pending' | 'allowed' | 'denied' };
  /** Slice 8d · true once a knock was allowed — parents read the page
   *  until the kid re-locks it (re-lock clears this server-side). */
  knock_open?: boolean;
  /** Set when this entry was spawned from a Reflection (Slice 8e). */
  linked_reflection_date?: string;
  /** Slice 8f · ⏳ sealed until this date — content hidden from everyone
   *  (owner included) until then; quiet-open still works. */
  sealed_until?: string;
  /** Slice 8f · 💌 Dear Kaya reply (written server-side, opt-in). */
  kaya_reply?: string;
  createdAt?: { seconds: number } | null;
}

export interface DiaryStats {
  daysFilledThisYear: number;
  entriesThisYear: number;
  /** Consecutive days-with-an-entry ending today/yesterday (calendar
   *  days — diary has no school-day mask; weekends count). */
  streak: number;
  /** date → the day's most recent feeling (drives calendar cells). */
  feelingByDate: Record<string, DiaryFeeling>;
  /** date → true when any entry that day is locked. */
  lockedByDate: Record<string, boolean>;
}

// ── Gateway ─────────────────────────────────────────────────────────

async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}

export async function diaryApi<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const token = await idToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/sparks/diary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || `diary-${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Refresh bus — subscribers keyed by `${familyId}:${ownerId}`. Writes
// ping the bus; subscribers re-fetch. Mirrors reflection.ts exactly.
const diaryListeners = new Map<string, Set<() => void>>();

function pingDiary(familyId: string, ownerId: string) {
  const set = diaryListeners.get(`${familyId}:${ownerId}`);
  if (set) for (const fn of set) { try { fn(); } catch { /* noop */ } }
}

/** Fetch-once + re-fetch-on-write subscription to an owner's entries. */
export function subscribeToDiary(
  familyId: string, ownerId: string,
  cb: (entries: DiaryEntry[]) => void,
  max = 366,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  let dead = false;
  const load = () => {
    diaryApi<{ entries: DiaryEntry[] }>('list', { ownerId, max })
      .then(({ entries }) => { if (!dead) cb(entries); })
      .catch((err) => { console.error('[diary] list failed:', err); if (!dead) cb([]); });
  };
  load();
  const key = `${familyId}:${ownerId}`;
  const set = diaryListeners.get(key) ?? new Set();
  set.add(load);
  diaryListeners.set(key, set);
  return () => { dead = true; set.delete(load); };
}

// ── Writes ──────────────────────────────────────────────────────────

export interface NewDiaryEntryInput {
  ownerId: string;
  date?: string;   // defaults server-side to today (local TZ)
  feeling: DiaryFeeling;
  blocks: DiaryBlock[];
  locked?: boolean;
  linked_reflection_date?: string;
  /** Slice 8f · seal the page until a FUTURE date. */
  sealed_until?: string;
}

/** Create one diary entry. Returns the new id. */
export async function saveDiaryEntry(
  familyId: string, input: NewDiaryEntryInput,
): Promise<string> {
  if (isGuestActive()) return 'guest';
  const { id } = await diaryApi<{ id: string }>('save', { ...input });
  pingDiary(familyId, input.ownerId);
  return id;
}

/** Flip an entry's lock. Owner only (server-enforced). */
export async function setDiaryEntryLock(
  familyId: string, ownerId: string, entryId: string, locked: boolean,
): Promise<void> {
  if (isGuestActive()) return;
  await diaryApi('lock', { ownerId, entryId, locked });
  pingDiary(familyId, ownerId);
}

/** Delete an entry. Owner only (server-enforced). */
export async function deleteDiaryEntry(
  familyId: string, ownerId: string, entryId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await diaryApi('delete', { ownerId, entryId });
  pingDiary(familyId, ownerId);
}

// ── Stats ───────────────────────────────────────────────────────────

/** Local-day key — same helper contract as reflectionDayKey. */
export function diaryDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeDiaryStats(entries: DiaryEntry[], today: Date = new Date()): DiaryStats {
  const year = String(today.getFullYear());
  const feelingByDate: Record<string, DiaryFeeling> = {};
  const lockedByDate: Record<string, boolean> = {};
  const daySet = new Set<string>();
  let entriesThisYear = 0;

  // Entries arrive newest-first; first feeling seen per day = the day's
  // latest entry, which is what the calendar cell should show.
  for (const e of entries) {
    if (!feelingByDate[e.date]) feelingByDate[e.date] = e.feeling;
    if (e.locked) lockedByDate[e.date] = true;
    if (e.date.startsWith(year)) { daySet.add(e.date); entriesThisYear++; }
  }

  // Calendar-day streak: walk back from today; today-not-yet-written
  // starts the walk at yesterday (an unfinished today isn't a break).
  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const allDays = new Set(entries.map((e) => e.date));
  if (!allDays.has(diaryDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 400; i++) {
    const k = diaryDayKey(cursor);
    if (allDays.has(k)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }

  return {
    daysFilledThisYear: daySet.size,
    entriesThisYear,
    streak,
    feelingByDate,
    lockedByDate,
  };
}


// ── Slice 8d · privacy client helpers ───────────────────────────────

export interface DiaryPrivacyParentView {
  pin: string | null;
  quota: number;
  usedThisMonth: number;
  ledger: Array<{ by: string; byName: string; on: string; entryDate: string; overQuota: boolean; reason?: string }>;
  parentCount: number;
}

/** Parent view of a kid's privacy card (PIN visible by design). */
export async function getDiaryPrivacy(ownerId: string): Promise<DiaryPrivacyParentView> {
  return diaryApi<DiaryPrivacyParentView>('privacy-get', { ownerId });
}

/** Kid-side: do I have a PIN yet? */
export async function kidHasDiaryPin(ownerId: string): Promise<boolean> {
  const { hasPin } = await diaryApi<{ hasPin: boolean }>('privacy-get', { ownerId });
  return !!hasPin;
}

export async function setDiaryPin(ownerId: string, pin: string): Promise<void> {
  await diaryApi('pin-set', { ownerId, pin });
}

export async function resetDiaryPin(ownerId: string): Promise<void> {
  await diaryApi('pin-reset', { ownerId });
}

export async function setDiaryQuota(ownerId: string, quota: number): Promise<void> {
  await diaryApi('quota-set', { ownerId, quota });
}

export async function knockOnPage(familyId: string, ownerId: string, entryId: string): Promise<void> {
  await diaryApi('knock', { ownerId, entryId });
  pingDiary(familyId, ownerId);
}

export async function answerKnock(familyId: string, ownerId: string, entryId: string, allow: boolean): Promise<void> {
  await diaryApi('knock-answer', { ownerId, entryId, allow });
  pingDiary(familyId, ownerId);
}

/** Quiet PIN-open — returns the FULL entry once (nothing persists,
 *  the kid is not notified). Throws 'reason-required' (multi-parent,
 *  over quota, no reason) and 'wrong-pin'. */
export async function quietOpenPage(
  ownerId: string, entryId: string, pin: string, reason?: string,
): Promise<{ entry: DiaryEntry; used: number; quota: number }> {
  return diaryApi<{ entry: DiaryEntry; used: number; quota: number }>('quiet-open', { ownerId, entryId, pin, reason });
}


// ── Slice 8e · parent-diary helpers ────────────────────────────────

/** Owner-parent view of their own diary privacy (both surfaces). */
export async function getMyDiaryMeta(ownerId: string): Promise<{ hasPin: boolean; visibility: 'personal' | 'visible'; reflection_visibility: 'personal' | 'visible' }> {
  const r = await diaryApi<{ hasPin: boolean; visibility?: string; reflection_visibility?: string }>('privacy-get', { ownerId });
  return {
    hasPin: !!r.hasPin,
    visibility: r.visibility === 'visible' ? 'visible' : 'personal',
    reflection_visibility: r.reflection_visibility === 'visible' ? 'visible' : 'personal',
  };
}

export async function setDiaryVisibility(ownerId: string, visibility: 'personal' | 'visible'): Promise<void> {
  await diaryApi('visibility-set', { ownerId, visibility });
}


// ── Slice 8f · the five features · client helpers ───────────────────

/** 🫙 Prompt Jar — one kid-appropriate writing prompt (AI or bank). */
export async function getDiaryPrompt(firstName: string, age?: number | null): Promise<string> {
  try {
    const res = await fetch('/api/sparks/ai/diary-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName, age: age ?? undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.prompt) return String(data.prompt);
  } catch { /* fall through */ }
  return 'What made today different from yesterday?';
}

/** 💌 Dear Kaya — request the pen-pal reply for a just-saved page.
 *  Server enforces: owner-only · parent toggle · never locked/sealed. */
export async function requestKayaReply(
  familyId: string, ownerId: string, entryId: string, firstName: string,
): Promise<string | null> {
  const token = await (async () => {
    const u = auth.currentUser;
    if (!u) return null;
    try { return await u.getIdToken(); } catch { return null; }
  })();
  if (!token) return null;
  try {
    const res = await fetch('/api/sparks/ai/diary-reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ownerId, entryId, firstName }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.reply) { pingDiary(familyId, ownerId); return String(data.reply); }
  } catch { /* best-effort */ }
  return null;
}
