// ✕ Recognition dismissals — "this proposal isn't right" + 🧠 Kaya learns.
//
// Pure, shared by client (wizard sheet, Hit-Map, settings insight) and
// server (gateway validation, cron engine). No Firebase imports here.
//
// A parent can dismiss a proposed round item with a REASON CODE; the code
// maps to a deterministic effect in the next round build (see EFFECTS).
// Kids never see dismissals. Nothing is minted, nobody is notified.

export type DismissCode = 'already_recognized' | 'bad_timing' | 'data_wrong' | 'away' | 'other';

export interface DismissReason {
  code: DismissCode;
  emoji: string;
  label: string;
  sub: string;
  /** Shown on the chip — what Kaya will do next. */
  effect: string;
  noteRequired?: boolean;
}

export const DISMISS_REASONS: DismissReason[] = [
  { code: 'already_recognized', emoji: '🙅', label: 'Already recognized', sub: 'In person, in chat, or elsewhere outside Kaya.', effect: 'resets the "waiting" clock · no points, no card' },
  { code: 'bad_timing', emoji: '⏰', label: 'Not the right moment', sub: 'Behaviour / discipline is being handled right now.', effect: 'pauses this kid in rounds for 7 days' },
  { code: 'data_wrong', emoji: '📊', label: 'The facts are off', sub: "Ratings or records don't match reality.", effect: 'this kind of proposal paused for this kid 14 days · flagged' },
  { code: 'away', emoji: '🧳', label: 'Away / sick / holiday', sub: "The quiet period wasn't a gap in effort.", effect: 'waiting clock paused from today' },
  { code: 'other', emoji: '✍️', label: 'Other', sub: 'Tell Kaya in your words (required).', effect: 'this kind paused for this kid 7 days', noteRequired: true },
];

export const DISMISS_CODES = DISMISS_REASONS.map((r) => r.code);
export const isDismissCode = (v: unknown): v is DismissCode =>
  typeof v === 'string' && (DISMISS_CODES as string[]).includes(v);
export const dismissReason = (code: string): DismissReason =>
  DISMISS_REASONS.find((r) => r.code === code) || DISMISS_REASONS[DISMISS_REASONS.length - 1];

export const DISMISS_NOTE_MAX = 140;
/** Undo / edit window = the round's 72h window. */
export const ROUND_WINDOW_MS = 72 * 3600_000;
/** How far back the engine reads dismissals when it builds a round. */
export const DISMISS_MEMORY_DAYS = 60;

/** Map key inside recognitionRounds/{date}.dismissed */
export const dismissKey = (kidId: string, kind: string) => `${kidId}:${kind}`;

export interface RoundDismissal {
  by: string;
  byName: string;
  at: number;
  code: DismissCode;
  note?: string;
}

/** Learning-log record: families/{f}/recognitionDismissals/{auto}. */
export interface DismissalRecord extends RoundDismissal {
  kidId: string;
  kind: string;
  roundDate: string;
  line?: string;
  daysSince?: number;
  lens?: string;
  termId?: string;
  giftRewardId?: string;
  /** data_wrong → flagged for later threshold tuning. */
  flag?: boolean;
}

// ── Engine memory (what the cron derives from the log) ────────────

export interface DismissMemory {
  /** kidId → ms: treated as "last award" for COVERAGE only (🙅 / 🧳). */
  coverageClock: Map<string, number>;
  /** kidId → until-ms: excluded from everything (⏰ bad_timing, 7d). */
  pausedKids: Map<string, number>;
  /** `${kidId}:${kind}` → until-ms (📊 14d, ✍️ 7d). */
  pausedKinds: Map<string, number>;
  /** 👑 leader termIds dismissed → never re-proposed. */
  dismissedTerms: Set<string>;
  count: number;
}

const DAY = 86400_000;

export function buildDismissMemory(records: DismissalRecord[], nowMs: number): DismissMemory {
  const mem: DismissMemory = {
    coverageClock: new Map(), pausedKids: new Map(), pausedKinds: new Map(),
    dismissedTerms: new Set(), count: 0,
  };
  for (const r of records) {
    if (!r.kidId || !r.code) continue;
    mem.count++;
    const k = dismissKey(r.kidId, r.kind);
    const bump = (map: Map<string, number>, key: string, until: number) => {
      if (until <= nowMs) return;
      if ((map.get(key) || 0) < until) map.set(key, until);
    };
    switch (r.code) {
      case 'already_recognized':
      case 'away':
        if ((mem.coverageClock.get(r.kidId) || 0) < r.at) mem.coverageClock.set(r.kidId, r.at);
        break;
      case 'bad_timing':
        bump(mem.pausedKids, r.kidId, r.at + 7 * DAY);
        break;
      case 'data_wrong':
        bump(mem.pausedKinds, k, r.at + 14 * DAY);
        break;
      case 'other':
      default:
        bump(mem.pausedKinds, k, r.at + 7 * DAY);
        break;
    }
    if (r.termId) mem.dismissedTerms.add(r.termId);
  }
  return mem;
}

/** True when this kid+kind must not be proposed right now. */
export function isSuppressed(mem: DismissMemory, kidId: string, kind: string, nowMs: number): boolean {
  const pk = mem.pausedKids.get(kidId);
  if (pk && pk > nowMs) return true;
  const pkk = mem.pausedKinds.get(dismissKey(kidId, kind));
  if (pkk && pkk > nowMs) return true;
  return false;
}

// ── Round outcome (shared by Hit-Map, Home strip, wizard, stats) ──

export interface RoundLike {
  date: string;
  items: Array<{ kidId: string; kind: string }>;
  dismissed?: Record<string, RoundDismissal>;
}

/** Items still OPEN in a round: not celebrated (card since round start)
 *  and not dismissed. */
export function openRoundItems<T extends { kidId: string; kind: string }>(
  round: { items: T[]; dismissed?: Record<string, unknown> },
  celebratedKidIds: Set<string>,
): T[] {
  const dismissed = round.dismissed || {};
  return round.items.filter((i) => !celebratedKidIds.has(i.kidId) && !dismissed[dismissKey(i.kidId, i.kind)]);
}

export type RoundOutcome = 'answered' | 'reviewed' | 'open' | 'missed';

/** Classify a round day. `cardsAt` = card timestamps (ms) in the family.
 *  answered = ≥1 card within 72h · reviewed = no card but every item
 *  dismissed · open = window still running with open items · missed. */
export function roundOutcome(round: RoundLike, cardsAt: number[], nowMs: number): RoundOutcome {
  const start = new Date(`${round.date}T00:00:00`).getTime();
  const end = start + ROUND_WINDOW_MS;
  if (cardsAt.some((t) => t >= start && t < end)) return 'answered';
  const dismissed = round.dismissed || {};
  const allDismissed = round.items.length > 0 && round.items.every((i) => !!dismissed[dismissKey(i.kidId, i.kind)]);
  if (allDismissed) return 'reviewed';
  return nowMs < end ? 'open' : 'missed';
}

/** 🔥 consecutive HANDLED rounds (answered or reviewed), newest first;
 *  a round still open (inside 72h, items open) is skipped, not broken. */
export function roundStreak(rounds: RoundLike[], cardsAt: number[], nowMs: number): number {
  let streak = 0;
  for (const r of [...rounds].sort((a, b) => b.date.localeCompare(a.date))) {
    const o = roundOutcome(r, cardsAt, nowMs);
    if (o === 'open') continue;
    if (o === 'answered' || o === 'reviewed') streak++; else break;
  }
  return streak;
}

/** 🧠 summary line inputs: counts by code within N days + currently
 *  paused kids (for the learned line / settings insight). */
export function summarizeDismissals(records: DismissalRecord[], nowMs: number, days = 30) {
  const since = nowMs - days * DAY;
  const recent = records.filter((r) => r.at >= since);
  const byCode = new Map<DismissCode, number>();
  for (const r of recent) byCode.set(r.code, (byCode.get(r.code) || 0) + 1);
  const mem = buildDismissMemory(records, nowMs);
  const paused: Array<{ kidId: string; until?: number; kind?: string; clock?: number }> = [];
  for (const [kidId, until] of mem.pausedKids) paused.push({ kidId, until });
  for (const [key, until] of mem.pausedKinds) {
    const [kidId, kind] = key.split(':');
    paused.push({ kidId, kind, until });
  }
  for (const [kidId, clock] of mem.coverageClock) {
    if (nowMs - clock < 4 * DAY) paused.push({ kidId, clock });
  }
  return { total: recent.length, byCode, paused, mem };
}
