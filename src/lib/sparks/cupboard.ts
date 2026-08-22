// Kaya Sparks · Treasures 2.0 — 🗄 The Family Cupboard (2026-08-22).
//
// Two shelves — 📚 Books and 🎲 Games — that the whole family shares.
// They are NOT a separate module (D24): Cupboard items are ordinary
// Treasures in the same collections, through the same lifecycle
// (Keeper Check, Lost & Found, Borrow & Return, Memory Shelf), reached
// through their own Admin-API gateway at /api/sparks/treasures/cupboard.
//
// Locked logic (Kaya-Treasures-2.0_LogicTest+Schedule_2026-08-22, D24–D42):
//   D25 family-owned items carry kidId === FAMILY_OWNER_ID; a kid's own
//       book/game shared with the family appears on the shelf too.
//   D26 parents + all kids see & add; helpers only when a parent lists
//       them in cupboardSettings.helperUids. Values are never sent here.
//   D27 new category 🎲 game + book/game meta + whereKept.
//   D28 canonical names: lookup / Kaya's read / manual(⚠ parent confirm).
//   D29 dedupe by barcode, else normalised title+author.
//   D41 lifecycle unchanged · D42 zero rules/index/storage deploys.
//
// Storage (all through the gateway, default-deny for clients):
//   /families/{f}/sparks_treasures/{id}                 (same as 1.0)
//   /families/{f}/sparks_treasure_events/{id}           (same as 1.0)
//   /families/{f}/sparks_treasure_private/cupboard__settings

'use client';

import { auth } from '../firebase';
import { isGuestActive } from '../mockFamily';
import type {
  Treasure, TreasureEvent, TreasureStatus, BookMeta, GameMeta, GameKind,
  NameSource, OwnerScope,
} from './treasures';

export type { BookMeta, GameMeta, GameKind, NameSource, OwnerScope };

// ── Settings (D26 · D32 · D36 · D38 · D40 · N8) ─────────────────────

export type ReadingReminderMode = 'off' | 'daily' | 'weekdays' | 'weekly';

export interface CupboardSettings {
  /** D26 · the selected helpers who may see + add + log readings. */
  helperUids: string[];
  /** D32 · default for a NEW reading (per-reading override later). */
  reading: { mode: ReadingReminderMode; hour: number; quietLineDays: number };
  /** D36 · the Finish Quiz. */
  quiz: { enabled: boolean; minAge: number; points: boolean };
  /** D38 · Game Night cadence. dayOfWeek 0 = Sunday. */
  gameNight: { enabled: boolean; dayOfWeek: number; hour: number; minute: number };
  /** D40 · days untouched before the 🕸 card. 0 = off. */
  dustDays: number;
  /** N8 · one line in the Sunday Meeting report. */
  meetingLine: boolean;
}

export const DEFAULT_CUPBOARD_SETTINGS: CupboardSettings = {
  helperUids: [],
  reading: { mode: 'daily', hour: 19, quietLineDays: 7 },
  quiz: { enabled: true, minAge: 6, points: false },
  gameNight: { enabled: true, dayOfWeek: 5, hour: 18, minute: 30 },
  dustDays: 90,
  meetingLine: true,
};

export const READING_MODE_LABEL: Record<ReadingReminderMode, string> = {
  off: 'Off', daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly',
};

export const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Shapes the pages share ──────────────────────────────────────────

/** A Treasure as the Cupboard sees it — plus the owner/keeper names the
 *  gateway resolves so no page needs the children collection. */
export interface CupboardItem extends Treasure {
  /** '' for family-owned; else the owning kid's name. */
  ownerName: string;
  keeperName?: string;
}

export interface CupboardShelf {
  items: CupboardItem[];
  kids: Array<{ id: string; name: string; emoji: string }>;
  settings: CupboardSettings;
  me: {
    role: 'parent' | 'kid' | 'helper';
    childId: string;
    /** Parents only — settings, name confirmations, endings of family things. */
    canManage: boolean;
  };
}

export interface CupboardHelperRow {
  uid: string;
  displayName: string;
  preset: string;
  active: boolean;
  allowed: boolean;
}

export const CUPBOARD_KIND_LABEL = { book: 'Book', game: 'Game' } as const;
export type CupboardKind = keyof typeof CUPBOARD_KIND_LABEL;

export const kindOf = (t: Pick<Treasure, 'categoryId'>): CupboardKind =>
  t.categoryId === 'game' ? 'game' : 'book';

/** "8+ · 2–5 · 45 min · 🧠" — the game's one-line meta. */
export function gameMetaLine(g: GameMeta | undefined): string {
  if (!g) return '';
  const parts: string[] = [];
  if (g.ageMin) parts.push(`${g.ageMin}+`);
  if (g.playersMin || g.playersMax) {
    const lo = g.playersMin || g.playersMax || 0;
    const hi = g.playersMax || g.playersMin || 0;
    parts.push(lo === hi ? `${lo} players` : `${lo}–${hi}`);
  }
  if (g.minutes) parts.push(`${g.minutes} min`);
  return parts.join(' · ');
}

/** "Rick Riordan · 375 pages" — the book's one-line meta. */
export function bookMetaLine(b: BookMeta | undefined): string {
  if (!b) return '';
  const parts: string[] = [];
  if (b.author) parts.push(b.author);
  if (b.pages) parts.push(`${b.pages} pages`);
  else if (b.year) parts.push(String(b.year));
  return parts.join(' · ');
}

/** D29 · the dedupe key the gateway also uses. */
export function normaliseTitle(name: string, author?: string): string {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${n(name)}|${n(author || '')}`;
}

// ── Gateway ─────────────────────────────────────────────────────────

async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}

export async function cupboardApi<T>(
  action: string, payload: Record<string, unknown> = {},
): Promise<T> {
  const token = await idToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/sparks/treasures/cupboard', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || `cupboard-${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Lookups (C2 · D28 · D30) — barcode → words, front face → words ──

export interface LookupBook {
  name: string; author?: string; pages?: number; year?: number;
  publisher?: string; coverUrl?: string; isbn?: string; ageMin?: number;
}
export interface LookupGame {
  name: string; ageMin?: number; playersMin?: number; playersMax?: number;
  minutes?: number; gameKind?: GameKind;
}
export interface LookupResult {
  found: boolean;
  kind?: CupboardKind;
  /** The normalised barcode (ISBN-13 / UPC) when one was involved. */
  code?: string;
  /** 'lookup' (a database answered) · 'vision' (Kaya read it, no DB match). */
  nameSource?: NameSource;
  source?: string;
  book?: LookupBook;
  game?: LookupGame;
  /** UPC DB name for a game (identity from the code, words from the box). */
  name?: string;
  confidence?: number;
  reason?: string;
}

/** Server-side lookups — Open Library / Google Books / UPC DB / Kaya
 *  vision. Never throws into the UI: a failed lookup is `{found:false}`. */
export async function cupboardLookup(
  action: 'code' | 'vision',
  payload: Record<string, unknown>,
): Promise<LookupResult> {
  const token = await idToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/sparks/treasures/cupboard/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) return { found: false, reason: `lookup-${res.status}` };
  return res.json() as Promise<LookupResult>;
}

// Refresh bus — one channel per family (the Cupboard is family-wide).
const listeners = new Map<string, Set<() => void>>();

export function pingCupboard(familyId: string) {
  const set = listeners.get(familyId);
  if (set) for (const fn of set) { try { fn(); } catch { /* noop */ } }
}

/** Fetch-once + re-fetch-on-write subscription to the whole Cupboard. */
export function subscribeToCupboard(
  familyId: string,
  cb: (shelf: CupboardShelf | null, err?: string) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  let dead = false;
  const load = () => {
    cupboardApi<CupboardShelf>('shelf')
      .then((r) => { if (!dead) cb(r); })
      .catch((e: unknown) => { if (!dead) cb(null, e instanceof Error ? e.message : 'error'); });
  };
  let set = listeners.get(familyId);
  if (!set) { set = new Set(); listeners.set(familyId, set); }
  set.add(load);
  load();
  return () => {
    dead = true;
    const s = listeners.get(familyId);
    if (s) { s.delete(load); if (!s.size) listeners.delete(familyId); }
  };
}

// ── Reads ───────────────────────────────────────────────────────────

export async function fetchCupboard(): Promise<CupboardShelf> {
  return cupboardApi<CupboardShelf>('shelf');
}

export async function getCupboardItem(treasureId: string): Promise<{
  item: CupboardItem;
  events: TreasureEvent[];
  canEdit: boolean;
  canEnd: boolean;
  canManage: boolean;
}> {
  return cupboardApi('item', { treasureId });
}

export async function getCupboardSettings(): Promise<CupboardSettings> {
  const { settings } = await cupboardApi<{ settings: CupboardSettings }>('settings-get');
  return { ...DEFAULT_CUPBOARD_SETTINGS, ...settings };
}

export async function listCupboardHelpers(): Promise<CupboardHelperRow[]> {
  const { helpers } = await cupboardApi<{ helpers: CupboardHelperRow[] }>('helpers');
  return helpers || [];
}

// ── Writes ──────────────────────────────────────────────────────────

export interface NewCupboardItemInput {
  kind: CupboardKind;
  name: string;
  ownerScope: OwnerScope;
  /** Required when ownerScope === 'kid'. */
  kidId?: string;
  whereKept?: string;
  book?: BookMeta;
  game?: GameMeta;
  barcode?: string;
  nameSource: NameSource;
  emoji?: string;
  photoUrl?: string;
  thumbUrl?: string;
  photoId?: string;
  /** D29 · set when the user chose "add a 2nd copy" past a dedupe hit. */
  allowDuplicate?: boolean;
}

export interface AddCupboardResult {
  id?: string;
  /** D29 · the gateway found the same thing already on the shelf. */
  duplicateOf?: { id: string; name: string; ownerName: string };
}

export async function addCupboardItem(
  familyId: string, input: NewCupboardItemInput,
): Promise<AddCupboardResult> {
  const r = await cupboardApi<AddCupboardResult>('add', { ...input });
  if (r.id) pingCupboard(familyId);
  return r;
}

export type CupboardPatch = Partial<Pick<Treasure,
  'name' | 'emoji' | 'whereKept' | 'keeperKidId' | 'book' | 'game' |
  'photoUrl' | 'thumbUrl' | 'photoId' | 'barcode' | 'nameConfirmed'>>;

export async function updateCupboardItem(
  familyId: string, treasureId: string, patch: CupboardPatch,
): Promise<void> {
  await cupboardApi('update', { treasureId, patch });
  pingCupboard(familyId);
}

/** Lifecycle — D41, same semantics as Treasures 1.0. */
export async function cupboardCondition(
  familyId: string, treasureId: string,
  status: Extract<TreasureStatus, 'broken' | 'repaired' | 'lost' | 'kept'>,
  note?: string, lastSeenWhere?: string,
): Promise<void> {
  await cupboardApi('condition', { treasureId, status, note, lastSeenWhere });
  pingCupboard(familyId);
}

export async function cupboardFound(
  familyId: string, treasureId: string, where?: string,
): Promise<void> {
  await cupboardApi('found', { treasureId, where });
  pingCupboard(familyId);
}

export async function cupboardLend(
  familyId: string, treasureId: string,
  to: { toChildId?: string; toName: string; dueOn: string },
): Promise<void> {
  await cupboardApi('lend', { treasureId, ...to });
  pingCupboard(familyId);
}

export async function cupboardReturn(familyId: string, treasureId: string): Promise<void> {
  await cupboardApi('return', { treasureId });
  pingCupboard(familyId);
}

export async function cupboardEnd(
  familyId: string, treasureId: string,
  how: Extract<TreasureStatus, 'handed_on' | 'donated' | 'sold' | 'outgrown' | 'retired'>,
  opts: { toChildId?: string; note?: string } = {},
): Promise<void> {
  await cupboardApi('end', { treasureId, how, ...opts });
  pingCupboard(familyId);
}

export async function setCupboardSettings(
  familyId: string, patch: Partial<CupboardSettings>,
): Promise<void> {
  await cupboardApi('settings-set', { settings: patch });
  pingCupboard(familyId);
}

// ── 📖 The reading loop (C3 · D31 · D32 · D33 · N9) ────────────────

export async function startReading(
  familyId: string, treasureId: string,
  opts: { readerKidId?: string; pages?: number; togetherWith?: string } = {},
): Promise<{ readingId: string; readNo: number }> {
  const r = await cupboardApi<{ readingId: string; readNo: number }>('reading-start', { treasureId, ...opts });
  pingCupboard(familyId);
  return r;
}

export async function markPage(
  familyId: string, treasureId: string, readingId: string, page: number, togetherWith?: string,
): Promise<{ ok: true; currentPage: number }> {
  const r = await cupboardApi<{ ok: true; currentPage: number }>('reading-mark', { treasureId, readingId, page, togetherWith });
  pingCupboard(familyId);
  return r;
}

export async function finishReading(
  familyId: string, treasureId: string, readingId: string,
): Promise<{ ok: true; readNo: number }> {
  const r = await cupboardApi<{ ok: true; readNo: number }>('reading-finish', { treasureId, readingId });
  pingCupboard(familyId);
  return r;
}

export async function setReadingReminder(
  familyId: string, treasureId: string, readingId: string,
  reminder: { mode: ReadingReminderMode; hour: number },
): Promise<void> {
  await cupboardApi('reading-reminder', { treasureId, readingId, ...reminder });
  pingCupboard(familyId);
}

export async function inviteToRead(
  familyId: string, treasureId: string, toKidId: string, note?: string,
): Promise<void> {
  await cupboardApi('reading-invite', { treasureId, toKidId, note });
  pingCupboard(familyId);
}

export async function respondToInvite(
  familyId: string, treasureId: string, inviteId: string, accept: boolean,
): Promise<{ ok: true; readingId?: string }> {
  const r = await cupboardApi<{ ok: true; readingId?: string }>('reading-invite-respond', { treasureId, inviteId, accept });
  pingCupboard(familyId);
  return r;
}

/** What a kid's My Day / Workplan / Sparks Today strip needs — one call. */
export interface MyReading {
  date: string;
  readings: Array<{
    treasureId: string; readingId: string; name: string; emoji: string; coverUrl?: string;
    currentPage: number; pages?: number; lastMarkOn?: string; readNo: number;
    /** The reminder says today is a reading day. */
    dueToday: boolean;
    /** No mark today yet. */
    openToday: boolean;
  }>;
  invites: Array<{ treasureId: string; inviteId: string; name: string; emoji: string; fromName: string; note?: string }>;
  openCount: number;
}

export async function fetchMyReading(kidId: string): Promise<MyReading> {
  return cupboardApi<MyReading>('my-reading', { kidId });
}

// ── Selectors ───────────────────────────────────────────────────────

const ENDED: TreasureStatus[] = ['handed_on', 'donated', 'sold', 'outgrown', 'retired'];
export const liveItems  = (list: CupboardItem[]) => list.filter((t) => !ENDED.includes(t.status));
export const endedItems = (list: CupboardItem[]) => list.filter((t) => ENDED.includes(t.status));
export const books = (list: CupboardItem[]) => list.filter((t) => kindOf(t) === 'book');
export const games = (list: CupboardItem[]) => list.filter((t) => kindOf(t) === 'game');
