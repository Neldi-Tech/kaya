// Kaya Sparks · Treasures (10th area · 2026-08-16).
//
// A Treasure is a thing the child owns and is responsible for: what it
// is, WHEN they got it, WHO gave it, WHY it matters — and what has
// happened to it since. The register is the easy half; the half that
// makes it survive is the ritual (the Keeper Check) and the relationship
// (the Giver's Thread).
//
//   Register → Story → Keeper Check → Condition → Lost & Found → Hand-on
//              → Memory Shelf
//
// Locked logic (Kaya-Treasures_LogicTest+Design_2026-08-16, D1–D23):
//   D1  10th Sparks area. /sparks/[kidId]/treasures
//   D3  Photo + name are the only required fields — a half-registered
//       thing beats an unregistered one.
//   D4  Money value is PARENT-ONLY, in a sub-document. The kid sees
//       effort units (Kaya Points / weeks of chores).
//   D5  Parents + the owner by default. Siblings don't see the tile.
//       NO cross-kid totals or value comparisons exist anywhere.
//   D6  Nothing is ever deleted — status moves; ended treasures live on
//       the Memory Shelf.
//   D7  Honesty is the scored behaviour. Self-reporting earns 🫱 Owned It.
//       NOTHING is ever deducted. Breakage is neutral.
//   D8  Care Score = accounted-for + reported-honestly, never a grade.
//   D9  Keeper Check covers the WATCH LIST only, target < 30 seconds.
//   D10 Lost & Found records sightings, NOT suspects — no person field.
//   D12 Hand-on transfers the object's history, never the Care Score.
//   D15 Valuation stays coarse; the child never sees a falling number.
//   D23 The check resurfaces on My Day AND the Workplan, on a parent-set
//       cadence, and escalates rather than slipping away.
//
// Storage — every collection below is reached ONLY through the Admin-API
// gateway at /api/sparks/treasures. The client never touches them, which
// is what makes the parent-only value real AND keeps this build at ZERO
// firestore.rules / index / storage.rules deploys (unlisted paths are
// default-deny):
//   /families/{f}/sparks_treasures/{treasureId}
//   /families/{f}/sparks_treasure_events/{eventId}     ← append-only trail
//   /families/{f}/sparks_treasure_private/{treasureId} ← parents only, ever
//   /families/{f}/sparks_treasure_private/settings__{kidId}
//                                                     ← keeper-check cadence
//
// Mirrors the diary.ts / quests.ts gateway + ping-bus pattern so pages
// get live-ish refresh without onSnapshot.

'use client';

import { auth } from '../firebase';
import { isGuestActive } from '../mockFamily';

// ── Vocabulary (D2) ─────────────────────────────────────────────────

/** D6 · a Treasure is never deleted; it moves through states. The first
 *  five are "live" states, the rest are endings that land it on the
 *  🕰 Memory Shelf. */
export type TreasureStatus =
  | 'kept' | 'lent' | 'lost' | 'broken' | 'repaired'
  | 'handed_on' | 'donated' | 'sold' | 'outgrown' | 'retired';

/** Statuses that mean the treasure's chapter is closed. */
export const ENDED_STATUSES: TreasureStatus[] = [
  'handed_on', 'donated', 'sold', 'outgrown', 'retired',
];

export const isEnded = (s: TreasureStatus): boolean => ENDED_STATUSES.includes(s);

/** D5 · who can see this treasure. Defaults to `private` (parents + the
 *  owner). Siblings never see the tile at all — sharing is a per-item
 *  choice the owner makes, which is the actual social skill. */
export type TreasureVisibility = 'private' | 'siblings' | 'family';

/** F9 · the family iPad problem. A `shared` thing is family-owned with a
 *  named Keeper — the child responsible for it right now. */
export type TreasureOwnership = 'kid' | 'shared';

/** Where a treasure came from. `self` = bought with their own points or
 *  money, which is a genuinely different feeling and worth recording. */
export type GiverKind = 'family' | 'person' | 'self' | 'unknown';

/** What a Keeper Check tap means. Deliberately three options — more and
 *  the 30-second target dies. */
export type CheckResult = 'have' | 'fix' | 'missing';

// ── Categories + the coarse age curve (D15 · F8) ────────────────────

export interface TreasureCategory {
  id: string;
  label: string;
  emoji: string;
  /** Rough useful life in years, used ONLY for the parent-side
   *  "roughly worth now" line. 0 = never depreciates (keepsakes).
   *  No market data, no FX, no resale pricing — on purpose. */
  lifeYears: number;
}

export const TREASURE_CATEGORIES: TreasureCategory[] = [
  { id: 'wearable', label: 'Wearable',        emoji: '⌚️', lifeYears: 5 },
  { id: 'school',   label: 'School',          emoji: '🎒', lifeYears: 3 },
  { id: 'outdoor',  label: 'Outdoor & sport', emoji: '🚲', lifeYears: 6 },
  { id: 'tech',     label: 'Tech',            emoji: '🎮', lifeYears: 4 },
  { id: 'toy',      label: 'Toy',             emoji: '🧸', lifeYears: 5 },
  { id: 'book',     label: 'Book',            emoji: '📚', lifeYears: 10 },
  { id: 'music',    label: 'Music',           emoji: '🎸', lifeYears: 10 },
  { id: 'clothes',  label: 'Clothes & shoes', emoji: '👟', lifeYears: 2 },
  { id: 'keepsake', label: 'Keepsake',        emoji: '💛', lifeYears: 0 },
  { id: 'other',    label: 'Something else',  emoji: '📦', lifeYears: 5 },
];

export function categoryDef(id: string | undefined): TreasureCategory {
  return TREASURE_CATEGORIES.find((c) => c.id === id) ?? TREASURE_CATEGORIES[TREASURE_CATEGORIES.length - 1];
}

/** D15 · the coarse curve. Never falls below 15% — a working thing is
 *  never worth nothing — and keepsakes never fall at all. Always
 *  labelled "roughly" in the UI, always parent-overridable. */
export function residualFraction(categoryId: string | undefined, yearsOld: number): number {
  const { lifeYears } = categoryDef(categoryId);
  if (lifeYears <= 0) return 1;
  const worn = Math.min(1, Math.max(0, yearsOld / lifeYears));
  return Math.max(0.15, 1 - worn * 0.85);
}

// ── Keeper Check cadence (D9 · D23) ─────────────────────────────────

export type CheckCadence = 'weekly' | 'fortnightly' | 'monthly' | 'termly';

export const CADENCE_DAYS: Record<CheckCadence, number> = {
  weekly: 7, fortnightly: 14, monthly: 30, termly: 90,
};

export const CADENCE_LABEL: Record<CheckCadence, string> = {
  weekly: 'Every week',
  fortnightly: 'Twice a month',
  monthly: 'Once a month',
  termly: 'Once a term',
};

/** D23 · parent-set, per kid. Defaults are the approved design's
 *  defaults: twice a month, Sunday 09:00, push after 1 day, email
 *  after 3 — and escalation copy that never blames. */
export interface KeeperCheckSettings {
  cadence: CheckCadence;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Local-day hour the check appears + the reminder fires. */
  hour: number;
  enabled: boolean;
  /** Days after the due date before the parent gets a push. */
  escalatePushAfterDays: number;
  /** Days after the due date before the parent gets an email. */
  escalateEmailAfterDays: number;
  /** Extra recipients on the escalation email (grandparent, tutor). */
  extraEmails?: string[];
}

export const DEFAULT_KEEPER_SETTINGS: KeeperCheckSettings = {
  cadence: 'fortnightly',
  dayOfWeek: 0,
  hour: 9,
  enabled: true,
  escalatePushAfterDays: 1,
  escalateEmailAfterDays: 3,
};

// ── The shapes ──────────────────────────────────────────────────────

export interface TreasureBorrow {
  /** Who has it. A family child, or a free-typed name (a cousin, a
   *  friend) — both are legitimate and both get chased. */
  toChildId?: string;
  toName: string;
  /** YYYY-MM-DD */
  since: string;
  /** YYYY-MM-DD */
  dueOn: string;
}

/** D10 · a sighting. Note there is deliberately NO field for who might
 *  have taken it — the board records WHERE, because that is what
 *  actually finds things. */
export interface TreasureSighting {
  where: string;
  on: string;          // YYYY-MM-DD
  byName: string;
  at: number;          // epoch ms
}

export interface Treasure {
  id: string;
  kidId: string;
  name: string;
  categoryId: string;
  emoji: string;
  /** One hero photo (F3) — the feed-size URL. Memory photos stay in
   *  Moments and are attached by reference, never re-uploaded here. */
  photoUrl?: string;
  photoId?: string;
  thumbUrl?: string;

  // ── The Giver's Thread (D17) ──
  giverKind: GiverKind;
  giverName: string;
  /** Set when the giver is someone in the family/directory. */
  giverUid?: string;
  giverChildId?: string;
  occasion?: string;
  /** YYYY-MM-DD — when they got it. */
  givenOn: string;
  /** The thank-you the kid composed. Sent only by a parent (F17). */
  thankYou?: {
    kind: 'text' | 'audio';
    text?: string;
    audioUrl?: string;
    status: 'draft' | 'approved' | 'sent';
    at: number;
    sentAt?: number;
  };
  /** The giver's reply, pinned to the object forever. */
  giverReply?: { text: string; at: number; byName: string };

  /** "Why this matters to me" (D3 · pathway 2). The field that makes the
   *  teddy rank with the phone. */
  story?: string;

  status: TreasureStatus;
  ownership: TreasureOwnership;
  visibility: TreasureVisibility;
  /** D9 · on the fortnightly Keeper Check. Everything else sweeps once
   *  a term, so the check stays under 30 seconds (R4). */
  watchlisted: boolean;
  /** Trip Mode — packs into the going-away checklist. */
  travels: boolean;
  tags?: string[];
  /** F2 · links the trophy row rather than duplicating it. */
  achievementItemId?: string;

  // ── Condition + check state ──
  lastCheckedOn?: string;      // YYYY-MM-DD
  lastCheckResult?: CheckResult;
  /** How many consecutive checks it has been unaccounted for. Only ≥2
   *  ever moves the Care Score (D8 · R3). */
  missedChecks?: number;
  /** D7 · true when the child reported the loss/break themselves within
   *  the honesty window. Earns 🫱 Owned It. */
  ownedIt?: boolean;

  // ── Lost & Found (D10) ──
  lostSince?: string;          // YYYY-MM-DD
  lastSeenWhere?: string;
  lastSeenOn?: string;
  sightings?: TreasureSighting[];

  // ── Borrow (D11) ──
  borrow?: TreasureBorrow;
  /** Rolling tally for the kid's lending record card. */
  lending?: { out: number; backOnTime: number; backLate: number };

  // ── Endings (D12 · D13) ──
  endedOn?: string;
  endedNote?: string;
  /** Set on hand-on: which child it went to. */
  handedToChildId?: string;
  /** Set on hand-on: the treasure id created for the new keeper. */
  handedToTreasureId?: string;
  /** Set on hand-on of the NEW row: where it came from. */
  handedFromTreasureId?: string;
  handedFromKidId?: string;
  /** Set on sell: the Business listing this went out through. */
  saleRef?: string;

  createdAt: number;
  createdBy: string;
  createdByName: string;
  updatedAt?: number;
  updatedByName?: string;
}

/** Append-only trail. This IS the record — every screen that says
 *  "its story so far" reads these. */
export type TreasureEventKind =
  | 'registered' | 'thanked' | 'reply' | 'story'
  | 'check' | 'broken' | 'repaired' | 'lost' | 'found' | 'sighting'
  | 'lent' | 'returned' | 'shared'
  | 'handed_on' | 'donated' | 'sold' | 'outgrown' | 'retired'
  | 'value_set' | 'vault_promoted';

export interface TreasureEvent {
  id: string;
  treasureId: string;
  kidId: string;
  kind: TreasureEventKind;
  /** YYYY-MM-DD, LOCAL day (never UTC). */
  on: string;
  at: number;
  byName: string;
  note?: string;
  /** D7 · stamped on self-reported losses/breaks. */
  ownedIt?: boolean;
}

/** D4 · PARENTS ONLY. Never a field on the Treasure, so it cannot leak
 *  through a shared screen, an export, a PDF or an AI reply. */
export interface TreasurePrivate {
  treasureId: string;
  valueCents?: number;
  currency?: string;
  purchasedOn?: string;
  serial?: string;
  receiptUrls?: string[];
  warrantyMonths?: number;
  warrantyEndsOn?: string;
  /** Set once promoted into Wealth → Valuables & Collectibles. */
  vaultAssetId?: string;
  note?: string;
}

// ── Care Score (D8) ─────────────────────────────────────────────────

export interface CareScore {
  /** 0–100. Never a grade, never compared across children. */
  score: number;
  live: number;
  accountedFor: number;
  /** Unaccounted for across TWO OR MORE consecutive checks — the only
   *  thing that ever moves the score down. */
  adrift: number;
  ownedIt: number;
  /** The plain-English line shown under the ring. Growth-voice, always. */
  line: string;
}

/** D8 · accounted-for + reported-honestly, over the live register.
 *
 *  Deliberately NOT counted: breakage (R3 — an accident is not a
 *  failure), items ended on purpose, or anything missing for less than
 *  two checks (it is probably in the car). If reporting had a cost,
 *  children would stop reporting and the register would become
 *  fiction — which is the one outcome that makes this feature useless. */
export function computeCareScore(treasures: Treasure[], kidName = 'You'): CareScore {
  const live = treasures.filter((t) => !isEnded(t.status));
  const adrift = live.filter((t) => (t.missedChecks ?? 0) >= 2).length;
  const accountedFor = live.length - adrift;
  const ownedIt = treasures.filter((t) => t.ownedIt).length;
  const score = live.length === 0 ? 100 : Math.round((accountedFor / live.length) * 100);

  const who = kidName === 'You' ? 'You' : kidName;
  const verb = who === 'You' ? "You've" : `${who} has`;
  let line: string;
  if (live.length === 0) {
    line = 'Nothing registered yet — add the ten things you would be saddest to lose.';
  } else if (adrift === 0 && ownedIt > 0) {
    line = `${verb} kept track of all ${live.length}, and told us straight away when something went wrong. That's the job.`;
  } else if (adrift === 0) {
    line = `${verb} kept track of all ${live.length} things this term.`;
  } else {
    line = `${accountedFor} of ${live.length} accounted for. Let's find the ${adrift === 1 ? 'other one' : `other ${adrift}`} together — nothing is lost for good yet.`;
  }
  return { score, live: live.length, accountedFor, adrift, ownedIt, line };
}

// ── Small derivations the UI shares ─────────────────────────────────

export const STATUS_LABEL: Record<TreasureStatus, string> = {
  kept: 'kept', lent: 'lent out', lost: 'missing', broken: 'needs fixing',
  repaired: 'repaired', handed_on: 'handed on', donated: 'donated',
  sold: 'sold', outgrown: 'outgrown', retired: 'retired',
};

export const STATUS_CHIP: Record<TreasureStatus, { emoji: string; bg: string; fg: string }> = {
  kept:      { emoji: '✅', bg: '#E2F3EE', fg: '#0E6B5E' },
  lent:      { emoji: '🤝', bg: '#EFE8FF', fg: '#5A3CB8' },
  lost:      { emoji: '❓', bg: '#FDE8E8', fg: '#C0392B' },
  broken:    { emoji: '🔧', bg: '#FFF1C9', fg: '#8A6800' },
  repaired:  { emoji: '🔧', bg: '#FFF1C9', fg: '#8A6800' },
  handed_on: { emoji: '🤝', bg: '#EEF0F4', fg: '#5B6B8C' },
  donated:   { emoji: '💚', bg: '#EEF0F4', fg: '#5B6B8C' },
  sold:      { emoji: '💰', bg: '#EEF0F4', fg: '#5B6B8C' },
  outgrown:  { emoji: '🌱', bg: '#EEF0F4', fg: '#5B6B8C' },
  retired:   { emoji: '🕰', bg: '#EEF0F4', fg: '#5B6B8C' },
};

/** Days between two YYYY-MM-DD strings, LOCAL-day arithmetic. */
export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const a = Date.UTC(fy, (fm || 1) - 1, fd || 1);
  const b = Date.UTC(ty, (tm || 1) - 1, td || 1);
  return Math.round((b - a) / 86400000);
}

/** Local-time YYYY-MM-DD. Day boundaries are LOCAL, never UTC. */
export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** D4 · the child's currency. Money is converted into the effort it
 *  actually took, because "about 6 weeks of chores" is a sentence a
 *  9-year-old can act on and "TZS 420,000" is not. */
export function effortLine(
  points: number,
  pointsPerWeek: number,
): string {
  if (!points || points <= 0) return '';
  const weeks = pointsPerWeek > 0 ? points / pointsPerWeek : 0;
  const pts = `≈ ${Math.round(points)} Kaya Points`;
  if (!weeks) return pts;
  if (weeks < 1.5) return `${pts} · about a week of chores`;
  if (weeks < 8) return `${pts} · about ${Math.round(weeks)} weeks of chores`;
  const months = Math.round(weeks / 4.3);
  return `${pts} · about ${months} month${months === 1 ? '' : 's'} of chores`;
}

/** Human one-liner for a treasure card's second line. */
export function giverLine(t: Treasure): string {
  if (t.giverKind === 'self') return 'Bought it yourself';
  if (t.giverKind === 'unknown' || !t.giverName) return t.occasion || '';
  return t.occasion ? `${t.giverName} · ${t.occasion}` : t.giverName;
}

// ── Gateway ─────────────────────────────────────────────────────────

async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}

export async function treasuresApi<T>(
  action: string, payload: Record<string, unknown> = {},
): Promise<T> {
  const token = await idToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/sparks/treasures', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || `treasures-${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Refresh bus — subscribers keyed by `${familyId}:${kidId}`. Writes ping
// the bus; subscribers re-fetch. Mirrors diary.ts / quests.ts exactly.
const listeners = new Map<string, Set<() => void>>();

export function pingTreasures(familyId: string, kidId: string) {
  const set = listeners.get(`${familyId}:${kidId}`);
  if (set) for (const fn of set) { try { fn(); } catch { /* noop */ } }
}

/** Fetch-once + re-fetch-on-write subscription to a kid's treasures. */
export function subscribeToTreasures(
  familyId: string, kidId: string,
  cb: (treasures: Treasure[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  let dead = false;
  const key = `${familyId}:${kidId}`;
  const load = () => {
    treasuresApi<{ treasures: Treasure[] }>('list', { kidId })
      .then((r) => { if (!dead) cb(r.treasures || []); })
      .catch(() => { if (!dead) cb([]); });
  };
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(load);
  load();
  return () => {
    dead = true;
    const s = listeners.get(key);
    if (s) { s.delete(load); if (!s.size) listeners.delete(key); }
  };
}

// ── Reads ───────────────────────────────────────────────────────────

export async function listTreasures(kidId: string): Promise<Treasure[]> {
  const { treasures } = await treasuresApi<{ treasures: Treasure[] }>('list', { kidId });
  return treasures || [];
}

export async function getTreasure(treasureId: string): Promise<{
  treasure: Treasure;
  events: TreasureEvent[];
  /** D4 · parents only. Absent for kids, siblings and helpers — the
   *  gateway does not send it, so there is nothing to redact. */
  private?: TreasurePrivate;
  /** R5 · parent-only "roughly worth now". Never on a kid screen. */
  worthNowCents?: number;
  /** D4 · what the CHILD sees instead of money — the same value in the
   *  effort it actually took. `pointsPerWeek` is 0 until there is enough
   *  of their own history to make the weeks figure true. */
  effort?: { points: number; pointsPerWeek: number };
}> {
  return treasuresApi('get', { treasureId });
}

/** D5 · the parent's cross-kid view. Carries behaviour for every child
 *  and, for parents only, value — but the rows are never ranked and no
 *  total is ever compared between children. */
export interface TreasuresRollUp {
  kids: Array<{
    kidId: string; name: string; emoji: string;
    live: number; careScore: number; missing: number; lent: number; ownedIt: number;
    checkDueOn: string; checkOverdueDays: number; checkItems: number; cadence: CheckCadence;
    costCents: number; nowCents: number; currency: string;
  }>;
  warrantyDue: Array<{
    treasureId: string; kidId: string; kidName: string;
    name: string; endsOn: string; days: number;
  }>;
  thankYous: Array<{
    treasureId: string; kidId: string; kidName: string;
    name: string; giverName: string; kind: string; text: string;
  }>;
}

export async function fetchTreasuresRollUp(): Promise<TreasuresRollUp> {
  return treasuresApi<TreasuresRollUp>('roll-up');
}

/** One call that answers "what is open right now?" for a kid — the nav
 *  badge, the My Day card, the Workplan row and the Sparks Today strip
 *  all need the same answer and none should cost N round-trips (D23). */
export interface TreasuresToday {
  date: string;
  live: number;
  /** The Keeper Check state — the whole of D23 in one object. */
  check: {
    due: boolean;
    dueOn: string;
    /** Days past the due date. 0 = due today, >0 = slipping. */
    overdueDays: number;
    /** How many treasures the check covers (the watch list). */
    items: number;
    cadence: CheckCadence;
    enabled: boolean;
    lastDoneOn?: string;
  };
  missing: number;
  dueBack: number;
  careScore: number;
  openCount: number;
}

export async function fetchTreasuresToday(kidId: string): Promise<TreasuresToday> {
  return treasuresApi<TreasuresToday>('today', { kidId });
}

// ── Writes ──────────────────────────────────────────────────────────

export interface NewTreasureInput {
  kidId: string;
  name: string;
  categoryId: string;
  emoji?: string;
  photoUrl?: string;
  photoId?: string;
  thumbUrl?: string;
  giverKind: GiverKind;
  giverName?: string;
  giverUid?: string;
  giverChildId?: string;
  occasion?: string;
  givenOn: string;
  story?: string;
  ownership?: TreasureOwnership;
  watchlisted?: boolean;
  travels?: boolean;
  achievementItemId?: string;
}

export async function createTreasure(
  familyId: string, input: NewTreasureInput,
): Promise<string> {
  const { id } = await treasuresApi<{ id: string }>('create', { ...input });
  pingTreasures(familyId, input.kidId);
  return id;
}

export async function updateTreasure(
  familyId: string, kidId: string, treasureId: string,
  patch: Partial<Pick<Treasure,
    'name' | 'categoryId' | 'emoji' | 'story' | 'occasion' | 'givenOn' |
    'visibility' | 'ownership' | 'watchlisted' | 'travels' | 'photoUrl' |
    'thumbUrl' | 'photoId' | 'giverName' | 'giverKind'>>,
): Promise<void> {
  await treasuresApi('update', { treasureId, patch });
  pingTreasures(familyId, kidId);
}

/** D6 · the ONLY true deletion, parents only, within 24h, for a
 *  mis-entry. Everything else is a status move. */
export async function deleteTreasure(
  familyId: string, kidId: string, treasureId: string,
): Promise<void> {
  await treasuresApi('delete', { treasureId });
  pingTreasures(familyId, kidId);
}

/** D3 · "why this matters to me". */
export async function setStory(
  familyId: string, kidId: string, treasureId: string, story: string,
): Promise<void> {
  await treasuresApi('story-set', { treasureId, story });
  pingTreasures(familyId, kidId);
}

// ── Keeper Check (D9 · D23) ─────────────────────────────────────────

export interface CheckSubmission {
  treasureId: string;
  result: CheckResult;
  /** Only for `missing` — where they had it last (D10). */
  lastSeenWhere?: string;
}

export async function submitKeeperCheck(
  familyId: string, kidId: string, results: CheckSubmission[],
): Promise<{ ok: true; ownedIt: number; missing: number }> {
  const r = await treasuresApi<{ ok: true; ownedIt: number; missing: number }>(
    'check-submit', { kidId, results },
  );
  pingTreasures(familyId, kidId);
  return r;
}

export async function getKeeperSettings(kidId: string): Promise<KeeperCheckSettings> {
  const { settings } = await treasuresApi<{ settings: KeeperCheckSettings }>('settings-get', { kidId });
  return { ...DEFAULT_KEEPER_SETTINGS, ...settings };
}

export async function setKeeperSettings(
  familyId: string, kidId: string, settings: Partial<KeeperCheckSettings>,
): Promise<void> {
  await treasuresApi('settings-set', { kidId, settings });
  pingTreasures(familyId, kidId);
}

// ── Condition (D7) ──────────────────────────────────────────────────

export async function reportCondition(
  familyId: string, kidId: string, treasureId: string,
  status: Extract<TreasureStatus, 'broken' | 'repaired' | 'lost' | 'kept'>,
  note?: string, lastSeenWhere?: string,
): Promise<{ ownedIt: boolean }> {
  const r = await treasuresApi<{ ownedIt: boolean }>('condition', {
    treasureId, status, note, lastSeenWhere,
  });
  pingTreasures(familyId, kidId);
  return r;
}

/** D10 · found. Appends to the SAME alert entry and sends one quiet ✅ —
 *  never a second alarming message (R1). */
export async function markFound(
  familyId: string, kidId: string, treasureId: string, where?: string,
): Promise<void> {
  await treasuresApi('found', { treasureId, where });
  pingTreasures(familyId, kidId);
}

/** D10 · a sighting. WHERE it was seen — there is no field for who. */
export async function addSighting(
  familyId: string, kidId: string, treasureId: string, where: string,
): Promise<void> {
  await treasuresApi('sighting', { treasureId, where });
  pingTreasures(familyId, kidId);
}

// ── Borrow & Return (D11) ───────────────────────────────────────────

export async function lendTreasure(
  familyId: string, kidId: string, treasureId: string,
  to: { toChildId?: string; toName: string; dueOn: string },
): Promise<void> {
  await treasuresApi('lend', { treasureId, ...to });
  pingTreasures(familyId, kidId);
}

export async function returnTreasure(
  familyId: string, kidId: string, treasureId: string,
): Promise<void> {
  await treasuresApi('return', { treasureId });
  pingTreasures(familyId, kidId);
}

export async function extendBorrow(
  familyId: string, kidId: string, treasureId: string, dueOn: string,
): Promise<void> {
  await treasuresApi('lend-extend', { treasureId, dueOn });
  pingTreasures(familyId, kidId);
}

// ── Values, parents only (D4) ───────────────────────────────────────

export async function setTreasureValue(
  familyId: string, kidId: string, treasureId: string,
  patch: Partial<TreasurePrivate>,
): Promise<void> {
  await treasuresApi('private-set', { treasureId, patch });
  pingTreasures(familyId, kidId);
}

// ── Endings (D6 · D12 · D13) ────────────────────────────────────────

export async function endTreasure(
  familyId: string, kidId: string, treasureId: string,
  how: Extract<TreasureStatus, 'handed_on' | 'donated' | 'sold' | 'outgrown' | 'retired'>,
  opts: { toChildId?: string; note?: string; saleRef?: string } = {},
): Promise<{ ok: true; newTreasureId?: string }> {
  const r = await treasuresApi<{ ok: true; newTreasureId?: string }>('end', {
    treasureId, how, ...opts,
  });
  pingTreasures(familyId, kidId);
  if (opts.toChildId) pingTreasures(familyId, opts.toChildId);
  return r;
}

// ── ✨ The Wish Shelf (pathway 12) ──────────────────────────────────
//
// Wish → gift → treasure → thank-you → care → hand-on. A child adds
// what they hope for; the gateway mirrors it into the family's existing
// 🎁 Gift Brain stash, which already surfaces ideas 14 days before a
// birthday. The mirror flows ONE way only — Gift Brain is parents-only
// by design, because it must never spoil a surprise.

export interface Wish {
  id: string;
  kidId: string;
  text: string;
  at: number;
  on: string;
  byName: string;
}

export async function listWishes(kidId: string): Promise<Wish[]> {
  const { wishes } = await treasuresApi<{ wishes: Wish[] }>('wish-list', { kidId });
  return wishes || [];
}

export async function addWish(kidId: string, text: string): Promise<string> {
  const { id } = await treasuresApi<{ id: string }>('wish-add', { kidId, text });
  return id;
}

export async function removeWish(kidId: string, wishId: string): Promise<void> {
  await treasuresApi('wish-remove', { kidId, wishId });
}

// ── Selectors the pages share ───────────────────────────────────────

export const liveTreasures = (list: Treasure[]) => list.filter((t) => !isEnded(t.status));
export const memoryShelf   = (list: Treasure[]) => list.filter((t) => isEnded(t.status));
export const missingItems  = (list: Treasure[]) => list.filter((t) => t.status === 'lost');
export const lentItems     = (list: Treasure[]) => list.filter((t) => t.status === 'lent');
export const watchList     = (list: Treasure[]) =>
  liveTreasures(list).filter((t) => t.watchlisted);

/** D5 · what a viewer other than the owner or a parent may see. Applied
 *  server-side too — this is only so the UI never renders a flash of
 *  something it will lose. */
export const visibleToSibling = (list: Treasure[]) =>
  list.filter((t) => t.visibility === 'siblings' || t.visibility === 'family');
